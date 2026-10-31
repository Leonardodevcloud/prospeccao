import { type Executor, INICIO_MES_SP, INICIO_MES_SP_TS } from '@prospeccao/db';
import {
  type CotaMes,
  type CustoLinha,
  type CustosPlataforma,
  fixosDoMes,
  fracaoDoMes,
  NOME_SERVICO,
  PAPEL_SERVICO,
  type PlanosConsumo,
  preverMes,
  type SaudeAgora,
  type SaudeMes,
  type ServicoAgora,
  type ServicoExterno,
} from '@prospeccao/shared';
import type { DepsApi } from '../../dependencias.js';
import { CELULAR, clientes, lerCustos, lerPlanos, SEGUNDOS_COBRADOS } from './repositorio.js';

/**
 * Saúde e consumo (painel master): o que está acontecendo agora com cada serviço externo, o consumo
 * do mês contra o que cada plano inclui e os custos (fixos + excedentes). A conta de demonstração
 * fica de fora de tudo.
 */

/** Contas que não são a de demonstração. */
const NAO_DEMO = `conta_id IN (SELECT c.id FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
                                WHERE NOT o.demonstracao)`;

const fmt = (v: number, casas = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const usd = (v: number) => `US$ ${fmt(v, v < 10 ? 2 : 0)}`;
const brl = (v: number) => `R$ ${fmt(v, v < 100 ? 2 : 0)}`;
const r2 = (v: number) => Math.round(v * 100) / 100;

/* ---------------- Agora ---------------- */

const ORDEM: ServicoExterno[] = [
  'ia',
  'whatsapp',
  'livekit',
  'groq',
  'voz',
  'email',
  'serper',
  'places',
  'ors',
  'asaas',
  'meta',
  'r2',
  'brasilapi',
  'directd',
  'vercel',
];

/** Serviços configurados (aparecem mesmo sem chamadas); os outros só aparecem se foram usados. */
function configurados(deps: DepsApi): Set<ServicoExterno> {
  const a = deps.credenciais.ambiente;
  const s = new Set<ServicoExterno>();
  if (a.iaKey) s.add('ia');
  if (a.zapiParceiroToken) s.add('whatsapp');
  if (deps.reunioes?.video || deps.telefonia?.servico) s.add('livekit');
  if (deps.reunioes?.transcricao || deps.assistente?.voz) s.add('groq');
  if (deps.assistente?.fala) s.add('voz');
  if (a.resendKey) s.add('email');
  if (a.placesKey) s.add('places');
  if (a.orsKey) s.add('ors');
  if (deps.cobranca) s.add('asaas');
  if (a.metaAppId) s.add('meta');
  if (deps.reunioes?.armazenamento) s.add('r2');
  return s;
}

export async function agora(deps: DepsApi): Promise<SaudeAgora> {
  const { pool } = deps;
  const t0 = performance.now();
  await pool.query('SELECT 1');
  const msConsulta = Math.round(performance.now() - t0);
  const [uso, estados, vivo, banco, workers, fila, chips] = await Promise.all([
    pool.query<{ servico: ServicoExterno; idx: number; chamadas: number; erros: number; ms: number }>(
      `SELECT servico, (59 - floor(extract(epoch FROM (date_trunc('minute', now()) - minuto)) / 60))::int AS idx,
              sum(chamadas)::int AS chamadas, sum(erros)::int AS erros, sum(ms_total)::float8 AS ms
         FROM cadastro.servicos_uso WHERE minuto > now() - interval '60 minutes'
        GROUP BY 1, 2`,
    ),
    pool.query<{
      servico: ServicoExterno;
      ultimo_erro: string | null;
      ultimo_erro_em: string | null;
      erros_seguidos: number;
      recente: boolean;
    }>(
      `SELECT servico, ultimo_erro, ultimo_erro_em, erros_seguidos,
              atualizado_em > now() - interval '7 days' AS recente
         FROM cadastro.servicos_estado`,
    ),
    pool.query<{ reunioes: number; pessoas: number; ligacoes: number; ia: number }>(
      `SELECT (SELECT count(*) FROM comercial.sala_sessoes WHERE situacao = 'ao_vivo' AND ${NAO_DEMO})::int AS reunioes,
              (SELECT count(*) FROM comercial.sala_participantes sp
                 JOIN comercial.sala_sessoes ss ON ss.sala_id = sp.sala_id AND ss.situacao = 'ao_vivo'
                WHERE sp.situacao = 'liberado' AND sp.entrou_em IS NOT NULL AND sp.saiu_em IS NULL
                  AND sp.entrou_em >= ss.iniciada_em)::int AS pessoas,
              (SELECT count(*) FROM comercial.ligacoes
                WHERE situacao IN ('chamando', 'tocando', 'em_andamento') AND iniciada_em > now() - interval '4 hours')::int AS ligacoes,
              (SELECT count(*) FROM comercial.atividades
                WHERE autor = 'agente' AND direcao = 'enviada' AND criado_em > now() - interval '1 hour')::int AS ia`,
    ),
    pool.query<{ bytes: number; conexoes: number; max: number }>(
      `SELECT pg_database_size(current_database())::float8 AS bytes,
              (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS conexoes,
              current_setting('max_connections')::int AS max`,
    ),
    pool.query<{ nome: string; visto_em: string; parado: boolean }>(
      `SELECT nome, visto_em, visto_em < now() - interval '5 minutes' AS parado
         FROM cadastro.servicos_vivos WHERE visto_em > now() - interval '7 days' ORDER BY nome`,
    ),
    pool
      .query<{ n: number }>(
        `SELECT count(*)::int AS n FROM fila.job WHERE name = 'enriquecimento.solicitar' AND state IN ('created', 'retry')`,
      )
      .catch(() => ({ rows: [{ n: 0 }] })),
    pool.query<{ total: number; conectados: number }>(
      `SELECT count(*) FILTER (WHERE token_cifrado IS NOT NULL)::int AS total,
              count(*) FILTER (WHERE ativo AND token_cifrado IS NOT NULL AND estado LIKE 'ok%')::int AS conectados
         FROM comercial.chips WHERE ${NAO_DEMO}`,
    ),
  ]);

  const porServico = new Map<ServicoExterno, { serie: number[]; erros: number[]; ms: number }>();
  for (const u of uso.rows) {
    if (u.idx < 0 || u.idx > 59) continue;
    const s = porServico.get(u.servico) ?? { serie: Array(60).fill(0), erros: Array(60).fill(0), ms: 0 };
    s.serie[u.idx] += u.chamadas;
    s.erros[u.idx] += u.erros;
    s.ms += u.ms;
    porServico.set(u.servico, s);
  }
  const estado = new Map(estados.rows.map((e) => [e.servico, e]));
  const conf = configurados(deps);
  const v = vivo.rows[0]!;
  const c = chips.rows[0]!;
  const detalhes: Partial<Record<ServicoExterno, string>> = {
    whatsapp: `${fmt(c.total)} ${c.total === 1 ? 'número' : 'números'} · ${fmt(c.conectados)} ${c.conectados === 1 ? 'conectado' : 'conectados'}`,
    livekit: `${fmt(v.reunioes)} ${v.reunioes === 1 ? 'reunião' : 'reuniões'} · ${fmt(v.ligacoes)} ${v.ligacoes === 1 ? 'ligação' : 'ligações'} agora`,
  };

  const servicos: ServicoAgora[] = [];
  for (const id of ORDEM) {
    const s = porServico.get(id);
    const e = estado.get(id);
    if (!conf.has(id) && !s && !e?.recente) continue;
    const chamadas = s ? s.serie.reduce((a, b) => a + b, 0) : 0;
    const erros = s ? s.erros.reduce((a, b) => a + b, 0) : 0;
    const ultimos10 = s ? s.serie.slice(-10).reduce((a, b) => a + b, 0) : 0;
    const erros10 = s ? s.erros.slice(-10).reduce((a, b) => a + b, 0) : 0;
    const problemaRecente =
      e?.ultimo_erro_em && Date.now() - new Date(e.ultimo_erro_em).getTime() < 24 * 3600_000;
    const estadoServico: ServicoAgora['estado'] =
      (e?.erros_seguidos ?? 0) >= 5 || (erros10 >= 3 && erros10 > ultimos10 * 0.2)
        ? 'erro'
        : erros > 0 && erros > chamadas * 0.05
          ? 'aviso'
          : chamadas === 0
            ? 'quieto'
            : 'ok';
    servicos.push({
      id,
      nome: NOME_SERVICO[id],
      papel: PAPEL_SERVICO[id],
      estado: estadoServico,
      serie: s?.serie ?? Array(60).fill(0),
      serieErros: s?.erros ?? Array(60).fill(0),
      chamadas,
      erros,
      msMedio: chamadas ? Math.round(s!.ms / chamadas) : null,
      ultimoProblema:
        problemaRecente && e?.ultimo_erro ? { em: e.ultimo_erro_em!, texto: e.ultimo_erro } : null,
      detalhe: detalhes[id] ?? null,
    });
  }
  const b = banco.rows[0]!;
  return {
    atualizadoEm: new Date().toISOString(),
    servicos,
    aoVivo: { reunioes: v.reunioes, pessoasEmSala: v.pessoas, ligacoes: v.ligacoes, respostasIaHora: v.ia },
    banco: {
      tamanhoGb: Math.round((b.bytes / 1e9) * 100) / 100,
      conexoes: b.conexoes,
      maxConexoes: b.max,
      msConsulta,
    },
    workers: workers.rows.map((w) => ({ nome: w.nome, vistoEm: w.visto_em, parado: w.parado })),
    fila: { enriquecimento: fila.rows[0]?.n ?? 0 },
    resumo: {
      respondendo: servicos.filter((s) => s.estado !== 'erro').length,
      total: servicos.length,
      chamadasHora: servicos.reduce((t, s) => t + s.chamadas, 0),
      errosHora: servicos.reduce((t, s) => t + s.erros, 0),
    },
  };
}

/* ---------------- Consumo do mês ---------------- */

export interface UsoDoMes {
  reuniaoMin: number;
  ligacaoSalaMin: number;
  sipFeitasMin: number;
  sipRecebidasMin: number;
  operadoraCelularMin: number;
  operadoraFixoMin: number;
  ligacoesFeitas: number;
  transcricaoReuniaoH: number;
  transcricaoLigacaoH: number;
  bytesReunioes: number;
  bytesLigacoes: number;
  iaChamadas: number;
  iaEntrada: number;
  iaSaida: number;
  placesUsd: number;
  serper: number;
  emails: number;
  emailsDevolvidos: number;
  numeros: number;
  orsHoje: number;
  orsPico: number;
  orsPicoDia: string | null;
  basePaga: number;
}

/** Tudo o que foi usado no mês (sem a demonstração). */
export async function usoDoMes(db: Executor): Promise<UsoDoMes> {
  const { rows } = await db.query<UsoDoMes>(
    `WITH lig AS (
       SELECT * FROM comercial.ligacoes WHERE iniciada_em >= ${INICIO_MES_SP_TS} AND ${NAO_DEMO}
     ), ors AS (
       SELECT (minuto AT TIME ZONE 'America/Sao_Paulo')::date AS dia, sum(chamadas) AS n
         FROM cadastro.servicos_uso WHERE servico = 'ors' AND minuto >= ${INICIO_MES_SP_TS} GROUP BY 1
     )
     SELECT
       coalesce((SELECT sum(segundos_na_sala) FROM comercial.sala_participantes
                  WHERE entrou_em >= ${INICIO_MES_SP_TS} AND ${NAO_DEMO}), 0)::float8 / 60 AS "reuniaoMin",
       -- Quem liga fica numa sala do LiveKit: na feita, desde a discagem; na recebida, desde que atendeu.
       coalesce((SELECT sum(extract(epoch FROM least(coalesce(encerrada_em, now()), iniciada_em + interval '4 hours')
                          - CASE WHEN direcao = 'saida' THEN iniciada_em ELSE coalesce(atendida_em, encerrada_em, now()) END))
                   FROM lig), 0)::float8 / 60 AS "ligacaoSalaMin",
       -- O lado do lead (SIP): do começo ao fim, tocando também.
       coalesce((SELECT sum(extract(epoch FROM least(coalesce(encerrada_em, now()), iniciada_em + interval '4 hours') - iniciada_em))
                   FROM lig WHERE direcao = 'saida'), 0)::float8 / 60 AS "sipFeitasMin",
       coalesce((SELECT sum(extract(epoch FROM least(coalesce(encerrada_em, now()), iniciada_em + interval '4 hours') - iniciada_em))
                   FROM lig WHERE direcao = 'entrada'), 0)::float8 / 60 AS "sipRecebidasMin",
       coalesce((SELECT sum(${SEGUNDOS_COBRADOS}) FROM lig
                  WHERE direcao = 'saida' AND atendida_em IS NOT NULL AND ${CELULAR}), 0)::float8 / 60 AS "operadoraCelularMin",
       coalesce((SELECT sum(${SEGUNDOS_COBRADOS}) FROM lig
                  WHERE direcao = 'saida' AND atendida_em IS NOT NULL AND NOT ${CELULAR}), 0)::float8 / 60 AS "operadoraFixoMin",
       (SELECT count(*) FROM lig WHERE direcao = 'saida')::int AS "ligacoesFeitas",
       coalesce((SELECT sum(sp.segundos_na_sala) FROM comercial.sala_participantes sp
                   JOIN comercial.sala_sessoes ss ON ss.sala_id = sp.sala_id AND ss.transcricao = 'pronta'
                    AND sp.entrou_em >= ss.iniciada_em AND sp.entrou_em < coalesce(ss.encerrada_em, now())
                  WHERE ss.iniciada_em >= ${INICIO_MES_SP_TS} AND ss.${NAO_DEMO}), 0)::float8 / 3600 AS "transcricaoReuniaoH",
       coalesce((SELECT sum(2 * duracao_segundos) FROM lig WHERE transcricao = 'pronta'), 0)::float8 / 3600
         AS "transcricaoLigacaoH",
       coalesce((SELECT sum(video_bytes) FROM comercial.sala_sessoes WHERE ${NAO_DEMO}), 0)::float8
         + coalesce((SELECT sum(g.bytes) FROM comercial.sala_gravacoes g JOIN comercial.sala_sessoes ss ON ss.id = g.sessao_id
                      WHERE g.tipo = 'audio' AND g.situacao = 'pronta' AND ss.${NAO_DEMO}), 0)::float8 AS "bytesReunioes",
       coalesce((SELECT sum(bytes) FROM comercial.ligacao_audios WHERE ${NAO_DEMO}), 0)::float8 AS "bytesLigacoes",
       coalesce((SELECT sum(chamadas) FROM cadastro.consumo_ia WHERE origem = 'plataforma' AND dia >= ${INICIO_MES_SP} AND ${NAO_DEMO}), 0)::int
         AS "iaChamadas",
       coalesce((SELECT sum(tokens_entrada) FROM cadastro.consumo_ia WHERE origem = 'plataforma' AND dia >= ${INICIO_MES_SP} AND ${NAO_DEMO}), 0)::float8
         AS "iaEntrada",
       coalesce((SELECT sum(tokens_saida) FROM cadastro.consumo_ia WHERE origem = 'plataforma' AND dia >= ${INICIO_MES_SP} AND ${NAO_DEMO}), 0)::float8
         AS "iaSaida",
       coalesce((SELECT sum(gasto_usd) FROM descoberta.v_uso_places_mes WHERE mes = ${INICIO_MES_SP} AND ${NAO_DEMO}), 0)::float8
         AS "placesUsd",
       coalesce((SELECT sum(buscas) FROM cadastro.consumo_buscas WHERE servico = 'serper' AND dia >= ${INICIO_MES_SP} AND ${NAO_DEMO}), 0)::int
         AS serper,
       (SELECT count(*) FROM comercial.envios_email WHERE canal = 'email' AND status = 'enviado'
         AND enviado_em >= ${INICIO_MES_SP_TS} AND ${NAO_DEMO})::int AS emails,
       (SELECT count(*) FROM comercial.envios_email WHERE canal = 'email' AND status = 'devolvido'
         AND criado_em >= ${INICIO_MES_SP_TS} AND ${NAO_DEMO})::int AS "emailsDevolvidos",
       (SELECT count(*) FROM comercial.chips WHERE token_cifrado IS NOT NULL AND ${NAO_DEMO})::int AS numeros,
       coalesce((SELECT n FROM ors WHERE dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date), 0)::int AS "orsHoje",
       coalesce((SELECT max(n) FROM ors), 0)::int AS "orsPico",
       (SELECT to_char(dia, 'DD/MM') FROM ors ORDER BY n DESC LIMIT 1) AS "orsPicoDia",
       coalesce((SELECT sum(custo_brl) FROM enriquecimento.uso_base_paga WHERE criado_em >= ${INICIO_MES_SP_TS}), 0)::float8
         AS "basePaga"`,
  );
  return rows[0]!;
}

/** Dia do mês em que um uso que cresce no ritmo de agora chega ao limite. */
function diaQueAcaba(usado: number, limite: number, fracao: number, dias: number, mes: Date): string | null {
  if (usado <= 0 || usado >= limite) return null;
  const ritmo = usado / fracao; // por mês
  const f = limite / ritmo;
  if (f >= 1) return null;
  const dia = Math.max(1, Math.ceil(f * dias));
  const m = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', month: '2-digit' }).format(mes);
  return `${String(dia).padStart(2, '0')}/${m}`;
}

/** Cartões do consumo do mês, alertas e o custo variável (excedentes e o que é cobrado por uso). */
export function calcularMes(
  u: UsoDoMes,
  p: PlanosConsumo,
  c: CustosPlataforma,
  agora = new Date(),
): Pick<SaudeMes, 'periodo' | 'alertas' | 'cotas'> & { variaveis: CustoLinha[] } {
  const { fracao, dia, dias } = fracaoDoMes(agora);
  const prev = (v: number) => preverMes(v, fracao);
  const cotas: CotaMes[] = [];
  const alertas: SaudeMes['alertas'] = [];
  const variaveis: CustoLinha[] = [];
  const d = c.dolar;
  const estadoPor = (usado: number, previsto: number, limite: number, para: boolean): CotaMes['estado'] =>
    usado >= limite ? (para ? 'erro' : 'aviso') : previsto > limite ? (para ? 'erro' : 'aviso') : 'ok';
  const lk = p.livekit;

  // LiveKit: minutos de participante (reuniões + quem liga pelo navegador).
  const part = u.reuniaoMin + u.ligacaoSalaMin;
  const partPrev = prev(part);
  const partPara = lk.participanteExtraUsd == null;
  cotas.push({
    id: 'livekit_participante',
    grupo: 'livekit',
    nome: 'Minutos de participante',
    sub: 'reuniões + quem liga pelo navegador',
    valor: fmt(part),
    de: `de ${fmt(lk.participanteMin)}`,
    usado: lk.participanteMin ? part / lk.participanteMin : null,
    previsao: lk.participanteMin ? partPrev / lk.participanteMin : null,
    estado: estadoPor(part, partPrev, lk.participanteMin, partPara),
    detalhe: `Reuniões ${fmt(u.reuniaoMin)} · ligações ${fmt(u.ligacaoSalaMin)}. Previsão: ${fmt(partPrev)}${
      partPrev > lk.participanteMin
        ? partPara
          ? ' (passa do plano: as salas param).'
          : ` (${fmt(partPrev - lk.participanteMin)} a mais · ${usd((partPrev - lk.participanteMin) * lk.participanteExtraUsd!)}).`
        : '.'
    }`,
    fonte: 'medido',
  });
  // LiveKit: minutos de ligação (o lado do lead).
  const sip = u.sipFeitasMin + u.sipRecebidasMin;
  const sipPrev = prev(sip);
  const sipPara = lk.ligacaoExtraUsd == null;
  cotas.push({
    id: 'livekit_ligacao',
    grupo: 'livekit',
    nome: 'Minutos de ligação (SIP)',
    sub: 'o lado do lead, feitas e recebidas',
    valor: fmt(sip),
    de: `de ${fmt(lk.ligacaoMin)}`,
    usado: lk.ligacaoMin ? sip / lk.ligacaoMin : null,
    previsao: lk.ligacaoMin ? sipPrev / lk.ligacaoMin : null,
    estado: estadoPor(sip, sipPrev, lk.ligacaoMin, sipPara),
    detalhe: `Feitas ${fmt(u.sipFeitasMin)} · recebidas ${fmt(u.sipRecebidasMin)}. Previsão: ${fmt(sipPrev)}${
      sipPrev > lk.ligacaoMin && !sipPara
        ? ` (${fmt(sipPrev - lk.ligacaoMin)} a mais · ${usd((sipPrev - lk.ligacaoMin) * lk.ligacaoExtraUsd!)}).`
        : '.'
    }`,
    fonte: 'medido',
  });
  for (const [titulo, usado, previsto, limite, extra, oQue] of [
    ['Os minutos de ligação', sip, sipPrev, lk.ligacaoMin, lk.ligacaoExtraUsd, 'as ligações param'],
    [
      'Os minutos de participante',
      part,
      partPrev,
      lk.participanteMin,
      lk.participanteExtraUsd,
      'as salas param',
    ],
  ] as const) {
    if (previsto <= limite || !limite) continue;
    const quando = usado >= limite ? null : diaQueAcaba(usado, limite, fracao, dias, agora);
    alertas.push({
      id: `livekit_${titulo.includes('ligação') ? 'ligacao' : 'participante'}`,
      titulo: `${titulo} do LiveKit (plano ${lk.plano}) ${quando ? `acabam por volta de ${quando}` : 'acabaram'}.`,
      texto:
        extra == null
          ? `O plano inclui ${fmt(limite)} por mês, para todos os clientes juntos, e não cobra o excedente: ${oQue}. Passe para um plano pago no LiveKit e atualize em Planos dos serviços.`
          : `O plano inclui ${fmt(limite)}; já foram ${fmt(usado)}. Depois disso, cada minuto custa US$ ${fmt(extra, 4)} (cerca de R$ ${fmt(extra * d, 3)}): no ritmo atual, uns ${brl((previsto - limite) * extra * d)} a mais no mês.`,
    });
  }
  const excLk = (v: number, lim: number, extra: number | null) => Math.max(0, v - lim) * (extra ?? 0) * d;
  variaveis.push({
    nome: 'LiveKit além do plano',
    detalhe: 'minutos de participante e de ligação acima do incluso',
    ate: r2(
      excLk(part, lk.participanteMin, lk.participanteExtraUsd) +
        excLk(sip, lk.ligacaoMin, lk.ligacaoExtraUsd),
    ),
    previsao: r2(
      excLk(partPrev, lk.participanteMin, lk.participanteExtraUsd) +
        excLk(sipPrev, lk.ligacaoMin, lk.ligacaoExtraUsd),
    ),
  });

  // Operadora do telefone: o minuto cobrado (cadência 3/30/6), além da franquia.
  const t = p.telefone;
  const opMin = u.operadoraCelularMin + u.operadoraFixoMin;
  const custoOp = (cel: number, fixo: number) => {
    const total = cel + fixo;
    if (!total) return 0;
    const fora = Math.max(0, total - t.franquiaMin) / total;
    return (cel * t.celularMin + fixo * t.fixoMin) * fora;
  };
  const opAte = custoOp(u.operadoraCelularMin, u.operadoraFixoMin);
  const opPrev = custoOp(prev(u.operadoraCelularMin), prev(u.operadoraFixoMin));
  cotas.push({
    id: 'operadora',
    grupo: 'outros',
    nome: `Telefone · ${t.operadora}`,
    sub: 'a operadora das ligações',
    valor: `${fmt(opMin)} min`,
    de: t.franquiaMin
      ? `de ${fmt(t.franquiaMin)} da franquia`
      : `celular R$ ${fmt(t.celularMin, 2)} · fixo R$ ${fmt(t.fixoMin, 2)}`,
    usado: t.franquiaMin ? opMin / t.franquiaMin : null,
    previsao: t.franquiaMin ? prev(opMin) / t.franquiaMin : null,
    estado: t.franquiaMin && prev(opMin) > t.franquiaMin ? 'aviso' : 'ok',
    detalhe: `Celular ${fmt(u.operadoraCelularMin)} min · fixo ${fmt(u.operadoraFixoMin)} min (só as atendidas, como a operadora cobra). ${brl(opAte)} até hoje · previsão ${brl(opPrev)}.`,
    fonte: 'medido',
  });
  variaveis.push({
    nome: `Ligações · ${t.operadora}`,
    detalhe: `${fmt(opMin)} min (celular ${fmt(u.operadoraCelularMin)} · fixo ${fmt(u.operadoraFixoMin)})${t.franquiaMin ? ', além da franquia' : ''}`,
    ate: r2(opAte),
    previsao: r2(opPrev),
  });

  // IA da plataforma.
  const iaAte = (u.iaEntrada / 1e6) * c.iaEntradaMilhao + (u.iaSaida / 1e6) * c.iaSaidaMilhao;
  const iaPrev = prev(iaAte);
  const iaLim = p.ia.limiteMes;
  cotas.push({
    id: 'ia',
    grupo: 'outros',
    nome: 'IA da plataforma',
    sub: 'tokens da chave da plataforma',
    valor: brl(iaAte),
    de: iaLim != null ? `de ${brl(iaLim)}` : `${fmt((u.iaEntrada + u.iaSaida) / 1e6, 1)} mi de tokens`,
    usado: iaLim ? iaAte / iaLim : null,
    previsao: iaLim ? iaPrev / iaLim : null,
    estado: iaLim != null && iaPrev > iaLim ? 'aviso' : 'ok',
    detalhe: `${fmt(u.iaChamadas)} chamadas · ${fmt((u.iaEntrada + u.iaSaida) / 1e6, 1)} mi de tokens. Previsão: ${brl(iaPrev)}${iaLim != null ? ` (limite que você definiu: ${brl(iaLim)})` : ''}.`,
    fonte: 'medido',
  });
  if (iaLim != null && iaPrev > iaLim)
    alertas.push({
      id: 'ia',
      titulo: `A IA da plataforma deve passar do limite que você definiu (${brl(iaLim)}).`,
      texto: `Até hoje ${brl(iaAte)}; no ritmo atual, ${brl(iaPrev)} no mês. Veja em Clientes quem mais usa.`,
    });
  variaveis.push({
    nome: 'IA da plataforma',
    detalhe: `${fmt((u.iaEntrada + u.iaSaida) / 1e6, 1)} mi de tokens`,
    ate: r2(iaAte),
    previsao: r2(iaPrev),
  });

  // Transcrição (Groq).
  const groqH = u.transcricaoReuniaoH + u.transcricaoLigacaoH;
  cotas.push({
    id: 'groq',
    grupo: 'outros',
    nome: 'Transcrição · Groq',
    sub: 'cada voz transcrita à parte',
    valor: `${fmt(groqH, 1)} h`,
    de: `de áudio · ${brl(groqH * c.transcricaoHora)}`,
    usado: null,
    previsao: null,
    estado: 'ok',
    detalhe: `Reuniões ${fmt(u.transcricaoReuniaoH, 1)} h · ligações ${fmt(u.transcricaoLigacaoH, 1)} h. Previsão: ${fmt(prev(groqH), 1)} h. A voz do Argos não entra na conta (são poucos minutos).`,
    fonte: 'medido',
  });

  // Serper.
  const sp = p.serper;
  const spPrev = prev(u.serper);
  const porCredito = sp.creditos ? (sp.mensalUsd / sp.creditos) * d : 0;
  cotas.push({
    id: 'serper',
    grupo: 'outros',
    nome: 'Busca no Google · Serper',
    sub: 'créditos do mês',
    valor: fmt(u.serper),
    de: `de ${fmt(sp.creditos)}`,
    usado: sp.creditos ? u.serper / sp.creditos : null,
    previsao: sp.creditos ? spPrev / sp.creditos : null,
    estado: u.serper >= sp.creditos ? 'erro' : spPrev > sp.creditos ? 'aviso' : 'ok',
    detalhe:
      u.serper >= sp.creditos
        ? 'Os créditos do mês acabaram: compre mais no painel do Serper (o enriquecimento espera e volta sozinho).'
        : `Previsão: ${fmt(spPrev)} (cerca de ${fmt(spPrev / 3)} leads).`,
    fonte: 'medido',
  });
  if (spPrev > sp.creditos) {
    const quando = diaQueAcaba(u.serper, sp.creditos, fracao, dias, agora);
    alertas.push({
      id: 'serper',
      titulo: quando
        ? `Os créditos do Serper acabam por volta de ${quando}.`
        : 'Os créditos do Serper deste mês acabaram.',
      texto: `O pacote tem ${fmt(sp.creditos)} créditos; no ritmo atual o mês fecha em ${fmt(spPrev)}. Sem crédito, o enriquecimento espera.`,
    });
  }
  variaveis.push({
    nome: 'Serper além do pacote',
    detalhe: `${fmt(u.serper)} buscas`,
    ate: r2(Math.max(0, u.serper - sp.creditos) * porCredito),
    previsao: r2(Math.max(0, spPrev - sp.creditos) * porCredito),
  });

  // Google Maps (Places).
  const plPrev = prev(u.placesUsd);
  const plLim = p.places.limiteUsd;
  cotas.push({
    id: 'places',
    grupo: 'outros',
    nome: 'Google Maps · Places',
    sub: 'busca das empresas',
    valor: usd(u.placesUsd),
    de: plLim != null ? `de ${usd(plLim)}` : null,
    usado: plLim ? u.placesUsd / plLim : null,
    previsao: plLim ? plPrev / plLim : null,
    estado: plLim != null && plPrev > plLim ? 'aviso' : 'ok',
    detalhe: `Previsão: ${usd(plPrev)}${plLim != null ? ` (limite que você definiu: ${usd(plLim)})` : ''}.`,
    fonte: 'medido',
  });
  variaveis.push({
    nome: 'Google Maps · Places',
    detalhe: usd(u.placesUsd),
    ate: r2(u.placesUsd * d),
    previsao: r2(plPrev * d),
  });

  // E-mail (Resend).
  const rs = p.resend;
  const emPrev = prev(u.emails);
  cotas.push({
    id: 'email',
    grupo: 'outros',
    nome: 'E-mail · Resend',
    sub: `plano ${rs.plano}`,
    valor: fmt(u.emails),
    de: `de ${fmt(rs.emails)}`,
    usado: rs.emails ? u.emails / rs.emails : null,
    previsao: rs.emails ? emPrev / rs.emails : null,
    estado: rs.emails && emPrev > rs.emails ? (rs.extraUsdMil == null ? 'erro' : 'aviso') : 'ok',
    detalhe: `Previsão: ${fmt(emPrev)}.${u.emails ? ` ${fmt((u.emailsDevolvidos / Math.max(1, u.emails)) * 100, 1)}% devolvidos.` : ''}`,
    fonte: 'medido',
  });
  const exEmail = (v: number) => (Math.max(0, v - rs.emails) / 1000) * (rs.extraUsdMil ?? 0) * d;

  // Gravações (R2).
  const gb = (u.bytesReunioes + u.bytesLigacoes) / 1e9;
  const r2Custo = Math.max(0, gb - p.r2.gbGratis) * c.armazenamentoGbMes;
  cotas.push({
    id: 'r2',
    grupo: 'outros',
    nome: 'Gravações · R2',
    sub: 'o que está guardado',
    valor: `${fmt(gb, 1)} GB`,
    de: `${fmt(p.r2.gbGratis)} GB grátis`,
    usado: p.r2.gbGratis ? gb / p.r2.gbGratis : null,
    previsao: null,
    estado: 'ok',
    detalhe: `Reuniões ${fmt(u.bytesReunioes / 1e9, 1)} GB · ligações ${fmt(u.bytesLigacoes / 1e9, 1)} GB. ${brl(r2Custo)} no mês.`,
    fonte: 'medido',
  });

  // WhatsApp (Z-API): por número conectado.
  const zapi = u.numeros * c.whatsappNumeroMes;
  cotas.push({
    id: 'whatsapp',
    grupo: 'outros',
    nome: 'WhatsApp · Z-API',
    sub: 'por número conectado',
    valor: `${fmt(u.numeros)} ${u.numeros === 1 ? 'número' : 'números'}`,
    de: `${brl(c.whatsappNumeroMes)} cada`,
    usado: null,
    previsao: null,
    estado: 'ok',
    detalhe: `${brl(zapi)} no mês.`,
    fonte: 'medido',
  });
  variaveis.push({
    nome: 'Números de WhatsApp (Z-API)',
    detalhe: `${fmt(u.numeros)} × ${brl(c.whatsappNumeroMes)}`,
    ate: r2(zapi),
    previsao: r2(zapi),
  });

  // Rotas (ORS): limite por dia.
  cotas.push({
    id: 'ors',
    grupo: 'outros',
    nome: 'Rotas · OpenRouteService',
    sub: 'chamadas por dia',
    valor: fmt(u.orsHoje),
    de: `de ${fmt(p.ors.porDia)} hoje`,
    usado: p.ors.porDia ? u.orsHoje / p.ors.porDia : null,
    previsao: null,
    estado: u.orsHoje >= p.ors.porDia ? 'erro' : u.orsHoje >= p.ors.porDia * 0.8 ? 'aviso' : 'ok',
    detalhe: u.orsPico ? `Pico do mês: ${fmt(u.orsPico)} no dia ${u.orsPicoDia}.` : 'Sem chamadas neste mês.',
    fonte: 'medido',
  });

  variaveis.push({
    nome: 'Transcrição, e-mail e gravações',
    detalhe: 'Groq, e-mails acima do plano e GB acima do grátis',
    ate: r2(groqH * c.transcricaoHora + exEmail(u.emails) + r2Custo),
    previsao: r2(prev(groqH) * c.transcricaoHora + exEmail(emPrev) + r2Custo),
  });
  if (u.basePaga > 0)
    variaveis.push({
      nome: 'Base paga · Direct Data',
      detalhe: 'consultas de telefone por CNPJ',
      ate: r2(u.basePaga),
      previsao: r2(prev(u.basePaga)),
    });

  return { periodo: { dia, dias, fracao }, alertas, cotas, variaveis };
}

export async function mes(deps: DepsApi): Promise<SaudeMes> {
  const { pool, credenciais } = deps;
  const [u, painel] = await Promise.all([usoDoMes(pool), clientes(pool, credenciais)]);
  const { custos, planos } = painel;
  const calc = calcularMes(u, planos, custos);
  const pagantes = painel.clientes.filter((c) => !c.principal && c.ativa && c.plano);
  const fixos = fixosDoMes(planos, custos.dolar);
  const fixoTotal = r2(fixos.reduce((t, f) => t + f.valor, 0));
  const variavelAte = r2(calc.variaveis.reduce((t, v) => t + v.ate, 0));
  const variavelPrevisao = r2(calc.variaveis.reduce((t, v) => t + v.previsao, 0));
  return {
    periodo: calc.periodo,
    alertas: calc.alertas,
    cotas: calc.cotas,
    custos: {
      receita: r2(pagantes.reduce((s, c) => s + (c.mensalidade ?? 0), 0)),
      pagantes: pagantes.length,
      fixos,
      fixoTotal,
      variaveis: calc.variaveis,
      variavelAte,
      variavelPrevisao,
      totalAte: r2(fixoTotal + variavelAte),
      totalPrevisao: r2(fixoTotal + variavelPrevisao),
    },
    planos,
    dolar: custos.dolar,
  };
}

/** Para a rotina de alertas: só o que precisa avisar (sem a lista de clientes). */
export async function alertasDoMes(db: Executor) {
  const [u, custos, planos] = await Promise.all([usoDoMes(db), lerCustos(db), lerPlanos(db)]);
  return calcularMes(u, planos, custos).alertas;
}
