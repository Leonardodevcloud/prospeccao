import { cifrar, decifrar, type Executor, type Pool } from '@prospeccao/db';
import type { FonteDoTime } from '@prospeccao/integrations/carrosseis';
import {
  type ClienteDoCerebro,
  clienteDoCerebro,
  ErroDoCerebro,
  enderecoDaApi,
  type TrechoDoCerebro,
} from '@prospeccao/integrations/segundo-cerebro';
import { AppError, type Logger } from '@prospeccao/shared';
import { contaSql, usuarioAtual } from '../../contexto.js';
import { paraCadaConta } from '../../rotinas.js';
import { nomeDaEmpresa, postsQueFuncionaram } from '../carrosseis/cerebro.js';
import { chaveDeCifra } from '../instagram/servico.js';

/**
 * Segundo cérebro (v147): a conta liga o Prospect Team ao Cérebro da empresa (outro sistema).
 *  - Os agentes de carrosséis, cards, ideias e vídeos leem o que está valendo lá (o Cérebro já tira
 *    restritos e rascunhos e mascara e-mail, CPF, telefone…). Falhou? O time segue sem: nunca trava.
 *  - O que o time aprendeu no Instagram volta para lá como rascunho, uma vez por semana (ou no botão).
 */

let redeLocal = false;
/** Só nos testes: o "Cérebro" de mentira roda na própria máquina, por http. */
export function permitirRedeLocal(v: boolean): void {
  redeLocal = v;
}

export interface EstadoDoCerebro {
  conectado: boolean;
  url: string | null;
  tokenFinal: string | null;
  usuarioNoCerebro: string | null;
  ligado: boolean;
  enviarAprendizados: boolean;
  testadoEm: string | null;
  erro: string | null;
  erroEm: string | null;
  ultimaLeituraEm: string | null;
  leituras: number;
  ultimoEnvio: { em: string; codigo: string | null; link: string | null } | null;
}

type Linha = {
  url: string;
  token_cifrado: string;
  token_final: string;
  usuario_no_cerebro: string | null;
  ligado: boolean;
  enviar_aprendizados: boolean;
  testado_em: Date | null;
  erro: string | null;
  erro_em: Date | null;
  ultima_leitura_em: Date | null;
  leituras: number;
  ultimo_envio_em: Date | null;
  ultimo_envio_codigo: string | null;
  ultimo_envio_link: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function linha(db: Executor): Promise<Linha | null> {
  const { rows } = await db.query<Linha>(
    `SELECT url, token_cifrado, token_final, usuario_no_cerebro, ligado, enviar_aprendizados, testado_em,
            erro, erro_em, ultima_leitura_em, leituras, ultimo_envio_em, ultimo_envio_codigo, ultimo_envio_link
       FROM comercial.segundo_cerebro WHERE conta_id = ${contaSql()}`,
  );
  return rows[0] ?? null;
}

export async function estado(db: Executor): Promise<EstadoDoCerebro> {
  const l = await linha(db);
  return {
    conectado: !!l,
    url: l?.url ?? null,
    tokenFinal: l?.token_final ?? null,
    usuarioNoCerebro: l?.usuario_no_cerebro ?? null,
    ligado: l?.ligado ?? false,
    enviarAprendizados: l?.enviar_aprendizados ?? true,
    testadoEm: iso(l?.testado_em ?? null),
    erro: l?.erro ?? null,
    erroEm: iso(l?.erro_em ?? null),
    ultimaLeituraEm: iso(l?.ultima_leitura_em ?? null),
    leituras: l?.leituras ?? 0,
    ultimoEnvio: l?.ultimo_envio_em
      ? { em: l.ultimo_envio_em.toISOString(), codigo: l.ultimo_envio_codigo, link: l.ultimo_envio_link }
      : null,
  };
}

function exigirChave(): string {
  const chave = chaveDeCifra();
  if (!chave)
    throw AppError.invalido(
      'Falta a CHAVE_CREDENCIAIS na api para guardar o token do Cérebro. Fale com o suporte.',
    );
  return chave;
}

const cliente = (url: string, token: string): ClienteDoCerebro =>
  clienteDoCerebro({ url, token }, { redeLocal });

/** Cliente da conta (só se ligada). Token que não abre mais: null. */
async function clienteDaConta(db: Executor): Promise<ClienteDoCerebro | null> {
  const l = await linha(db);
  const chave = chaveDeCifra();
  if (!l?.ligado || !chave) return null;
  try {
    return cliente(l.url, decifrar(chave, l.token_cifrado));
  } catch {
    return null;
  }
}

async function anotarErro(db: Executor, erro: unknown): Promise<void> {
  const msg = erro instanceof ErroDoCerebro ? erro.message : 'Falha ao falar com o Cérebro.';
  await db
    .query(`UPDATE comercial.segundo_cerebro SET erro = $1, erro_em = now() WHERE conta_id = ${contaSql()}`, [
      msg.slice(0, 300),
    ])
    .catch(() => undefined);
}

const paraErroDaTela = (erro: unknown): never => {
  if (erro instanceof ErroDoCerebro) throw AppError.invalido(erro.message);
  throw erro;
};

/** Testa e, se o Cérebro aceitar, guarda (o token fica cifrado; a tela só vê os 4 últimos). */
export async function conectar(db: Executor, d: { url: string; token: string }): Promise<EstadoDoCerebro> {
  const chave = exigirChave();
  let url: string;
  try {
    url = enderecoDaApi(d.url);
  } catch (erro) {
    return paraErroDaTela(erro);
  }
  const token = d.token.trim();
  if (!/^cbr_[A-Za-z0-9_-]{16,200}$/.test(token))
    throw AppError.invalido(
      'O token do Cérebro começa com cbr_. Gere em Integrações › Outros sistemas, no Cérebro.',
    );
  const quem = await cliente(url, token).testar().catch(paraErroDaTela);
  await db.query(
    `INSERT INTO comercial.segundo_cerebro (conta_id, url, token_cifrado, token_final, usuario_no_cerebro, testado_em, criado_por)
     VALUES (${contaSql()}, $1, $2, $3, $4, now(), $5)
     ON CONFLICT (conta_id) DO UPDATE
       SET url = EXCLUDED.url, token_cifrado = EXCLUDED.token_cifrado, token_final = EXCLUDED.token_final,
           usuario_no_cerebro = EXCLUDED.usuario_no_cerebro, testado_em = now(), ligado = true,
           erro = NULL, erro_em = NULL, atualizado_em = now()`,
    [url, cifrar(chave, token), token.slice(-4), quem.usuario.nome.slice(0, 120), usuarioAtual()?.id ?? null],
  );
  return estado(db);
}

/** O botão Testar: confere de novo o que está guardado. */
export async function testar(db: Executor): Promise<EstadoDoCerebro> {
  const l = await linha(db);
  if (!l) throw AppError.invalido('Conecte o Cérebro primeiro.');
  const chave = exigirChave();
  let token: string;
  try {
    token = decifrar(chave, l.token_cifrado);
  } catch {
    throw AppError.invalido('O token guardado não abre mais. Cole o token de novo.');
  }
  try {
    const quem = await cliente(l.url, token).testar();
    await db.query(
      `UPDATE comercial.segundo_cerebro SET testado_em = now(), usuario_no_cerebro = $1, erro = NULL, erro_em = NULL
        WHERE conta_id = ${contaSql()}`,
      [quem.usuario.nome.slice(0, 120)],
    );
  } catch (erro) {
    await anotarErro(db, erro);
    paraErroDaTela(erro);
  }
  return estado(db);
}

export async function ajustar(
  db: Executor,
  d: { ligado?: boolean; enviarAprendizados?: boolean },
): Promise<EstadoDoCerebro> {
  const { rowCount } = await db.query(
    `UPDATE comercial.segundo_cerebro
        SET ligado = coalesce($1, ligado), enviar_aprendizados = coalesce($2, enviar_aprendizados), atualizado_em = now()
      WHERE conta_id = ${contaSql()}`,
    [d.ligado ?? null, d.enviarAprendizados ?? null],
  );
  if (!rowCount) throw AppError.invalido('Conecte o Cérebro primeiro.');
  return estado(db);
}

export async function desconectar(db: Executor): Promise<void> {
  await db.query(`DELETE FROM comercial.segundo_cerebro WHERE conta_id = ${contaSql()}`);
}

/* ───────────────────────────── O time lendo o Cérebro ───────────────────────────── */

export const ROTULO_FONTE = 'Segundo cérebro';

/** Rótulo de cada trecho como fonte do time (o revisor procura o trecho citado nela). */
export const rotuloDoTrecho = (t: TrechoDoCerebro) => `${ROTULO_FONTE} · ${t.codigo} ${t.titulo}`;

/**
 * Busca as perguntas no Cérebro (em paralelo) e junta sem repetir registro. Sem conexão, ligação
 * desligada ou Cérebro fora do ar: lista vazia (e o erro fica na tela de Integrações).
 */
export async function trechosParaOTime(
  db: Executor,
  perguntas: string[],
  o: { max?: number; area?: string } = {},
): Promise<TrechoDoCerebro[]> {
  const c = await clienteDaConta(db).catch(() => null);
  const lista = [
    ...new Set(perguntas.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length >= 3)),
  ].slice(0, 5);
  if (!c || !lista.length) return [];
  const vistos = new Set<string>();
  const saida: TrechoDoCerebro[] = [];
  let falhou: unknown = null;
  const respostas = await Promise.all(
    lista.map((p) =>
      c.buscar(p, { area: o.area, limite: 4 }).catch((erro) => {
        falhou = erro;
        return [] as TrechoDoCerebro[];
      }),
    ),
  );
  for (const r of respostas)
    for (const t of r) {
      if (vistos.has(t.codigo)) continue;
      vistos.add(t.codigo);
      saida.push(t);
    }
  if (falhou && !saida.length) await anotarErro(db, falhou);
  else
    await db
      .query(
        `UPDATE comercial.segundo_cerebro
            SET ultima_leitura_em = now(), leituras = leituras + 1, erro = NULL, erro_em = NULL
          WHERE conta_id = ${contaSql()}`,
      )
      .catch(() => undefined);
  return saida.slice(0, o.max ?? 8);
}

/** As fontes do time vindas do Cérebro (uma por registro). */
export async function fontesParaOTime(
  db: Executor,
  perguntas: string[],
  o: { max?: number } = {},
): Promise<FonteDoTime[]> {
  const t = await trechosParaOTime(db, perguntas, o).catch(() => [] as TrechoDoCerebro[]);
  return t.map((x) => ({
    rotulo: rotuloDoTrecho(x),
    texto: `${x.tipoNome}${x.emRevisao ? ' (em revisão: confirme antes de afirmar)' : ''}\n${x.trecho}`,
  }));
}

/** O mesmo em texto corrido (para os prompts que recebem um bloco só: vídeo, ideias). */
export async function textoParaOTime(db: Executor, perguntas: string[], max = 6): Promise<string> {
  const t = await trechosParaOTime(db, perguntas, { max }).catch(() => [] as TrechoDoCerebro[]);
  return t
    .map(
      (x) =>
        `- ${x.codigo} ${x.titulo}${x.emRevisao ? ' (em revisão)' : ''}: ${x.trecho.replace(/\s+/g, ' ').slice(0, 700)}`,
    )
    .join('\n');
}

/** Para o rascunho do cérebro da marca: o que a empresa já escreveu sobre si no Cérebro. */
export const PERGUNTAS_DO_DOSSIE = [
  'o que a empresa vende, produtos e serviços',
  'diferenciais da empresa, prazos e garantias',
  'clientes, público e segmentos atendidos',
  'tom de voz, marca e comunicação',
  'regras comerciais, políticas e o que não prometer',
];

/* ───────────────────────────── O que o time aprendeu volta para o Cérebro ───────────────────────────── */

/** Semana ISO (2026-W46): o mesmo envio na mesma semana não duplica no Cérebro. */
export function semanaIso(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((t.getTime() - inicio.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

export interface Aprendido {
  aprendizados: { linha: string }[];
  melhorHorario: { texto: string; posts: number } | null;
  preferencias: { texto: string }[];
  posts: number;
  doCrm: number;
}

/** O texto da nota (Markdown) com o que o Instagram ensinou. Sem nada para contar: null. */
export function notaDosAprendizados(
  empresa: string,
  a: Aprendido,
  melhores: {
    tipo: string;
    alcance: number;
    salvos: number;
    compartilhamentos: number;
    leads: number;
    legenda: string;
  }[],
  agora = new Date(),
): { titulo: string; conteudo: string } | null {
  if (!a.aprendizados.length && !a.preferencias.length && !melhores.length) return null;
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(
    agora,
  );
  const partes = [
    `O que o Instagram da ${empresa} ensinou até ${data}, calculado pelo Prospect Team com os números de ${a.posts} post(s) dos últimos 180 dias (${a.doCrm} feitos no Prospect Team). Cada número é comparado com a mediana da própria conta.`,
    a.aprendizados.length
      ? `## O que funcionou e o que não funcionou\n${a.aprendizados.map((x) => `- ${x.linha}`).join('\n')}`
      : '',
    a.melhorHorario
      ? `## Melhor horário para postar\n- ${a.melhorHorario.texto} (${a.melhorHorario.posts} posts)`
      : '',
    a.preferencias.length
      ? `## O que quem publica sempre muda nos textos do time\n${a.preferencias.map((p) => `- ${p.texto}`).join('\n')}`
      : '',
    melhores.length
      ? `## Posts que mais trouxeram resultado\n${melhores
          .map(
            (p) =>
              `- [${p.tipo}] alcance ${p.alcance}, ${p.salvos} salvos, ${p.compartilhamentos} compartilhamentos, ${p.leads} leads: "${p.legenda.replace(/\s+/g, ' ').slice(0, 220)}"`,
          )
          .join('\n')}`
      : '',
    'Gerado automaticamente. Aprove em Revisar se valer como referência para a equipe; o Prospect Team manda uma nota nova por semana.',
  ];
  return {
    titulo: `Aprendizados do Instagram — ${empresa} — semana ${semanaIso(agora)}`,
    conteudo: partes.filter(Boolean).join('\n\n'),
  };
}

/**
 * Manda o que o time aprendeu como rascunho. Semana sem nada para contar não manda.
 * `aprendido` vem de carrosseis/aprender.ts (passado por quem chama, para não haver import circular).
 */
export async function enviarAprendizados(
  db: Executor,
  aprendido: () => Promise<Aprendido>,
): Promise<{ enviado: boolean; motivo?: string; codigo?: string; link?: string; jaExistia?: boolean }> {
  const c = await clienteDaConta(db);
  if (!c) return { enviado: false, motivo: 'O Cérebro não está conectado ou está desligado.' };
  const [empresa, a, melhores] = await Promise.all([
    nomeDaEmpresa(db),
    aprendido(),
    postsQueFuncionaram(db, 5),
  ]);
  const nota = notaDosAprendizados(empresa, a, melhores);
  if (!nota)
    return {
      enviado: false,
      motivo: 'Ainda não há números do Instagram suficientes para contar o que funcionou.',
    };
  try {
    const r = await c.guardarRascunho({
      tipo: 'nota',
      area: 'marketing',
      titulo: nota.titulo,
      conteudo: nota.conteudo,
      idExterno: `aprendizados-${contaSql()}-${semanaIso(new Date())}`,
    });
    await db.query(
      `UPDATE comercial.segundo_cerebro
          SET ultimo_envio_em = now(), ultimo_envio_codigo = $1, ultimo_envio_link = $2, erro = NULL, erro_em = NULL
        WHERE conta_id = ${contaSql()}`,
      [r.codigo?.slice(0, 20) ?? null, r.link?.slice(0, 500) ?? null],
    );
    return { enviado: true, codigo: r.codigo, link: r.link, jaExistia: r.jaExistia };
  } catch (erro) {
    await anotarErro(db, erro);
    if (erro instanceof ErroDoCerebro) return { enviado: false, motivo: erro.message };
    throw erro;
  }
}

/** A rotina: de 6 em 6 horas, manda para quem ligou e ainda não mandou nos últimos 7 dias. */
export function iniciarSegundoCerebro(deps: {
  pool: Pool;
  log: Logger;
  aprendido: (db: Executor) => Promise<Aprendido>;
}): () => void {
  const rodar = () =>
    void paraCadaConta(deps.pool, deps.log, 'segundo-cerebro', async () => {
      const { rows } = await deps.pool.query<{ vez: boolean }>(
        `SELECT (ultimo_envio_em IS NULL OR ultimo_envio_em < now() - interval '7 days') AS vez
           FROM comercial.segundo_cerebro WHERE conta_id = ${contaSql()} AND ligado AND enviar_aprendizados`,
      );
      if (!rows[0]?.vez) return;
      const r = await enviarAprendizados(deps.pool, () => deps.aprendido(deps.pool));
      if (r.enviado) deps.log.info({ codigo: r.codigo }, 'segundo-cerebro: aprendizados enviados');
    }).catch((e) => deps.log.warn({ err: e }, 'segundo-cerebro: rodada falhou'));
  const t = setInterval(rodar, 6 * 3_600_000);
  t.unref();
  return () => clearInterval(t);
}
