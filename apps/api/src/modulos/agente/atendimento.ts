import type { Pool } from '@prospeccao/db';
import {
  assuntoSensivel,
  avisoDePassagem,
  type ContextoAgente,
  type DecisaoAgente,
  type FonteConferencia,
  type FraseConferidaIa,
  fontesDoPerfil,
  juntarMemoria,
  type ProblemaVerificacao,
  pediuHumano,
  pediuParaParar,
  resumoEmTexto,
  semFonte,
  textoDoPerfil,
  verificarMensagem,
} from '@prospeccao/integrations/agente';
import type { PerfilIa } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import type { DepsApi, ServicosConta } from '../../dependencias.js';
import { visivel } from '../../visibilidade.js';
import { criarReuniaoDoLead } from '../agenda/repositorio.js';
import { fatosDoLead } from '../email/repositorio.js';
import { obterConfig as configCadencia, mensagemDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
import { notificar, notificarDono } from '../notificacoes/repositorio.js';
import * as base from './conhecimento.js';
import { dentroDoHorario, proximaAbertura } from './horario.js';
import { perfilParaAtendimento } from './perfil.js';
import * as repo from './repositorio.js';

/**
 * Atendimento da IA a um lead que escreveu. Antes de cada resposta:
 *  - pedido para parar, para falar com uma pessoa ou assunto sério (Procon, advogado) vão direto
 *    para o time, sem passar pela IA;
 *  - a IA recebe a ficha do lead, o que ele já contou (memória) e só os trechos da base de
 *    conhecimento que combinam com o que ele escreveu;
 *  - a resposta passa pelas verificações (preço, link ou contato fora da base, repetição,
 *    promessa, "te retorno" sem passar para o time…) e depois pela conferência frase a frase (uma
 *    segunda IA procura a fonte de cada afirmação no perfil e na base); o que não passa volta para
 *    a IA reescrever uma vez; se ainda não passar, não sai e o lead vai para o time.
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

/** Por que a IA passou o lead para o time (para os números de desempenho). */
export type TipoPassagem = 'pediu_pessoa' | 'sensivel' | 'limite' | 'sem_ia' | 'falha' | 'verificacao' | 'ia';

interface ContextoPassagem {
  conversa: Mensagem[];
  etapa: string;
  leadNome: string;
  contato: string | null;
}

/** Já avisamos este lead que o time vai responder (nas últimas 6 horas)? */
const NOTA_AVISO = 'Aviso ao lead: a IA passou para o time';

/**
 * Para de responder e passa o lead para o time: pausa a IA, põe "Responder" como próximo passo,
 * avisa o lead (para ele não ficar sem resposta) e o dono do lead, com um resumo da conversa.
 */
export async function passarParaTime(
  deps: DepsAtendimento,
  cfg: repo.ConfigAgente | null,
  empresaId: number,
  motivo: string,
  tipo: TipoPassagem,
  contexto?: ContextoPassagem,
  opcoes: { avisarLead?: boolean } = {},
): Promise<void> {
  const { pool } = deps;
  await pool.query(
    `UPDATE comercial.oportunidades SET agente_pausa = $2, agente_retorno_em = NULL
      WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId, motivo.slice(0, 300)],
  );
  await pool.query(
    `INSERT INTO comercial.passagens_ia (conta_id, empresa_id, tipo, motivo) VALUES (${contaSql()}, $1, $2, $3)`,
    [empresaId, tipo, motivo.slice(0, 300)],
  );
  await funil.atualizar(
    pool,
    empresaId,
    { proximaAcao: 'Responder: a IA passou para você', proximaAcaoEm: new Date().toISOString() },
    AUTOR,
  );

  const perfil = await perfilParaAtendimento(pool);
  // Aviso ao lead: "vou chamar alguém do time" (fora do horário, quando o time volta).
  if (cfg?.avisoPassagem && opcoes.avisarLead !== false && contexto) {
    const { rows: ja } = await pool.query(
      `SELECT 1 FROM comercial.mensagens WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND nota = $2
          AND criado_em > now() - interval '6 hours' LIMIT 1`,
      [empresaId, NOTA_AVISO],
    );
    const { telefone } = await mensagemDoLead(pool, empresaId);
    if (!ja.length && telefone)
      await repo.criarMensagem(pool, {
        empresaId,
        direcao: 'enviada',
        // A frase que o gestor escreveu no perfil vale dentro do horário; fora dele, a que diz quando o time volta.
        texto:
          perfil?.limites.fraseDePassagem && dentroDoHorario(cfg)
            ? perfil.limites.fraseDePassagem
            : avisoDePassagem({
                dentroDoHorario: dentroDoHorario(cfg),
                volta: proximaAbertura(cfg),
                motivo: tipo === 'pediu_pessoa' ? 'pediu_pessoa' : tipo === 'sensivel' ? 'sensivel' : 'outro',
              }),
        telefone,
        status: 'aprovada',
        origem: 'agente',
        nota: NOTA_AVISO,
      });
  }

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
  const aviso = {
    tipo: 'mensagem' as const,
    titulo: `${contexto?.leadNome || 'Lead'}: a IA passou a conversa para você`,
    texto: textoAviso,
    empresaId,
  };
  // Quem recebe: uma pessoa fixa (escolhida no perfil) ou o responsável pelo lead.
  const fixo = typeof perfil?.limites.quemRecebe === 'number' ? perfil.limites.quemRecebe : null;
  await (fixo ? notificar(pool, fixo, aviso) : notificarDono(pool, empresaId, aviso)).catch((erro) =>
    deps.log.warn({ err: erro, empresaId }, 'agente: não consegui avisar quem recebe'),
  );
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
const COM_MENSAGEM = new Set(['responder', 'marcar_reuniao', 'agendar_retorno', 'encerrar_sem_interesse']);

/** Regras fixas, antes da IA (sem chance de erro). */
export function regraFixa(
  texto: string,
): { tipo: 'parar' } | { tipo: 'pediu_pessoa' | 'sensivel'; motivo: string } | null {
  if (pediuParaParar(texto)) return { tipo: 'parar' };
  if (pediuHumano(texto)) return { tipo: 'pediu_pessoa', motivo: 'O lead pediu para falar com uma pessoa.' };
  if (assuntoSensivel(texto))
    return { tipo: 'sensivel', motivo: 'Assunto sério (reclamação ou jurídico): responda você.' };
  return null;
}

export interface EntradaPensar {
  empresaNome: string;
  remetente: string;
  lead: ContextoAgente['lead'];
  conversa: { de: 'nos' | 'lead'; texto: string; em: string }[];
  memoria: string[];
  ficha: string[];
  retomada?: string | null;
}

export interface Pensamento {
  decisao: DecisaoAgente;
  trechos: base.TrechoAchado[];
  /** O que a 1ª resposta tinha de errado (vazio: passou de primeira). */
  problemasIniciais: ProblemaVerificacao[];
  /** A 1ª resposta, quando foi reescrita. */
  primeiraResposta: string | null;
  /** O que sobrou depois da reescrita: a mensagem não sai. */
  barrada: ProblemaVerificacao[];
  /** Conferência frase a frase da resposta final (null: sem conferência, ex.: sem mensagem). */
  conferencia: FraseConferidaIa[] | null;
}

/**
 * O cérebro do atendimento, igual na conversa de verdade e no simulador: busca os trechos da base
 * que combinam com o que o lead escreveu, pede a decisão à IA, confere a resposta e, se precisar,
 * pede uma reescrita com o motivo.
 */
export async function pensar(
  pool: Pool,
  ia: NonNullable<DepsAtendimento['ia']>,
  cfg: repo.ConfigAgente,
  e: EntradaPensar,
  opcoes: { perfil?: PerfilIa | null; forcarPerfil?: boolean; sempreConferir?: boolean } = {},
): Promise<Pensamento> {
  // Perfil da IA (seções conferidas pelo gestor). Sem nenhuma conferida, vale o texto antigo.
  const perfil = opcoes.forcarPerfil ? (opcoes.perfil ?? null) : await perfilParaAtendimento(pool);
  const textoPerfil = perfil ? textoDoPerfil(perfil, e.empresaNome) : null;
  const doLead: string[] = [];
  for (let i = e.conversa.length - 1; i >= 0 && e.conversa[i]!.de === 'lead'; i--)
    doLead.unshift(e.conversa[i]!.texto);
  // Busca na base com o que ele escreveu agora (e a nossa última mensagem, que dá o assunto).
  const nossaUltima = [...e.conversa].reverse().find((c) => c.de === 'nos')?.texto ?? '';
  const trechos = await base.buscarTrechos(pool, `${doLead.join('\n') || e.retomada || ''}\n${nossaUltima}`);
  const ctx: ContextoAgente = {
    empresa: e.empresaNome,
    sobreEmpresa: cfg.sobreEmpresa,
    regras: cfg.regras,
    horariosReuniao: cfg.horariosReuniao,
    remetente: e.remetente,
    agora: new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date()),
    lead: e.lead,
    conversa: e.conversa,
    conhecimento: trechos.map((t) => ({ titulo: t.titulo, texto: t.texto })),
    memoria: e.memoria,
    ficha: e.ficha,
    retomada: e.retomada ?? null,
    perfil: textoPerfil,
  };
  // O que a IA podia usar: só isso vale para preço, link, telefone e promessa.
  const fontes = [
    ...(textoPerfil ? [textoPerfil] : [cfg.sobreEmpresa, cfg.regras]),
    cfg.horariosReuniao,
    ...trechos.map((t) => t.texto),
    ...e.ficha,
    ...e.memoria,
    ...e.conversa.map((c) => c.texto),
  ];
  const enviadasAntes = e.conversa
    .filter((c) => c.de === 'nos')
    .slice(-6)
    .map((c) => c.texto);
  const verificar = (d: DecisaoAgente) =>
    COM_MENSAGEM.has(d.acao) && d.resposta
      ? verificarMensagem({ texto: d.resposta, fontes, enviadasAntes, acao: d.acao })
      : [];

  // Fontes da conferência frase a frase: o perfil por seção, a base, o lead e a agenda.
  const fontesConferencia: FonteConferencia[] = [
    ...(perfil
      ? fontesDoPerfil(perfil, e.empresaNome)
      : [
          { rotulo: 'Sobre a empresa', texto: cfg.sobreEmpresa },
          { rotulo: 'Regras', texto: cfg.regras },
        ]),
    ...trechos.map((t) => ({ rotulo: `Base: ${t.titulo}`, texto: t.texto })),
    { rotulo: 'Horários', texto: `${cfg.horariosReuniao}\nAgora: ${ctx.agora}` },
    { rotulo: 'O que sabemos do lead', texto: [...e.ficha, ...e.memoria].join('\n') },
    { rotulo: 'Conversa', texto: e.conversa.map((c) => c.texto).join('\n') },
  ].filter((f) => f.texto.trim());

  // Regras fixas primeiro (rápidas); passou nelas, a conferência frase a frase.
  const conferir = async (
    d: DecisaoAgente,
  ): Promise<{ problemas: ProblemaVerificacao[]; frases: FraseConferidaIa[] | null }> => {
    const fixas = verificar(d);
    // Barrada nas regras fixas já não sai; a prova confere mesmo assim (para mostrar o porquê).
    if ((fixas.length && !opcoes.sempreConferir) || !COM_MENSAGEM.has(d.acao) || !d.resposta || !ia.conferir)
      return { problemas: fixas, frases: null };
    let frases: FraseConferidaIa[] | null = null;
    try {
      frases = await ia.conferir({ resposta: d.resposta, fontes: fontesConferencia });
    } catch {
      frases = null;
    }
    // Sem conferência, por segurança a mensagem não sai.
    if (!frases)
      return {
        problemas: [
          ...fixas,
          { regra: 'sem_fonte', detalhe: 'Não deu para conferir a resposta: por segurança ela não saiu.' },
        ],
        frases: null,
      };
    return {
      problemas: [
        ...fixas,
        ...semFonte(frases).map((f) => ({
          regra: 'sem_fonte' as const,
          detalhe: `"${f}" não está nas informações da empresa: tire ou passe para o time.`,
        })),
      ],
      frases,
    };
  };

  let decisao = await ia.decidir(ctx);
  const primeira = await conferir(decisao);
  const problemasIniciais = primeira.problemas;
  let conferencia = primeira.frases;
  let barrada: ProblemaVerificacao[] = [];
  let primeiraResposta: string | null = null;
  if (problemasIniciais.length) {
    primeiraResposta = decisao.resposta;
    decisao = await ia.decidir({
      ...ctx,
      correcao: { texto: decisao.resposta, problemas: problemasIniciais.map((p) => p.detalhe) },
    });
    const segunda = await conferir(decisao);
    barrada = segunda.problemas;
    conferencia = segunda.frases ?? conferencia;
  }
  return { decisao, trechos, problemasIniciais, primeiraResposta, barrada, conferencia };
}

async function dadosDaConversa(pool: Pool, empresaId: number) {
  const { rows: lead } = await pool.query<{ nome: string; cidade: string | null; decisor: string | null }>(
    `SELECT e.nome, e.cidade,
            -- com quem a conversa está (pessoa indicada, com o cargo), senão o decisor do enriquecimento
            coalesce(
              (SELECT cl.nome || coalesce(' (' || cl.cargo || ')', '') FROM comercial.contatos_lead cl
                 JOIN comercial.oportunidades o ON o.conta_id = cl.conta_id AND o.empresa_id = cl.empresa_id
                WHERE cl.conta_id = ${contaSql()} AND cl.empresa_id = e.id AND cl.status = 'confirmado'
                  AND o.whatsapp_destino IS NOT NULL AND left(cl.telefone, 2) = left(o.whatsapp_destino, 2)
                  AND right(cl.telefone, 8) = right(o.whatsapp_destino, 8) LIMIT 1),
              (SELECT p.nome FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor AND ${visivel('p')}
                ORDER BY (p.conta_id <> 0) DESC LIMIT 1)) AS decisor
       FROM descoberta.empresas e WHERE e.id = $1`,
    [empresaId],
  );
  const cad = await configCadencia(pool);
  const { rows: contaRows } = await pool.query<{ nome: string }>(
    `SELECT nome FROM cadastro.contas WHERE id = ${contaSql()}`,
  );
  return {
    leadNome: lead[0]?.nome ?? '',
    cidade: lead[0]?.cidade ?? null,
    contato: lead[0]?.decisor ?? null,
    remetente: cad.remetente,
    empresaNome: contaRows[0]?.nome ?? 'nossa empresa',
  };
}

const paraIa = (conversa: Mensagem[]) =>
  conversa.map((c) => ({
    de: c.direcao === 'enviada' ? ('nos' as const) : ('lead' as const),
    texto: c.texto,
    em: c.em,
  }));

export async function responderLead(
  deps: DepsAtendimento,
  cfg: repo.ConfigAgente,
  empresaId: number,
  etapa: string,
  opcoes: { retomada?: string } = {},
): Promise<void> {
  const { pool } = deps;
  const conversa = await conversaDoLead(pool, empresaId);
  const doLead = opcoes.retomada ? '' : ultimasDoLead(conversa) || conversa.at(-1)?.texto || '';
  const ultimaId = conversa.at(-1)?.id ?? 0;
  const dados = await dadosDaConversa(pool, empresaId);
  const contexto: ContextoPassagem = { conversa, etapa, leadNome: dados.leadNome, contato: dados.contato };
  const passar = (motivo: string, tipo: TipoPassagem, avisarLead = true) =>
    passarParaTime(deps, cfg, empresaId, motivo, tipo, contexto, { avisarLead });

  const desligarIa = () =>
    pool.query(
      `UPDATE comercial.oportunidades SET agente = false, agente_retorno_em = NULL
        WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [empresaId],
    );

  const fixa = doLead ? regraFixa(doLead) : null;
  if (fixa?.tipo === 'parar') {
    await desligarIa();
    await funil.atualizar(
      pool,
      empresaId,
      { etapa: 'descartado', motivo: 'Pediu para não receber mensagens' },
      AUTOR,
    );
    return;
  }
  if (fixa) {
    await passar(fixa.motivo, fixa.tipo);
    return;
  }
  const { rows: hoje } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.mensagens
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND origem = 'agente' AND criado_em >= ${repo.HOJE_SP}
        AND nota IS DISTINCT FROM $2`,
    [empresaId, NOTA_AVISO],
  );
  if ((hoje[0]?.n ?? 0) >= cfg.respostasDiaLead) {
    await passar(`A IA já respondeu ${cfg.respostasDiaLead} vezes hoje: continue você.`, 'limite');
    return;
  }
  if (!deps.ia) {
    await passar('O lead respondeu e a IA não está configurada para esta conta.', 'sem_ia');
    return;
  }

  const m = await mensagemDoLead(pool, empresaId);
  const memoria = await memoriaDoLead(pool, empresaId);
  let p: Pensamento;
  try {
    p = await pensar(pool, deps.ia, cfg, {
      empresaNome: dados.empresaNome,
      remetente: dados.remetente,
      lead: { empresa: dados.leadNome, cidade: dados.cidade, contato: dados.contato, etapa },
      conversa: paraIa(conversa),
      memoria,
      ficha: await fichaDoLead(pool, empresaId),
      retomada: opcoes.retomada ?? null,
    });
  } catch (erro) {
    deps.log.warn({ err: erro, empresaId }, 'agente: a IA falhou');
    await passar('A IA falhou ao responder: responda você.', 'falha');
    return;
  }
  const { decisao, trechos, barrada } = p;

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
  if (p.problemasIniciais.length && !barrada.length && p.primeiraResposta)
    await registrarVerificacao(pool, empresaId, p.primeiraResposta, p.problemasIniciais, 'reescrita');
  if (barrada.length) {
    await registrarVerificacao(pool, empresaId, decisao.resposta, barrada, 'bloqueada');
    await passar(
      `A resposta da IA não passou nas verificações (${barrada.map((x) => x.regra).join(', ')}): responda você.`,
      'verificacao',
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

  // A conversa voltou a andar: o retorno que estava combinado deixa de valer.
  if (decisao.acao !== 'agendar_retorno')
    await pool.query(
      `UPDATE comercial.oportunidades SET agente_retorno_em = NULL
        WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND agente_retorno_em IS NOT NULL`,
      [empresaId],
    );

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
    case 'agendar_retorno':
      // O lead pediu para falar depois: a cadência espera e a IA retoma na data, com o contexto.
      if (decisao.resposta) await nova(decisao.resposta);
      await pool.query(
        `UPDATE comercial.oportunidades SET agente_retorno_em = $2, agente_retorno_motivo = $3
          WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
        [empresaId, decisao.retornoEm, decisao.motivo.slice(0, 300) || 'O lead pediu para falar depois'],
      );
      await funil.registrarAtividade(
        pool,
        empresaId,
        {
          tipo: 'nota',
          direcao: null,
          texto: `A IA combinou retomar o contato: ${decisao.motivo}`,
        },
        AUTOR,
      );
      await funil.atualizar(
        pool,
        empresaId,
        { proximaAcao: 'Retomar (combinado com o lead)', proximaAcaoEm: decisao.retornoEm },
        AUTOR,
      );
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
      // A IA já disse algo ("vou confirmar com o time"): não manda o aviso fixo junto.
      if (decisao.resposta) await nova(decisao.resposta);
      await passar(decisao.motivo || 'A IA preferiu que você responda.', 'ia', !decisao.resposta);
  }
}

/**
 * Retornos combinados que venceram: a IA retoma a conversa com o contexto ("como combinamos…"),
 * no horário do agente. Sai pelo mesmo caminho das respostas (verificações, revisão).
 */
export async function retomarCombinados(deps: DepsAtendimento, cfg: repo.ConfigAgente, limite = 5) {
  if (!deps.ia || !dentroDoHorario(cfg)) return 0;
  const { rows } = await deps.pool.query<{ empresa_id: number; etapa: string; motivo: string | null }>(
    `SELECT o.empresa_id::int, o.etapa, o.agente_retorno_motivo AS motivo FROM comercial.oportunidades o
      WHERE o.conta_id = ${contaSql()} AND o.agente AND o.agente_pausa IS NULL
        AND o.agente_retorno_em <= now() AND o.etapa NOT IN ('ganho', 'perdido', 'descartado')
        AND NOT EXISTS (SELECT 1 FROM comercial.mensagens m
                         WHERE m.conta_id = o.conta_id AND m.empresa_id = o.empresa_id
                           AND m.status IN ('rascunho', 'aprovada'))
      ORDER BY o.agente_retorno_em LIMIT $1`,
    [limite],
  );
  for (const r of rows) {
    await deps.pool.query(
      `UPDATE comercial.oportunidades SET agente_retorno_em = NULL WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [r.empresa_id],
    );
    await responderLead(deps, cfg, r.empresa_id, r.etapa, {
      retomada: r.motivo || 'o lead pediu para falar depois',
    });
  }
  return rows.length;
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
