import type { Executor } from '@prospeccao/db';
import { type ImagensDosCards, trabalharNosCards } from '@prospeccao/integrations/carrosseis';
import { AppError } from '@prospeccao/shared';
import type { EstiloCarrossel, FormatoPeca, SlideCarrossel } from '@prospeccao/shared/carrosseis';
import {
  type EtapaTime,
  type LoteCards,
  type ObjetivoCard,
  outraVariacaoEntrada,
  type PedidoCards,
  type PedidoDoTime,
  pedidoCardsEntrada,
  type SituacaoPedido,
  textoDoDossie,
} from '@prospeccao/shared/carrosseis-time';
import { z } from 'zod';
import { contaSql, usuarioAtual } from '../../contexto.js';
import { notificar } from '../notificacoes/repositorio.js';
import * as aprender from './aprender.js';
import * as cerebro from './cerebro.js';
import { estiloDaConta, fazerImagem, imagensLigadas, tratarFotosDoPedido } from './imagens.js';
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
    if (!foto || foto.origem === 'referencia')
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
      fotos: fotos.filter((f) => f.origem !== 'referencia').map((f) => ({ id: f.id, nome: f.nome })),
      fotosDoPedido: fotosDoPedido.map((f) => ({ id: f.id, nome: f.nome })),
      hoje: hojeSp(),
      imagens: await imagensDosCards(db, ia, l, p, feitas),
      aprendizados: aprendido.aprendizados,
      preferencias: aprendido.preferencias,
      outra: outra ? { existentes: existentes.filter(Boolean), pedido: outra.pedido } : null,
    },
    avancar,
  );
  const ids: number[] = [];
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
      const [slide] = await repo.conferirFotos(db, [v.slide]);
      ids.push(
        await repo.criar(db, {
          titulo: (outra ? `${card.titulo} (variação)` : card.titulo).slice(0, 120),
          estilo,
          slides: [slide!],
          legenda: card.legenda,
          origem: 'ia',
          relatorio: v.relatorio,
          divulgarId: divulgar?.id ?? null,
          criadoPor: l.criado_por,
          card: {
            formato: p.formato,
            pedidoId: loteId,
            card: outra ? outra.card : i + 1,
            variacao: outra ? proxima + k : k + 1,
            escolhido: !outra && k === 0,
          },
        }),
      );
    }
  if (!outra)
    await db.query(
      `UPDATE comercial.carrossel_pedidos SET entrada = entrada || jsonb_build_object('tituloDoTime', $2::text) WHERE id = $1`,
      [l.id, r.titulo],
    );
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
    }>(
      `SELECT id, pedido_id, card, variacao, escolhido, versao, situacao, estilo, slides FROM comercial.carrosseis
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
