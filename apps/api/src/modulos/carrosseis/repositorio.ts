import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import {
  type Carrossel,
  type CarrosselEntrada,
  type EstiloCarrossel,
  type FormatoPeca,
  type FotoCarrossel,
  type IdentidadeCarrossel,
  identidadeCompleta,
  MAX_CARROSSEIS_CONTA,
  type ResumoCarrossel,
  type SlideCarrossel,
  slideEntrada,
} from '@prospeccao/shared/carrosseis';
import type { RelatorioTime } from '@prospeccao/shared/carrosseis-time';
import { z } from 'zod';
import { contaSql, usuarioAtual } from '../../contexto.js';

/**
 * Carrosséis da conta: a identidade visual (uma por conta), as fotos da empresa e os carrosséis.
 * Tudo filtrado pela conta da sessão; os arquivos ficam no armazenamento (só o caminho aqui).
 */

/* ───────────────────────────── Identidade ───────────────────────────── */

export type TipoLogo = 'claro' | 'escuro';

export interface LogoGuardada {
  chave: string;
  largura: number;
  altura: number;
}

export interface IdentidadeGuardada {
  identidade: IdentidadeCarrossel;
  salva: boolean;
  logos: Record<TipoLogo, LogoGuardada | null>;
  atualizadaEm: string | null;
}

export async function identidade(db: Executor): Promise<IdentidadeGuardada> {
  const { rows } = await db.query<{
    dados: unknown;
    logo_claro: string | null;
    logo_claro_largura: number | null;
    logo_claro_altura: number | null;
    logo_escuro: string | null;
    logo_escuro_largura: number | null;
    logo_escuro_altura: number | null;
    atualizado_em: string;
  }>(
    `SELECT dados, logo_claro, logo_claro_largura, logo_claro_altura, logo_escuro, logo_escuro_largura,
            logo_escuro_altura, atualizado_em
       FROM comercial.carrossel_identidade WHERE conta_id = ${contaSql()}`,
  );
  const r = rows[0];
  const logo = (
    chave: string | null | undefined,
    largura: number | null | undefined,
    altura: number | null | undefined,
  ) => (chave && largura && altura ? { chave, largura, altura } : null);
  return {
    identidade: identidadeCompleta(r?.dados),
    salva: !!r,
    logos: {
      claro: logo(r?.logo_claro, r?.logo_claro_largura, r?.logo_claro_altura),
      escuro: logo(r?.logo_escuro, r?.logo_escuro_largura, r?.logo_escuro_altura),
    },
    atualizadaEm: r?.atualizado_em ?? null,
  };
}

export async function salvarIdentidade(db: Executor, d: IdentidadeCarrossel): Promise<void> {
  await db.query(
    `INSERT INTO comercial.carrossel_identidade (conta_id, dados, atualizado_em)
     VALUES (${contaSql()}, $1, now())
     ON CONFLICT (conta_id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()`,
    [JSON.stringify(d)],
  );
}

/** Troca a logo (devolve a chave antiga, para apagar do armazenamento). */
export async function definirLogo(
  db: Executor,
  tipo: TipoLogo,
  logo: LogoGuardada | null,
): Promise<string | null> {
  const col = tipo === 'claro' ? 'logo_claro' : 'logo_escuro';
  const { rows } = await db.query<{ antiga: string | null }>(
    `SELECT ${col} AS antiga FROM comercial.carrossel_identidade WHERE conta_id = ${contaSql()}`,
  );
  await db.query(
    `INSERT INTO comercial.carrossel_identidade (conta_id, ${col}, ${col}_largura, ${col}_altura, atualizado_em)
     VALUES (${contaSql()}, $1, $2, $3, now())
     ON CONFLICT (conta_id) DO UPDATE
        SET ${col} = EXCLUDED.${col}, ${col}_largura = EXCLUDED.${col}_largura,
            ${col}_altura = EXCLUDED.${col}_altura, atualizado_em = now()`,
    [logo?.chave ?? null, logo?.largura ?? null, logo?.altura ?? null],
  );
  return rows[0]?.antiga ?? null;
}

/* ───────────────────────────── Fotos da empresa ───────────────────────────── */

const COLUNAS_FOTO = `id, nome, largura, altura, criado_em AS "criadoEm", origem, base_foto_id AS "baseFotoId"`;

export async function fotos(db: Executor): Promise<FotoCarrossel[]> {
  const { rows } = await db.query<FotoCarrossel>(
    // A referência de estilo não é foto para usar, e a arte da IA (v150) é a peça pronta: ficam fora.
    `SELECT ${COLUNAS_FOTO} FROM comercial.carrossel_fotos
      WHERE conta_id = ${contaSql()} AND origem NOT IN ('referencia', 'arte') ORDER BY id DESC`,
  );
  return rows;
}

export async function contarFotos(db: Executor): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    // O limite é das fotos enviadas: as que a IA faz não tiram vaga.
    `SELECT count(*)::int AS n FROM comercial.carrossel_fotos WHERE conta_id = ${contaSql()} AND origem = 'enviada'`,
  );
  return rows[0]!.n;
}

export async function foto(db: Executor, id: number): Promise<(FotoCarrossel & { chave: string }) | null> {
  const { rows } = await db.query<FotoCarrossel & { chave: string }>(
    `SELECT ${COLUNAS_FOTO}, chave FROM comercial.carrossel_fotos WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function adicionarFoto(
  db: Executor,
  d: { nome: string; chave: string; largura: number; altura: number; bytes: number },
): Promise<FotoCarrossel> {
  const { rows } = await db.query<FotoCarrossel>(
    `INSERT INTO comercial.carrossel_fotos (conta_id, nome, chave, largura, altura, bytes, criado_por)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6) RETURNING ${COLUNAS_FOTO}`,
    [d.nome, d.chave, d.largura, d.altura, d.bytes, usuarioAtual()?.id ?? null],
  );
  return rows[0]!;
}

/** Uma imagem feita pela IA (v132) ou a referência de estilo, guardada como foto da empresa. */
export async function adicionarFotoDaIa(
  db: Executor,
  d: {
    nome: string;
    chave: string;
    largura: number;
    altura: number;
    bytes: number;
    origem: 'gerada' | 'cenario' | 'referencia' | 'melhorada' | 'arte';
    baseFotoId?: number | null;
    pedido?: string | null;
    carrosselId?: number | null;
    estilo?: string | null;
    criadoPor?: number | null;
  },
): Promise<FotoCarrossel> {
  const { rows } = await db.query<FotoCarrossel>(
    `INSERT INTO comercial.carrossel_fotos
       (conta_id, nome, chave, largura, altura, bytes, criado_por, origem, base_foto_id, pedido, carrossel_id, estilo)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUNAS_FOTO}`,
    [
      d.nome,
      d.chave,
      d.largura,
      d.altura,
      d.bytes,
      d.criadoPor !== undefined ? d.criadoPor : (usuarioAtual()?.id ?? null),
      d.origem,
      d.baseFotoId ?? null,
      d.pedido ?? null,
      d.carrosselId ?? null,
      d.estilo ?? null,
    ],
  );
  return rows[0]!;
}

/** O estilo lido da referência (null: ainda não lido ou não é uma referência). */
export async function referencia(
  db: Executor,
  id: number,
): Promise<{ id: number; chave: string; estilo: string | null } | null> {
  const { rows } = await db.query<{ id: number; chave: string; estilo: string | null }>(
    `SELECT id, chave, estilo FROM comercial.carrossel_fotos
      WHERE id = $1 AND conta_id = ${contaSql()} AND origem = 'referencia'`,
    [id],
  );
  return rows[0] ?? null;
}

/** Os cenários já feitos a partir de uma foto do produto. */
export async function cenariosDaFoto(db: Executor, fotoId: number): Promise<FotoCarrossel[]> {
  const { rows } = await db.query<FotoCarrossel>(
    `SELECT ${COLUNAS_FOTO} FROM comercial.carrossel_fotos
      WHERE conta_id = ${contaSql()} AND base_foto_id = $1 AND origem = 'cenario' ORDER BY id DESC LIMIT 12`,
    [fotoId],
  );
  return rows;
}

/** Apaga a foto (e tira dos slides que usavam). Devolve a chave para apagar do armazenamento. */
export async function apagarFoto(db: Executor, id: number): Promise<string> {
  const { rows } = await db.query<{ chave: string }>(
    `DELETE FROM comercial.carrossel_fotos WHERE id = $1 AND conta_id = ${contaSql()} RETURNING chave`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Foto');
  await db.query(
    `UPDATE comercial.carrosseis
        SET slides = (SELECT jsonb_agg(CASE WHEN (s->>'fotoId')::int = $1 THEN s || '{"fotoId": null}' ELSE s END)
                        FROM jsonb_array_elements(slides) s)
      WHERE conta_id = ${contaSql()} AND slides @> $2::jsonb`,
    [id, JSON.stringify([{ fotoId: id }])],
  );
  return rows[0].chave;
}

/* ───────────────────────────── Carrosséis ───────────────────────────── */

const COLUNAS_RESUMO = `c.id, c.titulo, c.estilo, c.situacao, jsonb_array_length(c.slides)::int AS slides, c.versao,
  c.origem, c.tipo, c.formato, c.pedido_id AS "pedidoId", c.card, c.variacao, c.escolhido,
  c.criado_em AS "criadoEm", c.atualizado_em AS "atualizadoEm", u.nome AS "criadoPor",
  coalesce((SELECT count(*) FROM jsonb_array_elements(c.relatorio->'avisos') a WHERE a->>'resolvido' IS NULL), 0)::int AS "avisosAbertos",
  CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
    'palavra', pr.palavras[1], 'esperando', pr.alvo = 'carrossel', 'ligada', pr.ligada,
    'comentaram', pr.comentaram, 'leads', pr.leads, 'publicadoEm', c.publicado_em) END AS publicacao`;

/** A regra do Comente e receba do carrossel, com os números (para o cartão da lista). */
const JUNTA_PUBLICACAO = `LEFT JOIN LATERAL (
    SELECT r.id, r.palavras, r.alvo, r.ligada,
           (SELECT count(*)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id) AS comentaram,
           (SELECT count(DISTINCT i.empresa_id)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id) AS leads
      FROM comercial.instagram_regras r WHERE r.carrossel_id = c.id AND r.conta_id = c.conta_id) pr ON true`;

export async function listar(db: Executor): Promise<ResumoCarrossel[]> {
  const { rows } = await db.query<ResumoCarrossel>(
    `SELECT ${COLUNAS_RESUMO}
       FROM comercial.carrosseis c LEFT JOIN cadastro.usuarios u ON u.id = c.criado_por ${JUNTA_PUBLICACAO}
      WHERE c.conta_id = ${contaSql()} AND c.tipo = 'carrossel'
      ORDER BY c.atualizado_em DESC LIMIT ${MAX_CARROSSEIS_CONTA}`,
  );
  return rows;
}

/** Slides guardados, conferidos (o que não bate com o formato de hoje sai). */
function slidesValidos(x: unknown): SlideCarrossel[] {
  const r = z.array(slideEntrada).safeParse(x);
  if (r.success) return r.data;
  return (Array.isArray(x) ? x : []).flatMap((s) => {
    const um = slideEntrada.safeParse(s);
    return um.success ? [um.data] : [];
  });
}

export async function carrossel(db: Executor, id: number): Promise<Carrossel> {
  const { rows } = await db.query<
    ResumoCarrossel & { conteudo: unknown; legenda: string; relatorio: RelatorioTime | null }
  >(
    `SELECT ${COLUNAS_RESUMO}, c.slides AS conteudo, c.legenda, c.relatorio
       FROM comercial.carrosseis c LEFT JOIN cadastro.usuarios u ON u.id = c.criado_por ${JUNTA_PUBLICACAO}
      WHERE c.id = $1 AND c.conta_id = ${contaSql()}`,
    [id],
  );
  const r = rows[0];
  if (!r) throw AppError.naoEncontrado('Carrossel');
  return { ...r, conteudo: slidesValidos(r.conteudo) };
}

export async function contar(db: Executor): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrosseis WHERE conta_id = ${contaSql()}`,
  );
  return rows[0]!.n;
}

export async function criar(
  db: Executor,
  d: {
    titulo: string;
    estilo: EstiloCarrossel;
    slides: SlideCarrossel[];
    legenda?: string;
    origem?: 'manual' | 'ia';
    relatorio?: RelatorioTime | null;
    divulgarId?: number | null;
    /** Quem pediu (o time trabalha fora da requisição). */
    criadoPor?: number | null;
    /** v144: o card avulso (um slide só) e de que pedido, card e variação ele é. */
    card?: {
      formato: FormatoPeca;
      pedidoId: number;
      card: number;
      variacao: number;
      escolhido: boolean;
    } | null;
  },
): Promise<number> {
  // v134: os slides como o time entregou ficam guardados (o time aprende com o que quem publica muda).
  const k = d.card ?? null;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.carrosseis (conta_id, titulo, estilo, slides, legenda, origem, criado_por, relatorio, divulgar_id, slides_do_time,
                                       tipo, formato, pedido_id, card, variacao, escolhido)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $5 = 'ia' THEN $3::jsonb END,
             $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      d.titulo,
      d.estilo,
      JSON.stringify(d.slides),
      d.legenda ?? '',
      d.origem ?? 'manual',
      d.criadoPor !== undefined ? d.criadoPor : (usuarioAtual()?.id ?? null),
      d.relatorio ? JSON.stringify(d.relatorio) : null,
      d.divulgarId ?? null,
      k ? 'card' : 'carrossel',
      k?.formato ?? 'feed',
      k?.pedidoId ?? null,
      k?.card ?? null,
      k?.variacao ?? null,
      k?.escolhido ?? false,
    ],
  );
  return rows[0]!.id;
}

/** Fotos dos slides que existem nesta conta (foto de outra conta ou apagada sai do slide). */
export async function conferirFotos(db: Executor, slides: SlideCarrossel[]): Promise<SlideCarrossel[]> {
  const ids = [...new Set(slides.flatMap((s) => (s.fotoId ? [s.fotoId] : [])))];
  if (!ids.length) return slides;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM comercial.carrossel_fotos WHERE conta_id = ${contaSql()} AND id = ANY($1::int[])`,
    [ids],
  );
  const existem = new Set(rows.map((r) => r.id));
  return slides.map((s) => (s.fotoId && !existem.has(s.fotoId) ? { ...s, fotoId: null } : s));
}

export async function atualizar(db: Executor, id: number, d: CarrosselEntrada): Promise<Carrossel> {
  const atual = await carrossel(db, id);
  if (atual.situacao === 'publicado' || atual.situacao === 'agendado')
    throw AppError.conflito(
      atual.situacao === 'publicado'
        ? 'Este carrossel já foi publicado: duplique para fazer outro a partir dele.'
        : 'Este carrossel está agendado: tire do agendamento antes de mexer.',
    );
  if (d.versao && d.versao !== atual.versao)
    throw new AppError(
      409,
      'versao',
      'Outra pessoa salvou este carrossel enquanto você editava. Abra de novo para ver.',
    );
  const { rowCount } = await db.query(
    `UPDATE comercial.carrosseis
        SET titulo = $2, estilo = $3, slides = $4, legenda = $5, situacao = $6, versao = versao + 1, atualizado_em = now(),
            pronto_em = CASE WHEN $6 <> 'pronto' THEN NULL WHEN situacao = 'pronto' THEN pronto_em ELSE now() END
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, d.titulo, d.estilo, JSON.stringify(d.slides), d.legenda, d.situacao],
  );
  if (!rowCount) throw AppError.naoEncontrado('Carrossel');
  return carrossel(db, id);
}

/** As imagens foram baixadas (o passo a passo da aba Publicação mostra quando). */
export async function marcarBaixado(db: Executor, id: number): Promise<void> {
  await db.query(
    `UPDATE comercial.carrosseis SET baixado_em = now() WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
}

export async function apagar(db: Executor, id: number): Promise<string[]> {
  // A regra que ainda esperava o post sai junto (a que já está valendo fica, sem o carrossel).
  const { rows: regras } = await db.query<{ arquivo_chave: string | null }>(
    `DELETE FROM comercial.instagram_regras WHERE carrossel_id = $1 AND conta_id = ${contaSql()} AND alvo = 'carrossel'
     RETURNING arquivo_chave`,
    [id],
  );
  const { rowCount } = await db.query(
    `DELETE FROM comercial.carrosseis WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Carrossel');
  return regras.flatMap((r) => (r.arquivo_chave ? [r.arquivo_chave] : []));
}

/**
 * Carrosséis pedidos ao time de IA neste mês (a franquia do módulo conta só esses). Conta o pedido,
 * não o carrossel pronto: o que está na fila já ocupa a vaga; o que falhou ou foi cancelado, não.
 */
export async function feitosPelaIaNoMes(db: Executor): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrossel_pedidos
      WHERE conta_id = ${contaSql()} AND situacao NOT IN ('falhou', 'cancelado')
        -- v144: o pedido de cards conta 1 (a "outra variação" não conta).
        AND (tipo = 'carrossel' OR (tipo = 'cards' AND entrada->'outra' IS NULL))
        AND criado_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
  );
  return rows[0]!.n;
}

/** Grava o relatório do time (a pessoa decidiu um aviso) e, se mudou, os slides e a legenda. */
export async function salvarRelatorio(
  db: Executor,
  id: number,
  d: { relatorio: RelatorioTime; slides?: SlideCarrossel[]; legenda?: string },
): Promise<void> {
  await db.query(
    `UPDATE comercial.carrosseis
        SET relatorio = $2, slides = coalesce($3::jsonb, slides), legenda = coalesce($4, legenda),
            versao = versao + CASE WHEN $3::jsonb IS NULL AND $4::text IS NULL THEN 0 ELSE 1 END, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, JSON.stringify(d.relatorio), d.slides ? JSON.stringify(d.slides) : null, d.legenda ?? null],
  );
}

/** Títulos dos últimos carrosséis (o time não repete o ângulo). */
export async function titulosRecentes(db: Executor, n = 15): Promise<string[]> {
  const { rows } = await db.query<{ titulo: string }>(
    `SELECT titulo FROM comercial.carrosseis WHERE conta_id = ${contaSql()} ORDER BY criado_em DESC LIMIT $1`,
    [n],
  );
  return rows.map((r) => r.titulo);
}
