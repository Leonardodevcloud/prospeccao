import type { Executor } from '@prospeccao/db';
import {
  type EtapaFunil,
  RESULTADOS_COM_CONVERSA,
  type ResultadoVisita,
  type SituacaoRua,
} from '@prospeccao/shared';
import { contaSql, empresaVisivel } from '../../contexto.js';
import { daConta, juncoesEnriq } from '../empresas/repositorio.js';

/**
 * Vendas na rua (schema comercial, escrito só pela api): os leads com localização para o mapa, os
 * roteiros salvos com as paradas e o acompanhamento do gestor.
 */

export interface LeadRua {
  empresaId: number;
  nome: string;
  lat: number;
  lng: number;
  endereco: string | null;
  bairro: string | null;
  cidade: string;
  faixa: 'A' | 'B' | 'C' | null;
  score: number | null;
  etapa: EtapaFunil | null;
  /** nunca: ainda não visitado nem em conversa; fora: perdido ou descartado. */
  situacao: SituacaoRua | 'fora';
  ultimaVisita: string | null;
  /** Próximo passo vencido ou para hoje. */
  passoVencido: boolean;
  /** Já está no roteiro de outra pessoa neste dia. */
  emOutroRoteiro: string | null;
}

/** Endereço de rua, sem a cidade (o nome da cidade já aparece junto). */
const ENDERECO = `nullif(concat_ws(', ', nullif(trim(concat_ws(' ', e.logradouro, nullif(e.numero, ''))), ''), e.bairro), '')`;

const VISITOU = (alias: string) => `EXISTS (
  SELECT 1 FROM comercial.atividades va
   WHERE va.conta_id = ${contaSql()} AND va.empresa_id = ${alias} AND va.tipo = 'visita')`;

const SITUACAO = () => `CASE
    WHEN op.etapa = 'ganho' THEN 'clientes'
    WHEN op.etapa IN ('perdido', 'descartado') THEN 'fora'
    WHEN op.etapa IN ('respondeu', 'reuniao', 'proposta') THEN 'negociacao'
    WHEN ${VISITOU('e.id')} THEN 'negociacao'
    ELSE 'nunca' END`;

/**
 * Leads da conta com localização (de uma campanha ou de todas), para o mapa e para montar o dia.
 * Quem vê só a própria base não vê os leads de colegas.
 */
export async function leadsComLocal(
  db: Executor,
  f: { campanhaId: number | null; dia: string | null; vendedorId: number | null; limite?: number },
): Promise<{ leads: LeadRua[]; semLocalizacao: number }> {
  const C = contaSql();
  const daCampanha = `EXISTS (SELECT 1 FROM descoberta.campanha_empresas cc
     WHERE cc.empresa_id = e.id AND cc.conta_id = ${C} AND cc.liberado_em IS NOT NULL
       AND ($1::bigint IS NULL OR cc.campanha_id = $1))`;
  const { rows } = await db.query<LeadRua>(
    `SELECT e.id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS nome, e.lat, e.lng,
            ${ENDERECO} AS endereco, e.bairro, e.cidade, l.faixa, l.score, op.etapa,
            ${SITUACAO()} AS situacao,
            (SELECT max(va.criado_em) FROM comercial.atividades va
              WHERE va.conta_id = ${C} AND va.empresa_id = e.id AND va.tipo = 'visita') AS "ultimaVisita",
            coalesce(op.proxima_acao_em <= now() + interval '12 hours', false) AS "passoVencido",
            (SELECT u.nome FROM comercial.roteiro_paradas rp
               JOIN comercial.roteiros r ON r.id = rp.roteiro_id
               JOIN cadastro.usuarios u ON u.id = r.vendedor_id
              WHERE rp.conta_id = ${C} AND rp.empresa_id = e.id AND r.dia = $2::date
                AND r.vendedor_id IS DISTINCT FROM $3::int LIMIT 1) AS "emOutroRoteiro"
       FROM descoberta.empresas e
       ${juncoesEnriq()}
      WHERE ${daCampanha} AND ${empresaVisivel('e.id')} AND e.lat IS NOT NULL AND e.lng IS NOT NULL
        AND coalesce(e.maps_fechada, false) = false
      ORDER BY l.score DESC NULLS LAST, e.id
      LIMIT $4`,
    [f.campanhaId, f.dia, f.vendedorId, f.limite ?? 3000],
  );
  const { rows: sem } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM descoberta.empresas e
      WHERE ${daCampanha} AND ${empresaVisivel('e.id')} AND (e.lat IS NULL OR e.lng IS NULL)`,
    [f.campanhaId],
  );
  return { leads: rows, semLocalizacao: sem[0]?.n ?? 0 };
}

/** Os mesmos dados de leads escolhidos (na ordem pedida), para recalcular um roteiro montado à mão. */
export async function leadsPorId(db: Executor, empresaIds: number[]): Promise<LeadRua[]> {
  if (!empresaIds.length) return [];
  const { rows } = await db.query<LeadRua>(
    `SELECT e.id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS nome, e.lat, e.lng,
            ${ENDERECO} AS endereco, e.bairro, e.cidade, l.faixa, l.score, op.etapa,
            ${SITUACAO()} AS situacao, NULL::timestamptz AS "ultimaVisita", false AS "passoVencido",
            NULL::text AS "emOutroRoteiro"
       FROM descoberta.empresas e
       ${juncoesEnriq()}
      WHERE e.id = ANY($1::bigint[]) AND ${daConta('e.id')} AND ${empresaVisivel('e.id')}
        AND e.lat IS NOT NULL AND e.lng IS NOT NULL`,
    [empresaIds],
  );
  const porId = new Map(rows.map((r) => [r.empresaId, r]));
  return empresaIds.map((id) => porId.get(id)).filter((r): r is LeadRua => !!r);
}

/** Bases de operação da conta: pontos de partida prontos. */
export async function partidas(db: Executor) {
  const { rows } = await db.query<{ rotulo: string; endereco: string | null; lat: number; lng: number }>(
    `SELECT nome AS rotulo, endereco, lat, lng FROM cadastro.bases
      WHERE conta_id = ${contaSql()} AND ativa ORDER BY nome`,
  );
  return rows;
}

/** Pessoa ativa da conta (o vendedor do roteiro). */
export async function vendedor(db: Executor, id: number): Promise<{ id: number; nome: string } | null> {
  const { rows } = await db.query<{ id: number; nome: string }>(
    `SELECT id, nome FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${contaSql()} AND ativo`,
    [id],
  );
  return rows[0] ?? null;
}

/* ───────────────────────────── Roteiro salvo ───────────────────────────── */

export interface ParadaRua {
  id: number;
  empresaId: number;
  nome: string;
  lat: number;
  lng: number;
  endereco: string | null;
  bairro: string | null;
  cidade: string;
  faixa: 'A' | 'B' | 'C' | null;
  score: number | null;
  etapa: EtapaFunil | null;
  ordem: number;
  chegada: string | null;
  kmTrecho: number | null;
  minutosTrecho: number | null;
  almocoAntes: boolean;
  situacao: 'pendente' | 'em_visita' | 'feita' | 'pulada';
  chegouEm: string | null;
  chegouDistanciaM: number | null;
  concluidaEm: string | null;
  resultado: ResultadoVisita | null;
  anotacao: string | null;
  temFoto: boolean;
  proximoPasso: string | null;
  proximoPassoEm: string | null;
  /** Para a visita: com quem falar, telefone e o que já aconteceu. */
  decisor: { nome: string; cargo: string | null } | null;
  telefone: string | null;
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  etapaDesde: string | null;
  historico: { tipo: string; texto: string; quando: string }[];
}

export interface RoteiroRua {
  id: number;
  vendedorId: number;
  vendedorNome: string;
  dia: string;
  campanhaId: number | null;
  campanhaNome: string | null;
  partida: { rotulo: string; lat: number; lng: number };
  inicio: string;
  fim: string;
  minutosVisita: number;
  almoco: { inicio: string; minutos: number } | null;
  km: number | null;
  minutosRota: number | null;
  calculo: 'ruas' | 'estimado';
  tracado: [number, number][] | null;
  filtros: Record<string, unknown>;
  enviadoEm: string | null;
  paradas: ParadaRua[];
}

export async function roteiro(db: Executor, filtro: { id: number } | { vendedorId: number; dia: string }) {
  const C = contaSql();
  const porId = 'id' in filtro;
  const { rows } = await db.query<
    Omit<RoteiroRua, 'paradas' | 'almoco'> & { almocoInicio: string | null; almocoMinutos: number | null }
  >(
    `SELECT r.id::int, r.vendedor_id AS "vendedorId", u.nome AS "vendedorNome", to_char(r.dia, 'YYYY-MM-DD') AS dia,
            r.campanha_id::int AS "campanhaId", c.nome AS "campanhaNome",
            json_build_object('rotulo', r.partida_rotulo, 'lat', r.partida_lat, 'lng', r.partida_lng) AS partida,
            to_char(r.inicio, 'HH24:MI') AS inicio, to_char(r.fim, 'HH24:MI') AS fim, r.minutos_visita AS "minutosVisita",
            to_char(r.almoco_inicio, 'HH24:MI') AS "almocoInicio", r.almoco_minutos AS "almocoMinutos",
            r.km::float AS km, r.minutos_rota AS "minutosRota", r.calculo, r.tracado, r.filtros,
            r.enviado_em AS "enviadoEm"
       FROM comercial.roteiros r
       JOIN cadastro.usuarios u ON u.id = r.vendedor_id
       LEFT JOIN cadastro.campanhas c ON c.id = r.campanha_id AND c.conta_id = r.conta_id
      WHERE r.conta_id = ${C} AND ${porId ? 'r.id = $1' : 'r.vendedor_id = $1 AND r.dia = $2::date'}`,
    porId ? [filtro.id] : [filtro.vendedorId, filtro.dia],
  );
  const r = rows[0];
  if (!r) return null;
  const { almocoInicio, almocoMinutos, ...resto } = r;
  return {
    ...resto,
    almoco: almocoInicio && almocoMinutos ? { inicio: almocoInicio, minutos: almocoMinutos } : null,
    paradas: await paradas(db, r.id),
  } satisfies RoteiroRua;
}

async function paradas(db: Executor, roteiroId: number): Promise<ParadaRua[]> {
  const C = contaSql();
  const { rows } = await db.query<ParadaRua>(
    `SELECT p.id::int, p.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS nome, e.lat, e.lng,
            ${ENDERECO} AS endereco, e.bairro, e.cidade, l.faixa, l.score, op.etapa,
            p.ordem, to_char(p.chegada_prevista, 'HH24:MI') AS chegada, p.km_trecho::float AS "kmTrecho",
            p.minutos_trecho AS "minutosTrecho", p.almoco_antes AS "almocoAntes", p.situacao,
            p.chegou_em AS "chegouEm", p.chegou_distancia_m AS "chegouDistanciaM", p.concluida_em AS "concluidaEm",
            p.resultado, p.anotacao, (p.foto_chave IS NOT NULL) AS "temFoto", p.proximo_passo AS "proximoPasso",
            to_char(p.proximo_passo_em, 'YYYY-MM-DD') AS "proximoPassoEm",
            CASE WHEN dec.nome IS NOT NULL THEN json_build_object('nome', dec.nome, 'cargo', dec.cargo) END AS decisor,
            coalesce(CASE WHEN pc.canal <> 'email' THEN pc.valor END, e.maps_telefone) AS telefone,
            op.proxima_acao AS "proximaAcao", op.proxima_acao_em AS "proximaAcaoEm", op.etapa_desde AS "etapaDesde",
            coalesce((
              SELECT json_agg(h ORDER BY h.quando DESC) FROM (
                SELECT a.tipo, coalesce(a.texto, 'Foi para ' || coalesce(a.para_nome, a.para_etapa)) AS texto,
                       a.criado_em AS quando
                  FROM comercial.atividades a
                 WHERE a.conta_id = ${C} AND a.empresa_id = p.empresa_id
                   AND (a.texto IS NOT NULL OR a.tipo = 'etapa')
                 ORDER BY a.criado_em DESC LIMIT 3) h), '[]') AS historico
       FROM comercial.roteiro_paradas p
       JOIN descoberta.empresas e ON e.id = p.empresa_id
       ${juncoesEnriq()}
      WHERE p.roteiro_id = $1 AND p.conta_id = ${C}
      ORDER BY p.ordem`,
    [roteiroId],
  );
  return rows;
}

export interface ParadaGravar {
  empresaId: number;
  ordem: number;
  chegada: string;
  kmTrecho: number;
  minutosTrecho: number;
  almocoAntes: boolean;
}

export interface RoteiroGravar {
  vendedorId: number;
  dia: string;
  campanhaId: number | null;
  partida: { rotulo: string; lat: number; lng: number };
  inicio: string;
  fim: string;
  minutosVisita: number;
  almoco: { inicio: string; minutos: number } | null;
  km: number;
  minutosRota: number;
  calculo: 'ruas' | 'estimado';
  tracado: [number, number][] | null;
  filtros: Record<string, unknown>;
  enviar: boolean;
  criadoPor: number | null;
}

/**
 * Salva o roteiro do vendedor no dia (um por dia). Visitas já começadas, feitas ou puladas ficam
 * como estão (só a ordem e a hora prevista mudam); as pendentes que saíram da lista são tiradas.
 */
export async function gravar(db: Executor, r: RoteiroGravar, lista: ParadaGravar[]): Promise<number> {
  const C = contaSql();
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.roteiros
       (conta_id, vendedor_id, dia, campanha_id, partida_rotulo, partida_lat, partida_lng, inicio, fim,
        minutos_visita, almoco_inicio, almoco_minutos, km, minutos_rota, calculo, tracado, filtros,
        enviado_em, criado_por)
     VALUES (${C}, $1, $2::date, $3, $4, $5, $6, $7::time, $8::time, $9, $10::time, $11, $12, $13, $14, $15, $16,
             CASE WHEN $17 THEN now() END, $18)
     ON CONFLICT (conta_id, vendedor_id, dia) DO UPDATE SET
       campanha_id = EXCLUDED.campanha_id, partida_rotulo = EXCLUDED.partida_rotulo,
       partida_lat = EXCLUDED.partida_lat, partida_lng = EXCLUDED.partida_lng, inicio = EXCLUDED.inicio,
       fim = EXCLUDED.fim, minutos_visita = EXCLUDED.minutos_visita, almoco_inicio = EXCLUDED.almoco_inicio,
       almoco_minutos = EXCLUDED.almoco_minutos, km = EXCLUDED.km, minutos_rota = EXCLUDED.minutos_rota,
       calculo = EXCLUDED.calculo, tracado = EXCLUDED.tracado, filtros = EXCLUDED.filtros,
       enviado_em = CASE WHEN $17 THEN now() ELSE comercial.roteiros.enviado_em END
     RETURNING id::int`,
    [
      r.vendedorId,
      r.dia,
      r.campanhaId,
      r.partida.rotulo,
      r.partida.lat,
      r.partida.lng,
      r.inicio,
      r.fim,
      r.minutosVisita,
      r.almoco?.inicio ?? null,
      r.almoco?.minutos ?? null,
      Math.round(r.km * 10) / 10,
      Math.round(r.minutosRota),
      r.calculo,
      r.tracado ? JSON.stringify(r.tracado) : null,
      JSON.stringify(r.filtros),
      r.enviar,
      r.criadoPor,
    ],
  );
  const id = rows[0]!.id;
  const ids = lista.map((p) => p.empresaId);
  await db.query(
    `DELETE FROM comercial.roteiro_paradas
      WHERE roteiro_id = $1 AND conta_id = ${C} AND situacao = 'pendente' AND NOT (empresa_id = ANY($2::bigint[]))`,
    [id, ids],
  );
  // A ordem é única só na tela; aqui, as que ficaram de fora da lista (já feitas) vão para o fim.
  const { rows: maior } = await db.query<{ n: number }>(
    `SELECT coalesce(max(ordem), 0)::int AS n FROM comercial.roteiro_paradas WHERE roteiro_id = $1`,
    [id],
  );
  const fora = maior[0]?.n ?? 0;
  await db.query(
    `UPDATE comercial.roteiro_paradas SET ordem = ordem + $3
      WHERE roteiro_id = $1 AND conta_id = ${C} AND NOT (empresa_id = ANY($2::bigint[]))`,
    [id, ids, fora + lista.length],
  );
  for (const p of lista)
    await db.query(
      `INSERT INTO comercial.roteiro_paradas
         (roteiro_id, conta_id, empresa_id, ordem, chegada_prevista, km_trecho, minutos_trecho, almoco_antes)
       VALUES ($1, ${C}, $2, $3, $4::time, $5, $6, $7)
       ON CONFLICT (roteiro_id, empresa_id) DO UPDATE SET
         ordem = EXCLUDED.ordem, chegada_prevista = EXCLUDED.chegada_prevista, km_trecho = EXCLUDED.km_trecho,
         minutos_trecho = EXCLUDED.minutos_trecho, almoco_antes = EXCLUDED.almoco_antes`,
      [
        id,
        p.empresaId,
        p.ordem,
        p.chegada,
        Math.round(p.kmTrecho * 10) / 10,
        Math.round(p.minutosTrecho),
        p.almocoAntes,
      ],
    );
  // Fecha os buracos da ordem (1, 2, 3…), com as que ficaram de fora por último.
  await db.query(
    `UPDATE comercial.roteiro_paradas p SET ordem = x.n
       FROM (SELECT id, row_number() OVER (ORDER BY ordem) AS n FROM comercial.roteiro_paradas WHERE roteiro_id = $1) x
      WHERE p.id = x.id AND p.ordem <> x.n`,
    [id],
  );
  return id;
}

export async function apagar(db: Executor, id: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.roteiros WHERE id = $1 AND conta_id = ${contaSql()}
        AND NOT EXISTS (SELECT 1 FROM comercial.roteiro_paradas p WHERE p.roteiro_id = $1 AND p.situacao <> 'pendente')`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/* ───────────────────────────── Parada (no celular) ───────────────────────────── */

export interface ParadaDona {
  id: number;
  roteiroId: number;
  vendedorId: number;
  empresaId: number;
  situacao: ParadaRua['situacao'];
  lat: number | null;
  lng: number | null;
  fotoChave: string | null;
  chegouEm: string | null;
}

export async function parada(db: Executor, id: number): Promise<ParadaDona | null> {
  const { rows } = await db.query<ParadaDona>(
    `SELECT p.id::int, p.roteiro_id::int AS "roteiroId", r.vendedor_id AS "vendedorId", p.empresa_id::int AS "empresaId",
            p.situacao, e.lat, e.lng, p.foto_chave AS "fotoChave", p.chegou_em AS "chegouEm"
       FROM comercial.roteiro_paradas p
       JOIN comercial.roteiros r ON r.id = p.roteiro_id
       JOIN descoberta.empresas e ON e.id = p.empresa_id
      WHERE p.id = $1 AND p.conta_id = ${contaSql()}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function registrarChegada(
  db: Executor,
  id: number,
  c: { lat: number | null; lng: number | null; distanciaM: number | null },
): Promise<void> {
  const C = contaSql();
  // Só uma visita "em andamento" por roteiro: a que estava aberta (sem concluir) volta para pendente.
  await db.query(
    `UPDATE comercial.roteiro_paradas SET situacao = 'pendente'
      WHERE conta_id = ${C} AND situacao = 'em_visita' AND id <> $1
        AND roteiro_id = (SELECT roteiro_id FROM comercial.roteiro_paradas WHERE id = $1)`,
    [id],
  );
  await db.query(
    `UPDATE comercial.roteiro_paradas
        SET situacao = 'em_visita', chegou_em = coalesce(chegou_em, now()),
            chegou_lat = coalesce($2, chegou_lat), chegou_lng = coalesce($3, chegou_lng),
            chegou_distancia_m = coalesce($4, chegou_distancia_m)
      WHERE id = $1 AND conta_id = ${C}`,
    [id, c.lat, c.lng, c.distanciaM],
  );
}

export async function concluir(
  db: Executor,
  id: number,
  c: {
    resultado: ResultadoVisita;
    anotacao: string | null;
    proximoPasso: string | null;
    proximoPassoEm: string | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE comercial.roteiro_paradas
        SET situacao = 'feita', resultado = $2, anotacao = $3, proximo_passo = $4, proximo_passo_em = $5::date,
            chegou_em = coalesce(chegou_em, now()), concluida_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, c.resultado, c.anotacao, c.proximoPasso, c.proximoPassoEm],
  );
}

export async function mudarSituacao(
  db: Executor,
  id: number,
  situacao: 'pulada' | 'pendente',
): Promise<void> {
  await db.query(
    `UPDATE comercial.roteiro_paradas
        SET situacao = $2,
            resultado = CASE WHEN $2 = 'pendente' THEN NULL ELSE resultado END,
            concluida_em = CASE WHEN $2 = 'pendente' THEN NULL ELSE concluida_em END
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, situacao],
  );
}

export async function definirFoto(db: Executor, id: number, chave: string | null): Promise<void> {
  await db.query(
    `UPDATE comercial.roteiro_paradas SET foto_chave = $2 WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, chave],
  );
}

/* ───────────────────────────── Acompanhamento do gestor ───────────────────────────── */

export type PeriodoRua = 'hoje' | 'semana' | 'mes';

const DESDE: Record<PeriodoRua, string> = {
  hoje: `(now() AT TIME ZONE 'America/Sao_Paulo')::date`,
  semana: `date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')::date`,
  mes: `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date`,
};

export interface AgoraVendedor {
  tipo: 'em_visita' | 'a_caminho' | 'terminou' | 'nao_comecou';
  ordem: number | null;
  empresa: string | null;
  desde: string | null;
}

export interface VendedorRua {
  id: number;
  nome: string;
  campanhas: string[];
  feitas: number;
  total: number;
  km: number;
  resultados: Partial<Record<ResultadoVisita, number>>;
  agora: AgoraVendedor | null;
}

export async function equipe(db: Executor, periodo: PeriodoRua, soDe: number | null) {
  const C = contaSql();
  const desde = DESDE[periodo];
  const filtroVendedor = soDe ? `AND r.vendedor_id = ${Number(soDe)}` : '';
  const { rows: vendedores } = await db.query<VendedorRua & { agoraHoje: AgoraVendedor | null }>(
    `SELECT u.id, u.nome,
            coalesce(array_agg(DISTINCT c.nome) FILTER (WHERE c.nome IS NOT NULL), '{}') AS campanhas,
            (SELECT count(*)::int FROM comercial.roteiro_paradas p JOIN comercial.roteiros r2 ON r2.id = p.roteiro_id
              WHERE r2.conta_id = ${C} AND r2.vendedor_id = u.id AND r2.dia >= ${desde} AND p.situacao = 'feita') AS feitas,
            (SELECT count(*)::int FROM comercial.roteiro_paradas p JOIN comercial.roteiros r2 ON r2.id = p.roteiro_id
              WHERE r2.conta_id = ${C} AND r2.vendedor_id = u.id AND r2.dia >= ${desde}) AS total,
            coalesce(sum(r.km), 0)::float AS km,
            coalesce((SELECT json_object_agg(x.resultado, x.n) FROM (
              SELECT p.resultado, count(*)::int AS n FROM comercial.roteiro_paradas p
                JOIN comercial.roteiros r2 ON r2.id = p.roteiro_id
               WHERE r2.conta_id = ${C} AND r2.vendedor_id = u.id AND r2.dia >= ${desde} AND p.resultado IS NOT NULL
               GROUP BY p.resultado) x), '{}') AS resultados,
            (SELECT CASE
                WHEN v.id IS NOT NULL THEN json_build_object('tipo', 'em_visita', 'ordem', v.ordem, 'empresa', v.nome, 'desde', v.chegou_em)
                WHEN pend.ordem IS NOT NULL AND feitas_hoje.n > 0 THEN json_build_object('tipo', 'a_caminho', 'ordem', pend.ordem, 'empresa', pend.nome, 'desde', NULL)
                WHEN pend.ordem IS NOT NULL THEN json_build_object('tipo', 'nao_comecou', 'ordem', pend.ordem, 'empresa', pend.nome, 'desde', NULL)
                ELSE json_build_object('tipo', 'terminou', 'ordem', NULL, 'empresa', NULL, 'desde', ultima.em) END
               FROM comercial.roteiros rh
               LEFT JOIN LATERAL (SELECT p.id, p.ordem, p.chegou_em, coalesce(e.maps_nome, e.nome) AS nome
                                    FROM comercial.roteiro_paradas p JOIN descoberta.empresas e ON e.id = p.empresa_id
                                   WHERE p.roteiro_id = rh.id AND p.situacao = 'em_visita' LIMIT 1) v ON true
               LEFT JOIN LATERAL (SELECT p.ordem, coalesce(e.maps_nome, e.nome) AS nome
                                    FROM comercial.roteiro_paradas p JOIN descoberta.empresas e ON e.id = p.empresa_id
                                   WHERE p.roteiro_id = rh.id AND p.situacao = 'pendente' ORDER BY p.ordem LIMIT 1) pend ON true
               LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM comercial.roteiro_paradas p
                                   WHERE p.roteiro_id = rh.id AND p.situacao IN ('feita', 'pulada')) feitas_hoje ON true
               LEFT JOIN LATERAL (SELECT max(p.concluida_em) AS em FROM comercial.roteiro_paradas p
                                   WHERE p.roteiro_id = rh.id) ultima ON true
              WHERE rh.conta_id = ${C} AND rh.vendedor_id = u.id
                AND rh.dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS "agoraHoje"
       FROM comercial.roteiros r
       JOIN cadastro.usuarios u ON u.id = r.vendedor_id
       LEFT JOIN cadastro.campanhas c ON c.id = r.campanha_id AND c.conta_id = r.conta_id
      WHERE r.conta_id = ${C} AND r.dia >= ${desde} AND r.dia <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
            ${filtroVendedor}
      GROUP BY u.id, u.nome
      ORDER BY u.nome`,
  );
  const { rows: ultimas } = await db.query<{
    paradaId: number;
    empresaId: number;
    empresa: string;
    vendedor: string;
    quando: string;
    resultado: ResultadoVisita;
    anotacao: string | null;
    temFoto: boolean;
  }>(
    `SELECT p.id::int AS "paradaId", p.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS empresa,
            u.nome AS vendedor, p.concluida_em AS quando, p.resultado, p.anotacao, (p.foto_chave IS NOT NULL) AS "temFoto"
       FROM comercial.roteiro_paradas p
       JOIN comercial.roteiros r ON r.id = p.roteiro_id
       JOIN cadastro.usuarios u ON u.id = r.vendedor_id
       JOIN descoberta.empresas e ON e.id = p.empresa_id
      WHERE p.conta_id = ${C} AND p.situacao = 'feita' AND r.dia >= ${desde} ${filtroVendedor}
      ORDER BY p.concluida_em DESC
      LIMIT 20`,
  );
  const lista: VendedorRua[] = vendedores.map(({ agoraHoje, ...v }) => ({ ...v, agora: agoraHoje }));
  const soma = (f: (v: VendedorRua) => number) => lista.reduce((t, v) => t + f(v), 0);
  const deResultado = (rs: readonly ResultadoVisita[]) =>
    soma((v) => rs.reduce((t, r) => t + (v.resultados[r] ?? 0), 0));
  return {
    numeros: {
      planejadas: soma((v) => v.total),
      feitas: soma((v) => v.feitas),
      comConversa: deResultado(RESULTADOS_COM_CONVERSA),
      propostasReunioes: deResultado(['proposta', 'reuniao']),
      fechados: deResultado(['fechou']),
      km: Math.round(soma((v) => v.km)),
    },
    vendedores: lista,
    ultimas,
  };
}
