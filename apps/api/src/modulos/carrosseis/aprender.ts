import type { Executor } from '@prospeccao/db';
import {
  type Aprendizado,
  aprendizados as calcularAprendizados,
  type FonteDaIdeia,
  type IdeiaDoTime,
  linhaDoAprendizado,
  melhorHorario,
  type PostParaAprender,
  pedirIdeias,
  preferenciasDasEdicoes,
  testeDaVez,
  type UsoClaude,
  vezDeTestar,
} from '@prospeccao/integrations/carrosseis';
import { AppError } from '@prospeccao/shared';
import type { SlideCarrossel } from '@prospeccao/shared/carrosseis';
import { palavraDaChamada } from '@prospeccao/shared/carrosseis-publicacao';
import { ROTULO_DIVULGAR, textoDoDossie } from '@prospeccao/shared/carrosseis-time';
import { contaSql, usuarioAtual } from '../../contexto.js';
import { leadsDosPosts } from '../instagram/conteudo.js';
import * as instagram from '../instagram/servico.js';
import * as segundoCerebro from '../segundo-cerebro/servico.js';
import * as cerebro from './cerebro.js';
import * as repo from './repositorio.js';
import type { CarrosseisIa } from './time.js';

/**
 * O time aprendendo (v134): os números de cada post contra a mediana da própria conta (com o DNA dos
 * posts feitos no CRM), o melhor horário, o que quem publica sempre muda no editor, as contas de
 * referência e as ideias com a fonte de cada uma. As contas estão em
 * @prospeccao/integrations/carrosseis (aprender.ts e ideias.ts); aqui fica o que vem do banco.
 */

/** Os posts dos últimos 180 dias com os números e, quando saíram do CRM, o DNA. */
export async function postsParaAprender(db: Executor): Promise<PostParaAprender[]> {
  const { rows } = await db.query<{
    tipo: string | null;
    publicado_em: Date | null;
    alcance: number | null;
    salvos: number | null;
    compartilhamentos: number | null;
    interacoes: number | null;
    leads: number;
    carrossel_slides: SlideCarrossel[] | null;
    estilo: string | null;
    objetivo: string | null;
    video: boolean;
    chamada_video: string | null;
    fotos_ia: number | null;
  }>(
    `WITH lp AS (${leadsDosPosts()})
     SELECT m.tipo, m.publicado_em, m.alcance, m.salvos, m.compartilhamentos, m.interacoes,
            (SELECT count(*)::int FROM lp WHERE lp.midia_id = m.midia_id) AS leads,
            c.slides AS carrossel_slides, c.estilo, c.relatorio->>'objetivo' AS objetivo,
            v.id IS NOT NULL AS video, v.opcoes->'chamada'->>'tipo' AS chamada_video,
            (SELECT count(*)::int FROM comercial.carrossel_fotos f
              WHERE f.conta_id = m.conta_id AND f.origem IN ('gerada', 'cenario')
                AND f.id IN (SELECT (s->>'fotoId')::int FROM jsonb_array_elements(coalesce(c.slides, '[]')) s
                              WHERE s->>'fotoId' IS NOT NULL)) AS fotos_ia
       FROM comercial.instagram_midias m
       LEFT JOIN comercial.carrosseis c ON c.conta_id = m.conta_id AND c.midia_id = m.midia_id
       LEFT JOIN comercial.videos v ON v.conta_id = m.conta_id AND v.midia_id = m.midia_id
      WHERE m.conta_id = ${contaSql()} AND m.publicado_em >= now() - interval '180 days'`,
  );
  return rows.map((r) => {
    const sp = r.publicado_em
      ? new Date(r.publicado_em.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
      : null;
    const slides = r.carrossel_slides;
    return {
      tipo: slides ? 'carrossel' : r.video ? 'video' : 'outro',
      modelos: slides ? slides.map((s) => s.modelo) : null,
      slides: slides ? slides.length : null,
      estilo: r.estilo,
      chamada: slides ? (palavraDaChamada(slides) ? 'comentar' : 'outra') : r.video ? r.chamada_video : null,
      fotos: slides ? slides.filter((s) => s.fotoId).length : null,
      fotosIa: slides ? (r.fotos_ia ?? 0) : null,
      objetivo: r.objetivo,
      diaSemana: sp ? sp.getDay() : null,
      hora: sp ? sp.getHours() : null,
      alcance: r.alcance,
      salvos: r.salvos,
      compartilhamentos: r.compartilhamentos,
      interacoes: r.interacoes,
      leads: r.leads,
    } satisfies PostParaAprender;
  });
}

/** As edições de quem publica nos carrosséis do time (os últimos 20). */
async function preferencias(db: Executor) {
  const { rows } = await db.query<{ slides_do_time: SlideCarrossel[]; slides: SlideCarrossel[] }>(
    `SELECT slides_do_time, slides FROM comercial.carrosseis
      WHERE conta_id = ${contaSql()} AND origem = 'ia' AND slides_do_time IS NOT NULL
        AND situacao IN ('pronto', 'agendado', 'publicado')
      ORDER BY id DESC LIMIT 20`,
  );
  const tt = (l: SlideCarrossel[]) => l.map((s) => ({ titulo: s.titulo ?? '', texto: s.texto ?? '' }));
  return preferenciasDasEdicoes(rows.map((r) => ({ doTime: tt(r.slides_do_time), final: tt(r.slides) })));
}

export interface OQueOTimeAprendeu {
  aprendizados: (Aprendizado & { linha: string })[];
  melhorHorario: { texto: string; posts: number } | null;
  preferencias: { texto: string; de: number; em: number }[];
  /** Posts com números (de todos os do Instagram) e quantos saíram do CRM. */
  posts: number;
  doCrm: number;
}

export async function oQueAprendeu(db: Executor): Promise<OQueOTimeAprendeu> {
  const posts = await postsParaAprender(db);
  const a = calcularAprendizados(posts);
  return {
    aprendizados: a.map((x) => ({ ...x, linha: linhaDoAprendizado(x) })),
    melhorHorario: melhorHorario(posts),
    preferencias: await preferencias(db),
    posts: posts.length,
    doCrm: posts.filter((p) => p.tipo !== 'outro').length,
  };
}

/** O que o time leva para cada carrossel: os aprendizados, as preferências e se é a vez de testar. */
export async function paraOTime(
  db: Executor,
): Promise<{ aprendizados: string[]; preferencias: string[]; teste: string | null }> {
  const posts = await postsParaAprender(db).catch(() => [] as PostParaAprender[]);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrossel_pedidos WHERE conta_id = ${contaSql()} AND tipo = 'carrossel'`,
  );
  return {
    aprendizados: calcularAprendizados(posts).map(linhaDoAprendizado),
    preferencias: (await preferencias(db).catch(() => [])).map((p) => p.texto),
    teste: vezDeTestar(rows[0]?.n ?? 0) ? testeDaVez(posts) : null,
  };
}

/* ───────────────────────────── Contas de referência ───────────────────────────── */

export interface ContaDeReferencia {
  id: number;
  usuario: string;
  nome: string | null;
  seguidores: number | null;
  posts: {
    legenda: string;
    tipo: string | null;
    curtidas: number | null;
    comentarios: number | null;
    em: string | null;
  }[];
  lidoEm: string | null;
  erro: string | null;
}

export const MAX_REFERENCIAS = 5;

export async function referencias(db: Executor): Promise<ContaDeReferencia[]> {
  const { rows } = await db.query<ContaDeReferencia>(
    `SELECT id, usuario, nome, seguidores, posts, lido_em AS "lidoEm", erro
       FROM comercial.carrossel_referencias WHERE conta_id = ${contaSql()} ORDER BY id`,
  );
  return rows;
}

/** Lê os números públicos do perfil (Business Discovery). Sem o Instagram conectado, fica o erro. */
async function lerReferencia(db: Executor, id: number, usuario: string): Promise<void> {
  const c = await instagram.conexaoDaConta(db);
  const m = instagram.meta();
  let erro: string | null = null;
  let perfil: Awaited<ReturnType<NonNullable<NonNullable<typeof m>['descobrir']>>> = null;
  if (!c || !m?.descobrir) erro = 'Conecte o Instagram da empresa para ler os números.';
  else {
    perfil = await m.descobrir(c.igId, c.token, usuario).catch(() => null);
    if (!perfil) erro = 'Não deu para ler: o perfil precisa ser profissional (empresa ou criador) e público.';
  }
  await db.query(
    `UPDATE comercial.carrossel_referencias
        SET nome = coalesce($2, nome), seguidores = coalesce($3, seguidores), posts = coalesce($4, posts),
            lido_em = CASE WHEN $5::text IS NULL THEN now() ELSE lido_em END, erro = $5
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [
      id,
      perfil?.nome ?? null,
      perfil?.seguidores ?? null,
      perfil ? JSON.stringify(perfil.posts) : null,
      erro,
    ],
  );
}

export async function adicionarReferencia(db: Executor, bruto: string): Promise<ContaDeReferencia[]> {
  const usuario = bruto
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(usuario))
    throw AppError.invalido('Escreva o @ do perfil (ex.: @autopecasdobairro).');
  if ((await referencias(db)).length >= MAX_REFERENCIAS)
    throw AppError.invalido(`Até ${MAX_REFERENCIAS} contas de referência.`);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.carrossel_referencias (conta_id, usuario) VALUES (${contaSql()}, $1)
     ON CONFLICT (conta_id, usuario) DO UPDATE SET usuario = EXCLUDED.usuario RETURNING id::int`,
    [usuario],
  );
  await lerReferencia(db, rows[0]!.id, usuario);
  return referencias(db);
}

export async function apagarReferencia(db: Executor, id: number): Promise<void> {
  await db.query(`DELETE FROM comercial.carrossel_referencias WHERE id = $1 AND conta_id = ${contaSql()}`, [
    id,
  ]);
}

/* ───────────────────────────── Ideias ───────────────────────────── */

export interface IdeiaSalva extends IdeiaDoTime {
  id: number;
  criadoEm: string;
  usadaEm: string | null;
  carrosselId: number | null;
}

export async function ideias(db: Executor): Promise<IdeiaSalva[]> {
  const { rows } = await db.query<IdeiaSalva>(
    `SELECT id, titulo, gancho, formato, objetivo, slides, chamada, teste, fontes, criado_em AS "criadoEm",
            usada_em AS "usadaEm", carrossel_id AS "carrosselId"
       FROM comercial.carrossel_ideias
      WHERE conta_id = ${contaSql()} AND descartada_em IS NULL AND criado_em > now() - interval '30 days'
      ORDER BY usada_em IS NOT NULL, id DESC LIMIT 30`,
  );
  return rows;
}

export async function descartarIdeia(db: Executor, id: number): Promise<void> {
  await db.query(
    `UPDATE comercial.carrossel_ideias SET descartada_em = now() WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
}

/** A ideia vira pedido ao time: devolve o que preenche o formulário. */
export async function ideia(db: Executor, id: number): Promise<IdeiaSalva> {
  const { rows } = await db.query<IdeiaSalva>(
    `SELECT id, titulo, gancho, formato, objetivo, slides, chamada, teste, fontes, criado_em AS "criadoEm",
            usada_em AS "usadaEm", carrossel_id AS "carrosselId"
       FROM comercial.carrossel_ideias WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Ideia');
  return rows[0];
}

/** O carrossel nasceu da ideia: marca como usada. */
export async function marcarIdeiaUsada(db: Executor, id: number, carrosselId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.carrossel_ideias SET usada_em = now(), carrossel_id = $2
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, carrosselId],
  );
}

/** "Buscar ideias": um pedido na fila do time (não conta na franquia). */
export async function pedirBuscaDeIdeias(db: Executor, ia: CarrosseisIa | null) {
  if (!ia) throw new AppError(503, 'indisponivel', 'O time de IA ainda não foi ligado na plataforma.');
  const c = await cerebro.cerebro(db);
  if (!c.conferidoEm)
    throw new AppError(409, 'cerebro', 'Confira o cérebro da marca antes de pedir ideias ao time.');
  const { rows: atual } = await db.query<{ id: number }>(
    `SELECT id FROM comercial.carrossel_pedidos
      WHERE conta_id = ${contaSql()} AND tipo = 'ideias' AND situacao IN ('fila', 'trabalhando') LIMIT 1`,
  );
  if (atual[0]) return { id: atual[0].id };
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.carrossel_pedidos (conta_id, tipo, entrada, criado_por)
     VALUES (${contaSql()}, 'ideias', '{}', $1) RETURNING id::int`,
    [usuarioAtual()?.id ?? null],
  );
  return { id: rows[0]!.id };
}

/** A busca de ideias em andamento (a tela mostra "o estrategista está pensando"). */
export async function buscaEmAndamento(db: Executor): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM comercial.carrossel_pedidos
      WHERE conta_id = ${contaSql()} AND tipo = 'ideias' AND situacao IN ('fila', 'trabalhando') LIMIT 1`,
  );
  return rows.length > 0;
}

/** As fontes das ideias, em texto: o que o estrategista pode citar (e o que a evidência confere). */
async function fontesDasIdeias(db: Executor): Promise<Partial<Record<FonteDaIdeia, string>>> {
  const c = await cerebro.cerebro(db);
  const [divulgar, posts, apr, refs, doCerebro] = await Promise.all([
    cerebro.listarDivulgar(db),
    cerebro.postsQueFuncionaram(db, 8),
    oQueAprendeu(db).catch(() => null),
    referencias(db),
    // O Cérebro da empresa (quando ligado), pelos pilares do dossiê.
    segundoCerebro
      .textoParaOTime(db, [...c.dossie.pilares.slice(0, 4), 'novidades, lançamentos e decisões recentes'], 8)
      .catch(() => ''),
  ]);
  const linhas = (l: string[]) => l.filter(Boolean).join('\n');
  return {
    CAMPANHA: linhas(
      divulgar.map(
        (d) =>
          `- ${ROTULO_DIVULGAR[d.tipo]}: ${d.titulo}${d.produto ? ` · ${d.produto}` : ''}${d.precoPor ? ` · por ${d.precoPor}` : ''}${d.validade ? ` · ${d.validade}` : ''}${d.usado ? ` · ${d.usado} carrossel(éis) já feitos` : ''}`,
      ),
    ),
    CONVERSAS: linhas(
      c.dossie.perguntas.map((p) => `- "${p.texto}"${p.vezes ? ` (${p.vezes} vezes)` : ''} [${p.fonte}]`),
    ),
    OBJEÇÕES: linhas(c.dossie.objecoes.map((o) => `- "${o.diz}"`)),
    INSTAGRAM: linhas(
      posts.map(
        (p) =>
          `- [${p.tipo}] alcance ${p.alcance}, ${p.salvos} salvos, ${p.compartilhamentos} compartilhamentos, ${p.leads} leads · "${p.legenda.replace(/\s+/g, ' ').slice(0, 140)}"`,
      ),
    ),
    APRENDIDO: linhas([
      ...(apr?.aprendizados ?? []).map((a) => `- ${a.linha}`),
      apr?.melhorHorario
        ? `- Melhor horário: ${apr.melhorHorario.texto} (${apr.melhorHorario.posts} posts)`
        : '',
    ]),
    REFERÊNCIAS: linhas(
      refs
        .filter((r) => r.posts.length)
        .map((r) => {
          const top = [...r.posts].sort((a, b) => (b.curtidas ?? 0) - (a.curtidas ?? 0)).slice(0, 3);
          return `- @${r.usuario}${r.seguidores ? ` (${r.seguidores} seguidores)` : ''}: ${top
            .map(
              (p) =>
                `[${p.tipo ?? 'post'}] ${p.curtidas ?? 0} curtidas, ${p.comentarios ?? 0} comentários · "${p.legenda.replace(/\s+/g, ' ').slice(0, 90)}"`,
            )
            .join(' | ')}`;
        }),
    ),
    'SEGUNDO CÉREBRO': doCerebro,
  };
}

/** O trabalho da busca de ideias (a fila do time chama). */
export async function trabalharIdeias(
  db: Executor,
  ia: CarrosseisIa,
  l: { id: number; conta_id: number },
): Promise<{ ideias: number; uso: UsoClaude; custoUsd: number }> {
  const empresa = await cerebro.nomeDaEmpresa(db);
  const c = await cerebro.cerebro(db);
  const [fontes, posts, anteriores, aprender] = await Promise.all([
    fontesDasIdeias(db),
    cerebro.postsQueFuncionaram(db, 6),
    repo.titulosRecentes(db, 15),
    postsParaAprender(db).catch(() => [] as PostParaAprender[]),
  ]);
  const r = await pedirIdeias(ia.cliente(db, l.conta_id), {
    empresa,
    dossieTexto: textoDoDossie(c.dossie, empresa),
    postsQueFuncionaram: posts,
    anteriores,
    hoje: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(
      new Date(),
    ),
    fontes,
    teste: testeDaVez(aprender),
  });
  for (const i of r.ideias)
    await db.query(
      `INSERT INTO comercial.carrossel_ideias
         (conta_id, pedido_id, titulo, gancho, formato, objetivo, slides, chamada, teste, fontes)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        l.id,
        i.titulo,
        i.gancho,
        i.formato,
        i.objetivo,
        i.slides,
        i.chamada,
        i.teste,
        JSON.stringify(i.fontes),
      ],
    );
  return { ideias: r.ideias.length, uso: r.uso, custoUsd: r.custoUsd };
}
