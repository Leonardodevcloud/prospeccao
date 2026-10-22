import type { Pool } from '@prospeccao/db';
import {
  assuntoSensivel,
  type ContextoAgente,
  type DecisaoAgente,
  juntarMemoria,
  type ProblemaVerificacao,
  pediuHumano,
  pediuParaParar,
  resumoEmTexto,
  verificarMensagem,
} from '@prospeccao/integrations/agente';
import { contaSql } from '../../contexto.js';
import type { DepsApi, ServicosConta } from '../../dependencias.js';
import { criarReuniaoDoLead } from '../agenda/repositorio.js';
import { fatosDoLead } from '../email/repositorio.js';
import { obterConfig as configCadencia, mensagemDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
import { notificarDono } from '../notificacoes/repositorio.js';
import * as base from './conhecimento.js';
import * as repo from './repositorio.js';

/**
 * Atendimento da IA a um lead que escreveu. Antes de cada resposta:
 *  - pedido para parar, para falar com uma pessoa ou assunto sério (Procon, advogado) vão direto
 *    para o time, sem passar pela IA;
 *  - a IA recebe a ficha do lead, o que ele já contou (memória) e só os trechos da base de
 *    conhecimento que combinam com o que ele escreveu;
 *  - a resposta passa pelas verificações (preço, link ou contato fora da base, repetição,
 *    promessa, "te retorno" sem passar para o time…); o que não passa volta para a IA reescrever
 *    uma vez; se ainda não passar, não sai e o lead vai para o time.
 * Quando passa para o time, o vendedor recebe um resumo (combinado, objeções, próximo passo).
 */

const AUTOR = 'agente';

/** O motor de uma conta: banco, log e o WhatsApp e a IA dela. */
export type DepsAtendimento = Pick<DepsApi, 'pool' | 'log'> & Pick<ServicosConta, 'whatsapp' | 'ia'>;

interface Mensagem {
  id: number;
  direcao: 'enviada' | 'recebida';
  texto: string;
  em: string;
}

async function conversaDoLead(pool: Pool, empresaId: number, limite = 30): Promise<Mensagem[]> {
  const { rows } = await pool.query<Mensagem>(
    `SELECT id::int, direcao, texto, criado_em AS em FROM comercial.atividades
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND direcao IS NOT NULL AND texto IS NOT NULL
      ORDER BY criado_em DESC, id DESC LIMIT $2`,
    [empresaId, limite],
  );
  return rows.reverse();
}

/** O que o lead escreveu desde a nossa última mensagem (ele costuma mandar em pedaços). */
function ultimasDoLead(conversa: Mensagem[]): string {
  const partes: string[] = [];
  for (let i = conversa.length - 1; i >= 0 && conversa[i]!.direcao === 'recebida'; i--)
    partes.unshift(conversa[i]!.texto);
  return partes.join('\n');
}

async function memoriaDoLead(pool: Pool, empresaId: number): Promise<string[]> {
  const { rows } = await pool.query<{ m: unknown }>(
    `SELECT agente_memoria AS m FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  const m = rows[0]?.m;
  return Array.isArray(m) ? m.map(String) : [];
}

async function guardarMemoria(pool: Pool, empresaId: number, fatos: string[]) {
  await pool.query(
    `UPDATE comercial.oportunidades SET agente_memoria = $2::jsonb WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId, JSON.stringify(fatos)],
  );
}

/** Ficha do lead em frases curtas (o que o enriquecimento achou). */
async function fichaDoLead(pool: Pool, empresaId: number): Promise<string[]> {
  try {
    const f = await fatosDoLead(pool, empresaId);
    return [
      f.categoria && `Ramo: ${f.categoria}`,
      f.resumo && `O que faz: ${f.resumo}`,
      f.anosDeEmpresa != null && `Empresa com ${f.anosDeEmpresa} anos`,
      f.notaGoogle != null && `Nota no Google: ${f.notaGoogle} (${f.avaliacoesGoogle ?? 0} avaliações)`,
      f.site && `Site: ${f.site}`,
      f.instagram && `Instagram: @${f.instagram}`,
    ].filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

/**
 * Para de responder e passa o lead para o time: pausa a IA, põe "Responder" como próximo passo e
 * avisa o dono do lead. Com a IA disponível, junta um resumo da conversa.
 */
export async function passarParaTime(
  deps: DepsAtendimento,
  empresaId: number,
  motivo: string,
  contexto?: { conversa: Mensagem[]; etapa: string; leadNome: string; contato: string | null },
): Promise<void> {
  const { pool } = deps;
  await pool.query(
    `UPDATE comercial.oportunidades SET agente_pausa = $2 WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId, motivo.slice(0, 300)],
  );
  await funil.atualizar(
    pool,
    empresaId,
    { proximaAcao: 'Responder: a IA passou para você', proximaAcaoEm: new Date().toISOString() },
    AUTOR,
  );
  let textoAviso = motivo;
  if (deps.ia?.resumir && contexto?.conversa.length) {
    const { rows } = await pool.query<{ nome: string }>(
      `SELECT nome FROM cadastro.contas WHERE id = ${contaSql()}`,
    );
    const resumo = await deps.ia
      .resumir({
        empresa: rows[0]?.nome ?? 'nossa empresa',
        lead: { empresa: contexto.leadNome, contato: contexto.contato, etapa: contexto.etapa },
        motivo,
        memoria: await memoriaDoLead(pool, empresaId),
        conversa: contexto.conversa.map((m) => ({
          de: m.direcao === 'enviada' ? 'nos' : 'lead',
          texto: m.texto,
        })),
      })
      .catch((erro) => {
        deps.log.warn({ err: erro, empresaId }, 'agente: não consegui resumir a conversa');
        return null;
      });
    if (resumo) {
      await pool.query(
        `UPDATE comercial.oportunidades SET agente_resumo = $2::jsonb, agente_resumo_em = now()
          WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
        [empresaId, JSON.stringify({ ...resumo, motivo })],
      );
      textoAviso = resumoEmTexto(resumo);
    }
  }
  await notificarDono(pool, empresaId, {
    tipo: 'mensagem',
    titulo: `${contexto?.leadNome || 'Lead'}: a IA passou a conversa para você`,
    texto: textoAviso,
  }).catch((erro) => deps.log.warn({ err: erro, empresaId }, 'agente: não consegui avisar o dono'));
}

async function registrarVerificacao(
  pool: Pool,
  empresaId: number,
  texto: string,
  problemas: ProblemaVerificacao[],
  resultado: 'reescrita' | 'bloqueada',
) {
  await pool.query(
    `INSERT INTO comercial.verificacoes_ia (conta_id, empresa_id, texto, problemas, resultado)
     VALUES (${contaSql()}, $1, $2, $3::jsonb, $4)`,
    [empresaId, texto.slice(0, 2000), JSON.stringify(problemas), resultado],
  );
}

/** Ações com mensagem para o lead (as outras não passam pelas verificações). */
const COM_MENSAGEM = new Set(['responder', 'marcar_reuniao', 'encerrar_sem_interesse']);

export async function responderLead(
  deps: DepsAtendimento,
  cfg: repo.ConfigAgente,
  empresaId: number,
  etapa: string,
): Promise<void> {
  const { pool } = deps;
  const conversa = await conversaDoLead(pool, empresaId);
  const doLead = ultimasDoLead(conversa) || conversa.at(-1)?.texto || '';
  const ultimaId = conversa.at(-1)?.id ?? 0;

  const { rows: lead } = await pool.query<{ nome: string; cidade: string | null; decisor: string | null }>(
    `SELECT e.nome, e.cidade,
            -- com quem a conversa está (pessoa indicada, com o cargo), senão o decisor do enriquecimento
            coalesce(
              (SELECT cl.nome || coalesce(' (' || cl.cargo || ')', '') FROM comercial.contatos_lead cl
                 JOIN comercial.oportunidades o ON o.conta_id = cl.conta_id AND o.empresa_id = cl.empresa_id
                WHERE cl.conta_id = ${contaSql()} AND cl.empresa_id = e.id AND cl.status = 'confirmado'
                  AND o.whatsapp_destino IS NOT NULL AND left(cl.telefone, 2) = left(o.whatsapp_destino, 2)
                  AND right(cl.telefone, 8) = right(o.whatsapp_destino, 8) LIMIT 1),
              (SELECT p.nome FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor LIMIT 1)) AS decisor
       FROM descoberta.empresas e WHERE e.id = $1`,
    [empresaId],
  );
  const leadNome = lead[0]?.nome ?? '';
  const contato = lead[0]?.decisor ?? null;
  const contexto = { conversa, etapa, leadNome, contato };

  const desligarIa = () =>
    pool.query(
      `UPDATE comercial.oportunidades SET agente = false WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [empresaId],
    );

  // Regras fixas, antes da IA (sem chance de erro).
  if (pediuParaParar(doLead)) {
    await desligarIa();
    await funil.atualizar(
      pool,
      empresaId,
      { etapa: 'descartado', motivo: 'Pediu para não receber mensagens' },
      AUTOR,
    );
    return;
  }
  if (pediuHumano(doLead)) {
    await passarParaTime(deps, empresaId, 'O lead pediu para falar com uma pessoa.', contexto);
    return;
  }
  if (assuntoSensivel(doLead)) {
    await passarParaTime(deps, empresaId, 'Assunto sério (reclamação ou jurídico): responda você.', contexto);
    return;
  }
  const { rows: hoje } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.mensagens
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND origem = 'agente' AND criado_em >= ${repo.HOJE_SP}`,
    [empresaId],
  );
  if ((hoje[0]?.n ?? 0) >= cfg.respostasDiaLead) {
    await passarParaTime(
      deps,
      empresaId,
      `A IA já respondeu ${cfg.respostasDiaLead} vezes hoje: continue você.`,
      contexto,
    );
    return;
  }
  if (!deps.ia) {
    await passarParaTime(deps, empresaId, 'O lead respondeu e a IA não está configurada para esta conta.');
    return;
  }
  const ia = deps.ia;

  const m = await mensagemDoLead(pool, empresaId);
  const cad = await configCadencia(pool);
  const { rows: contaRows } = await pool.query<{ nome: string }>(
    `SELECT nome FROM cadastro.contas WHERE id = ${contaSql()}`,
  );
  // Busca na base com o que ele escreveu agora (e a nossa última mensagem, que dá o assunto).
  const nossaUltima = [...conversa].reverse().find((c) => c.direcao === 'enviada')?.texto ?? '';
  const trechos = await base.buscarTrechos(pool, `${doLead}\n${nossaUltima}`);
  const memoria = await memoriaDoLead(pool, empresaId);
  const ficha = await fichaDoLead(pool, empresaId);

  const ctx: ContextoAgente = {
    empresa: contaRows[0]?.nome ?? 'nossa empresa',
    sobreEmpresa: cfg.sobreEmpresa,
    regras: cfg.regras,
    horariosReuniao: cfg.horariosReuniao,
    remetente: cad.remetente,
    agora: new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date()),
    lead: { empresa: leadNome, cidade: lead[0]?.cidade ?? null, contato, etapa },
    conversa: conversa.map((c) => ({
      de: c.direcao === 'enviada' ? 'nos' : 'lead',
      texto: c.texto,
      em: c.em,
    })),
    conhecimento: trechos.map((t) => ({ titulo: t.titulo, texto: t.texto })),
    memoria,
    ficha,
  };

  // O que a IA podia usar: só isso vale para preço, link, telefone e promessa.
  const fontes = [
    cfg.sobreEmpresa,
    cfg.regras,
    cfg.horariosReuniao,
    ...trechos.map((t) => t.texto),
    ...ficha,
    ...conversa.map((c) => c.texto),
  ];
  const enviadasAntes = conversa
    .filter((c) => c.direcao === 'enviada')
    .slice(-6)
    .map((c) => c.texto);
  const verificar = (d: DecisaoAgente) =>
    COM_MENSAGEM.has(d.acao) && d.resposta
      ? verificarMensagem({ texto: d.resposta, fontes, enviadasAntes, acao: d.acao })
      : [];

  let decisao: DecisaoAgente;
  /** Problemas que sobraram depois da reescrita: a mensagem não sai. */
  let barrada: ProblemaVerificacao[] = [];
  try {
    decisao = await ia.decidir(ctx);
    const problemas = verificar(decisao);
    if (problemas.length) {
      const primeira = decisao;
      decisao = await ia.decidir({
        ...ctx,
        correcao: { texto: primeira.resposta, problemas: problemas.map((p) => p.detalhe) },
      });
      barrada = verificar(decisao);
      if (!barrada.length)
        await registrarVerificacao(pool, empresaId, primeira.resposta, problemas, 'reescrita');
    }
  } catch (erro) {
    deps.log.warn({ err: erro, empresaId }, 'agente: a IA falhou');
    await passarParaTime(deps, empresaId, 'A IA falhou ao responder: responda você.', contexto);
    return;
  }

  // O lead escreveu de novo enquanto a IA pensava: responde tudo junto na próxima rodada.
  const { rows: novas } = await pool.query(
    `SELECT 1 FROM comercial.atividades
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND direcao = 'recebida' AND id > $2 LIMIT 1`,
    [empresaId, ultimaId],
  );
  if (novas.length) return;

  // O que ele contou e o que a base não respondeu valem mesmo quando a mensagem é barrada.
  if (decisao.memoria?.length) await guardarMemoria(pool, empresaId, juntarMemoria(memoria, decisao.memoria));
  if (decisao.semResposta)
    await base.registrarLacuna(pool, {
      empresaId,
      pergunta: decisao.semResposta,
      motivo: decisao.motivo || 'A base não responde',
    });
  if (barrada.length) {
    await registrarVerificacao(pool, empresaId, decisao.resposta, barrada, 'bloqueada');
    await passarParaTime(
      deps,
      empresaId,
      `A resposta da IA não passou nas verificações (${barrada.map((p) => p.regra).join(', ')}): responda você.`,
      contexto,
    );
    return;
  }
  if (trechos.length && decisao.acao !== 'passar_para_humano')
    await base.marcarUso(
      pool,
      trechos.map((t) => t.conhecimentoId),
    );

  const nova = (texto: string) =>
    repo.criarMensagem(pool, {
      empresaId,
      direcao: 'enviada',
      texto,
      telefone: m.telefone,
      status: cfg.revisarAntes ? 'rascunho' : 'aprovada',
      origem: 'agente',
      nota: decisao.motivo,
    });

  switch (decisao.acao) {
    case 'responder':
      await nova(decisao.resposta);
      break;
    case 'marcar_reuniao':
      await funil.registrarAtividade(
        pool,
        empresaId,
        {
          tipo: 'reuniao',
          direcao: null,
          texto: `Reunião combinada pela IA: ${decisao.motivo}`,
          proximaAcao: 'Reunião com o lead',
          proximaAcaoEm: decisao.reuniaoEm,
        },
        AUTOR,
      );
      // Entra na agenda do dono do lead (o closer, se a reunião passou o lead para ele).
      if (decisao.reuniaoEm)
        await criarReuniaoDoLead(pool, empresaId, decisao.reuniaoEm, null).catch((erro) =>
          deps.log.warn({ err: erro, empresaId }, 'agente: não consegui pôr a reunião na agenda'),
        );
      if (decisao.resposta) await nova(decisao.resposta);
      break;
    case 'encerrar_sem_interesse':
      if (decisao.resposta) await nova(decisao.resposta);
      await desligarIa();
      await funil.atualizar(
        pool,
        empresaId,
        { etapa: 'perdido', motivo: `Sem interesse: ${decisao.motivo}` },
        AUTOR,
      );
      break;
    case 'optout':
      await desligarIa();
      await funil.atualizar(
        pool,
        empresaId,
        { etapa: 'descartado', motivo: 'Pediu para não receber mensagens' },
        AUTOR,
      );
      break;
    default:
      if (decisao.resposta) await nova(decisao.resposta);
      await passarParaTime(deps, empresaId, decisao.motivo || 'A IA preferiu que você responda.', contexto);
  }
}

/**
 * Aprende com o time: a pergunta que a IA não soube responder e a resposta que o vendedor mandou
 * depois viram uma sugestão de pergunta e resposta para a base (só vale depois de aprovada).
 * Espera 10 minutos depois da última mensagem do vendedor, para pegar a resposta inteira.
 */
export async function aprenderComEquipe(deps: DepsAtendimento, limite = 3): Promise<number> {
  if (!deps.ia?.aprender) return 0;
  const { pool } = deps;
  const C = contaSql();
  const { rows } = await pool.query<{ id: number; empresa_id: number; pergunta: string; resposta: string }>(
    `SELECT l.id::int, l.empresa_id::int, l.pergunta, r.resposta
       FROM comercial.lacunas_ia l
       CROSS JOIN LATERAL (
         SELECT string_agg(x.texto, E'\\n' ORDER BY x.criado_em) AS resposta, max(x.criado_em) AS ultima
           FROM (SELECT m.texto, m.criado_em FROM comercial.mensagens m
                  WHERE m.conta_id = l.conta_id AND m.empresa_id = l.empresa_id AND m.origem = 'humano'
                    AND m.direcao = 'enviada' AND m.texto IS NOT NULL AND m.midia_tipo IS NULL
                    AND m.criado_em > l.criado_em AND m.criado_em < l.criado_em + interval '2 days'
                  ORDER BY m.criado_em LIMIT 4) x) r
      WHERE l.conta_id = ${C} AND l.resolvida_em IS NULL AND l.aprendizado_em IS NULL
        AND l.conhecimento_id IS NULL AND l.criado_em > now() - interval '14 days'
        AND r.resposta IS NOT NULL AND r.ultima < now() - interval '10 minutes'
      ORDER BY l.criado_em
      LIMIT $1`,
    [limite],
  );
  if (!rows.length) return 0;
  const { rows: contaRows } = await pool.query<{ nome: string }>(
    `SELECT nome FROM cadastro.contas WHERE id = ${C}`,
  );
  let n = 0;
  for (const l of rows) {
    await pool.query('UPDATE comercial.lacunas_ia SET aprendizado_em = now() WHERE id = $1', [l.id]);
    const a = await deps.ia
      .aprender({
        empresa: contaRows[0]?.nome ?? 'nossa empresa',
        pergunta: l.pergunta,
        respostaDoTime: l.resposta,
      })
      .catch((erro) => {
        deps.log.warn({ err: erro, lacuna: l.id }, 'agente: não consegui aprender com a resposta do time');
        return null;
      });
    if (!a) continue;
    const id = await base.criar(pool, {
      tipo: 'faq',
      titulo: a.titulo,
      pergunta: a.pergunta,
      conteudo: a.resposta,
      origem: 'conversa',
      status: 'sugerido',
      empresaId: l.empresa_id,
    });
    await pool.query('UPDATE comercial.lacunas_ia SET conhecimento_id = $2 WHERE id = $1', [l.id, id]);
    n++;
  }
  return n;
}
