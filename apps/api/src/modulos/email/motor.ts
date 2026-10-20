import type { EmailRecebido } from '@prospeccao/integrations/email';
import { AppError, type ClasseResposta, classificarRespostaSimples, montarEmail } from '@prospeccao/shared';
import { usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { urlPublicaApi } from '../../endereco.js';
import { dentroDoHorario } from '../agente/motor.js';
import * as funil from '../funil/repositorio.js';
import { notificarDono } from '../notificacoes/repositorio.js';
import * as repo from './repositorio.js';

/**
 * Motor do e-mail (a cada 30 s, uma instância por vez):
 *  1. follow-ups: quem não respondeu ganha o próximo e-mail da sequência no dia certo;
 *  2. envio: um e-mail por vez, dentro do horário, do limite do dia e do intervalo;
 *  3. respostas e avisos chegam pelo webhook do Resend (processarEvento); quem tem interesse entra no SDR.
 */

const LOCK = 7_301_028;
const AUTOR = 'e-mail automático';
type Deps = Pick<DepsApi, 'pool' | 'log' | 'email' | 'classificarEmail' | 'origens'>;

/** Endereços dos links rastreados (pixel, clique, descadastro). */
export function enderecosDoEnvio(origens: string[], token: string) {
  const base = urlPublicaApi(origens);
  return {
    pixel: `${base}/e/a/${token}.gif`,
    clique: (i: number) => `${base}/e/c/${token}/${i}`,
    descadastro: `${base}/e/sair/${token}`,
  };
}

/** 1. Próximo passo da sequência para quem não respondeu no prazo. */
export async function agendarSeguimentos(deps: Pick<Deps, 'pool'>): Promise<number> {
  const { rowCount } = await deps.pool.query(
    `INSERT INTO comercial.envios_email (campanha_email_id, empresa_id, email, passo)
     SELECT en.campanha_email_id, en.empresa_id, en.email, en.passo + 1
       FROM comercial.envios_email en
       JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
      WHERE ce.status = 'enviando' AND en.status = 'enviado'
        AND en.passo < jsonb_array_length(ce.passos)
        AND en.enviado_em < now() - make_interval(days => (ce.passos -> en.passo ->> 'dias')::int)
        AND NOT EXISTS (SELECT 1 FROM comercial.envios_email x
                         WHERE x.campanha_email_id = en.campanha_email_id AND x.empresa_id = en.empresa_id
                           AND (x.respondido_em IS NOT NULL OR x.passo > en.passo))
        AND NOT EXISTS (SELECT 1 FROM comercial.descadastros_email d WHERE d.email = lower(en.email))
     ON CONFLICT DO NOTHING`,
  );
  return rowCount ?? 0;
}

/** Campanha sem nada na fila e sem follow-up por vir: concluída. */
export async function concluirCampanhas(deps: Pick<Deps, 'pool'>): Promise<void> {
  await deps.pool.query(
    `UPDATE comercial.campanhas_email ce SET status = 'concluida', concluida_em = now()
      WHERE ce.status = 'enviando'
        AND NOT EXISTS (SELECT 1 FROM comercial.envios_email x WHERE x.campanha_email_id = ce.id AND x.status = 'na_fila')
        AND NOT EXISTS (
          SELECT 1 FROM comercial.envios_email x
           WHERE x.campanha_email_id = ce.id AND x.status = 'enviado' AND x.passo < jsonb_array_length(ce.passos)
             AND NOT EXISTS (SELECT 1 FROM comercial.envios_email y
                              WHERE y.campanha_email_id = ce.id AND y.empresa_id = x.empresa_id
                                AND (y.passo > x.passo OR y.respondido_em IS NOT NULL))
             AND NOT EXISTS (SELECT 1 FROM comercial.descadastros_email d WHERE d.email = lower(x.email)))`,
  );
}

/**
 * Para onde vai a resposta do lead: com o domínio de recebimento do Resend, um endereço só deste
 * envio (r-<token>@…), assim a resposta volta para o sistema e já se sabe de quem é.
 */
export function enderecoDeResposta(
  deps: Pick<Deps, 'email'>,
  cfg: Pick<repo.ConfigEmail, 'remetenteNome' | 'responderPara'>,
  token: string | null,
): string | null {
  const dominio = deps.email?.dominioRespostas;
  if (dominio) return `${cfg.remetenteNome.replace(/["<>]/g, '')} <r-${token ?? 'geral'}@${dominio}>`;
  return cfg.responderPara;
}

/** Erro do servidor de e-mail que quer dizer "esse endereço não existe". */
function enderecoNaoExiste(erro: unknown): boolean {
  const e = erro as { responseCode?: number; message?: string };
  return (
    (e.responseCode != null && [550, 551, 553].includes(e.responseCode)) ||
    /user unknown|no such user|does not exist|mailbox unavailable|recipient address rejected|não existe|invalid `to`|invalid email/i.test(
      e.message ?? '',
    )
  );
}

async function marcarEmailInvalido(deps: Pick<Deps, 'pool'>, empresaId: number, email: string) {
  await deps.pool.query(
    `UPDATE enriquecimento.contatos SET status = 'invalido', rotulo = 'E-mail voltou: não existe'
      WHERE empresa_id = $1 AND canal = 'email' AND lower(valor) = lower($2)`,
    [empresaId, email],
  );
}

/** 2. Envia o próximo e-mail da fila, se o horário, o limite e o intervalo deixarem. */
export async function enviarProximo(deps: Deps, cfg: repo.ConfigEmail, agora = new Date()): Promise<boolean> {
  if (!deps.email || !cfg.ligado || !dentroDoHorario(cfg, agora)) return false;
  const { rows: uso } = await deps.pool.query<{ hoje: number; ultima: string | null }>(
    `SELECT count(*) FILTER (WHERE enviado_em >= ${repo.HOJE_SP})::int AS hoje, max(enviado_em) AS ultima
       FROM comercial.envios_email WHERE status = 'enviado'`,
  );
  if ((uso[0]?.hoje ?? 0) >= cfg.limiteDia) return false;
  const ultima = uso[0]?.ultima ? new Date(uso[0].ultima).getTime() : 0;
  if (agora.getTime() - ultima < cfg.intervaloSeg * 1000) return false;

  // Até 20 tentativas: pula (cancela) quem deixou de poder receber desde que entrou na fila.
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const { rows } = await deps.pool.query<{
      id: number;
      empresa_id: number;
      email: string;
      passo: number;
      token: string;
      campanha: number;
      passos: { modeloId: number }[];
    }>(
      `SELECT en.id::int, en.empresa_id::int, en.email, en.passo, en.token, ce.id AS campanha, ce.passos
         FROM comercial.envios_email en
         JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
        WHERE en.status = 'na_fila' AND ce.status = 'enviando'
        ORDER BY en.passo DESC, en.id
        LIMIT 1`,
    );
    const en = rows[0];
    if (!en) return false;

    const { rows: bloqueio } = await deps.pool.query<{ motivo: string }>(
      `SELECT 'Pediu para sair da lista' AS motivo FROM comercial.descadastros_email WHERE email = lower($2)
       UNION ALL
       SELECT 'Já respondeu' FROM comercial.envios_email
        WHERE campanha_email_id = $3 AND empresa_id = $1 AND respondido_em IS NOT NULL
       UNION ALL
       SELECT 'Descartado no funil' FROM comercial.oportunidades WHERE empresa_id = $1 AND etapa = 'descartado'
       LIMIT 1`,
      [en.empresa_id, en.email, en.campanha],
    );
    if (bloqueio[0]) {
      await deps.pool.query(
        `UPDATE comercial.envios_email SET status = 'cancelado', erro = $2 WHERE id = $1`,
        [en.id, bloqueio[0].motivo],
      );
      continue;
    }

    try {
      const passo = en.passos[en.passo - 1];
      if (!passo) throw AppError.invalido('Passo da sequência não existe');
      const modelo = await repo.obterModelo(deps.pool, passo.modeloId);
      const v = await repo.variaveisDoLead(deps.pool, en.empresa_id);
      const end = enderecosDoEnvio(deps.origens, en.token);
      const e = montarEmail(modelo, v, {
        assinatura: cfg.assinatura,
        descadastro: end.descadastro,
        pixel: cfg.rastrearAbertura ? end.pixel : null,
        rastrearLink: cfg.rastrearAbertura ? (i) => end.clique(i) : null,
      });
      // Follow-up vai na mesma conversa do e-mail anterior.
      const { rows: anteriores } = await deps.pool.query<{ message_id: string }>(
        `SELECT message_id FROM comercial.envios_email
          WHERE campanha_email_id = $1 AND empresa_id = $2 AND passo < $3 AND message_id IS NOT NULL
          ORDER BY passo`,
        [en.campanha, en.empresa_id, en.passo],
      );
      const refs = anteriores.map((a) => a.message_id);
      const r = await deps.email.enviar({
        de: { nome: cfg.remetenteNome, email: deps.email.remetente },
        para: en.email,
        responderPara: enderecoDeResposta(deps, cfg, en.token),
        assunto: e.assunto,
        html: e.html,
        texto: e.texto,
        anexos: await repo.anexosDoModelo(deps.pool, modelo.anexos),
        emRespostaA: refs.at(-1) ?? null,
        referencias: refs,
        descadastro: end.descadastro,
        etiquetas: { envio: String(en.id) },
        chave: `envio-${en.id}`,
      });
      await deps.pool.query(
        `UPDATE comercial.envios_email
            SET status = 'enviado', enviado_em = now(), resend_id = $2, assunto = $3, links = $4, erro = NULL
          WHERE id = $1`,
        [en.id, r.id, e.assunto, e.links],
      );
      // Lead que já está no funil: o e-mail entra no histórico (sem mudar a etapa).
      await deps.pool.query(
        `INSERT INTO comercial.atividades (empresa_id, tipo, direcao, texto, contato, autor)
         SELECT $1, 'email', 'enviada', $2, $3, $4 FROM comercial.oportunidades WHERE empresa_id = $1`,
        [en.empresa_id, `E-mail: ${e.assunto}`, en.email, AUTOR],
      );
      return true;
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      const devolvido = enderecoNaoExiste(erro);
      await deps.pool.query(`UPDATE comercial.envios_email SET status = $2, erro = $3 WHERE id = $1`, [
        en.id,
        devolvido ? 'devolvido' : 'erro',
        msg.slice(0, 300),
      ]);
      if (devolvido) await marcarEmailInvalido(deps, en.empresa_id, en.email);
      deps.log.warn({ err: erro, envio: en.id }, 'e-mail: falha ao enviar');
      return false;
    }
  }
  return false;
}

/* ───────────── 3. Respostas ───────────── */

async function classificar(
  deps: Deps,
  r: EmailRecebido,
): Promise<{ classe: ClasseResposta; resumo: string | null; por: 'ia' | 'regra' }> {
  if (r.automatica) return { classe: 'automatica', resumo: null, por: 'regra' };
  if (deps.classificarEmail && r.texto.trim()) {
    try {
      const { rows } = await deps.pool.query<{ sobre: string }>(
        'SELECT sobre_empresa AS sobre FROM comercial.config_agente LIMIT 1',
      );
      const a = await deps.classificarEmail({
        sobreEmpresa: rows[0]?.sobre ?? '',
        assunto: r.assunto,
        texto: r.texto,
      });
      if (a) return { classe: a.classe, resumo: a.resumo || null, por: 'ia' };
    } catch (erro) {
      deps.log.warn({ err: erro }, 'e-mail: a IA não classificou a resposta (usando a regra)');
    }
  }
  return { classe: classificarRespostaSimples(r.assunto, r.texto), resumo: null, por: 'regra' };
}

/** O que acontece com o lead depois da resposta (também usado quando você corrige a classificação). */
export async function agirPelaResposta(
  deps: Pick<Deps, 'pool'>,
  resposta: {
    id: number;
    empresaId: number | null;
    deEmail: string;
    classe: ClasseResposta;
    texto: string;
    resumo: string | null;
  },
): Promise<void> {
  const { pool } = deps;
  if (resposta.classe === 'descadastro') {
    await repo.descadastrar(pool, resposta.deEmail, 'Pediu na resposta do e-mail');
    return;
  }
  if (!resposta.empresaId || resposta.classe === 'automatica') return;
  const { rows } = await pool.query<{ etapa: string | null; nome: string }>(
    `SELECT o.etapa, e.nome FROM descoberta.empresas e LEFT JOIN comercial.oportunidades o ON o.empresa_id = e.id
      WHERE e.id = $1`,
    [resposta.empresaId],
  );
  const lead = rows[0];
  if (!lead) return;
  const texto = `${resposta.resumo ? `${resposta.resumo}\n\n` : ''}${resposta.texto}`.slice(0, 4000);
  if (resposta.classe === 'interessado') {
    // Entra (ou avança) no SDR em "Respondeu", com dono pelo rodízio e próximo passo para hoje.
    await funil.registrarAtividade(
      pool,
      resposta.empresaId,
      {
        tipo: 'email',
        direcao: 'recebida',
        texto,
        contato: resposta.deEmail,
        proximaAcao: 'Responder o e-mail',
        proximaAcaoEm: new Date().toISOString(),
      },
      resposta.deEmail,
    );
    await notificarDono(pool, resposta.empresaId, {
      tipo: 'mensagem',
      titulo: `${lead.nome} respondeu o e-mail: tem interesse`,
      texto: resposta.resumo ?? resposta.texto.slice(0, 200),
      link: `/email?aba=respostas&resposta=${resposta.id}`,
    });
    return;
  }
  // Sem interesse: fica registrado no histórico de quem já está no funil (não move etapa).
  if (lead.etapa)
    await pool.query(
      `INSERT INTO comercial.atividades (empresa_id, tipo, direcao, texto, contato, autor)
       VALUES ($1, 'email', 'recebida', $2, $3, $3)`,
      [resposta.empresaId, texto, resposta.deEmail],
    );
}

export async function processarRecebido(
  deps: Deps,
  r: EmailRecebido,
): Promise<'ignorado' | 'devolucao' | 'resposta'> {
  const { pool } = deps;
  if (!r.de || r.de === deps.email?.remetente.toLowerCase()) return 'ignorado';

  if (r.devolucao) {
    const { rows } = await pool.query<{ id: number; empresa_id: number; email: string }>(
      `SELECT id::int, empresa_id::int, email FROM comercial.envios_email
        WHERE status = 'enviado' AND enviado_em > now() - interval '14 days' AND position(lower(email) in lower($1)) > 0`,
      [r.texto],
    );
    for (const en of rows) {
      await pool.query(
        `UPDATE comercial.envios_email SET status = 'devolvido', erro = 'Voltou: o endereço não existe' WHERE id = $1`,
        [en.id],
      );
      await marcarEmailInvalido(deps, en.empresa_id, en.email);
    }
    return rows.length ? 'devolucao' : 'ignorado';
  }

  // A qual envio responde: pelo endereço com o token (r-<token>@…); senão pelo cabeçalho da
  // conversa; senão pelo remetente.
  const tokens = r.para.map((p) => p.match(/^r-([a-f0-9]{32})@/)?.[1]).filter(Boolean) as string[];
  const ids = [r.emRespostaA, ...r.referencias].filter(Boolean) as string[];
  const { rows: envios } = await pool.query<{ id: number; empresa_id: number; campanha_email_id: number }>(
    `SELECT id::int, empresa_id::int, campanha_email_id FROM comercial.envios_email
      WHERE token = ANY($3::text[]) OR (message_id = ANY($1::text[]))
         OR (lower(email) = $2 AND status = 'enviado' AND enviado_em > now() - interval '60 days')
      ORDER BY (token = ANY($3::text[])) DESC, (message_id = ANY($1::text[])) DESC, enviado_em DESC LIMIT 1`,
    [ids, r.de, tokens],
  );
  const envio = envios[0] ?? null;
  let empresaId = envio?.empresa_id ?? null;
  if (!empresaId) {
    // Lead do funil que respondeu um e-mail mandado à mão.
    const { rows } = await pool.query<{ empresa_id: number }>(
      `SELECT c.empresa_id::int FROM enriquecimento.contatos c
         JOIN comercial.oportunidades o ON o.empresa_id = c.empresa_id
        WHERE c.canal = 'email' AND lower(c.valor) = $1 LIMIT 1`,
      [r.de],
    );
    empresaId = rows[0]?.empresa_id ?? null;
  }
  if (!envio && !empresaId) return 'ignorado';

  const c = await classificar(deps, r);
  const { rows: ins } = await pool.query<{ id: number }>(
    `INSERT INTO comercial.respostas_email
       (envio_id, empresa_id, de_email, de_nome, assunto, texto, message_id, recebido_em, classe, resumo,
        classificado_por, resend_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT DO NOTHING
     RETURNING id::int`,
    [
      envio?.id ?? null,
      empresaId,
      r.de,
      r.deNome,
      r.assunto,
      r.texto || '(sem texto)',
      r.messageId,
      r.data,
      c.classe,
      c.resumo,
      c.por,
      r.id,
    ],
  );
  const id = ins[0]?.id;
  if (!id) return 'ignorado'; // já lida antes

  if (envio && c.classe !== 'automatica') {
    await pool.query(
      `UPDATE comercial.envios_email SET respondido_em = coalesce(respondido_em, $2), aberto_em = coalesce(aberto_em, $2)
        WHERE id = $1`,
      [envio.id, r.data],
    );
    // A sequência para para este lead nesta campanha.
    await pool.query(
      `UPDATE comercial.envios_email SET status = 'cancelado', erro = 'Já respondeu'
        WHERE campanha_email_id = $1 AND empresa_id = $2 AND status = 'na_fila'`,
      [envio.campanha_email_id, envio.empresa_id],
    );
  }
  await agirPelaResposta(deps, {
    id,
    empresaId,
    deEmail: r.de,
    classe: c.classe,
    texto: r.texto,
    resumo: c.resumo,
  });
  return 'resposta';
}

export async function rodarEmail(deps: Deps): Promise<void> {
  const cliente = await deps.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      const cfg = await repo.obterConfig(deps.pool);
      if (!cfg.ligado) return;
      await agendarSeguimentos(deps);
      await enviarProximo(deps, cfg);
      await concluirCampanhas(deps);
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    deps.log.error({ err: erro }, 'e-mail: rodada falhou');
  } finally {
    cliente.release();
  }
}

export function iniciarEmail(deps: Deps): () => void {
  const t = setInterval(() => void rodarEmail(deps), 30_000);
  t.unref();
  deps.log.info(
    {
      resend: !!deps.email,
      respostas: !!deps.email?.dominioRespostas,
      webhook: !!deps.email?.segredoWebhook,
      ia: !!deps.classificarEmail,
    },
    'e-mail de prospecção pronto (liga e desliga na tela)',
  );
  return () => clearInterval(t);
}

/** Responde o lead de dentro do sistema (na mesma conversa do e-mail dele). */
export async function responder(deps: Deps, respostaId: number, texto: string): Promise<void> {
  if (!deps.email)
    throw AppError.invalido('O e-mail não está configurado na API (RESEND_API_KEY e EMAIL_REMETENTE).');
  const { rows } = await deps.pool.query<{
    empresa_id: number | null;
    de_email: string;
    assunto: string | null;
    message_id: string | null;
    refs: string[];
    token: string | null;
  }>(
    `SELECT r.empresa_id::int, r.de_email, r.assunto, r.message_id,
            (SELECT token FROM comercial.envios_email WHERE id = r.envio_id) AS token,
            coalesce((SELECT array_agg(x.message_id ORDER BY x.passo) FROM comercial.envios_email x
                       WHERE x.id = r.envio_id OR (x.campanha_email_id = (SELECT campanha_email_id FROM comercial.envios_email WHERE id = r.envio_id)
                                                  AND x.empresa_id = r.empresa_id AND x.message_id IS NOT NULL)), '{}') AS refs
       FROM comercial.respostas_email r WHERE r.id = $1`,
    [respostaId],
  );
  const r = rows[0];
  if (!r) throw AppError.naoEncontrado('Resposta');
  const cfg = await repo.obterConfig(deps.pool);
  const v = r.empresa_id
    ? await repo.variaveisDoLead(deps.pool, r.empresa_id)
    : { empresa: '', nome: null, remetente: cfg.remetenteNome };
  const assunto = r.assunto ? (/^re:/i.test(r.assunto) ? r.assunto : `Re: ${r.assunto}`) : 'Re:';
  const e = montarEmail({ assunto, corpo: texto }, v, { assinatura: cfg.assinatura });
  const refs = [...new Set([...r.refs.filter(Boolean), ...(r.message_id ? [r.message_id] : [])])];
  await deps.email.enviar({
    de: { nome: cfg.remetenteNome, email: deps.email.remetente },
    para: r.de_email,
    responderPara: enderecoDeResposta(deps, cfg, r.token),
    assunto: e.assunto,
    html: e.html,
    texto: e.texto,
    emRespostaA: r.message_id,
    referencias: refs,
  });
  await deps.pool.query(
    'UPDATE comercial.respostas_email SET lida_em = coalesce(lida_em, now()) WHERE id = $1',
    [respostaId],
  );
  if (r.empresa_id)
    await deps.pool.query(
      `INSERT INTO comercial.atividades (empresa_id, tipo, direcao, texto, contato, autor, usuario_id)
       SELECT $1, 'email', 'enviada', $2, $3, $4, $5 FROM comercial.oportunidades WHERE empresa_id = $1`,
      [
        r.empresa_id,
        texto.slice(0, 4000),
        r.de_email,
        usuarioAtual()?.nome ?? 'sistema',
        usuarioAtual()?.id ?? null,
      ],
    );
}

/* ───────────── Avisos do Resend (webhook) ───────────── */

export interface EventoResend {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    to?: string[];
    tags?: Record<string, string> | { name: string; value: string }[];
    bounce?: { message?: string; type?: string; subType?: string };
    click?: { link?: string };
    failed?: { reason?: string };
    [k: string]: unknown;
  };
}

/** Envio do aviso: pela etiqueta "envio" ou pelo id do e-mail no Resend. */
async function envioDoEvento(deps: Pick<Deps, 'pool'>, d: NonNullable<EventoResend['data']>) {
  const tags = Array.isArray(d.tags)
    ? Object.fromEntries(d.tags.map((t) => [t.name, t.value]))
    : (d.tags ?? {});
  const id = Number(tags.envio);
  const { rows } = await deps.pool.query<{ id: number; empresa_id: number; email: string }>(
    `SELECT id::int, empresa_id::int, email FROM comercial.envios_email
      WHERE ($1::bigint IS NOT NULL AND id = $1) OR ($2::text IS NOT NULL AND resend_id = $2)
      LIMIT 1`,
    [Number.isInteger(id) && id > 0 ? id : null, d.email_id ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Processa um aviso do Resend: entrega, abertura, clique, devolução, spam e resposta recebida.
 * Devolve o que foi feito (para o log e os testes).
 */
export async function processarEvento(deps: Deps, ev: EventoResend): Promise<string> {
  const { pool } = deps;
  const d = ev.data ?? {};
  await pool.query('UPDATE comercial.config_email SET webhook_em = now()');

  if (ev.type === 'email.received') {
    if (!deps.email?.buscarRecebido || !d.email_id) return 'ignorado';
    const { rows } = await pool.query('SELECT 1 FROM comercial.respostas_email WHERE resend_id = $1', [
      d.email_id,
    ]);
    if (rows.length) return 'repetido';
    const recebido = await deps.email.buscarRecebido(d.email_id);
    return processarRecebido(deps, recebido);
  }

  const envio = await envioDoEvento(deps, d);
  if (!envio) return 'sem envio';
  const quando = ev.created_at ?? new Date().toISOString();
  switch (ev.type) {
    case 'email.sent':
    case 'email.delivered':
      await pool.query(
        `UPDATE comercial.envios_email
            SET message_id = coalesce(message_id, $2),
                entregue_em = CASE WHEN $3 THEN coalesce(entregue_em, $4::timestamptz) ELSE entregue_em END
          WHERE id = $1`,
        [envio.id, d.message_id ?? null, ev.type === 'email.delivered', quando],
      );
      return 'entregue';
    case 'email.opened':
      await pool.query(
        `UPDATE comercial.envios_email SET aberto_em = coalesce(aberto_em, $2), aberturas = aberturas + 1 WHERE id = $1`,
        [envio.id, quando],
      );
      return 'aberto';
    case 'email.clicked':
      await pool.query(
        `UPDATE comercial.envios_email
            SET clicado_em = coalesce(clicado_em, $2), cliques = cliques + 1, aberto_em = coalesce(aberto_em, $2)
          WHERE id = $1`,
        [envio.id, quando],
      );
      return 'clicado';
    case 'email.bounced': {
      // Devolução permanente: o endereço não existe. Temporária (caixa cheia): só registra.
      const permanente = !/transient|temporary/i.test(`${d.bounce?.type ?? ''} ${d.bounce?.subType ?? ''}`);
      await pool.query(`UPDATE comercial.envios_email SET status = 'devolvido', erro = $2 WHERE id = $1`, [
        envio.id,
        `Voltou: ${d.bounce?.message ?? d.bounce?.type ?? 'endereço recusou'}`.slice(0, 300),
      ]);
      if (permanente) await marcarEmailInvalido(deps, envio.empresa_id, envio.email);
      return 'devolvido';
    }
    case 'email.complained':
      // Marcou como spam: nunca mais recebe.
      await repo.descadastrar(pool, envio.email, 'Marcou o e-mail como spam');
      return 'spam';
    case 'email.failed':
    case 'email.suppressed':
      await pool.query(`UPDATE comercial.envios_email SET status = 'erro', erro = $2 WHERE id = $1`, [
        envio.id,
        (ev.type === 'email.suppressed'
          ? 'O Resend bloqueou: este endereço já voltou ou marcou spam antes'
          : `Falhou: ${d.failed?.reason ?? 'erro no envio'}`
        ).slice(0, 300),
      ]);
      return 'falhou';
    default:
      return 'ignorado';
  }
}
