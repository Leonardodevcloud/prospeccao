import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import {
  type Carrossel,
  type CarrosselEntrada,
  type EstiloCarrossel,
  type FotoCarrossel,
  type IdentidadeCarrossel,
  identidadeCompleta,
  MAX_CARROSSEIS_CONTA,
  type ResumoCarrossel,
  type SlideCarrossel,
  slideEntrada,
} from '@prospeccao/shared/carrosseis';
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

const COLUNAS_FOTO = `id, nome, largura, altura, criado_em AS "criadoEm"`;

export async function fotos(db: Executor): Promise<FotoCarrossel[]> {
  const { rows } = await db.query<FotoCarrossel>(
    `SELECT ${COLUNAS_FOTO} FROM comercial.carrossel_fotos WHERE conta_id = ${contaSql()} ORDER BY id DESC`,
  );
  return rows;
}

export async function contarFotos(db: Executor): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrossel_fotos WHERE conta_id = ${contaSql()}`,
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
  c.criado_em AS "criadoEm", c.atualizado_em AS "atualizadoEm", u.nome AS "criadoPor"`;

export async function listar(db: Executor): Promise<ResumoCarrossel[]> {
  const { rows } = await db.query<ResumoCarrossel>(
    `SELECT ${COLUNAS_RESUMO}
       FROM comercial.carrosseis c LEFT JOIN cadastro.usuarios u ON u.id = c.criado_por
      WHERE c.conta_id = ${contaSql()}
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
  const { rows } = await db.query<ResumoCarrossel & { conteudo: unknown; legenda: string }>(
    `SELECT ${COLUNAS_RESUMO}, c.slides AS conteudo, c.legenda
       FROM comercial.carrosseis c LEFT JOIN cadastro.usuarios u ON u.id = c.criado_por
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
  },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.carrosseis (conta_id, titulo, estilo, slides, legenda, origem, criado_por)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      d.titulo,
      d.estilo,
      JSON.stringify(d.slides),
      d.legenda ?? '',
      d.origem ?? 'manual',
      usuarioAtual()?.id ?? null,
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
        SET titulo = $2, estilo = $3, slides = $4, legenda = $5, situacao = $6, versao = versao + 1, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, d.titulo, d.estilo, JSON.stringify(d.slides), d.legenda, d.situacao],
  );
  if (!rowCount) throw AppError.naoEncontrado('Carrossel');
  return carrossel(db, id);
}

export async function apagar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.carrosseis WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Carrossel');
}

/** Carrosséis que o time de IA fez neste mês (a franquia do módulo conta só esses). */
export async function feitosPelaIaNoMes(db: Executor): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrosseis
      WHERE conta_id = ${contaSql()} AND origem = 'ia'
        AND criado_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
  );
  return rows[0]!.n;
}
