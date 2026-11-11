import { randomUUID } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import {
  CENAS_PRODUTO,
  conferirCenario,
  conferirImagemDoSlide,
  descreverReferencia,
  type EstiloDaImagem,
  gerarCenario,
  gerarImagemDoSlide,
} from '@prospeccao/integrations/carrosseis';
import { prepararImagem } from '@prospeccao/integrations/slides';
import { AppError } from '@prospeccao/shared';
import type { FotoCarrossel } from '@prospeccao/shared/carrosseis';
import { conta, contaSql } from '../../contexto.js';
import * as repo from './repositorio.js';
import type { CarrosseisIa } from './time.js';

/**
 * As imagens dos carrosséis (v132), feitas aqui na api: gerar com o GPT Image 2, passar pelo revisor
 * visual (Claude com visão) e guardar como foto da empresa (origem 'gerada' ou 'cenario'). Imagem
 * reprovada não entra: tenta mais uma vez e, se reprovar de novo, o slide fica sem.
 */

const TENTATIVAS = 2;

export const imagensLigadas = (ia: CarrosseisIa | null | undefined): boolean =>
  !!ia?.imagem && !!ia.armazenamento;

/** O estilo das imagens: as cores da identidade visual e, quando há, a referência de estilo. */
export async function estiloDaConta(db: Executor, referenciaId: number | null): Promise<EstiloDaImagem> {
  const { identidade } = await repo.identidade(db);
  const ref = referenciaId ? await repo.referencia(db, referenciaId) : null;
  return {
    paleta: [identidade.cores.principal, identidade.cores.destaque, identidade.cores.claro],
    referencia: ref?.estilo ?? null,
  };
}

/** Cada imagem pedida conta no consumo (aprovada ou não: a OpenAI cobra igual). */
async function contarImagem(db: Executor, custoUsd: number): Promise<void> {
  await db.query(
    `INSERT INTO cadastro.consumo_carrosseis (conta_id, dia, imagens, imagens_usd)
     VALUES (${contaSql()}, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 1, $1)
     ON CONFLICT (conta_id, dia) DO UPDATE SET
       imagens = consumo_carrosseis.imagens + 1,
       imagens_usd = consumo_carrosseis.imagens_usd + EXCLUDED.imagens_usd`,
    [custoUsd],
  );
}

async function guardar(
  db: Executor,
  ia: CarrosseisIa,
  jpeg: Uint8Array,
  d: {
    origem: 'gerada' | 'cenario';
    nome: string;
    pedido: string;
    baseFotoId?: number | null;
    carrosselId?: number | null;
    criadoPor?: number | null;
  },
): Promise<FotoCarrossel> {
  const img = await prepararImagem(jpeg, { maxLado: 2160 });
  const chave = `carrosseis/${conta()}/fotos/ia-${randomUUID()}.jpg`;
  await ia.armazenamento!.enviar(chave, new Uint8Array(img.dados), 'image/jpeg');
  return repo.adicionarFotoDaIa(db, {
    nome: d.nome.slice(0, 80),
    chave,
    largura: img.largura,
    altura: img.altura,
    bytes: img.dados.byteLength,
    origem: d.origem,
    baseFotoId: d.baseFotoId ?? null,
    pedido: d.pedido.slice(0, 500),
    carrosselId: d.carrosselId ?? null,
    ...(d.criadoPor !== undefined ? { criadoPor: d.criadoPor } : {}),
  });
}

/**
 * Uma imagem para um slide (uma cena gerada) ou o produto de uma foto num cenário novo. Devolve a
 * foto guardada, ou null quando o revisor visual reprovou as duas tentativas.
 */
export async function fazerImagem(
  db: Executor,
  ia: CarrosseisIa,
  contaId: number,
  p: { tipo: 'gerar' | 'cenario'; descricao: string; fotoId: number | null },
  estilo: EstiloDaImagem,
  extra: { carrosselId?: number | null; criadoPor?: number | null } = {},
): Promise<FotoCarrossel | null> {
  if (!imagensLigadas(ia)) return null;
  const cfg = ia.imagem!.config;
  const claude = ia.cliente(db, contaId);
  let original: Uint8Array | null = null;
  let nomeBase = '';
  if (p.tipo === 'cenario') {
    const base = p.fotoId ? await repo.foto(db, p.fotoId) : null;
    if (!base) throw AppError.naoEncontrado('Foto do produto');
    original = await ia.armazenamento!.ler(base.chave);
    nomeBase = base.nome;
  }
  for (let k = 0; k < TENTATIVAS; k++) {
    const jpeg =
      p.tipo === 'cenario'
        ? await gerarCenario(cfg, original!, p.descricao, estilo)
        : await gerarImagemDoSlide(cfg, p.descricao, estilo);
    await contarImagem(db, ia.imagem!.custoUsd);
    const conferencia =
      p.tipo === 'cenario'
        ? await conferirCenario(claude, { original: original!, gerada: jpeg, cena: p.descricao })
        : await conferirImagemDoSlide(claude, { jpeg, descricao: p.descricao });
    if (!conferencia.aprovada) continue;
    return guardar(db, ia, jpeg, {
      origem: p.tipo === 'cenario' ? 'cenario' : 'gerada',
      nome: p.tipo === 'cenario' ? `${nomeBase} · cenário` : `Gerada: ${p.descricao}`,
      pedido: p.descricao,
      baseFotoId: p.tipo === 'cenario' ? p.fotoId : null,
      ...extra,
    });
  }
  return null;
}

/** "Cenários para o produto" (o editor): três cenários de uma foto, cada um conferido. */
export async function cenarios(
  db: Executor,
  ia: CarrosseisIa | null,
  fotoId: number,
  d: { carrosselId: number | null; referenciaId: number | null },
): Promise<{ feitos: FotoCarrossel[]; reprovados: number }> {
  if (!ia || !imagensLigadas(ia))
    throw AppError.invalido('As imagens feitas pela IA ainda não estão ligadas. Fale com a gente.');
  const base = await repo.foto(db, fotoId);
  if (!base) throw AppError.naoEncontrado('Foto');
  if (base.origem && base.origem !== 'enviada')
    throw AppError.invalido('Escolha uma foto enviada por você (o produto como ele é).');
  const estilo = await estiloDaConta(db, d.referenciaId);
  const r = await Promise.all(
    CENAS_PRODUTO.map((cena) =>
      fazerImagem(db, ia, conta(), { tipo: 'cenario', descricao: cena, fotoId }, estilo, {
        carrosselId: d.carrosselId,
      }).catch(() => null),
    ),
  );
  const feitos = r.filter((x): x is FotoCarrossel => !!x);
  return { feitos, reprovados: r.length - feitos.length };
}

/** A referência de estilo: guarda o post e lê o estilo dele (para inspirar, nunca copiar). */
export async function guardarReferencia(
  db: Executor,
  ia: CarrosseisIa | null,
  bytes: Uint8Array,
  nome: string,
): Promise<{ id: number; estilo: string | null }> {
  if (!ia?.armazenamento) throw AppError.invalido('O armazenamento de arquivos não está ligado.');
  const img = await prepararImagem(bytes, { maxLado: 1600 }).catch(() => {
    throw AppError.invalido('Não deu para ler esta imagem. Use JPG, PNG ou WEBP.');
  });
  const estilo = await descreverReferencia(ia.cliente(db, conta()), new Uint8Array(img.dados)).catch(
    () => null,
  );
  const chave = `carrosseis/${conta()}/fotos/ref-${randomUUID()}.jpg`;
  await ia.armazenamento.enviar(chave, new Uint8Array(img.dados), 'image/jpeg');
  const f = await repo.adicionarFotoDaIa(db, {
    nome: nome.slice(0, 80) || 'Referência',
    chave,
    largura: img.largura,
    altura: img.altura,
    bytes: img.dados.byteLength,
    origem: 'referencia',
    estilo,
  });
  return { id: f.id, estilo };
}
