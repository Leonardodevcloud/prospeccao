import type { Executor, Pool } from '@prospeccao/db';
import {
  AppError,
  type CodigoPorteiro,
  type DetalhesPorteiro,
  MIN_PALAVRAS_REPETICAO,
  PORTEIRO_PADRAO,
  type PorteiroEntrada,
  type PreviaPorteiro,
  palavrasDoTexto,
  REPETIDAS_CONVERSA,
  REPETIDAS_CONVERSA_JANELA_MIN,
  SEMELHANCA_REPETICAO,
  semelhanca,
} from '@prospeccao/shared';
import { contaSql, usuarioAtual } from '../../contexto.js';
import { tetoDeAquecimento } from '../agente/chips.js';
import { HOJE_SP } from '../agente/repositorio.js';

/**
 * Porteiro do WhatsApp (sempre ligado desde a v178): antes de a equipe mandar uma mensagem pelo
 * número da conta, confere o que mais derruba número (sobretudo em API não oficial): o mesmo texto
 * indo para muita gente em pouco tempo, contatos novos demais no dia e em sequência rápida, e o
 * número em pausa por sinal de risco. O texto repetido tem duas réguas: rígida para quem nunca
 * respondeu (não deixa mandar) e um aviso para quem já conversa (15 na mesma hora, dá para mandar).
 * Os envios automáticos (cadência e sequência) passam pela régua rígida antes de sair.
 */

export async function config(db: Executor): Promise<PorteiroEntrada> {
  const { rows } = await db.query<PorteiroEntrada>(
    `SELECT ativo, repetidas_contatos AS "repetidasContatos", repetidas_janela_min AS "repetidasJanelaMin",
            repetidas_acao AS "repetidasAcao", novos_dia AS "novosDia", novos_intervalo_seg AS "novosIntervaloSeg",
            pausar_risco AS "pausarRisco"
       FROM comercial.porteiro WHERE conta_id = ${contaSql()}`,
  );
  // Sempre ligado: o que estiver gravado como desligado (de antes da v178) não vale.
  return { ...(rows[0] ?? PORTEIRO_PADRAO), ativo: true };
}

export async function salvarConfig(db: Executor, c: PorteiroEntrada): Promise<void> {
  // A proteção fica sempre ligada; "repetidas_acao" é legado (a régua depende do contato).
  await db.query(
    `INSERT INTO comercial.porteiro
       (conta_id, ativo, repetidas_contatos, repetidas_janela_min, repetidas_acao, novos_dia, novos_intervalo_seg, pausar_risco)
     VALUES (${contaSql()}, true, $1, $2, 'segurar', $3, $4, $5)
     ON CONFLICT (conta_id) DO UPDATE SET ativo = true, repetidas_contatos = $1, repetidas_janela_min = $2,
       novos_dia = $3, novos_intervalo_seg = $4, pausar_risco = $5, atualizado_em = now()`,
    [c.repetidasContatos, c.repetidasJanelaMin, c.novosDia, c.novosIntervaloSeg, c.pausarRisco],
  );
}

export async function registrar(
  db: Executor,
  e: { tipo: string; chipId: number | null; empresaId: number | null; detalhe: string },
): Promise<void> {
  await db
    .query(
      `INSERT INTO comercial.porteiro_eventos (conta_id, chip_id, usuario_id, empresa_id, tipo, detalhe)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5)`,
      [e.chipId, usuarioAtual()?.id ?? null, e.empresaId, e.tipo, e.detalhe.slice(0, 500)],
    )
    .catch(() => undefined);
}

async function segurar(
  db: Executor,
  codigo: CodigoPorteiro,
  mensagem: string,
  detalhes: Omit<DetalhesPorteiro, 'porteiro'>,
  e: { chipId: number | null; empresaId: number },
): Promise<never> {
  await registrar(db, {
    tipo: codigo.replace('porteiro_', ''),
    chipId: e.chipId,
    empresaId: e.empresaId,
    detalhe: mensagem,
  });
  throw new AppError(409, codigo, mensagem, { detalhes: { porteiro: true, ...detalhes } });
}

/** Contatos novos do número: os leads cuja primeira mensagem (de qualquer lado) saiu por ele. */
async function novosDoChip(db: Executor, chipId: number): Promise<{ hoje: number; ultima: Date | null }> {
  const C = contaSql();
  const { rows } = await db.query<{ hoje: number; ultima: Date | null }>(
    `WITH primeiras AS (
       SELECT m.empresa_id, min(coalesce(m.enviado_em, m.criado_em)) AS em
         FROM comercial.mensagens m
        WHERE m.conta_id = ${C} AND m.chip_id = $1 AND m.direcao = 'enviada' AND m.status = 'enviada'
          AND coalesce(m.enviado_em, m.criado_em) > now() - interval '2 days'
        GROUP BY m.empresa_id)
     SELECT count(*) FILTER (WHERE p.em >= ${HOJE_SP})::int AS hoje, max(p.em) AS ultima
       FROM primeiras p
      WHERE NOT EXISTS (SELECT 1 FROM comercial.mensagens a
                         WHERE a.conta_id = ${C} AND a.empresa_id = p.empresa_id
                           AND a.status IN ('enviada', 'recebida') AND coalesce(a.enviado_em, a.criado_em) < p.em)`,
    [chipId],
  );
  return rows[0] ?? { hoje: 0, ultima: null };
}

/** Limite de contatos novos hoje deste número (o do porteiro, ou o do aquecimento se for menor). */
async function limiteDoChip(
  db: Executor,
  chipId: number,
  cfg: PorteiroEntrada,
): Promise<{ nome: string; limite: number; friosAte: Date | null; friosMotivo: string | null } | null> {
  const { rows } = await db.query<{
    nome: string;
    aquecer: boolean;
    dias: number;
    frios_ate: Date | null;
    frios_motivo: string | null;
  }>(
    `SELECT nome, aquecer, extract(day FROM now() - ativado_em)::int AS dias,
            CASE WHEN frios_ate > now() THEN frios_ate END AS frios_ate, frios_motivo
       FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [chipId],
  );
  const c = rows[0];
  if (!c) return null;
  const teto = c.aquecer ? tetoDeAquecimento(c.dias) : null;
  return {
    nome: c.nome,
    limite: teto != null ? Math.min(cfg.novosDia, teto) : cfg.novosDia,
    friosAte: c.frios_ate,
    friosMotivo: c.frios_motivo,
  };
}

/** Meia-noite de amanhã em Brasília (quando o limite do dia volta). */
async function amanha(db: Executor): Promise<string> {
  const { rows } = await db.query<{ em: Date }>(`SELECT ${HOJE_SP} + interval '1 day' AS em`);
  return new Date(rows[0]!.em).toISOString();
}

/** O lead já respondeu alguma vez (conversa)? Quem nunca respondeu é contato frio: régua rígida. */
async function jaRespondeu(db: Executor, empresaId: number): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM comercial.mensagens WHERE conta_id = ${contaSql()} AND empresa_id = $1
                       AND direcao = 'recebida') AS ok`,
    [empresaId],
  );
  return !!rows[0]?.ok;
}

/**
 * Para quantos contatos (fora este) um texto igual ou quase igual já foi, por janela. Por contato, a
 * última vez (é quando ele sai da janela).
 */
async function parecidas(
  db: Executor,
  p: { empresaId: number; chipId: number | null; texto: string; janelaMin: number },
): Promise<Map<string, number> | null> {
  const palavras = palavrasDoTexto(p.texto);
  if (new Set(palavras).size < MIN_PALAVRAS_REPETICAO) return null;
  const { rows } = await db.query<{ empresa_id: string; texto: string; em: Date }>(
    `SELECT empresa_id, texto, coalesce(enviado_em, criado_em) AS em
       FROM comercial.mensagens
      WHERE conta_id = ${contaSql()} AND direcao = 'enviada' AND status = 'enviada' AND empresa_id <> $1
        AND ($2::int IS NULL OR chip_id = $2 OR chip_id IS NULL)
        AND coalesce(enviado_em, criado_em) > now() - make_interval(mins => $3)
      ORDER BY id DESC LIMIT 1500`,
    [p.empresaId, p.chipId, p.janelaMin],
  );
  const m = new Map<string, number>();
  for (const r of rows)
    if (semelhanca(palavras, palavrasDoTexto(r.texto)) >= SEMELHANCA_REPETICAO)
      m.set(r.empresa_id, Math.max(m.get(r.empresa_id) ?? 0, new Date(r.em).getTime()));
  return m;
}

/** Quantos dentro de uma janela menor (a régua de quem conversa usa 1 hora). */
function dentroDe(m: Map<string, number>, janelaMin: number): number[] {
  const desde = Date.now() - janelaMin * 60_000;
  return [...m.values()].filter((t) => t > desde).sort((a, b) => a - b);
}

/** A régua do texto repetido para este destinatário. */
function regua(cfg: PorteiroEntrada, frio: boolean) {
  return frio
    ? { limite: cfg.repetidasContatos, janelaMin: cfg.repetidasJanelaMin, rigida: true }
    : { limite: REPETIDAS_CONVERSA, janelaMin: REPETIDAS_CONVERSA_JANELA_MIN, rigida: false };
}

/**
 * Confere antes de mandar. Lança 409 com o código do porteiro (a tela mostra o que fazer). Sempre
 * ligado.
 */
export async function conferirEnvio(
  db: Executor,
  p: { empresaId: number; chipId: number | null; texto: string | null; mesmoAssim?: boolean },
): Promise<void> {
  const cfg = await config(db);
  const C = contaSql();
  const alvo = { chipId: p.chipId, empresaId: p.empresaId };

  // 1. Contato novo (nunca houve mensagem com este lead): pausa, limite do dia e espera.
  const { rows: h } = await db.query<{ conversou: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM comercial.mensagens WHERE conta_id = ${C} AND empresa_id = $1
                       AND status IN ('enviada', 'recebida')) AS conversou`,
    [p.empresaId],
  );
  if (!h[0]?.conversou && p.chipId) {
    const chip = await limiteDoChip(db, p.chipId, cfg);
    if (chip) {
      if (chip.friosAte)
        await segurar(
          db,
          'porteiro_pausado',
          `O número “${chip.nome}” está sem abordar contatos novos até ${hora(chip.friosAte)} (${chip.friosMotivo ?? 'sinal de risco'}). Responder quem já conversa continua normal.`,
          { liberaEm: chip.friosAte.toISOString() },
          alvo,
        );
      const uso = await novosDoChip(db, p.chipId);
      if (uso.hoje >= chip.limite)
        await segurar(
          db,
          'porteiro_limite',
          `O número “${chip.nome}” já abordou ${chip.limite} contatos novos hoje, o limite para não arriscar o número. Amanhã libera; responder quem já conversa continua normal.`,
          { limite: chip.limite, liberaEm: await amanha(db) },
          alvo,
        );
      if (uso.ultima && cfg.novosIntervaloSeg > 0) {
        const falta = Math.ceil(
          (new Date(uso.ultima).getTime() + cfg.novosIntervaloSeg * 1000 - Date.now()) / 1000,
        );
        if (falta > 0)
          await segurar(
            db,
            'porteiro_espera',
            `Espere ${falta} s para abordar outro contato novo por este número (mensagens em sequência rápida para quem nunca conversou parecem disparo).`,
            { segundos: falta, liberaEm: new Date(Date.now() + falta * 1000).toISOString() },
            alvo,
          );
      }
    }
  }

  // 2. O mesmo texto para muitos contatos dentro da janela.
  if (!p.texto) return;
  const frio = !(await jaRespondeu(db, p.empresaId));
  const r = regua(cfg, frio);
  const mapa = await parecidas(db, {
    empresaId: p.empresaId,
    chipId: p.chipId,
    texto: p.texto,
    janelaMin: r.janelaMin,
  });
  if (!mapa) return;
  const tempos = dentroDe(mapa, r.janelaMin);
  const n = tempos.length;
  if (n + 1 < r.limite) return;
  if (!r.rigida && p.mesmoAssim) {
    await registrar(db, {
      tipo: 'mesmo_assim',
      ...alvo,
      detalhe: `Mandou mesmo assim o texto que já tinha ido para ${n} contatos: “${p.texto.slice(0, 200)}”`,
    });
    return;
  }
  // Libera quando sair da janela gente bastante para este envio ficar abaixo do limite.
  const sai = tempos[n - r.limite + 1] ?? tempos[0]!;
  await segurar(
    db,
    'porteiro_repetida',
    r.rigida
      ? `Esta mensagem já foi, igual ou quase igual, para ${n} ${n === 1 ? 'contato' : 'contatos'} ${janela(r.janelaMin)}, e este contato ainda não respondeu. O mesmo texto para muita gente que não conversa com você é o que mais derruba número no WhatsApp: varie as palavras (a IA ajuda) ou espere.`
      : `Esta mensagem já foi, igual ou quase igual, para ${n} contatos ${janela(r.janelaMin)}. Mesmo com quem já conversa, texto igual em série chama a atenção do WhatsApp: varie as palavras (a IA ajuda) ou mande assim mesmo.`,
    {
      contatos: n,
      janelaMin: r.janelaMin,
      podeForcar: !r.rigida,
      liberaEm: new Date(sai + r.janelaMin * 60_000).toISOString(),
    },
    alvo,
  );
}

/**
 * Prévia para a tela (o aviso enquanto escreve): o que acontece se mandar este texto agora para
 * este contato. Não registra nada.
 */
export async function previa(
  db: Executor,
  p: { empresaId: number; chipId: number | null; texto: string },
): Promise<PreviaPorteiro> {
  const cfg = await config(db);
  const frio = !(await jaRespondeu(db, p.empresaId));
  const r = regua(cfg, frio);
  const mapa = await parecidas(db, { ...p, janelaMin: r.janelaMin });
  const n = mapa ? dentroDe(mapa, r.janelaMin).length : 0;
  const base = { contatos: n, limite: r.limite, janelaMin: r.janelaMin, frio };
  if (!mapa || n === 0) return { ...base, nivel: 'ok', mensagem: null };
  if (n + 1 >= r.limite)
    return {
      ...base,
      nivel: r.rigida ? 'segura' : 'aviso',
      mensagem: r.rigida
        ? `Este texto já foi para ${n} ${n === 1 ? 'contato' : 'contatos'} ${janela(r.janelaMin)} e este contato ainda não respondeu: a proteção do número vai segurar. Varie as palavras antes de mandar.`
        : `Este texto já foi para ${n} contatos ${janela(r.janelaMin)}. Varie as palavras para não chamar a atenção do WhatsApp.`,
    };
  const faltam = r.limite - 1 - n;
  return {
    ...base,
    nivel: 'atencao',
    mensagem: `Texto parecido já foi para ${n} ${n === 1 ? 'contato' : 'contatos'} ${janela(r.janelaMin)}.${
      faltam <= 2
        ? ` Mais ${faltam === 1 ? '1 envio' : `${faltam} envios`} e ${r.rigida ? 'a proteção segura' : 'vem o aviso'}.`
        : ''
    } Variar as palavras protege o número.`,
  };
}

/**
 * Envio automático (cadência e sequência): passa pela régua do texto repetido antes de sair (para
 * contato frio e para quem conversa, sem "mandar mesmo assim"). Devolve o motivo para segurar, ou
 * null. A mensagem fica na fila e sai quando a janela liberar.
 */
export async function seguraAutomatica(
  db: Executor,
  p: { empresaId: number; chipId: number | null; texto: string; mensagemId: number },
): Promise<string | null> {
  const cfg = await config(db);
  const frio = !(await jaRespondeu(db, p.empresaId));
  const r = regua(cfg, frio);
  const mapa = await parecidas(db, { ...p, janelaMin: r.janelaMin });
  if (!mapa) return null;
  const n = dentroDe(mapa, r.janelaMin).length;
  if (n + 1 < r.limite) return null;
  const motivo = `Envio automático segurado: o mesmo texto já foi para ${n} contatos ${janela(r.janelaMin)}. Sai quando a janela liberar; para não esperar, crie versões da mensagem.`;
  // Um registro por mensagem segurada (ela volta a ser conferida a cada rodada).
  const { rows } = await db.query<{ ja: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM comercial.porteiro_eventos
                     WHERE conta_id = ${contaSql()} AND tipo = 'automatica' AND detalhe LIKE $1) AS ja`,
    [`%#${p.mensagemId})`],
  );
  if (!rows[0]?.ja)
    await registrar(db, {
      tipo: 'automatica',
      chipId: p.chipId,
      empresaId: p.empresaId,
      detalhe: `${motivo} (mensagem #${p.mensagemId})`,
    });
  return motivo;
}

const janela = (min: number) =>
  min % 60 === 0
    ? min === 60
      ? 'na última hora'
      : `nas últimas ${min / 60} horas`
    : `nos últimos ${min} minutos`;

const hora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

/** O que a tela do porteiro mostra: a configuração, cada número hoje e o que foi segurado. */
export async function painel(pool: Pool) {
  const cfg = await config(pool);
  const C = contaSql();
  const { rows: chips } = await pool.query<{ id: number; nome: string }>(
    `SELECT id, nome FROM comercial.chips WHERE conta_id = ${C} AND ativo ORDER BY id`,
  );
  const numeros = [];
  for (const c of chips) {
    const l = await limiteDoChip(pool, c.id, cfg);
    const uso = await novosDoChip(pool, c.id);
    numeros.push({
      id: c.id,
      nome: c.nome,
      novosHoje: uso.hoje,
      limiteHoje: l?.limite ?? cfg.novosDia,
      friosAte: l?.friosAte ? l.friosAte.toISOString() : null,
      friosMotivo: l?.friosAte ? l.friosMotivo : null,
    });
  }
  const { rows: eventos } = await pool.query(
    `SELECT e.id::int, e.tipo, e.detalhe, e.criado_em AS "criadoEm", e.empresa_id::int AS "empresaId",
            coalesce(emp.maps_nome, emp.nome) AS lead, u.nome AS usuario, ch.nome AS numero
       FROM comercial.porteiro_eventos e
       LEFT JOIN descoberta.empresas emp ON emp.id = e.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = e.usuario_id
       LEFT JOIN comercial.chips ch ON ch.id = e.chip_id
      WHERE e.conta_id = ${C} AND e.criado_em > now() - interval '7 days'
      ORDER BY e.id DESC LIMIT 30`,
  );
  const { rows: hoje } = await pool.query<{ tipo: string; n: number }>(
    `SELECT tipo, count(*)::int AS n FROM comercial.porteiro_eventos
      WHERE conta_id = ${C} AND criado_em >= ${HOJE_SP} GROUP BY tipo`,
  );
  return { config: cfg, numeros, eventos, hoje: Object.fromEntries(hoje.map((h) => [h.tipo, h.n])) };
}
