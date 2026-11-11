import { randomUUID } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import {
  CENA_MELHORADA,
  CENAS_PRODUTO,
  conferirCenario,
  conferirImagemDoSlide,
  descreverReferencia,
  type EstiloDaImagem,
  gerarCenario,
  gerarImagemDoSlide,
  type JeitoDePostar,
  lerJeitoDePostar,
  melhorarFoto,
} from '@prospeccao/integrations/carrosseis';
import { buscarNaInternet } from '@prospeccao/integrations/rede';
import { prepararImagem } from '@prospeccao/integrations/slides';
import { AppError } from '@prospeccao/shared';
import type { FormatoPeca, FotoCarrossel } from '@prospeccao/shared/carrosseis';
import type { FotoDoPedido } from '@prospeccao/shared/carrosseis-time';
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
    origem: 'gerada' | 'cenario' | 'melhorada';
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
  p: { tipo: 'gerar' | 'cenario' | 'melhorar'; descricao: string; fotoId: number | null },
  estilo: EstiloDaImagem,
  extra: { carrosselId?: number | null; criadoPor?: number | null; formato?: FormatoPeca } = {},
): Promise<FotoCarrossel | null> {
  if (!imagensLigadas(ia)) return null;
  const cfg = ia.imagem!.config;
  const claude = ia.cliente(db, contaId);
  const { formato = 'feed', ...resto } = extra;
  let original: Uint8Array | null = null;
  let nomeBase = '';
  const daFoto = p.tipo === 'cenario' || p.tipo === 'melhorar';
  if (daFoto) {
    const base = p.fotoId ? await repo.foto(db, p.fotoId) : null;
    if (!base) throw AppError.naoEncontrado('Foto');
    original = await ia.armazenamento!.ler(base.chave);
    nomeBase = base.nome;
  }
  const cena = p.tipo === 'melhorar' ? CENA_MELHORADA : p.descricao;
  for (let k = 0; k < TENTATIVAS; k++) {
    const jpeg =
      p.tipo === 'cenario'
        ? await gerarCenario(cfg, original!, p.descricao, estilo, formato)
        : p.tipo === 'melhorar'
          ? await melhorarFoto(cfg, original!, formato)
          : await gerarImagemDoSlide(cfg, p.descricao, estilo, formato);
    await contarImagem(db, ia.imagem!.custoUsd);
    const conferencia = daFoto
      ? await conferirCenario(claude, { original: original!, gerada: jpeg, cena })
      : await conferirImagemDoSlide(claude, { jpeg, descricao: p.descricao });
    if (!conferencia.aprovada) continue;
    return guardar(db, ia, jpeg, {
      origem: p.tipo === 'cenario' ? 'cenario' : p.tipo === 'melhorar' ? 'melhorada' : 'gerada',
      nome:
        p.tipo === 'cenario'
          ? `${nomeBase} · cenário`
          : p.tipo === 'melhorar'
            ? `${nomeBase} · melhorada`
            : `Gerada: ${p.descricao}`,
      pedido: cena,
      baseFotoId: daFoto ? p.fotoId : null,
      ...resto,
    });
  }
  return null;
}

/**
 * v144: as fotos que vieram com o pedido, já tratadas como a pessoa escolheu: como está, melhorada
 * ou o produto num cenário novo. Se a IA de imagem não estiver ligada (ou o revisor visual reprovar),
 * a foto entra como foi enviada. Devolve a foto que vai nos slides, na ordem do pedido.
 */
export async function tratarFotosDoPedido(
  db: Executor,
  ia: CarrosseisIa | null,
  contaId: number,
  fotos: FotoDoPedido[],
  d: { formato: FormatoPeca; referenciaId: number | null; criadoPor?: number | null },
): Promise<{ id: number; nome: string; original: number; tratada: boolean }[]> {
  const estilo = fotos.some((f) => f.tratamento === 'cenario')
    ? await estiloDaConta(db, d.referenciaId)
    : { paleta: [] };
  const r = await Promise.all(
    fotos.map(async (f) => {
      const base = await repo.foto(db, f.fotoId);
      if (!base) return null;
      if (f.tratamento === 'como_esta' || !ia || !imagensLigadas(ia))
        return { id: base.id, nome: base.nome, original: base.id, tratada: false };
      const feita = await fazerImagem(
        db,
        ia,
        contaId,
        {
          tipo: f.tratamento === 'melhorar' ? 'melhorar' : 'cenario',
          descricao: CENAS_PRODUTO[0],
          fotoId: base.id,
        },
        estilo,
        { formato: d.formato, ...(d.criadoPor !== undefined ? { criadoPor: d.criadoPor } : {}) },
      ).catch(() => null);
      return feita
        ? { id: feita.id, nome: base.nome, original: base.id, tratada: true }
        : { id: base.id, nome: base.nome, original: base.id, tratada: false };
    }),
  );
  return r.filter((x): x is NonNullable<typeof x> => !!x);
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

/* ───────────────────────────── v148: aprender com o Instagram da empresa ───────────────────────────── */

const MIN_POSTS_PARA_APRENDER = 3;
const MAX_POSTS_PARA_APRENDER = 9;

/**
 * Lê os posts mais recentes do Instagram da conta (as imagens que o CRM já guardou) e sugere as cores,
 * o estilo, as fontes e o jeito de postar. Só sugere: a tela mostra e a pessoa aplica e salva.
 */
export async function aprenderDoInstagram(
  db: Executor,
  ia: CarrosseisIa | null,
): Promise<{ sugestao: JeitoDePostar; posts: number }> {
  if (!ia) throw AppError.invalido('O time de IA ainda não foi ligado na plataforma.');
  const { rows } = await db.query<{ imagem: string; legenda: string | null }>(
    `SELECT imagem, legenda FROM comercial.instagram_midias
      WHERE conta_id = ${contaSql()} AND imagem IS NOT NULL
      ORDER BY publicado_em DESC NULLS LAST LIMIT 15`,
  );
  if (rows.length < MIN_POSTS_PARA_APRENDER)
    throw AppError.invalido(
      'Para aprender o jeito de postar, conecte o Instagram da empresa (em Instagram) e espere os posts aparecerem: são lidos de 6 em 6 horas.',
    );
  const posts: { jpeg: Uint8Array; legenda: string | null }[] = [];
  for (const r of rows) {
    if (posts.length >= MAX_POSTS_PARA_APRENDER) break;
    try {
      const resp = await buscarNaInternet(r.imagem, { timeoutMs: 12_000, limiteBytes: 8 * 1024 * 1024 });
      if (resp.status !== 200 || resp.cortado) continue;
      const img = await prepararImagem(new Uint8Array(resp.corpo), { maxLado: 768 });
      posts.push({ jpeg: new Uint8Array(img.dados), legenda: r.legenda });
    } catch {
      // Link vencido ou imagem que não abre: segue para o próximo post.
    }
  }
  if (posts.length < MIN_POSTS_PARA_APRENDER)
    throw AppError.invalido(
      'Não consegui abrir as imagens dos posts agora (os links da Meta vencem e são renovados de 6 em 6 horas). Tente de novo mais tarde.',
    );
  const { identidade } = await repo.identidade(db);
  const sugestao = await lerJeitoDePostar(ia.cliente(db, conta()), posts, identidade.cores).catch((e) => {
    throw AppError.externo('IA', 'O diretor de arte não conseguiu ler os posts agora. Tente de novo.', e);
  });
  return { sugestao, posts: posts.length };
}
