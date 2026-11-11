import type { Executor } from '@prospeccao/db';
import { fontesDoPerfil, textoDoPerfil } from '@prospeccao/integrations/agente';
import type { FonteDoTime, FontesDoDossie, PostQueFuncionou } from '@prospeccao/integrations/carrosseis';
import { lerSite } from '@prospeccao/integrations/enriquecimento';
import { AppError } from '@prospeccao/shared';
import {
  camposExatos,
  type DivulgarEntrada,
  type DivulgarItem,
  type DossieMarca,
  dossieCompleto,
  faltandoNoDossie,
  ROTULO_DIVULGAR,
  textoDoDossie,
} from '@prospeccao/shared/carrosseis-time';
import { contaSql, usuarioAtual } from '../../contexto.js';
import { lerPerfil } from '../agente/perfil.js';
import { listarConteudo } from '../instagram/conteudo.js';
import * as segundoCerebro from '../segundo-cerebro/servico.js';

/**
 * O cérebro da marca (o dossiê que o time de IA lê) e o que divulgar no mês. O dossiê nasce de um
 * rascunho da IA com o que o CRM já sabe da empresa; só vale depois que o administrador confere.
 */

export interface CerebroDaConta {
  dossie: DossieMarca;
  fontes: { rotulo: string; quantos: number }[];
  geradoEm: string | null;
  conferidoEm: string | null;
  conferidoPor: string | null;
  faltando: string[];
  atualizadoEm: string | null;
}

export async function cerebro(db: Executor): Promise<CerebroDaConta> {
  const { rows } = await db.query<{
    dados: unknown;
    fontes: { rotulo: string; quantos: number }[];
    gerado_em: string | null;
    conferido_em: string | null;
    conferido_por: string | null;
    atualizado_em: string;
  }>(
    `SELECT c.dados, c.fontes, c.gerado_em, c.conferido_em, u.nome AS conferido_por, c.atualizado_em
       FROM comercial.carrossel_cerebro c LEFT JOIN cadastro.usuarios u ON u.id = c.conferido_por
      WHERE c.conta_id = ${contaSql()}`,
  );
  const r = rows[0];
  const dossie = dossieCompleto(r?.dados);
  return {
    dossie,
    fontes: Array.isArray(r?.fontes) ? r.fontes : [],
    geradoEm: r?.gerado_em ?? null,
    conferidoEm: r?.conferido_em ?? null,
    conferidoPor: r?.conferido_por ?? null,
    faltando: faltandoNoDossie(dossie),
    atualizadoEm: r?.atualizado_em ?? null,
  };
}

/** Salvar muda o dossiê: precisa conferir de novo (o time só usa o conferido). */
export async function salvarDossie(db: Executor, d: DossieMarca, conferir: boolean): Promise<void> {
  if (conferir) {
    const falta = faltandoNoDossie(d);
    if (falta.length) throw AppError.invalido(`Antes de conferir, preencha: ${falta.join(', ')}.`);
  }
  await db.query(
    `INSERT INTO comercial.carrossel_cerebro (conta_id, dados, conferido_em, conferido_por, atualizado_em)
     VALUES (${contaSql()}, $1, CASE WHEN $2 THEN now() END, CASE WHEN $2 THEN $3::int END, now())
     ON CONFLICT (conta_id) DO UPDATE SET dados = EXCLUDED.dados, conferido_em = EXCLUDED.conferido_em,
       conferido_por = EXCLUDED.conferido_por, atualizado_em = now()`,
    [JSON.stringify(d), conferir, usuarioAtual()?.id ?? null],
  );
}

/** O rascunho da IA chegou: substitui o dossiê e tira a conferência (a pessoa lê antes de valer). */
export async function guardarRascunho(
  db: Executor,
  d: DossieMarca,
  fontes: { rotulo: string; quantos: number }[],
): Promise<void> {
  await db.query(
    `INSERT INTO comercial.carrossel_cerebro (conta_id, dados, fontes, gerado_em, atualizado_em)
     VALUES (${contaSql()}, $1, $2, now(), now())
     ON CONFLICT (conta_id) DO UPDATE SET dados = EXCLUDED.dados, fontes = EXCLUDED.fontes, gerado_em = now(),
       conferido_em = NULL, conferido_por = NULL, atualizado_em = now()`,
    [JSON.stringify(d), JSON.stringify(fontes)],
  );
}

export async function nomeDaEmpresa(db: Executor): Promise<string> {
  const { rows } = await db.query<{ nome: string }>(
    `SELECT nome FROM cadastro.contas WHERE id = ${contaSql()}`,
  );
  return rows[0]?.nome ?? 'a empresa';
}

/* ───────────────────────────── O que divulgar ───────────────────────────── */

interface LinhaDivulgar {
  id: number;
  tipo: DivulgarItem['tipo'];
  titulo: string;
  dados: Partial<DivulgarEntrada>;
  ate: string | null;
  criadoEm: string;
  usado: number;
}

const paraItem = (l: LinhaDivulgar): DivulgarItem => ({
  id: l.id,
  tipo: l.tipo,
  titulo: l.titulo,
  detalhes: l.dados.detalhes ?? '',
  produto: l.dados.produto ?? '',
  precoDe: l.dados.precoDe ?? '',
  precoPor: l.dados.precoPor ?? '',
  validade: l.dados.validade ?? '',
  condicoes: l.dados.condicoes ?? '',
  ate: l.ate,
  usado: l.usado,
  criadoEm: l.criadoEm,
});

const SELECT_DIVULGAR = `SELECT d.id, d.tipo, d.titulo, d.dados, to_char(d.ate, 'YYYY-MM-DD') AS ate, d.criado_em AS "criadoEm",
            (SELECT count(*)::int FROM comercial.carrosseis c WHERE c.divulgar_id = d.id) AS usado
       FROM comercial.carrossel_divulgar d`;

/** O que está valendo (o que passou da data some da lista; dá para ver os antigos). */
export async function listarDivulgar(db: Executor, antigos = false): Promise<DivulgarItem[]> {
  const { rows } = await db.query<LinhaDivulgar>(
    `${SELECT_DIVULGAR}
      WHERE d.conta_id = ${contaSql()} AND NOT d.arquivado
        AND ($1 OR d.ate IS NULL OR d.ate >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
      ORDER BY d.criado_em DESC LIMIT 100`,
    [antigos],
  );
  return rows.map(paraItem);
}

export async function divulgar(db: Executor, id: number): Promise<DivulgarItem> {
  const { rows } = await db.query<LinhaDivulgar>(
    `${SELECT_DIVULGAR} WHERE d.id = $1 AND d.conta_id = ${contaSql()} AND NOT d.arquivado`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('O que divulgar');
  return paraItem(rows[0]);
}

const dadosDe = (d: DivulgarEntrada) => ({
  detalhes: d.detalhes,
  produto: d.produto,
  precoDe: d.precoDe,
  precoPor: d.precoPor,
  validade: d.validade,
  condicoes: d.condicoes,
});

export async function criarDivulgar(db: Executor, d: DivulgarEntrada): Promise<DivulgarItem> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrossel_divulgar WHERE conta_id = ${contaSql()} AND NOT arquivado`,
  );
  if (rows[0]!.n >= 100) throw AppError.invalido('Até 100 itens para divulgar: apague os que já passaram.');
  const { rows: novo } = await db.query<{ id: number }>(
    `INSERT INTO comercial.carrossel_divulgar (conta_id, tipo, titulo, dados, ate, criado_por)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5) RETURNING id`,
    [d.tipo, d.titulo, JSON.stringify(dadosDe(d)), d.ate, usuarioAtual()?.id ?? null],
  );
  return divulgar(db, novo[0]!.id);
}

export async function atualizarDivulgar(db: Executor, id: number, d: DivulgarEntrada): Promise<DivulgarItem> {
  const { rowCount } = await db.query(
    `UPDATE comercial.carrossel_divulgar SET tipo = $2, titulo = $3, dados = $4, ate = $5
      WHERE id = $1 AND conta_id = ${contaSql()} AND NOT arquivado`,
    [id, d.tipo, d.titulo, JSON.stringify(dadosDe(d)), d.ate],
  );
  if (!rowCount) throw AppError.naoEncontrado('O que divulgar');
  return divulgar(db, id);
}

/** Arquiva (os carrosséis que usaram continuam mostrando de onde vieram). */
export async function apagarDivulgar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.carrossel_divulgar SET arquivado = true WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('O que divulgar');
}

/* ───────────────────────────── O que o CRM sabe ───────────────────────────── */

/** Os posts que mais funcionaram nos últimos 120 dias (leads primeiro, depois salvos e compartilhamentos). */
export async function postsQueFuncionaram(db: Executor, n = 12): Promise<PostQueFuncionou[]> {
  const c = await listarConteudo(db, 120, null).catch(() => null);
  if (!c) return [];
  return c.posts
    .filter((p) => p.legenda?.trim())
    .map((p) => ({
      legenda: p.legenda ?? '',
      tipo: String(p.tipo ?? 'post').toLowerCase(),
      alcance: p.alcance ?? 0,
      salvos: p.salvos ?? 0,
      compartilhamentos: p.compartilhamentos ?? 0,
      leads: p.leads ?? 0,
    }))
    .sort(
      (a, b) =>
        b.leads * 50 +
        b.salvos * 3 +
        b.compartilhamentos * 4 -
        (a.leads * 50 + a.salvos * 3 + a.compartilhamentos * 4),
    )
    .slice(0, n);
}

/** Tudo o que entra no rascunho do dossiê (as mensagens dos clientes saem sem dado pessoal lá no time). */
export async function fontesDoDossie(db: Executor, comSite = true): Promise<FontesDoDossie> {
  const empresa = await nomeDaEmpresa(db);
  const atual = (await cerebro(db)).dossie;
  const { perfil, conferidas } = await lerPerfil(db);
  const perfilIa = Object.keys(conferidas).length ? textoDoPerfil(perfil, empresa) : null;
  const C = contaSql();
  const [conhecimento, sitio, nichos, comentarios, mensagens, quadros, ligacoes, reunioes] =
    await Promise.all([
      db.query<{ titulo: string; texto: string }>(
        `SELECT titulo, conteudo AS texto FROM comercial.conhecimento
        WHERE conta_id = ${C} AND status = 'ativo' ORDER BY usos DESC, atualizado_em DESC LIMIT 25`,
      ),
      db.query<{ site_url: string | null }>(`SELECT site_url FROM comercial.ia_perfil WHERE conta_id = ${C}`),
      db.query<{ nome: string }>(
        `SELECT nome FROM cadastro.nichos WHERE conta_id = ${C} AND ativo ORDER BY nome LIMIT 20`,
      ),
      db.query<{ texto: string; interesse: string | null }>(
        `SELECT texto, interesse FROM comercial.instagram_comentarios
        WHERE conta_id = ${C} AND comentado_em > now() - interval '120 days' AND length(texto) >= 8
        ORDER BY (interesse IS NOT NULL) DESC, comentado_em DESC LIMIT 80`,
      ),
      // Mensagens que os clientes mandaram (com cara de pergunta ou de pedido), as mais recentes.
      db.query<{ texto: string }>(
        `SELECT texto FROM comercial.mensagens
        WHERE conta_id = ${C} AND direcao = 'recebida' AND criado_em > now() - interval '90 days'
          AND length(texto) BETWEEN 12 AND 400 AND (texto LIKE '%?%' OR length(texto) >= 40)
        ORDER BY criado_em DESC LIMIT 150`,
      ),
      db.query<{ quadro: string; coluna: string; leads: number }>(
        `SELECT q.nome AS quadro, c.nome AS coluna, count(k.id)::int AS leads
         FROM comercial.quadros q JOIN comercial.quadro_colunas c ON c.quadro_id = q.id
         LEFT JOIN comercial.quadro_cartoes k ON k.coluna_id = c.id
        WHERE q.conta_id = ${C} GROUP BY q.nome, c.nome, c.ordem ORDER BY q.nome, c.ordem LIMIT 40`,
      ),
      db.query<{ texto: string }>(
        `SELECT concat_ws(' · ', resumo->>'resumo', resumo->>'proximoPasso') AS texto FROM comercial.ligacoes
        WHERE conta_id = ${C} AND resumo IS NOT NULL AND criado_em > now() - interval '90 days'
        ORDER BY criado_em DESC LIMIT 30`,
      ),
      db.query<{ texto: string }>(
        `SELECT resumo->>'resumo' AS texto FROM comercial.sala_sessoes
        WHERE conta_id = ${C} AND resumo IS NOT NULL AND iniciada_em > now() - interval '120 days'
        ORDER BY iniciada_em DESC LIMIT 20`,
      ),
    ]);
  const url = sitio.rows[0]?.site_url ?? null;
  // O Cérebro da empresa (quando ligado): o que ela já escreveu sobre si, valendo e sem restritos.
  const doCerebro = await segundoCerebro
    .trechosParaOTime(db, segundoCerebro.PERGUNTAS_DO_DOSSIE, { max: 15 })
    .catch(() => []);
  const site =
    comSite && url
      ? await lerSite(url, { timeoutMs: 12_000 })
          .then((s) => (s?.texto ? { url: s.urlFinal, texto: s.texto } : null))
          .catch(() => null)
      : null;
  return {
    empresa,
    atual,
    perfilIa,
    conhecimento: conhecimento.rows,
    site,
    nichos: nichos.rows.map((n) => n.nome),
    posts: await postsQueFuncionaram(db, 30),
    comentarios: comentarios.rows,
    mensagens: mensagens.rows.map((m) => m.texto),
    quadros: quadros.rows.filter((q) => q.leads > 0),
    ligacoes: ligacoes.rows.map((l) => l.texto).filter(Boolean),
    reunioes: reunioes.rows.map((r) => r.texto).filter(Boolean),
    segundoCerebro: doCerebro.map((t) => ({ titulo: `${t.codigo} ${t.titulo}`, texto: t.trecho })),
  };
}

/** As fontes que um fato do carrossel pode citar (a conferência do revisor procura o trecho nelas). */
export async function fontesParaOsFatos(
  db: Executor,
  d: {
    dossie: DossieMarca;
    empresa: string;
    divulgar: DivulgarEntrada | null;
    assunto: string;
    /** v148: as respostas às perguntas do time (fato confirmado por quem pediu). */
    respostas?: { pergunta: string; resposta: string }[];
    /** v149: o briefing da estrategista que quem pediu conferiu. */
    briefing?: string;
  },
): Promise<FonteDoTime[]> {
  const f: FonteDoTime[] = [{ rotulo: 'Cérebro da marca', texto: textoDoDossie(d.dossie, d.empresa) }];
  if (d.divulgar)
    f.push({
      rotulo: 'O que divulgar',
      texto: [
        `${ROTULO_DIVULGAR[d.divulgar.tipo]}: ${d.divulgar.titulo}`,
        d.divulgar.produto,
        d.divulgar.detalhes,
        ...camposExatos(d.divulgar).map((c) => `${c.rotulo}: ${c.valor}`),
        d.divulgar.condicoes,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  if (d.assunto.trim()) f.push({ rotulo: 'Pedido de quem criou', texto: d.assunto });
  if (d.respostas?.length)
    f.push({
      rotulo: 'Respostas de quem pediu',
      texto: d.respostas.map((r) => `${r.pergunta}: ${r.resposta}`).join('\n'),
    });
  if (d.briefing?.trim()) f.push({ rotulo: 'Briefing conferido por quem pediu', texto: d.briefing });
  const { perfil, conferidas } = await lerPerfil(db);
  if (Object.keys(conferidas).length) f.push(...fontesDoPerfil(perfil, d.empresa));
  // O Cérebro da empresa (quando ligado): o assunto do pedido e o que divulgar viram perguntas.
  const perguntas = [
    d.assunto,
    d.divulgar ? [d.divulgar.titulo, d.divulgar.produto].filter(Boolean).join(' ') : '',
  ];
  f.push(...(await segundoCerebro.fontesParaOTime(db, perguntas, { max: 6 }).catch(() => [])));
  return f;
}
