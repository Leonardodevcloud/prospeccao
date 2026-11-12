import type { Executor } from '@prospeccao/db';
import {
  avaliarOpcoes,
  type ImagensDosCards,
  opcaoPreferida,
  trabalharNosCards,
} from '@prospeccao/integrations/carrosseis';
import { AppError } from '@prospeccao/shared';
import {
  COMPOSICOES_CAMADAS,
  type EstiloCarrossel,
  FORMAS_CAMADAS,
  type FormatoPeca,
  type FotoCarrossel,
  geometriaCamadas,
  type IdentidadeCarrossel,
  montarSlide,
  type SlideCarrossel,
  semMarcas,
} from '@prospeccao/shared/carrosseis';
import {
  type EtapaTime,
  formatosDoPedido,
  type LoteCards,
  type NotaVisual,
  OBJETIVO_CARD,
  type ObjetivoCard,
  outraVariacaoEntrada,
  type PedidoCards,
  type PedidoDoTime,
  pedidoCardsEntrada,
  type SituacaoPedido,
  textoDoDossie,
} from '@prospeccao/shared/carrosseis-time';
import { z } from 'zod';
import { conta, contaSql, usuarioAtual } from '../../contexto.js';
import { notificar } from '../notificacoes/repositorio.js';
import * as aprender from './aprender.js';
import * as cerebro from './cerebro.js';
import { desenhar, materialDaConta } from './desenho.js';
import {
  estiloDaConta,
  fazerArte,
  fazerElemento,
  fazerImagem,
  fazerRecorte,
  imagensLigadas,
  olharAsFotos,
  tratarFotosDoPedido,
} from './imagens.js';
import * as repo from './repositorio.js';
import type { CarrosseisIa } from './time.js';

/**
 * Os cards avulsos (v144) na api. O pedido entra na mesma fila do time (tipo 'cards'); pronto, cada
 * variação vira um carrossel de um slide (tipo 'card') com o pedido, o número do card e da variação.
 * "Outra variação" é um pedido 'cards' com `outra` na entrada: cai no mesmo lote e não conta na
 * franquia. O pedido de cards conta 1 na franquia do mês, como um carrossel.
 */

/** O que fica guardado na entrada do pedido de "outra variação". */
const outraNaEntrada = z.object({
  loteId: z.number().int().positive(),
  card: z.number().int().min(1),
  pedido: z.string().default(''),
});

interface LinhaPedidoCards {
  id: number;
  conta_id: number;
  entrada: Record<string, unknown>;
  criado_por: number | null;
}

const hojeSp = () =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(new Date());

const semIa = () =>
  new AppError(503, 'indisponivel', 'O time de IA ainda não foi ligado na plataforma. Fale com a gente.');

/** As fotos do pedido existem nesta conta e são fotos (não a referência de estilo). */
async function conferirFotosDoPedido(db: Executor, fotos: PedidoCards['fotos']): Promise<void> {
  for (const f of fotos) {
    const foto = await repo.foto(db, f.fotoId);
    if (!foto || foto.origem === 'referencia' || foto.origem === 'arte' || foto.origem === 'recorte')
      throw AppError.invalido('Uma das fotos do pedido não existe mais.');
    if (f.tratamento === 'cenario' && (foto.origem ?? 'enviada') !== 'enviada')
      throw AppError.invalido(
        'O cenário novo é feito a partir de uma foto enviada por você (o produto como ele é).',
      );
  }
}

/** Pede os cards ao time: confere a chave, o cérebro da marca, as fotos e a franquia. */
export async function pedirCards(
  db: Executor,
  ia: CarrosseisIa | null,
  bruto: unknown,
  franquia: () => Promise<{ usados: number; limite: number | null }>,
): Promise<PedidoDoTime> {
  if (!ia) throw semIa();
  const r = pedidoCardsEntrada.safeParse(bruto);
  if (!r.success) throw AppError.invalido(r.error.issues[0]?.message ?? 'Pedido inválido.');
  const p = r.data;
  const c = await cerebro.cerebro(db);
  if (!c.conferidoEm)
    throw new AppError(
      409,
      'cerebro',
      'Antes dos primeiros cards com IA, confira o cérebro da marca (o que a empresa vende, para quem e como fala).',
    );
  if (p.divulgarId) await cerebro.divulgar(db, p.divulgarId);
  await conferirFotosDoPedido(db, p.fotos);
  const f = await franquia();
  if (f.limite != null && f.usados >= f.limite)
    throw new AppError(
      403,
      'franquia',
      f.limite === 0
        ? 'O time de IA não está no seu plano. Fale com a gente para liberar.'
        : `Os ${f.limite} pedidos do time de IA deste mês já foram usados. A franquia volta no dia 1º; para mais, fale com a gente.`,
    );
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.carrossel_pedidos (conta_id, tipo, entrada, criado_por)
     VALUES (${contaSql()}, 'cards', $1, $2) RETURNING id`,
    [JSON.stringify(p), usuarioAtual()?.id ?? null],
  );
  return pedidoDoTime(db, rows[0]!.id);
}

async function pedidoDoTime(db: Executor, id: number): Promise<PedidoDoTime> {
  const { rows } = await db.query<{
    id: number;
    situacao: SituacaoPedido;
    etapa: EtapaTime | null;
    detalhes: PedidoDoTime['detalhes'];
    entrada: Record<string, unknown>;
    erro: string | null;
    criado_em: string;
    concluido_em: string | null;
  }>(`SELECT * FROM comercial.carrossel_pedidos WHERE id = $1 AND conta_id = ${contaSql()}`, [id]);
  const l = rows[0];
  if (!l) throw AppError.naoEncontrado('Pedido');
  return {
    id: l.id,
    tipo: 'cards',
    situacao: l.situacao,
    etapa: l.etapa,
    detalhes: l.detalhes ?? {},
    assunto: String(l.entrada.assunto ?? ''),
    carrosselId: null,
    erro: l.erro,
    criadoEm: l.criado_em,
    concluidoEm: l.concluido_em,
  };
}

/** O pedido de cards (o lote) desta conta, para "outra variação" e para apagar. */
async function loteGuardado(
  db: Executor,
  id: number,
): Promise<{ id: number; entrada: Record<string, unknown> }> {
  const { rows } = await db.query<{ id: number; entrada: Record<string, unknown> }>(
    `SELECT id, entrada FROM comercial.carrossel_pedidos
      WHERE id = $1 AND conta_id = ${contaSql()} AND tipo = 'cards' AND entrada->'outra' IS NULL
        AND entrada->'apagado' IS NULL`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Pedido de cards');
  return rows[0];
}

/** "Outra variação" de um card: mais uma, diferente das que já existem (não conta na franquia). */
export async function pedirOutraVariacao(
  db: Executor,
  ia: CarrosseisIa | null,
  loteId: number,
  card: number,
  bruto: unknown,
): Promise<PedidoDoTime> {
  if (!ia) throw semIa();
  const d = outraVariacaoEntrada.parse(bruto ?? {});
  const lote = await loteGuardado(db, loteId);
  const { rows: existem } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrosseis
      WHERE conta_id = ${contaSql()} AND tipo = 'card' AND pedido_id = $1 AND card = $2`,
    [loteId, card],
  );
  if (!existem[0]!.n) throw AppError.naoEncontrado('Card');
  if (existem[0]!.n >= 8) throw AppError.invalido('Este card já tem 8 variações: apague as que não servem.');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.carrossel_pedidos (conta_id, tipo, entrada, criado_por)
     VALUES (${contaSql()}, 'cards', $1, $2) RETURNING id`,
    [
      JSON.stringify({ ...lote.entrada, fotos: [], outra: { loteId, card, pedido: d.pedido } }),
      usuarioAtual()?.id ?? null,
    ],
  );
  return pedidoDoTime(db, rows[0]!.id);
}

/** As imagens que o time pode gerar nos cards (sem a chave da OpenAI, null). */
async function imagensDosCards(
  db: Executor,
  ia: CarrosseisIa,
  l: LinhaPedidoCards,
  p: PedidoCards,
  feitas: number[],
): Promise<ImagensDosCards | null> {
  if (!imagensLigadas(ia) || !p.gerarImagens) return null;
  const estilo = await estiloDaConta(db, p.referenciaId);
  return {
    gerar: true,
    estiloReferencia: estilo.referencia ?? null,
    fazer: async (x) => {
      const f = await fazerImagem(db, ia, l.conta_id, x, estilo, {
        criadoPor: l.criado_por,
        formato: p.formato,
      });
      if (f) feitas.push(f.id);
      return f?.id ?? null;
    },
  };
}

/**
 * v152: o slide do time na peça "em camadas": o mesmo texto, com o recorte da foto no lugar da foto. A
 * 1ª opção põe a foto ao lado do texto, sobre a cor principal; a 2ª, embaixo, sobre a cor de destaque.
 * Devolve null (fica o modelo do time) quando não há recorte, o modelo tem conteúdo que a peça em
 * camadas não mostra (lista, comparação, citação) ou o texto não cabe em algum dos formatos pedidos.
 */
export function slideEmCamadas(
  slide: SlideCarrossel,
  recorte: FotoCarrossel | null,
  k: number,
  e: {
    identidade: IdentidadeCarrossel;
    estilo: EstiloCarrossel;
    formatos: FormatoPeca[];
    /** v153: quantos slides a peça tem (1: card; mais: a capa de um carrossel). */
    total?: number;
    /** v153: o elemento em 3D da peça. */
    elementoId?: number | null;
    /** v155: o número do card no pedido (as formas de fundo se revezam de um card para o outro). */
    indice?: number;
  },
): SlideCarrossel | null {
  if (!recorte || !slide.titulo.trim()) return null;
  if (!['capa', 'numero', 'foto', 'chamada'].includes(slide.modelo)) return null;
  const medidas = { largura: recorte.largura, altura: recorte.altura };
  const base: SlideCarrossel = {
    ...slide,
    modelo: 'camadas',
    fotoId: recorte.id,
    itens: [],
    colunas: [],
    fundo: k % 2 === 0 ? 'auto' : 'destaque',
    forma: FORMAS_CAMADAS[((e.indice ?? 0) + k * 2) % FORMAS_CAMADAS.length]!,
    acabamento: k % 2 === 0 ? 'sombra' : 'contorno',
    ...(e.elementoId ? { elementoIds: [e.elementoId] } : {}),
  };
  // v155: o código monta as composições possíveis e mede cada uma (o tamanho que o título conseguiu e
  // quanto da peça a foto ocupa); composições que dão no mesmo desenho contam uma vez. A 1ª opção fica
  // com a melhor; a 2ª, com a seguinte (ou a mesma, com outra cor, forma e acabamento).
  const candidatas = COMPOSICOES_CAMADAS.flatMap((composicao) => {
    const novo: SlideCarrossel = { ...base, composicao };
    let nota = 0;
    for (const formato of e.formatos) {
      const m = montarSlide({
        slide: novo,
        indice: 0,
        total: e.total ?? 1,
        identidade: e.identidade,
        estilo: e.estilo,
        foto: 'recorte',
        fotoMedidas: medidas,
        formato,
      }).camadas;
      if (!m?.cabe) return [];
      nota += m.titulo / 100 + m.foto * 3;
    }
    const g = geometriaCamadas(e.formatos[0]!, medidas, composicao);
    return [{ novo, nota, desenho: `${g.naBase}:${!!g.centrado}:${g.foto.x}:${g.foto.y}` }];
  });
  const unicas = candidatas
    .sort((a, b) => b.nota - a.nota)
    .filter((c, i, l) => l.findIndex((x) => x.desenho === c.desenho) === i);
  // v157: de um card para o outro a composição também muda (o perfil não fica com tudo igual).
  return unicas.length ? unicas[(k + (e.indice ?? 0)) % unicas.length]!.novo : null;
}

/** v157: abaixo desta nota a opção em camadas é remontada em outra composição e avaliada de novo. */
const NOTA_PARA_REFAZER = 4;

/**
 * v153: desenha as opções de cada card (a imagem final, pequena) e pede a nota da revisora. Grava a nota
 * no relatório de cada opção e deixa escolhida a que ela prefere. Sem as imagens ou sem resposta, as
 * opções ficam como estavam (sem nota).
 */
async function avaliarAsOpcoes(
  db: Executor,
  ia: CarrosseisIa,
  contaId: number,
  criadas: {
    id: number;
    dados: Omit<Parameters<typeof repo.criar>[1], 'card'>;
    card: number;
    escolhido: boolean;
  }[],
  e: { empresa: string; objetivo: string; estilo: EstiloCarrossel; formato: FormatoPeca },
): Promise<void> {
  const material = await materialDaConta(db, ia.armazenamento ?? null);
  const claude = ia.cliente(db, contaId);
  const cards = [...new Set(criadas.map((c) => c.card))];
  await Promise.all(
    cards.map(async (n) => {
      const opcoes = criadas.filter((c) => c.card === n).slice(0, 4);
      if (opcoes.length < 2) return;
      const imagens = await Promise.all(
        opcoes.map(async (o) => {
          const d = await desenhar(db, ia.armazenamento ?? null, material, {
            slide: o.dados.slides[0]!,
            indice: 0,
            total: 1,
            estilo: e.estilo,
            formato: e.formato,
            largura: 540,
          });
          return new Uint8Array(d.jpeg);
        }),
      );
      const notas = await avaliarOpcoes(claude, {
        empresa: e.empresa,
        objetivo: e.objetivo,
        opcoes: imagens,
      });
      if (!notas) return;
      // v157: opção em camadas com nota abaixo de 4 ganha uma segunda chance sozinha: o código monta a
      // mesma peça em outra composição (de graça) e a revisora olha de novo. Fica a que tiver nota maior.
      const trocas = await Promise.all(
        opcoes.map(async (o, k) => {
          const slide = o.dados.slides[0]!;
          if (notas[k]!.nota >= NOTA_PARA_REFAZER || slide.modelo !== 'camadas' || !slide.fotoId) return null;
          const recorte = await repo.foto(db, slide.fotoId);
          if (!recorte) return null;
          const medidas = { largura: recorte.largura, altura: recorte.altura };
          const chave = (c: SlideCarrossel['composicao']) => {
            const g = geometriaCamadas(e.formato, medidas, c ?? 'lado');
            return `${g.naBase}:${!!g.centrado}:${g.foto.x}:${g.foto.y}`;
          };
          const usadas = new Set(
            opcoes
              .map((x) => x.dados.slides[0]!)
              .filter((x) => x.modelo === 'camadas')
              .map((x) => chave(x.composicao)),
          );
          for (const composicao of COMPOSICOES_CAMADAS) {
            if (usadas.has(chave(composicao))) continue;
            const novo: SlideCarrossel = {
              ...slide,
              composicao,
              forma:
                FORMAS_CAMADAS[
                  (FORMAS_CAMADAS.indexOf(slide.forma ?? 'circulo') + 1) % FORMAS_CAMADAS.length
                ]!,
            };
            const cabe = montarSlide({
              slide: novo,
              indice: 0,
              total: 1,
              identidade: material.identidade,
              estilo: e.estilo,
              foto: 'recorte',
              fotoMedidas: medidas,
              formato: e.formato,
            }).camadas?.cabe;
            if (!cabe) continue;
            const d = await desenhar(db, ia.armazenamento ?? null, material, {
              slide: novo,
              indice: 0,
              total: 1,
              estilo: e.estilo,
              formato: e.formato,
              largura: 540,
            });
            return { k, novo, jpeg: new Uint8Array(d.jpeg) };
          }
          return null;
        }),
      );
      const refeitas = trocas.flatMap((t) => (t ? [t] : []));
      if (refeitas.length) {
        const segundas = await avaliarOpcoes(claude, {
          empresa: e.empresa,
          objetivo: e.objetivo,
          opcoes: imagens.map((im, k) => refeitas.find((t) => t.k === k)?.jpeg ?? im),
        }).catch(() => null);
        for (const t of refeitas) {
          const nova = segundas?.[t.k];
          if (!nova || nova.nota <= notas[t.k]!.nota) continue;
          notas[t.k] = nova;
          const o = opcoes[t.k]!;
          o.dados.slides = [t.novo, ...o.dados.slides.slice(1)];
          await db.query(
            `UPDATE comercial.carrosseis SET slides = $2::jsonb WHERE id = $1 AND conta_id = ${contaSql()}`,
            [o.id, JSON.stringify(o.dados.slides)],
          );
        }
      }
      const preferida = opcaoPreferida(notas);
      for (const [k, o] of opcoes.entries()) {
        const visual = { ...notas[k]!, preferida: k === preferida };
        o.escolhido = k === preferida;
        if (o.dados.relatorio) o.dados.relatorio = { ...o.dados.relatorio, visual };
        await db.query(
          `UPDATE comercial.carrosseis
              SET escolhido = $2,
                  relatorio = CASE WHEN relatorio IS NULL THEN NULL
                                   ELSE relatorio || jsonb_build_object('visual', $3::jsonb) END
            WHERE id = $1 AND conta_id = ${contaSql()}`,
          [o.id, o.escolhido, JSON.stringify(visual)],
        );
      }
    }),
  );
}

/** O que o time faz com um pedido de cards (a fila chama). Devolve o uso para o pedido. */
export async function trabalharCards(
  db: Executor,
  ia: CarrosseisIa,
  l: LinhaPedidoCards,
  avancar: (etapa: EtapaTime, detalhe?: string) => Promise<void>,
) {
  const p = pedidoCardsEntrada.parse(l.entrada);
  const outra = l.entrada.outra ? outraNaEntrada.parse(l.entrada.outra) : null;
  const loteId = outra?.loteId ?? l.id;
  const empresa = await cerebro.nomeDaEmpresa(db);
  const c = await cerebro.cerebro(db);
  const { identidade } = await repo.identidade(db);
  const divulgar = p.divulgarId ? await cerebro.divulgar(db, p.divulgarId).catch(() => null) : null;
  const estilo: EstiloCarrossel = p.estilo ?? identidade.estilo;
  const [fotos, posts, anteriores, fontes] = await Promise.all([
    repo.fotos(db),
    cerebro.postsQueFuncionaram(db, 6),
    repo.titulosRecentes(db, 15),
    cerebro.fontesParaOsFatos(db, {
      dossie: c.dossie,
      empresa,
      divulgar,
      assunto: p.assunto,
      respostas: p.respostas,
      briefing: p.briefing,
    }),
  ]);
  const aprendido = await aprender
    .paraOTime(db)
    .catch(() => ({ aprendizados: [], preferencias: [], teste: null }));
  // As fotos do pedido, tratadas antes do time começar (melhorada ou o produto num cenário novo).
  if (p.fotos.length) await avancar('estrategista', 'Tratando as fotos que você mandou');
  const fotosDoPedido = await tratarFotosDoPedido(db, ia, l.conta_id, p.fotos, {
    formato: p.formato,
    referenciaId: p.referenciaId,
    criadoPor: l.criado_por,
  });
  // "Outra variação": o que já existe neste card, para sair diferente.
  const existentes = outra
    ? (
        await db.query<{ slides: SlideCarrossel[] }>(
          `SELECT slides FROM comercial.carrosseis
            WHERE conta_id = ${contaSql()} AND tipo = 'card' AND pedido_id = $1 AND card = $2 ORDER BY variacao`,
          [loteId, outra.card],
        )
      ).rows.map((r) => {
        const s = r.slides[0];
        return s
          ? `${s.modelo}: ${[s.sobretitulo, s.titulo, s.destaque, s.texto].filter(Boolean).join(' · ')}`
          : '';
      })
    : [];
  // v157: o time enxerga as fotos (descritas uma vez e guardadas): as do pedido e as mais novas da empresa.
  const vistas = await olharAsFotos(db, ia, l.conta_id, [
    ...fotosDoPedido.map((f) => f.id),
    ...(p.usarFotos ? fotos.filter((f) => f.origem !== 'referencia').map((f) => f.id) : []),
  ]);
  const feitas: number[] = [];
  const r = await trabalharNosCards(
    ia.cliente(db, l.conta_id),
    {
      empresa,
      dossieTexto: textoDoDossie(c.dossie, empresa),
      fontes,
      identidade,
      estilo,
      pedido: p,
      divulgar,
      postsQueFuncionaram: posts,
      anteriores,
      fotos: fotos
        .filter((f) => f.origem !== 'referencia')
        .map((f) => ({ id: f.id, nome: f.nome, descricao: vistas.get(f.id) ?? null })),
      fotosDoPedido: fotosDoPedido.map((f) => ({
        id: f.id,
        nome: f.nome,
        descricao: vistas.get(f.id) ?? null,
      })),
      hoje: hojeSp(),
      imagens: await imagensDosCards(db, ia, l, p, feitas),
      aprendizados: aprendido.aprendizados,
      preferencias: aprendido.preferencias,
      outra: outra ? { existentes: existentes.filter(Boolean), pedido: outra.pedido } : null,
    },
    avancar,
  );
  // v152: as opções "em camadas" de cada card. A IA tira o fundo da foto do card (a que o time escolheu
  // ou a que veio no pedido) e a peça é montada pelo sistema; sem foto que sirva, ficam os modelos.
  const formatos = formatosDoPedido(p);
  const fotosDoPedidoIds = fotosDoPedido.map((f) => f.id);
  const recortes: (FotoCarrossel | null)[] =
    !outra && p.camadas && imagensLigadas(ia) && r.cards.length
      ? await (async () => {
          await avancar('diretor', 'Recortando as fotos para as peças em camadas');
          return Promise.all(
            r.cards.map((card) => {
              const doTime = card.variacoes
                .map((v) => v.slide.fotoId)
                .find((id) => !!id && (fotos.find((f) => f.id === id)?.origem ?? 'enviada') !== 'gerada');
              const fotoId = doTime ?? fotosDoPedidoIds[0] ?? null;
              return fotoId
                ? fazerRecorte(db, ia, l.conta_id, fotoId, { criadoPor: l.criado_por }).catch(() => null)
                : null;
            }),
          );
        })()
      : [];
  // v153: um elemento em 3D por card com recorte (o mesmo nas duas opções), pelo texto da 1ª opção.
  const elementos: (FotoCarrossel | null)[] =
    p.elementos && recortes.some(Boolean)
      ? await Promise.all(
          r.cards.map((card, i) => {
            const s = card.variacoes[0]?.slide;
            // v154: sem um vazio para o elemento na peça (foto deitada, por exemplo), nem pede a imagem.
            const cabe =
              !!recortes[i] &&
              !!geometriaCamadas(
                formatos[0]!,
                { largura: recortes[i]!.largura, altura: recortes[i]!.altura },
                'lado',
              ).elemento;
            return cabe && s
              ? fazerElemento(
                  db,
                  ia,
                  l.conta_id,
                  { titulo: semMarcas(s.titulo), destaque: s.destaque, texto: s.texto },
                  { criadoPor: l.criado_por },
                ).catch(() => null)
              : null;
          }),
        )
      : [];
  const ids: number[] = [];
  /** O que foi criado, para nascer igual no outro formato (feed e story pedidos juntos). */
  const criadas: {
    id: number;
    dados: Omit<Parameters<typeof repo.criar>[1], 'card'>;
    card: number;
    variacao: number;
    escolhido: boolean;
  }[] = [];
  const proxima = outra
    ? (
        await db.query<{ n: number }>(
          `SELECT coalesce(max(variacao), 0)::int AS n FROM comercial.carrosseis
            WHERE conta_id = ${contaSql()} AND tipo = 'card' AND pedido_id = $1 AND card = $2`,
          [loteId, outra.card],
        )
      ).rows[0]!.n + 1
    : 1;
  for (const [i, card] of r.cards.entries())
    for (const [k, v] of card.variacoes.entries()) {
      const [conferido] = await repo.conferirFotos(db, [v.slide]);
      // As duas primeiras opções do card viram "em camadas" quando o recorte saiu e o texto cabe.
      const emCamadas =
        !outra && k < 2
          ? slideEmCamadas(conferido!, recortes[i] ?? null, k, {
              identidade,
              estilo,
              formatos,
              elementoId: elementos[i]?.id ?? null,
            })
          : null;
      const dados = {
        titulo: (outra ? `${card.titulo} (variação)` : card.titulo).slice(0, 120),
        estilo,
        slides: [emCamadas ?? conferido!],
        legenda: card.legenda,
        origem: 'ia' as const,
        relatorio: v.relatorio,
        divulgarId: divulgar?.id ?? null,
        criadoPor: l.criado_por,
      };
      const numero = { card: outra ? outra.card : i + 1, variacao: outra ? proxima + k : k + 1 };
      const escolhido = !outra && k === 0;
      const id = await repo.criar(db, {
        ...dados,
        card: { formato: formatos[0]!, pedidoId: loteId, ...numero, escolhido },
      });
      ids.push(id);
      if (!outra) criadas.push({ id, dados, ...numero, escolhido });
    }
  // v150: em cada card, mais uma variação com a peça inteira desenhada pela IA, a partir do texto da
  // 1ª variação (o que o time aprovou). Reprovada duas vezes na conferência: o card fica só nos moldes.
  if (!outra && p.arteIa && imagensLigadas(ia) && r.cards.length) {
    await avancar('diretor', 'Desenhando a arte de cada card');
    const feitasArte = await Promise.all(
      r.cards.map(async (card, i) => {
        const base = card.variacoes[0]?.slide;
        if (!base) return null;
        const fotoIds = [
          ...(base.fotoId ? [base.fotoId] : []),
          ...card.variacoes.map((v) => v.slide.fotoId).filter((x): x is number => !!x),
          ...fotosDoPedidoIds,
        ];
        const f = await fazerArte(db, ia, l.conta_id, {
          slide: base,
          formato: formatos[0]!,
          objetivo: `${OBJETIVO_CARD[p.objetivo].nome} (${OBJETIVO_CARD[p.objetivo].dica})`,
          fotoIds,
          criadoPor: l.criado_por,
        }).catch(() => null);
        return f ? { i, card, base, foto: f } : null;
      }),
    );
    for (const a of feitasArte) {
      if (!a) continue;
      const id = await repo.criar(db, {
        titulo: `${a.card.titulo} (arte da IA)`.slice(0, 120),
        estilo,
        slides: [
          {
            ...a.base,
            id: `c${a.i + 1}arte`,
            modelo: 'arte',
            fotoId: a.foto.id,
            fundo: 'auto',
            ...(a.foto.zonaTexto ? { zonaTexto: a.foto.zonaTexto } : {}),
          },
        ],
        legenda: a.card.legenda,
        origem: 'ia',
        relatorio: a.card.variacoes[0]!.relatorio,
        divulgarId: divulgar?.id ?? null,
        criadoPor: l.criado_por,
        card: {
          formato: formatos[0]!,
          pedidoId: loteId,
          card: a.i + 1,
          variacao: a.card.variacoes.length + 1,
          escolhido: false,
        },
      });
      await db.query(
        `UPDATE comercial.carrossel_fotos SET carrossel_id = $1 WHERE conta_id = ${contaSql()} AND id = $2`,
        [id, a.foto.id],
      );
      ids.push(id);
    }
  }
  if (!outra)
    await db.query(
      `UPDATE comercial.carrossel_pedidos SET entrada = entrada || jsonb_build_object('tituloDoTime', $2::text) WHERE id = $1`,
      [l.id, r.titulo],
    );
  // v153: a revisora olha as opções prontas de cada card e dá a nota; a que ela prefere fica escolhida.
  if (!outra && criadas.length > 1) {
    await avancar('revisor', 'Olhando as opções prontas de cada card');
    await avaliarAsOpcoes(db, ia, l.conta_id, criadas, {
      empresa,
      objetivo: `${OBJETIVO_CARD[p.objetivo].nome} (${OBJETIVO_CARD[p.objetivo].dica})`,
      estilo,
      formato: formatos[0]!,
    }).catch(() => undefined);
  }
  // v152: feed e story pedidos juntos. As mesmas peças nascem no outro formato, num lote irmão (o texto,
  // a foto e o recorte são os mesmos; o sistema monta de novo no outro tamanho). Não conta na franquia.
  if (!outra && formatos.length > 1 && criadas.length) {
    const { rows: irmao } = await db.query<{ id: number }>(
      `INSERT INTO comercial.carrossel_pedidos (conta_id, tipo, entrada, criado_por, situacao, concluido_em)
       VALUES (${contaSql()}, 'cards', $1, $2, 'pronto', now()) RETURNING id`,
      [
        JSON.stringify({
          ...p,
          formato: formatos[1],
          formatos: [],
          fotos: [],
          irmaoDe: l.id,
          tituloDoTime: r.titulo,
        }),
        l.criado_por,
      ],
    );
    for (const c of criadas)
      ids.push(
        await repo.criar(db, {
          ...c.dados,
          card: {
            formato: formatos[1]!,
            pedidoId: irmao[0]!.id,
            card: c.card,
            variacao: c.variacao,
            escolhido: c.escolhido,
          },
        }),
      );
  }
  if (feitas.length && ids.length)
    await db.query(
      `UPDATE comercial.carrossel_fotos SET carrossel_id = $1
        WHERE conta_id = ${contaSql()} AND id = ANY($2::int[]) AND carrossel_id IS NULL`,
      [ids[0], feitas],
    );
  if (l.criado_por)
    await notificar(db, l.criado_por, {
      tipo: 'sistema',
      titulo: outra ? 'A nova variação do card ficou pronta' : 'Seus cards ficaram prontos',
      texto: outra ? r.titulo : `${r.titulo} · ${ids.length} ${ids.length === 1 ? 'peça' : 'peças'}`,
      link: '/carrosseis?aba=cards',
    }).catch(() => undefined);
  return { uso: r.uso, custoUsd: r.custoUsd, carrosselId: ids[0] ?? null };
}

/* ───────────────────────────── A lista ───────────────────────────── */

interface LinhaLote {
  id: number;
  entrada: Record<string, unknown>;
  situacao: SituacaoPedido;
  etapa: EtapaTime | null;
  detalhes: LoteCards['detalhes'];
  erro: string | null;
  criado_em: string;
}

/** Os pedidos de cards (os mais novos primeiro) com as variações de cada card. */
export async function lotes(db: Executor): Promise<LoteCards[]> {
  const { rows } = await db.query<LinhaLote>(
    `SELECT id, entrada, situacao, etapa, detalhes, erro, criado_em FROM comercial.carrossel_pedidos
      WHERE conta_id = ${contaSql()} AND tipo = 'cards' AND entrada->'outra' IS NULL AND situacao <> 'cancelado'
        AND entrada->'apagado' IS NULL
        AND (situacao <> 'falhou' OR concluido_em > now() - interval '3 days')
      ORDER BY id DESC LIMIT 30`,
  );
  if (!rows.length) return [];
  const ids = rows.map((l) => l.id);
  const [pecas, outras] = await Promise.all([
    db.query<{
      id: number;
      pedido_id: number;
      card: number;
      variacao: number;
      escolhido: boolean;
      versao: number;
      situacao: string;
      estilo: EstiloCarrossel;
      slides: SlideCarrossel[];
      visual: NotaVisual | null;
    }>(
      `SELECT id, pedido_id, card, variacao, escolhido, versao, situacao, estilo, slides,
              relatorio->'visual' AS visual
         FROM comercial.carrosseis
        WHERE conta_id = ${contaSql()} AND tipo = 'card' AND pedido_id = ANY($1::int[])
        ORDER BY pedido_id, card, variacao`,
      [ids],
    ),
    db.query<{ lote: number; card: number }>(
      `SELECT (entrada->'outra'->>'loteId')::int AS lote, (entrada->'outra'->>'card')::int AS card
         FROM comercial.carrossel_pedidos
        WHERE conta_id = ${contaSql()} AND tipo = 'cards' AND situacao IN ('fila', 'trabalhando')
          AND (entrada->'outra'->>'loteId')::int = ANY($1::int[])`,
      [ids],
    ),
  ]);
  return rows.map((l) => {
    const e = l.entrada;
    const minhas = pecas.rows.filter((x) => x.pedido_id === l.id);
    const numeros = [...new Set(minhas.map((x) => x.card))].sort((a, b) => a - b);
    return {
      pedidoId: l.id,
      titulo: String(e.tituloDoTime ?? '') || String(e.assunto ?? '').slice(0, 80) || 'Cards',
      assunto: String(e.assunto ?? ''),
      objetivo: (e.objetivo as ObjetivoCard) ?? 'promocao',
      formato: (e.formato as FormatoPeca) ?? 'feed',
      quantidade: Number(e.quantidade ?? 1),
      variacoes: Number(e.variacoes ?? 1),
      situacao: l.situacao,
      etapa: l.etapa,
      detalhes: l.detalhes ?? {},
      erro: l.erro,
      criadoEm: l.criado_em,
      trabalhando: outras.rows.filter((o) => o.lote === l.id).map((o) => o.card),
      cards: numeros.map((n) => ({
        card: n,
        variacoes: minhas
          .filter((x) => x.card === n)
          .map((x) => ({
            id: x.id,
            variacao: x.variacao,
            escolhido: x.escolhido,
            versao: x.versao,
            situacao: x.situacao,
            slide: Array.isArray(x.slides) ? (x.slides[0] ?? null) : null,
            estilo: x.estilo,
            visual: x.visual ?? null,
          })),
      })),
    };
  });
}

/** A variação escolhida do card (as outras do mesmo card deixam de ser). */
export async function escolher(db: Executor, id: number): Promise<void> {
  const { rows } = await db.query<{ pedido_id: number; card: number }>(
    `SELECT pedido_id, card FROM comercial.carrosseis WHERE id = $1 AND conta_id = ${contaSql()} AND tipo = 'card'`,
    [id],
  );
  const c = rows[0];
  if (!c) throw AppError.naoEncontrado('Card');
  await db.query(
    `UPDATE comercial.carrosseis SET escolhido = (id = $1)
      WHERE conta_id = ${contaSql()} AND tipo = 'card' AND pedido_id = $2 AND card = $3`,
    [id, c.pedido_id, c.card],
  );
}

/** Os ids das peças de um lote (para apagar ou baixar). `escolhidas`: só a escolhida de cada card. */
export async function pecasDoLote(db: Executor, loteId: number, escolhidas: boolean): Promise<number[]> {
  await loteGuardado(db, loteId);
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM comercial.carrosseis
      WHERE conta_id = ${contaSql()} AND tipo = 'card' AND pedido_id = $1 ${escolhidas ? 'AND escolhido' : ''}
      ORDER BY card, variacao`,
    [loteId],
  );
  return rows.map((r) => r.id);
}

/**
 * Tira o lote da lista (as peças são apagadas pela rota, com os arquivos). O pedido continua contado
 * na franquia do mês: só fica marcado como apagado. Com o time trabalhando nele, espera terminar.
 */
export async function esquecerLote(db: Executor, loteId: number): Promise<void> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrossel_pedidos
      WHERE conta_id = ${contaSql()} AND tipo = 'cards' AND situacao IN ('fila', 'trabalhando')
        AND (id = $1 OR (entrada->'outra'->>'loteId')::int = $1)`,
    [loteId],
  );
  if (rows[0]!.n) throw AppError.conflito('O time ainda está trabalhando nestes cards: espere terminar.');
  await db.query(
    `UPDATE comercial.carrossel_pedidos SET entrada = entrada || '{"apagado": true}'::jsonb
      WHERE conta_id = ${contaSql()} AND tipo = 'cards' AND id = $1`,
    [loteId],
  );
}

/* ───────────────────────────── v150: desenhar a arte de novo ───────────────────────────── */

/**
 * "Desenhar a arte" de uma variação de card, com o texto que está nela agora. Numa variação que já é
 * arte (o texto mudou no editor, ou a pessoa quer outra), troca a imagem; numa variação dos moldes, cria
 * mais uma variação do mesmo card, desenhada pela IA. Reprovada duas vezes: nada muda e a tela avisa.
 */
export async function desenharArteDoCard(
  db: Executor,
  ia: CarrosseisIa | null,
  id: number,
): Promise<{ carrosselId: number }> {
  if (!ia || !imagensLigadas(ia))
    throw AppError.invalido('A arte desenhada pela IA ainda não está ligada. Fale com a gente.');
  const c = await repo.carrossel(db, id);
  const slide = c.conteudo[0];
  if (c.tipo !== 'card' || !c.pedidoId || !c.card || !slide)
    throw AppError.invalido('A arte da IA é feita para os cards avulsos.');
  if (c.situacao === 'publicado' || c.situacao === 'agendado')
    throw AppError.conflito('Esta peça já foi publicada ou agendada: duplique para mexer.');
  if (!semMarcas(slide.titulo).trim()) throw AppError.invalido('Escreva o título da peça antes de desenhar.');
  const { rows } = await db.query<{ objetivo: string | null }>(
    `SELECT entrada->>'objetivo' AS objetivo FROM comercial.carrossel_pedidos WHERE id = $1 AND conta_id = ${contaSql()}`,
    [c.pedidoId],
  );
  const obj = (rows[0]?.objetivo as ObjetivoCard | null) ?? 'promocao';
  const objetivo = OBJETIVO_CARD[obj] ?? OBJETIVO_CARD.promocao;
  const base = slide.modelo === 'arte' ? null : slide.fotoId;
  const f = await fazerArte(db, ia, conta(), {
    slide,
    formato: c.formato,
    objetivo: `${objetivo.nome} (${objetivo.dica})`,
    fotoIds: base ? [base] : [],
  });
  if (!f)
    throw new AppError(
      422,
      'arte',
      'A IA não acertou o texto da arte em duas tentativas: a peça ficou como estava. Tente de novo ou encurte o texto.',
    );
  if (slide.modelo === 'arte') {
    const { zonaTexto: _antiga, ...semZona } = slide;
    const slides = [
      { ...semZona, fotoId: f.id, ...(f.zonaTexto ? { zonaTexto: f.zonaTexto } : {}) },
      ...c.conteudo.slice(1),
    ];
    await db.query(
      `UPDATE comercial.carrosseis SET slides = $2, versao = versao + 1, atualizado_em = now()
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id, JSON.stringify(slides)],
    );
    await db.query(
      `UPDATE comercial.carrossel_fotos SET carrossel_id = $1 WHERE conta_id = ${contaSql()} AND id = $2`,
      [id, f.id],
    );
    return { carrosselId: id };
  }
  const { rows: prox } = await db.query<{ n: number }>(
    `SELECT coalesce(max(variacao), 0)::int + 1 AS n FROM comercial.carrosseis
      WHERE conta_id = ${contaSql()} AND tipo = 'card' AND pedido_id = $1 AND card = $2`,
    [c.pedidoId, c.card],
  );
  const novo = await repo.criar(db, {
    titulo: `${c.titulo} (arte da IA)`.slice(0, 120),
    estilo: c.estilo,
    slides: [
      {
        ...slide,
        id: `${slide.id}-arte`,
        modelo: 'arte',
        fotoId: f.id,
        fundo: 'auto',
        ...(f.zonaTexto ? { zonaTexto: f.zonaTexto } : {}),
      },
    ],
    legenda: c.legenda,
    origem: 'ia',
    relatorio: c.relatorio,
    card: { formato: c.formato, pedidoId: c.pedidoId, card: c.card, variacao: prox[0]!.n, escolhido: false },
  });
  await db.query(
    `UPDATE comercial.carrossel_fotos SET carrossel_id = $1 WHERE conta_id = ${contaSql()} AND id = $2`,
    [novo, f.id],
  );
  return { carrosselId: novo };
}
