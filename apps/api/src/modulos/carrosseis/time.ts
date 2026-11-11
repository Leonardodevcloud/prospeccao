import type { Executor, Pool } from '@prospeccao/db';
import {
  type ClienteClaude,
  criarClaude,
  type ImagensDoTime,
  type MedidorClaude,
  montarDossie,
  resumoDasFontes,
  somarUso,
  testarClaude,
  trabalharNoCarrossel,
  type UsoClaude,
} from '@prospeccao/integrations/carrosseis';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import type { ConfigImagem } from '@prospeccao/integrations/videos';
import { AppError, type Logger } from '@prospeccao/shared';
import { directPadrao } from '@prospeccao/shared/carrosseis-publicacao';
import {
  type EtapaTime,
  type PedidoDoTime,
  type PedidoTime,
  pedidoTimeEntrada,
  textoDoDossie,
} from '@prospeccao/shared/carrosseis-time';
import { comConta, contaSql, usuarioAtual } from '../../contexto.js';
import { contratoDaConta } from '../../recursos.js';
import { notificar } from '../notificacoes/repositorio.js';
import * as aprender from './aprender.js';
import * as cards from './cards.js';
import * as cerebro from './cerebro.js';
import { estiloDaConta, fazerImagem, imagensLigadas, tratarFotosDoPedido } from './imagens.js';
import * as publicacao from './publicacao.js';
import * as repo from './repositorio.js';

/**
 * O time de IA trabalhando: cada pedido (um carrossel ou o rascunho do cérebro da marca) entra
 * numa fila no banco e a api trabalha em até 2 ao mesmo tempo. A tela acompanha a etapa; quando
 * fica pronto, quem pediu recebe o aviso. A api reiniciou no meio: o pedido volta para a fila
 * (uma vez) e depois falha com o motivo.
 */

export const MODELO_ENV = 'CARROSSEIS_MODELO';

/** O Claude dos carrosséis (a chave da plataforma) e o cliente de cada conta, com o consumo medido. */
/** v148: o custo médio de uma imagem 4:5 do GPT Image por qualidade (conferir na Saúde e consumo). */
export const CUSTO_MEDIO_IMAGEM = { low: 0.015, medium: 0.05, high: 0.2 } as const;

export interface CarrosseisIa {
  modelo: string;
  cliente(db: Executor, contaId: number): ClienteClaude;
  /** v132: o GPT Image 2 (com a OPENAI_CHAVE) para as imagens dos carrosséis; null: só fotos da empresa. */
  imagem?: { config: ConfigImagem; custoUsd: number } | null;
  /** Onde as imagens feitas ficam guardadas (o mesmo armazenamento das fotos). */
  armazenamento?: Armazenamento | null;
  /** O botão "Testar" das Configurações da plataforma. */
  testar(): Promise<string>;
}

/** Consumo do Claude por conta e dia (o Financeiro e a Saúde e consumo leem daqui). */
export function medidorClaude(db: Executor, contaId: number): MedidorClaude {
  return {
    async depois(uso: UsoClaude, custoUsd: number, ok: boolean) {
      await db.query(
        `INSERT INTO cadastro.consumo_carrosseis
           (conta_id, dia, chamadas, tokens_entrada, tokens_saida, cache_escrita, cache_leitura, erros, custo_usd)
         VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (conta_id, dia) DO UPDATE SET
           chamadas = consumo_carrosseis.chamadas + 1,
           tokens_entrada = consumo_carrosseis.tokens_entrada + EXCLUDED.tokens_entrada,
           tokens_saida = consumo_carrosseis.tokens_saida + EXCLUDED.tokens_saida,
           cache_escrita = consumo_carrosseis.cache_escrita + EXCLUDED.cache_escrita,
           cache_leitura = consumo_carrosseis.cache_leitura + EXCLUDED.cache_leitura,
           erros = consumo_carrosseis.erros + EXCLUDED.erros,
           custo_usd = consumo_carrosseis.custo_usd + EXCLUDED.custo_usd`,
        [contaId, uso.entrada, uso.saida, uso.cacheEscrita, uso.cacheLeitura, ok ? 0 : 1, custoUsd],
      );
    },
  };
}

/** Pela variável ANTHROPIC_CHAVE (sem ela, o time de IA fica desligado e a tela explica). */
export function prepararCarrosseisIa(
  env: {
    ANTHROPIC_CHAVE?: string | null;
    CARROSSEIS_MODELO?: string;
    OPENAI_CHAVE?: string | null;
    CARROSSEIS_IMAGEM_MODELO?: string;
    CARROSSEIS_CUSTO_IMAGEM_USD?: number;
    CARROSSEIS_IMAGEM_QUALIDADE?: 'low' | 'medium' | 'high';
  },
  armazenamento: Armazenamento | null = null,
): CarrosseisIa | null {
  if (!env.ANTHROPIC_CHAVE) return null;
  const chave = env.ANTHROPIC_CHAVE;
  const modelo = env.CARROSSEIS_MODELO || 'claude-sonnet-5-5';
  return {
    modelo,
    imagem:
      env.OPENAI_CHAVE && armazenamento
        ? {
            config: {
              chave: env.OPENAI_CHAVE,
              modelo: env.CARROSSEIS_IMAGEM_MODELO || 'gpt-image-2',
              qualidade: env.CARROSSEIS_IMAGEM_QUALIDADE ?? 'high',
            },
            custoUsd:
              env.CARROSSEIS_CUSTO_IMAGEM_USD ??
              CUSTO_MEDIO_IMAGEM[env.CARROSSEIS_IMAGEM_QUALIDADE ?? 'high'],
          }
        : null,
    armazenamento,
    cliente: (db, contaId) => criarClaude({ chave, modelo, medidor: medidorClaude(db, contaId) }),
    testar: () => testarClaude({ chave, modelo }),
  };
}

/* ───────────────────────────── Pedidos ───────────────────────────── */

interface LinhaPedido {
  id: number;
  conta_id: number;
  tipo: 'carrossel' | 'dossie' | 'ideias' | 'cards';
  entrada: Record<string, unknown>;
  situacao: PedidoDoTime['situacao'];
  etapa: EtapaTime | null;
  detalhes: PedidoDoTime['detalhes'];
  carrossel_id: number | null;
  erro: string | null;
  tentativas: number;
  criado_por: number | null;
  criado_em: string;
  concluido_em: string | null;
}

const paraPedido = (l: LinhaPedido): PedidoDoTime => ({
  id: l.id,
  tipo: l.tipo,
  situacao: l.situacao,
  etapa: l.etapa,
  detalhes: l.detalhes ?? {},
  assunto: String(l.entrada.assunto ?? l.entrada.titulo ?? ''),
  carrosselId: l.carrossel_id,
  erro: l.erro,
  criadoEm: l.criado_em,
  concluidoEm: l.concluido_em,
});

export async function pedido(db: Executor, id: number): Promise<PedidoDoTime> {
  const { rows } = await db.query<LinhaPedido>(
    `SELECT * FROM comercial.carrossel_pedidos WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Pedido');
  return paraPedido(rows[0]);
}

/** Os pedidos em andamento e os que terminaram nas últimas horas (a lista mostra o andamento). */
export async function pedidosRecentes(db: Executor): Promise<PedidoDoTime[]> {
  const { rows } = await db.query<LinhaPedido>(
    `SELECT * FROM comercial.carrossel_pedidos
      WHERE conta_id = ${contaSql()} AND tipo = 'carrossel'
        AND (situacao IN ('fila', 'trabalhando') OR (situacao = 'falhou' AND concluido_em > now() - interval '1 day'))
      ORDER BY id DESC LIMIT 20`,
  );
  return rows.map(paraPedido);
}

/** O pedido do dossiê em andamento (a tela do cérebro da marca mostra). */
export async function pedidoDoDossie(db: Executor): Promise<PedidoDoTime | null> {
  const { rows } = await db.query<LinhaPedido>(
    `SELECT * FROM comercial.carrossel_pedidos
      WHERE conta_id = ${contaSql()} AND tipo = 'dossie'
        AND (situacao IN ('fila', 'trabalhando') OR (situacao = 'falhou' AND concluido_em > now() - interval '1 hour'))
      ORDER BY id DESC LIMIT 1`,
  );
  return rows[0] ? paraPedido(rows[0]) : null;
}

/** A franquia do mês (null: sem limite; 0: o módulo não está no plano). */
export async function franquia(db: Executor): Promise<{ usados: number; limite: number | null }> {
  const c = await contratoDaConta(db).catch(() => null);
  return { usados: await repo.feitosPelaIaNoMes(db), limite: c ? c.carrosseisMes : null };
}

/** Pede um carrossel ao time: confere a chave, o cérebro da marca e a franquia. */
export async function pedirCarrossel(
  db: Executor,
  ia: CarrosseisIa | null,
  bruto: unknown,
): Promise<PedidoDoTime> {
  if (!ia)
    throw new AppError(
      503,
      'indisponivel',
      'O time de IA ainda não foi ligado na plataforma. Fale com a gente.',
    );
  const r = pedidoTimeEntrada.safeParse(bruto);
  if (!r.success) throw AppError.invalido(r.error.issues[0]?.message ?? 'Pedido inválido.');
  const p = r.data;
  const c = await cerebro.cerebro(db);
  if (!c.conferidoEm)
    throw new AppError(
      409,
      'cerebro',
      'Antes do primeiro carrossel com IA, confira o cérebro da marca (o que a empresa vende, para quem e como fala).',
    );
  if (p.divulgarId) await cerebro.divulgar(db, p.divulgarId);
  for (const x of p.fotos) {
    const foto = await repo.foto(db, x.fotoId);
    if (!foto || foto.origem === 'referencia')
      throw AppError.invalido('Uma das fotos do pedido não existe mais.');
  }
  const f = await franquia(db);
  if (f.limite != null && f.usados >= f.limite)
    throw new AppError(
      403,
      'franquia',
      f.limite === 0
        ? 'O time de IA não está no seu plano. Fale com a gente para liberar.'
        : `Os ${f.limite} carrosséis do time de IA deste mês já foram usados. A franquia volta no dia 1º; para mais, fale com a gente.`,
    );
  const { rows } = await db.query<LinhaPedido>(
    `INSERT INTO comercial.carrossel_pedidos (conta_id, tipo, entrada, criado_por)
     VALUES (${contaSql()}, 'carrossel', $1, $2) RETURNING *`,
    [JSON.stringify(p), usuarioAtual()?.id ?? null],
  );
  await avisarFranquia(db, f.usados + 1, f.limite);
  return paraPedido(rows[0]!);
}

/** Pede o rascunho do cérebro da marca (um por vez). */
export async function pedirDossie(db: Executor, ia: CarrosseisIa | null): Promise<PedidoDoTime> {
  if (!ia)
    throw new AppError(
      503,
      'indisponivel',
      'O time de IA ainda não foi ligado na plataforma. Fale com a gente.',
    );
  const atual = await pedidoDoDossie(db);
  if (atual && (atual.situacao === 'fila' || atual.situacao === 'trabalhando')) return atual;
  const { rows } = await db.query<LinhaPedido>(
    `INSERT INTO comercial.carrossel_pedidos (conta_id, tipo, entrada, criado_por)
     VALUES (${contaSql()}, 'dossie', '{}', $1) RETURNING *`,
    [usuarioAtual()?.id ?? null],
  );
  return paraPedido(rows[0]!);
}

export async function cancelar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.carrossel_pedidos SET situacao = 'cancelado', concluido_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} AND situacao = 'fila'`,
    [id],
  );
  if (!rowCount) throw AppError.conflito('Este pedido já começou: espere terminar.');
}

/** Aviso aos administradores em 80% e 100% da franquia (uma vez cada, no mês). */
async function avisarFranquia(db: Executor, usados: number, limite: number | null): Promise<void> {
  if (!limite) return;
  const marco = usados === limite ? 100 : usados === Math.ceil(limite * 0.8) && usados < limite ? 80 : null;
  if (!marco) return;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.usuarios WHERE conta_id = ${contaSql()} AND papel = 'admin' AND ativo AND NOT master`,
  );
  for (const u of rows)
    await notificar(db, u.id, {
      tipo: 'sistema',
      titulo:
        marco === 100
          ? `Você usou os ${limite} carrosséis do time de IA deste mês`
          : `Você já usou ${usados} dos ${limite} carrosséis do time de IA deste mês`,
      texto: marco === 100 ? 'A franquia volta no dia 1º. Para mais, fale com a gente.' : null,
      link: '/carrosseis',
    }).catch(() => undefined);
}

/* ───────────────────────────── O trabalho ───────────────────────────── */

async function avancar(db: Executor, id: number, etapa: EtapaTime, detalhe?: string): Promise<void> {
  await db.query(
    `UPDATE comercial.carrossel_pedidos
        SET etapa = $2, detalhes = CASE WHEN $3::text IS NULL THEN detalhes ELSE detalhes || jsonb_build_object($2::text, $3::text) END
      WHERE id = $1`,
    [id, etapa, detalhe ?? null],
  );
}

async function concluir(
  db: Executor,
  id: number,
  d: { carrosselId?: number | null; uso: UsoClaude; custoUsd: number },
): Promise<void> {
  await db.query(
    `UPDATE comercial.carrossel_pedidos
        SET situacao = 'pronto', etapa = NULL, carrossel_id = $2, concluido_em = now(),
            tokens_entrada = tokens_entrada + $3, tokens_saida = tokens_saida + $4, custo_usd = custo_usd + $5
      WHERE id = $1`,
    [
      id,
      d.carrosselId ?? null,
      d.uso.entrada + d.uso.cacheEscrita + d.uso.cacheLeitura,
      d.uso.saida,
      d.custoUsd,
    ],
  );
}

const hojeSp = () =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(new Date());

/**
 * As imagens que o time pode pôr neste pedido (v132): geradas (se a pessoa liberou) e o produto num
 * cenário (se escolheu a foto do produto). Sem a chave da OpenAI, null: só as fotos da empresa.
 */
async function imagensDoPedido(
  db: Executor,
  ia: CarrosseisIa,
  l: LinhaPedido,
  p: PedidoTime,
  feitas: number[],
): Promise<ImagensDoTime | null> {
  if (!imagensLigadas(ia) || !(p.gerarImagens || p.fotoProdutoId)) return null;
  const produto = p.fotoProdutoId ? await repo.foto(db, p.fotoProdutoId) : null;
  const estilo = await estiloDaConta(db, p.referenciaId);
  return {
    gerar: p.gerarImagens,
    produto:
      produto && (produto.origem ?? 'enviada') === 'enviada'
        ? { fotoId: produto.id, nome: produto.nome }
        : null,
    estiloReferencia: estilo.referencia ?? null,
    fazer: async (x) => {
      const f = await fazerImagem(db, ia, l.conta_id, x, estilo, { criadoPor: l.criado_por });
      if (f) feitas.push(f.id);
      return f?.id ?? null;
    },
  };
}

async function trabalharCarrossel(db: Executor, ia: CarrosseisIa, l: LinhaPedido): Promise<void> {
  const p: PedidoTime = pedidoTimeEntrada.parse(l.entrada);
  const feitas: number[] = [];
  const empresa = await cerebro.nomeDaEmpresa(db);
  const c = await cerebro.cerebro(db);
  const { identidade } = await repo.identidade(db);
  const divulgar = p.divulgarId ? await cerebro.divulgar(db, p.divulgarId).catch(() => null) : null;
  const estilo = p.estilo ?? identidade.estilo;
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
    }),
  ]);
  // v134: o que o time aprendeu com os posts da conta (e, de 10 em 10, 2 carrosséis são teste).
  const aprendido = await aprender
    .paraOTime(db)
    .catch(() => ({ aprendizados: [], preferencias: [], teste: null }));
  // v144: as fotos que vieram com o pedido, tratadas antes do time começar.
  if (p.fotos.length) await avancar(db, l.id, 'estrategista', 'Tratando as fotos que você mandou');
  const fotosDoPedido = await tratarFotosDoPedido(db, ia, l.conta_id, p.fotos, {
    formato: 'feed',
    referenciaId: p.referenciaId,
    criadoPor: l.criado_por,
  });
  const r = await trabalharNoCarrossel(
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
      fotos: fotos.map((f) => ({ id: f.id, nome: f.nome })),
      hoje: hojeSp(),
      imagens: await imagensDoPedido(db, ia, l, p, feitas),
      aprendizados: aprendido.aprendizados,
      preferencias: aprendido.preferencias,
      teste: aprendido.teste,
      fotosDoPedido: fotosDoPedido.map((f) => ({ id: f.id, nome: f.nome })),
    },
    (etapa, detalhe) => avancar(db, l.id, etapa, detalhe),
  );
  const slides = await repo.conferirFotos(db, r.slides);
  const carrosselId = await repo.criar(db, {
    titulo: r.titulo,
    estilo,
    slides,
    legenda: r.legenda,
    origem: 'ia',
    relatorio: r.relatorio,
    divulgarId: divulgar?.id ?? null,
    criadoPor: l.criado_por,
  });
  if (p.ideiaId) await aprender.marcarIdeiaUsada(db, p.ideiaId, carrosselId).catch(() => undefined);
  if (feitas.length)
    await db.query(
      `UPDATE comercial.carrossel_fotos SET carrossel_id = $1
        WHERE conta_id = ${contaSql()} AND id = ANY($2::int[]) AND carrossel_id IS NULL`,
      [carrosselId, feitas],
    );
  // "Comente a palavra": a regra do Comente e receba nasce junto, com o direct da redatora.
  let uso = r.uso;
  let custo = r.custoUsd;
  if (p.chamada === 'comentar' && p.palavra) {
    const partida = await publicacao.entregaDePartida(db, divulgar?.id ?? null);
    const direct = await publicacao
      .directDaPeca(db, ia.cliente(db, l.conta_id), {
        peca: { tipo: 'carrossel', id: carrosselId },
        palavra: p.palavra.toUpperCase(),
        entrega: partida.entrega,
        divulgarId: partida.divulgarId,
        material: '',
      })
      .catch(() => null);
    if (direct) {
      uso = somarUso(uso, direct.uso);
      custo += direct.custoUsd;
    }
    await publicacao.criarRegra(
      db,
      { tipo: 'carrossel', id: carrosselId },
      {
        palavra: p.palavra,
        entrega: partida.entrega,
        mensagem: direct?.mensagem ?? directPadrao(partida.entrega, r.titulo),
        botao: direct?.botao ?? '',
        divulgarId: partida.divulgarId,
        whatsapp: partida.whatsapp,
        criadoPor: l.criado_por,
      },
    );
  }
  await concluir(db, l.id, { carrosselId, uso, custoUsd: custo });
  if (l.criado_por)
    await notificar(db, l.criado_por, {
      tipo: 'sistema',
      titulo: 'Seu carrossel ficou pronto',
      texto: `${r.titulo}${r.relatorio.avisos.length ? ` · ${r.relatorio.avisos.length} ponto(s) da revisora para você decidir` : ''}`,
      link: `/carrosseis/${carrosselId}`,
    }).catch(() => undefined);
}

async function trabalharBuscaDeIdeias(db: Executor, ia: CarrosseisIa, l: LinhaPedido): Promise<void> {
  const r = await aprender.trabalharIdeias(db, ia, l);
  await concluir(db, l.id, { uso: r.uso, custoUsd: r.custoUsd });
}

async function trabalharDossie(db: Executor, ia: CarrosseisIa, l: LinhaPedido): Promise<void> {
  const f = await cerebro.fontesDoDossie(db);
  const r = await montarDossie(ia.cliente(db, l.conta_id), f);
  await cerebro.guardarRascunho(db, r.dossie, resumoDasFontes(f));
  await concluir(db, l.id, { uso: r.uso, custoUsd: r.custoUsd });
}

const MAX_TENTATIVAS = 2;

/** Pega o próximo da fila (o que travou há mais de 10 minutos volta para a fila uma vez). */
async function pegar(pool: Pool): Promise<LinhaPedido | null> {
  await pool.query(
    `UPDATE comercial.carrossel_pedidos
        SET situacao = CASE WHEN tentativas >= ${MAX_TENTATIVAS} THEN 'falhou' ELSE 'fila' END,
            erro = CASE WHEN tentativas >= ${MAX_TENTATIVAS} THEN 'O time parou no meio duas vezes. Peça de novo.' END,
            concluido_em = CASE WHEN tentativas >= ${MAX_TENTATIVAS} THEN now() END
      WHERE situacao = 'trabalhando' AND iniciado_em < now() - interval '10 minutes'`,
  );
  const { rows } = await pool.query<LinhaPedido>(
    `UPDATE comercial.carrossel_pedidos SET situacao = 'trabalhando', iniciado_em = now(), tentativas = tentativas + 1,
            etapa = NULL, detalhes = '{}'
      WHERE id = (SELECT id FROM comercial.carrossel_pedidos WHERE situacao = 'fila'
                   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`,
  );
  return rows[0] ?? null;
}

/** Trabalha um pedido (dentro da conta dele). Erro vira "falhou" com o motivo em português. */
export async function trabalhar(pool: Pool, ia: CarrosseisIa, l: LinhaPedido, log: Logger): Promise<void> {
  await comConta(l.conta_id, async () => {
    try {
      if (l.tipo === 'dossie') await trabalharDossie(pool, ia, l);
      else if (l.tipo === 'ideias') await trabalharBuscaDeIdeias(pool, ia, l);
      else if (l.tipo === 'cards')
        await concluir(
          pool,
          l.id,
          await cards.trabalharCards(pool, ia, l, (etapa, detalhe) => avancar(pool, l.id, etapa, detalhe)),
        );
      else await trabalharCarrossel(pool, ia, l);
      log.info({ conta: l.conta_id, pedido: l.id, tipo: l.tipo }, 'carrosséis: pedido pronto');
    } catch (erro) {
      const e = erro as AppError;
      const passageiro = e.repetivel && l.tentativas < MAX_TENTATIVAS;
      log.warn({ err: erro, conta: l.conta_id, pedido: l.id, passageiro }, 'carrosséis: pedido falhou');
      await pool.query(
        `UPDATE comercial.carrossel_pedidos
            SET situacao = $2, erro = $3, concluido_em = CASE WHEN $2 = 'falhou' THEN now() END
          WHERE id = $1`,
        [
          l.id,
          passageiro ? 'fila' : 'falhou',
          passageiro
            ? null
            : /HTTP 4(01|03)/.test(e.message ?? '')
              ? 'A chave do time de IA foi recusada. Fale com a gente.'
              : l.tipo === 'cards'
                ? 'O time de IA não conseguiu terminar estes cards. Peça de novo; se repetir, fale com a gente.'
                : 'O time de IA não conseguiu terminar este carrossel. Peça de novo; se repetir, fale com a gente.',
        ],
      );
      if (!passageiro && l.criado_por && (l.tipo === 'carrossel' || l.tipo === 'cards'))
        await notificar(pool, l.criado_por, {
          tipo: 'sistema',
          titulo:
            l.tipo === 'cards'
              ? 'O time de IA não conseguiu terminar os cards'
              : 'O time de IA não conseguiu terminar o carrossel',
          texto: `Peça de novo em ${l.tipo === 'cards' ? 'Cards avulsos' : 'Carrosséis'}. Este não contou na franquia.`,
          link: l.tipo === 'cards' ? '/carrosseis?aba=cards' : '/carrosseis',
        }).catch(() => undefined);
    }
  });
}

/** Trabalha o próximo pedido da fila, se houver (a rotina abaixo e os testes usam). */
export async function rodarUmPedido(pool: Pool, ia: CarrosseisIa, log: Logger): Promise<boolean> {
  const l = await pegar(pool);
  if (!l) return false;
  await trabalhar(pool, ia, l, log);
  return true;
}

/** A fila: confere a cada 3 segundos e trabalha em até 2 pedidos ao mesmo tempo. */
export function iniciarTimeCarrosseis(d: { pool: Pool; log: Logger; ia: CarrosseisIa | null }): () => void {
  const ia = d.ia;
  if (!ia) return () => undefined;
  let ocupadas = 0;
  const VAGAS = 2;
  const t = setInterval(() => {
    if (ocupadas >= VAGAS) return;
    ocupadas++;
    void pegar(d.pool)
      .then((l) => (l ? trabalhar(d.pool, ia, l, d.log) : undefined))
      .catch((e) => d.log.warn({ err: e }, 'carrosséis: fila falhou'))
      .finally(() => {
        ocupadas--;
      });
  }, 3000);
  t.unref();
  return () => clearInterval(t);
}
