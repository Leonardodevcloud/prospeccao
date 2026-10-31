import { cifrar, decifrar, type Executor, type Pool } from '@prospeccao/db';
import {
  AppError,
  campoSugerido,
  comentarioBate,
  comNome,
  indicacoesNoTexto,
  interesseDoComentario,
  type Logger,
  leadDoCadastro,
  type PerguntaFormulario,
  PRAZO_RESPOSTA_PRIVADA_DIAS,
} from '@prospeccao/shared';
import { comConta, conta, contaSql, usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { temRecurso } from '../../recursos.js';
import * as agente from '../agente/repositorio.js';
import * as contatos from '../contatos/repositorio.js';
import { pararSequencia } from '../email/sequencia.js';
import { dadosDoLead } from '../funil/cadencia.js';
import { criarLeadManual, LeadExistente } from '../funil/novoLead.js';
import * as funil from '../funil/repositorio.js';
import { notificar, notificarDono } from '../notificacoes/repositorio.js';
import { janelaDoDirect } from './canal.js';
import { type ClienteMeta, ErroMeta, type PublicacaoMeta } from './meta.js';

/**
 * Instagram no CRM: a conexão da conta, o "comente e receba", os cadastros dos formulários dos
 * anúncios e o direct como canal da conversa. Os avisos da Meta (webhook) chegam sem conta: a
 * conta sai do id do Instagram ou da página.
 */

/* ───────────────────────── A Meta e a chave (definidas na subida da api) ───────────────────────── */

let metaAtual: ClienteMeta | null = null;
let chaveAtual: string | null = null;

export function definirMeta(meta: ClienteMeta | null, chave: string | null): void {
  metaAtual = meta;
  chaveAtual = chave;
}

export function meta(): ClienteMeta | null {
  return metaAtual;
}

function exigirMeta(): ClienteMeta {
  if (!metaAtual)
    throw AppError.invalido(
      'A integração com o Instagram ainda não foi liberada na plataforma. Fale com o suporte do Prospect Team.',
    );
  return metaAtual;
}

/* ───────────────────────── Conexão ───────────────────────── */

export interface Conexao {
  contaId: number;
  igId: string;
  usuario: string | null;
  paginaId: string;
  token: string;
  mensagensBloqueadas: boolean;
  directNovo: 'lead' | 'ignorar';
}

type LinhaConexao = {
  conta_id: number;
  ig_id: string | null;
  ig_usuario: string | null;
  pagina_id: string | null;
  token_cifrado: string | null;
  mensagens_bloqueadas: boolean;
  direct_novo: 'lead' | 'ignorar';
};

function paraConexao(l: LinhaConexao | undefined): Conexao | null {
  if (!l?.ig_id || !l.pagina_id || !l.token_cifrado || !chaveAtual) return null;
  try {
    return {
      contaId: l.conta_id,
      igId: l.ig_id,
      usuario: l.ig_usuario,
      paginaId: l.pagina_id,
      token: decifrar(chaveAtual, l.token_cifrado),
      mensagensBloqueadas: l.mensagens_bloqueadas,
      directNovo: l.direct_novo,
    };
  } catch {
    return null;
  }
}

const COLUNAS = 'conta_id, ig_id, ig_usuario, pagina_id, token_cifrado, mensagens_bloqueadas, direct_novo';

export async function conexaoDaConta(db: Executor): Promise<Conexao | null> {
  const { rows } = await db.query<LinhaConexao>(
    `SELECT ${COLUNAS} FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`,
  );
  return paraConexao(rows[0]);
}

async function exigirConexao(db: Executor): Promise<{ m: ClienteMeta; c: Conexao }> {
  const m = exigirMeta();
  const c = await conexaoDaConta(db);
  if (!c) throw AppError.invalido('Conecte o Instagram da empresa primeiro (aba Conexão).');
  return { m, c };
}

async function conexaoPor(db: Executor, coluna: 'ig_id' | 'pagina_id', id: string): Promise<Conexao | null> {
  const { rows } = await db.query<LinhaConexao>(
    `SELECT ${COLUNAS} FROM comercial.instagram_contas ic JOIN cadastro.contas c ON c.id = ic.conta_id
      WHERE ic.${coluna} = $1 AND c.ativa LIMIT 1`,
    [id],
  );
  return paraConexao(rows[0]);
}

/** O que a tela mostra da conexão (sem o token). */
export async function situacao(db: Executor) {
  const { rows } = await db.query(
    `SELECT ig_id AS "igId", ig_usuario AS usuario, ig_nome AS nome, ig_seguidores AS seguidores, ig_foto AS foto,
            pagina_id AS "paginaId", pagina_nome AS "paginaNome", conectado_em AS "conectadoEm",
            mensagens_bloqueadas AS "mensagensBloqueadas", erro, erro_em AS "erroEm", direct_novo AS "directNovo",
            opcoes_cifradas IS NOT NULL AND ig_id IS NULL AS escolher
       FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`,
  );
  const l = rows[0] as Record<string, unknown> | undefined;
  let opcoes: { paginaId: string; paginaNome: string; usuario: string | null; seguidores: number | null }[] =
    [];
  if (l?.escolher) opcoes = (await opcoesGuardadas(db)).map(paraOpcaoDaTela);
  return {
    configurado: !!metaAtual,
    conexao: l?.igId ? l : null,
    escolher: l?.escolher ? opcoes : null,
    directNovo: (l?.directNovo as string | undefined) ?? 'lead',
  };
}

interface OpcaoPagina {
  paginaId: string;
  paginaNome: string;
  token: string;
  ig: {
    id: string;
    usuario: string | null;
    nome: string | null;
    seguidores: number | null;
    foto: string | null;
  };
}

const paraOpcaoDaTela = (o: OpcaoPagina) => ({
  paginaId: o.paginaId,
  paginaNome: o.paginaNome,
  usuario: o.ig.usuario,
  seguidores: o.ig.seguidores,
});

async function opcoesGuardadas(db: Executor): Promise<OpcaoPagina[]> {
  const { rows } = await db.query<{ o: string | null }>(
    `SELECT opcoes_cifradas AS o FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`,
  );
  if (!rows[0]?.o || !chaveAtual) return [];
  try {
    return JSON.parse(decifrar(chaveAtual, rows[0].o)) as OpcaoPagina[];
  } catch {
    return [];
  }
}

/** Depois do login na Meta: guarda a conta (ou as opções, quando a pessoa liberou mais de uma). */
export async function concluirLogin(
  deps: { pool: Pool; log: Logger },
  codigo: string,
  redirect: string,
  usuarioId: number | null,
): Promise<'conectado' | 'escolher'> {
  const m = exigirMeta();
  if (!chaveAtual) throw AppError.invalido('Configure CHAVE_CREDENCIAIS na api para guardar a conexão.');
  const tokenPessoa = await m.trocarCodigo(codigo, redirect);
  const paginas = (await m.paginas(tokenPessoa)).filter((p) => p.instagram);
  if (!paginas.length)
    throw AppError.invalido(
      'Nenhuma conta profissional do Instagram ligada a uma página do Facebook foi liberada. Confira se o Instagram é conta comercial ou de criador e está ligado à página da empresa.',
    );
  const opcoes: OpcaoPagina[] = paginas.map((p) => ({
    paginaId: p.id,
    paginaNome: p.nome,
    token: p.token,
    ig: {
      id: p.instagram!.id,
      usuario: p.instagram!.usuario,
      nome: p.instagram!.nome,
      seguidores: p.instagram!.seguidores,
      foto: p.instagram!.foto,
    },
  }));
  if (opcoes.length === 1) {
    await salvarConexao(deps, opcoes[0]!, usuarioId);
    return 'conectado';
  }
  await deps.pool.query(
    `INSERT INTO comercial.instagram_contas (conta_id, opcoes_cifradas, conectado_por)
     VALUES (${contaSql()}, $1, $2)
     ON CONFLICT (conta_id) DO UPDATE SET opcoes_cifradas = EXCLUDED.opcoes_cifradas,
       conectado_por = EXCLUDED.conectado_por, atualizado_em = now()`,
    [cifrar(chaveAtual, JSON.stringify(opcoes)), usuarioId],
  );
  return 'escolher';
}

export async function escolherPagina(deps: { pool: Pool; log: Logger }, paginaId: string): Promise<void> {
  const o = (await opcoesGuardadas(deps.pool)).find((x) => x.paginaId === paginaId);
  if (!o) throw AppError.naoEncontrado('Conta do Instagram');
  await salvarConexao(deps, o, usuarioAtual()?.id ?? null);
}

async function salvarConexao(deps: { pool: Pool; log: Logger }, o: OpcaoPagina, usuarioId: number | null) {
  const m = exigirMeta();
  // O mesmo Instagram já está em outra conta do sistema: não liga em duas (os avisos iriam para uma só).
  const { rows: outra } = await deps.pool.query<{ nome: string }>(
    `SELECT c.nome FROM comercial.instagram_contas ic JOIN cadastro.contas c ON c.id = ic.conta_id
      WHERE ic.ig_id = $1 AND ic.conta_id <> ${contaSql()}`,
    [o.ig.id],
  );
  if (outra[0])
    throw AppError.conflito(
      `Este Instagram já está conectado na unidade ${outra[0].nome}. Desconecte lá antes de conectar aqui.`,
    );
  let erro: string | null = null;
  try {
    await m.assinarPagina(o.paginaId, o.token);
  } catch (e) {
    erro = `Não consegui ligar os avisos da página: ${(e as Error).message}`;
    deps.log.warn({ err: e }, 'instagram: falha ao assinar a página');
  }
  await deps.pool.query(
    `INSERT INTO comercial.instagram_contas
       (conta_id, ig_id, ig_usuario, ig_nome, ig_seguidores, ig_foto, pagina_id, pagina_nome, token_cifrado,
        opcoes_cifradas, conectado_em, conectado_por, mensagens_bloqueadas, erro, erro_em)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, NULL, now(), $9, false, $10, CASE WHEN $10::text IS NOT NULL THEN now() END)
     ON CONFLICT (conta_id) DO UPDATE SET ig_id = EXCLUDED.ig_id, ig_usuario = EXCLUDED.ig_usuario,
       ig_nome = EXCLUDED.ig_nome, ig_seguidores = EXCLUDED.ig_seguidores, ig_foto = EXCLUDED.ig_foto,
       pagina_id = EXCLUDED.pagina_id, pagina_nome = EXCLUDED.pagina_nome, token_cifrado = EXCLUDED.token_cifrado,
       opcoes_cifradas = NULL, conectado_em = now(), conectado_por = EXCLUDED.conectado_por,
       mensagens_bloqueadas = false, erro = EXCLUDED.erro, erro_em = EXCLUDED.erro_em, atualizado_em = now()`,
    [
      o.ig.id,
      o.ig.usuario,
      o.ig.nome,
      o.ig.seguidores,
      o.ig.foto,
      o.paginaId,
      o.paginaNome,
      cifrar(chaveAtual!, o.token),
      usuarioId,
      erro,
    ],
  );
}

export async function desconectar(deps: { pool: Pool; log: Logger }): Promise<void> {
  const c = await conexaoDaConta(deps.pool);
  if (c && metaAtual)
    await metaAtual
      .desassinarPagina(c.paginaId, c.token)
      .catch((e) => deps.log.warn({ err: e }, 'instagram: não consegui desligar os avisos da página'));
  await deps.pool.query(`DELETE FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`);
}

export async function salvarDirectNovo(db: Executor, modo: 'lead' | 'ignorar'): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.instagram_contas SET direct_novo = $1, atualizado_em = now() WHERE conta_id = ${contaSql()}`,
    [modo],
  );
  if (!rowCount) throw AppError.invalido('Conecte o Instagram primeiro.');
}

/** Atualiza seguidores e foto (a tela chama ao abrir, no máximo uma vez por hora). */
export async function atualizarPerfil(deps: { pool: Pool; log: Logger }): Promise<void> {
  const c = await conexaoDaConta(deps.pool);
  if (!c || !metaAtual) return;
  const { rows } = await deps.pool.query(
    `SELECT 1 FROM comercial.instagram_contas WHERE conta_id = ${contaSql()} AND atualizado_em > now() - interval '1 hour'`,
  );
  if (rows.length) return;
  try {
    const p = await metaAtual.contaInstagram(c.igId, c.token);
    await deps.pool.query(
      `UPDATE comercial.instagram_contas SET ig_usuario = $1, ig_nome = $2, ig_seguidores = $3, ig_foto = $4,
              erro = NULL, erro_em = NULL, atualizado_em = now()
        WHERE conta_id = ${contaSql()}`,
      [p.usuario, p.nome, p.seguidores, p.foto],
    );
  } catch (e) {
    await registrarErroDaMeta(deps.pool, e);
  }
}

/** Guarda o problema que a Meta respondeu (token vencido, mensagens bloqueadas) para a tela mostrar. */
export async function registrarErroDaMeta(db: Executor, e: unknown): Promise<void> {
  if (!(e instanceof ErroMeta)) return;
  if (e.mensagensBloqueadas)
    await db.query(
      `UPDATE comercial.instagram_contas SET mensagens_bloqueadas = true, atualizado_em = now() WHERE conta_id = ${contaSql()}`,
    );
  else if (e.tokenInvalido) {
    const { rowCount } = await db.query(
      `UPDATE comercial.instagram_contas SET erro = $1, erro_em = now(), atualizado_em = now()
        WHERE conta_id = ${contaSql()} AND erro IS DISTINCT FROM $1`,
      [ERRO_TOKEN],
    );
    if (rowCount)
      await avisarAdmins(
        db,
        'O Instagram desconectou',
        'A Meta não aceita mais o acesso (senha trocada ou permissão removida). Abra Instagram › Conexão e conecte de novo.',
      );
  }
}

const ERRO_TOKEN = 'A Meta não aceita mais o acesso (senha trocada ou permissão removida). Conecte de novo.';

/* ───────────────────────── Publicações ───────────────────────── */

export async function publicacoes(db: Executor): Promise<PublicacaoMeta[]> {
  const { m, c } = await exigirConexao(db);
  try {
    return await m.publicacoes(c.igId, c.token, 24);
  } catch (e) {
    await registrarErroDaMeta(db, e);
    throw AppError.invalido(`O Instagram não respondeu: ${(e as Error).message}`);
  }
}

/* ───────────────────────── Leads do Instagram ───────────────────────── */

export type DepsLead = Pick<DepsApi, 'pool' | 'filas' | 'log'>;

interface Destino {
  etapaId: number | null;
  responsavelId: number | null;
  etiquetas: string[];
  agente: boolean;
}

/** Cria o lead (sem enriquecimento) ou acha o que já tem o mesmo telefone. */
export async function criarLead(
  deps: DepsLead,
  d: {
    empresa: string;
    contato?: string | null;
    cargo?: string | null;
    telefone?: string | null;
    email?: string | null;
    cidade?: string | null;
    instagram?: string | null;
    observacao?: string | null;
  },
  destino: Destino,
  autor: string,
): Promise<{ empresaId: number; novo: boolean }> {
  const entrada = {
    empresa: d.empresa.slice(0, 160).padEnd(2, '.'),
    contato: d.contato ?? null,
    cargo: d.cargo ?? null,
    telefone: d.telefone ?? null,
    whatsapp: true,
    email: d.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) ? d.email.toLowerCase() : null,
    cidade: d.cidade ?? null,
    instagram: d.instagram ?? null,
    observacao: d.observacao ?? null,
    etapaId: destino.etapaId,
    responsavelId: destino.responsavelId,
    agente: destino.agente,
    enriquecer: false,
  };
  let r: { empresaId: number; jaExistia: boolean };
  try {
    r = await criarLeadManual(deps, entrada, autor);
  } catch (e) {
    if (e instanceof LeadExistente) {
      const empresaId = (e.detalhes as { empresaId: number }).empresaId;
      return { empresaId, novo: false };
    }
    // Telefone que não é brasileiro ou veio torto: cria sem ele e guarda o que veio na anotação.
    if (e instanceof AppError && entrada.telefone && /Telefone inválido/.test(e.message)) {
      r = await criarLeadManual(
        deps,
        {
          ...entrada,
          telefone: null,
          observacao: [entrada.observacao, `Telefone informado: ${entrada.telefone}`]
            .filter(Boolean)
            .join('\n'),
        },
        autor,
      );
    } else throw e;
  }
  if (!r.jaExistia && destino.etiquetas.length)
    await funil
      .atualizar(deps.pool, r.empresaId, { etiquetas: destino.etiquetas }, autor)
      .catch(() => undefined);
  return { empresaId: r.empresaId, novo: !r.jaExistia };
}

/** Você assumiu a conversa: a IA para de responder este lead. */
async function assumir(db: Executor, empresaId: number, motivo = 'Você assumiu a conversa.') {
  await db.query(
    `UPDATE comercial.oportunidades SET agente_pausa = $2
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND agente AND agente_pausa IS NULL`,
    [empresaId, motivo],
  );
}

/** Direct pela tela (Conversas). */
export async function enviarDirectDoTime(
  deps: Pick<DepsApi, 'pool' | 'log'>,
  empresaId: number,
  texto: string,
) {
  const { m, c } = await exigirConexao(deps.pool);
  const { rows } = await deps.pool.query<{ instagram_id: string | null }>(
    `SELECT instagram_id FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  const pessoa = rows[0]?.instagram_id;
  if (!pessoa) throw AppError.invalido('Este lead não conversou pelo Instagram.');
  const ate = await janelaDoDirect(deps.pool, empresaId);
  if (!ate || new Date(ate).getTime() < Date.now())
    throw AppError.invalido(
      'O Instagram só deixa responder no direct até 24 horas depois da última mensagem do lead. Siga pelo WhatsApp.',
    );
  let id: string | null;
  try {
    id = await m.enviarDirect(c.paginaId, pessoa, texto, c.token);
  } catch (e) {
    await registrarErroDaMeta(deps.pool, e);
    throw AppError.invalido(`O Instagram não aceitou a mensagem: ${(e as Error).message}`);
  }
  const quem = usuarioAtual();
  await agente.criarMensagem(deps.pool, {
    empresaId,
    direcao: 'enviada',
    texto,
    telefone: null,
    status: 'enviada',
    origem: 'humano',
    idExterno: id,
    usuarioId: quem?.id ?? null,
    canal: 'instagram',
    instagramId: pessoa,
  });
  await funil.registrarAtividade(
    deps.pool,
    empresaId,
    { tipo: 'instagram', direcao: 'enviada', texto },
    quem?.nome ?? 'sistema',
  );
  await assumir(deps.pool, empresaId);
}

/**
 * Respostas da IA e boas-vindas que esperam o envio pelo direct (o motor do agente chama, conta a
 * conta). Fora da janela de 24 h, a mensagem fica com erro e o time segue pelo WhatsApp.
 */
export async function enviarDirectsPendentes(pool: Pool, log: Logger): Promise<number> {
  const { rows } = await pool.query<{
    id: number;
    empresa_id: number;
    texto: string;
    instagram_id: string | null;
  }>(
    `SELECT id::int, empresa_id::int, texto, instagram_id FROM comercial.mensagens
      WHERE conta_id = ${contaSql()} AND status = 'aprovada' AND canal = 'instagram'
      ORDER BY criado_em, id LIMIT 10`,
  );
  if (!rows.length) return 0;
  if (!(await temRecurso(pool, 'instagram'))) return 0;
  const c = await conexaoDaConta(pool);
  let n = 0;
  for (const msg of rows) {
    const falhar = (erro: string) =>
      pool.query(`UPDATE comercial.mensagens SET status = 'erro', erro = $2 WHERE id = $1`, [msg.id, erro]);
    if (!c || !metaAtual || !msg.instagram_id) {
      await falhar('Instagram desconectado');
      continue;
    }
    const ate = await janelaDoDirect(pool, msg.empresa_id);
    if (!ate || new Date(ate).getTime() < Date.now()) {
      await falhar('Passou das 24 h do Instagram: siga pelo WhatsApp');
      continue;
    }
    try {
      const id = await metaAtual.enviarDirect(c.paginaId, msg.instagram_id, msg.texto, c.token);
      await pool.query(
        `UPDATE comercial.mensagens SET status = 'enviada', enviado_em = now(), id_externo = $2 WHERE id = $1`,
        [msg.id, id],
      );
      await funil.registrarAtividade(
        pool,
        msg.empresa_id,
        { tipo: 'instagram', direcao: 'enviada', texto: msg.texto },
        'agente',
      );
      n++;
    } catch (e) {
      await registrarErroDaMeta(pool, e);
      await falhar((e as Error).message.slice(0, 300));
      log.warn({ err: e, mensagem: msg.id }, 'instagram: falha ao enviar o direct');
    }
  }
  return n;
}

/* ───────────────────────── Avisos da Meta (webhook) ───────────────────────── */

interface AvisoMeta {
  object?: string;
  entry?: {
    id?: string;
    time?: number;
    changes?: { field?: string; value?: Record<string, unknown> }[];
    messaging?: MensagemWebhook[];
  }[];
}

interface MensagemWebhook {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: { type?: string }[];
  };
}

/** Processa o que a Meta mandou (cada parte separada: uma falha não derruba as outras). */
export async function processarAviso(deps: DepsLead, aviso: AvisoMeta): Promise<void> {
  for (const entrada of aviso.entry ?? []) {
    const id = String(entrada.id ?? '');
    if (!id) continue;
    const quando = paraData(entrada.time);
    const tarefas: (() => Promise<void>)[] = [];
    if (aviso.object === 'page')
      for (const ch of entrada.changes ?? [])
        if (ch.field === 'leadgen' && ch.value) tarefas.push(() => receberCadastro(deps, id, ch.value!));
    if (aviso.object === 'instagram') {
      for (const ch of entrada.changes ?? [])
        if (ch.field === 'comments' && ch.value)
          tarefas.push(() => receberComentario(deps, id, ch.value!, quando));
      for (const msg of entrada.messaging ?? []) tarefas.push(() => receberDirect(deps, id, msg));
    }
    for (const t of tarefas)
      await t().catch((e) =>
        deps.log.error({ err: e, objeto: aviso.object }, 'instagram: aviso da Meta falhou'),
      );
  }
}

/** Segundos ou milissegundos desde 1970 (a Meta usa os dois). */
function paraData(t: unknown): Date {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n > 1e12 ? n : n * 1000);
}

/* ───── Comentários ───── */

interface LinhaRegra {
  id: number;
  alvo: 'publicacao' | 'proxima' | 'todas';
  midia_id: string | null;
  palavras: string[];
  respostas: string[];
  mensagem: string;
  botao_texto: string | null;
  botao_link: string | null;
  criado_em: Date;
}

async function receberComentario(deps: DepsLead, igId: string, v: Record<string, unknown>, quando: Date) {
  const c = await conexaoPor(deps.pool, 'ig_id', igId);
  if (!c || !metaAtual) return;
  const m = metaAtual;
  const comentarioId = String(v.id ?? '');
  const texto = String(v.text ?? '');
  const de = (v.from ?? {}) as { id?: string; username?: string };
  const midiaId = String((v.media as { id?: string } | undefined)?.id ?? '');
  // O próprio perfil respondendo, resposta dentro de outro comentário ou aviso sem o essencial: ignora.
  if (!comentarioId || !de.id || !midiaId || de.id === c.igId || v.parent_id) return;
  await comConta(c.contaId, async () => {
    // Plano sem o Instagram (mudou de plano depois de conectar): os avisos não fazem nada.
    if (!(await temRecurso(deps.pool, 'instagram'))) return;
    // Todo comentário fica guardado para a análise do conteúdo (com a marca de interesse).
    await guardarComentario(deps.pool, {
      comentarioId,
      midiaId,
      pessoaId: de.id as string,
      usuario: de.username ?? null,
      texto,
      em: quando,
    });
    const { rows: regras } = await deps.pool.query<LinhaRegra>(
      `SELECT id::int, alvo, midia_id, palavras, respostas, mensagem, botao_texto, botao_link, criado_em
         FROM comercial.instagram_regras
        WHERE conta_id = ${contaSql()} AND ligada
          AND ((alvo = 'publicacao' AND midia_id = $1) OR (alvo = 'proxima' AND midia_id IS NULL) OR alvo = 'todas')
        ORDER BY CASE alvo WHEN 'publicacao' THEN 0 WHEN 'proxima' THEN 1 ELSE 2 END, id`,
      [midiaId],
    );
    if (!regras.length) return;
    // "A próxima que eu postar": a primeira publicação depois da regra fica sendo a dela.
    const proximas = regras.filter((r) => r.alvo === 'proxima');
    if (proximas.length) {
      const pub = await m.publicacao(midiaId, c.token).catch(() => null);
      for (const r of proximas)
        if (pub?.em && new Date(pub.em) > r.criado_em) {
          await guardarPublicacao(deps.pool, r.id, pub, 'publicacao');
          r.alvo = 'publicacao';
          r.midia_id = midiaId;
        }
    }
    const regra = regras.find(
      (r) => (r.alvo !== 'proxima' || r.midia_id === midiaId) && comentarioBate(texto, r.palavras),
    );
    if (!regra) return;
    // A mesma pessoa já recebeu o direct desta regra: não manda de novo.
    const { rows: ja } = await deps.pool.query(
      `SELECT 1 FROM comercial.instagram_interacoes
        WHERE conta_id = ${contaSql()} AND regra_id = $1 AND pessoa_id = $2 AND direct = 'enviado' LIMIT 1`,
      [regra.id, de.id],
    );
    const foraDoPrazo = Date.now() - quando.getTime() > PRAZO_RESPOSTA_PRIVADA_DIAS * 86_400_000;
    const { rows: nova } = await deps.pool.query<{ id: number }>(
      `INSERT INTO comercial.instagram_interacoes
         (conta_id, regra_id, midia_id, comentario_id, pessoa_id, usuario, comentario, comentado_em, direct)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (conta_id, comentario_id) DO NOTHING RETURNING id::int`,
      [
        regra.id,
        midiaId,
        comentarioId,
        de.id,
        de.username ?? null,
        texto.slice(0, 2000),
        quando,
        ja.length ? 'repetido' : foraDoPrazo ? 'fora_do_prazo' : 'enviado',
      ],
    );
    const interacaoId = nova[0]?.id;
    if (!interacaoId || ja.length || foraDoPrazo) return;
    // O nome de quem comentou (se a Meta deixar ver antes da conversa), para o {nome}.
    const perfil = await m.perfil(de.id as string, c.token).catch(() => null);
    const nome = perfil?.nome ?? null;
    if (nome)
      await deps.pool.query('UPDATE comercial.instagram_interacoes SET nome = $2 WHERE id = $1', [
        interacaoId,
        nome,
      ]);
    try {
      await m.respostaPrivada(
        c.paginaId,
        comentarioId,
        {
          texto: comNome(regra.mensagem, nome),
          botao:
            regra.botao_texto && regra.botao_link
              ? { texto: regra.botao_texto, link: regra.botao_link }
              : null,
        },
        c.token,
      );
    } catch (e) {
      await registrarErroDaMeta(deps.pool, e);
      await deps.pool.query(
        `UPDATE comercial.instagram_interacoes SET direct = 'erro', direct_erro = $2 WHERE id = $1`,
        [interacaoId, (e as Error).message.slice(0, 300)],
      );
      deps.log.warn({ err: e, regra: regra.id }, 'instagram: o direct do comentário não foi');
      return;
    }
    if (regra.respostas.length) {
      const frase = regra.respostas[Math.floor(Math.random() * regra.respostas.length)]!;
      try {
        await m.responderComentario(comentarioId, comNome(frase, nome), c.token);
        await deps.pool.query(
          'UPDATE comercial.instagram_interacoes SET resposta_publica = true WHERE id = $1',
          [interacaoId],
        );
      } catch (e) {
        deps.log.warn({ err: e, regra: regra.id }, 'instagram: a resposta no comentário não foi');
      }
    }
  });
}

/** Guarda o comentário (o que já existe fica como está). */
export async function guardarComentario(
  db: Executor,
  c: {
    comentarioId: string;
    midiaId: string;
    pessoaId: string | null;
    usuario: string | null;
    texto: string;
    em: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO comercial.instagram_comentarios (conta_id, comentario_id, midia_id, pessoa_id, usuario, texto, comentado_em, interesse, empresa_id)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7,
             (SELECT empresa_id FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND instagram_id = $3))
     ON CONFLICT (conta_id, comentario_id) DO NOTHING`,
    [
      c.comentarioId,
      c.midiaId,
      c.pessoaId,
      c.usuario,
      c.texto.slice(0, 2000),
      c.em,
      interesseDoComentario(c.texto),
    ],
  );
}

export async function guardarPublicacao(
  db: Executor,
  regraId: number,
  p: PublicacaoMeta,
  alvo: 'publicacao' | null = null,
): Promise<void> {
  await db.query(
    `UPDATE comercial.instagram_regras
        SET midia_id = $2, midia_legenda = $3, midia_tipo = $4, midia_link = $5, midia_imagem = $6, midia_em = $7,
            alvo = coalesce($8, alvo)
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [regraId, p.id, p.legenda?.slice(0, 2000) ?? null, p.tipo, p.link, p.imagem, p.em, alvo],
  );
}

/* ───── Direct ───── */

const ROTULO_ANEXO: Record<string, string> = {
  image: '[foto]',
  video: '[vídeo]',
  audio: '[áudio]',
  file: '[arquivo]',
  share: '[publicação compartilhada]',
  story_mention: '[mencionou você no story]',
  ig_reel: '[reels compartilhado]',
  reel: '[reels compartilhado]',
};

async function receberDirect(deps: DepsLead, igId: string, msg: MensagemWebhook) {
  const m = msg.message;
  if (!m?.mid || m.is_deleted) return;
  const c = await conexaoPor(deps.pool, 'ig_id', igId);
  if (!c) return;
  const texto =
    m.text?.trim() ||
    (m.attachments ?? []).map((a) => ROTULO_ANEXO[a.type ?? ''] ?? '[anexo]').join(' ') ||
    '[mensagem]';
  await comConta(c.contaId, async () => {
    // Plano sem o Instagram (mudou de plano depois de conectar): os avisos não fazem nada.
    if (!(await temRecurso(deps.pool, 'instagram'))) return;
    if (m.is_echo) {
      // Saiu da conta da empresa: se foi o sistema, já está na conversa; se foi alguém pelo app do
      // Instagram, entra no histórico e a IA para de responder este lead.
      const pessoa = msg.recipient?.id;
      if (!pessoa) return;
      const { rows: ja } = await deps.pool.query(
        `SELECT 1 FROM comercial.mensagens WHERE conta_id = ${contaSql()} AND id_externo = $1`,
        [m.mid],
      );
      if (ja.length) return;
      const lead = await leadDoInstagram(deps.pool, pessoa);
      if (!lead) return;
      // Pode ser o direct do "comente e receba" (a Meta devolve o eco antes de saber o id): ignora o igual.
      const { rows: auto } = await deps.pool.query(
        `SELECT 1 FROM comercial.mensagens WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND canal = 'instagram'
            AND direcao = 'enviada' AND texto = $2 AND criado_em > now() - interval '10 minutes' LIMIT 1`,
        [lead, texto],
      );
      if (auto.length) return;
      const id = await agente.criarMensagem(deps.pool, {
        empresaId: lead,
        direcao: 'enviada',
        texto,
        telefone: null,
        status: 'enviada',
        origem: 'humano',
        idExterno: m.mid,
        canal: 'instagram',
        instagramId: pessoa,
      });
      if (id) {
        await funil.registrarAtividade(
          deps.pool,
          lead,
          { tipo: 'instagram', direcao: 'enviada', texto },
          'você (Instagram)',
        );
        await assumir(deps.pool, lead, 'Você respondeu pelo Instagram.');
      }
      return;
    }
    const pessoa = msg.sender?.id;
    if (!pessoa || pessoa === c.igId) return;
    await receberDaPessoa(deps, c, pessoa, texto, m.mid!, paraData(msg.timestamp));
  });
}

export async function leadDoInstagram(db: Executor, pessoa: string): Promise<number | null> {
  const { rows } = await db.query<{ empresa_id: number }>(
    `SELECT empresa_id::int FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND instagram_id = $1`,
    [pessoa],
  );
  return rows[0]?.empresa_id ?? null;
}

interface InteracaoPendente {
  id: number;
  regra_id: number | null;
  midia_id: string | null;
  comentario: string | null;
  comentado_em: Date;
  nome: string | null;
  usuario: string | null;
  direct: string;
  mensagem: string | null;
  ia_continua: boolean | null;
  avisar: boolean | null;
  etapa_id: number | null;
  responsavel_id: number | null;
  etiquetas: string[] | null;
  midia_legenda: string | null;
  midia_link: string | null;
  midia_tipo: string | null;
}

async function receberDaPessoa(
  deps: DepsLead,
  c: Conexao,
  pessoa: string,
  texto: string,
  mid: string,
  quando: Date,
) {
  const { pool } = deps;
  const { rows: interacoes } = await pool.query<InteracaoPendente>(
    `UPDATE comercial.instagram_interacoes i SET respondeu_em = coalesce(i.respondeu_em, $2)
       FROM comercial.instagram_interacoes x LEFT JOIN comercial.instagram_regras r ON r.id = x.regra_id
      WHERE i.id = x.id AND x.conta_id = ${contaSql()} AND x.pessoa_id = $1
      RETURNING x.id::int, x.regra_id::int, x.midia_id, x.comentario, x.comentado_em, x.nome, x.usuario, x.direct,
                coalesce(x.mensagem, r.mensagem) AS mensagem, r.ia_continua, r.avisar, r.etapa_id, r.responsavel_id, r.etiquetas,
                r.midia_legenda, r.midia_link, r.midia_tipo`,
    [pessoa, quando],
  );
  // A interação mais recente decide (a regra da última publicação em que comentou).
  const ultima = interacoes.sort((a, b) => b.comentado_em.getTime() - a.comentado_em.getTime())[0] ?? null;
  let empresaId = await leadDoInstagram(pool, pessoa);
  const achados = indicacoesNoTexto(texto);
  const telefone = achados[0]?.telefone ?? null;
  let novo = false;
  let perfil: { nome: string | null; usuario: string | null } | null = null;
  if (!empresaId) {
    if (!ultima && c.directNovo === 'ignorar') return;
    perfil = metaAtual ? await metaAtual.perfil(pessoa, c.token).catch(() => null) : null;
    const nome = perfil?.nome ?? ultima?.nome ?? null;
    const usuario = perfil?.usuario ?? ultima?.usuario ?? null;
    const r = await criarLead(
      deps,
      {
        empresa: nome || (usuario ? `@${usuario}` : 'Contato do Instagram'),
        contato: nome,
        telefone,
        instagram: usuario ? `https://instagram.com/${usuario}` : null,
      },
      {
        etapaId: ultima?.etapa_id ?? null,
        responsavelId: ultima?.responsavel_id ?? null,
        etiquetas: ultima?.etiquetas?.length ? ultima.etiquetas : ['instagram'],
        agente: !!ultima?.ia_continua,
      },
      'Instagram',
    );
    empresaId = r.empresaId;
    novo = r.novo;
    const origem = ultima
      ? {
          tipo: 'comentario',
          regraId: ultima.regra_id,
          midiaId: ultima.midia_id,
          legenda: ultima.midia_legenda?.slice(0, 200) ?? null,
          link: ultima.midia_link,
          midiaTipo: ultima.midia_tipo,
          comentario: ultima.comentario?.slice(0, 300) ?? null,
        }
      : { tipo: 'direct' };
    await pool.query(
      `UPDATE comercial.oportunidades SET instagram_id = $2, instagram_usuario = $3,
              origem_instagram = coalesce(origem_instagram, $4::jsonb)
        WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [empresaId, pessoa, usuario, JSON.stringify(origem)],
    );
    if (ultima) {
      const onde = ultima.midia_legenda ? ` na publicação “${ultima.midia_legenda.slice(0, 60)}”` : '';
      await funil.registrarAtividade(
        pool,
        empresaId,
        { tipo: 'nota', direcao: null, texto: `Comentou “${ultima.comentario ?? ''}”${onde} no Instagram.` },
        'Instagram',
      );
      // O direct automático entra na conversa (antes da resposta dele).
      if (ultima.direct === 'enviado' && ultima.mensagem)
        await pool.query(
          `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, status, origem, canal, instagram_id,
                                            criado_em, enviado_em, lida_em, nota)
           VALUES (${contaSql()}, $1, 'enviada', $2, 'enviada', 'automatico', 'instagram', $3, $4, $4, $4, 'Comente e receba')`,
          [
            empresaId,
            comNome(ultima.mensagem, ultima.nome),
            pessoa,
            // Logo depois do comentário e sempre antes da resposta dele.
            new Date(Math.min(ultima.comentado_em.getTime() + 1000, quando.getTime() - 1000)),
          ],
        );
    }
  }
  await pool.query(
    `UPDATE comercial.instagram_interacoes SET empresa_id = $2 WHERE conta_id = ${contaSql()} AND pessoa_id = $1`,
    [pessoa, empresaId],
  );
  await pool.query(
    `UPDATE comercial.instagram_comentarios SET empresa_id = $2
      WHERE conta_id = ${contaSql()} AND pessoa_id = $1 AND empresa_id IS NULL`,
    [pessoa, empresaId],
  );
  const msgId = await agente.criarMensagem(pool, {
    empresaId,
    direcao: 'recebida',
    texto,
    telefone: null,
    status: 'recebida',
    origem: 'lead',
    idExterno: mid,
    canal: 'instagram',
    instagramId: pessoa,
  });
  if (!msgId) return; // a Meta mandou a mesma mensagem duas vezes
  await pararSequencia(pool, empresaId, 'Respondeu no Instagram');
  const quem = perfil?.nome ?? ultima?.nome ?? (ultima?.usuario ? `@${ultima.usuario}` : 'lead');
  await funil.registrarAtividade(pool, empresaId, { tipo: 'instagram', direcao: 'recebida', texto }, quem);
  // Telefone na mensagem: no lead novo já foi salvo; no que existia, vira sugestão de contato.
  if (!novo && achados.length)
    await contatos.sugerir(
      pool,
      empresaId,
      achados.map((a) => ({ ...a, evidencia: 'Mandou no direct do Instagram' })),
      msgId,
      null,
    );
  if (novo && telefone)
    await funil.registrarAtividade(
      pool,
      empresaId,
      { tipo: 'nota', direcao: null, texto: 'WhatsApp encontrado na mensagem do Instagram e salvo no lead.' },
      'Instagram',
    );
  const { rows } = await pool.query<{ nome: string; ia: boolean }>(
    `SELECT e.nome, (o.agente AND o.agente_pausa IS NULL) AS ia
       FROM descoberta.empresas e JOIN comercial.oportunidades o ON o.conta_id = ${contaSql()} AND o.empresa_id = e.id
      WHERE e.id = $1`,
    [empresaId],
  );
  const nomeLead = rows[0]?.nome ?? 'Lead';
  const avisar = ultima?.avisar ?? true;
  if (novo || avisar || !ultima)
    await notificarDono(pool, empresaId, {
      tipo: 'mensagem',
      titulo: novo
        ? `Lead novo do Instagram: ${nomeLead}${telefone ? ' (passou o WhatsApp)' : ''}`
        : `${nomeLead} mandou mensagem no Instagram${rows[0]?.ia ? ' (a IA está respondendo)' : ''}`,
      texto,
    });
}

/** "Criar lead" na lista da publicação: quem comentou e não respondeu, criado à mão. */
export async function criarLeadDaInteracao(deps: DepsLead, interacaoId: number): Promise<number> {
  const { rows } = await deps.pool.query<
    InteracaoPendente & { pessoa_id: string; empresa_id: number | null }
  >(
    `SELECT x.id::int, x.pessoa_id, x.empresa_id::int, x.usuario, x.nome, x.comentario, x.midia_id, x.regra_id::int,
            r.etapa_id, r.responsavel_id, r.etiquetas, r.midia_legenda, r.midia_link, r.midia_tipo
       FROM comercial.instagram_interacoes x LEFT JOIN comercial.instagram_regras r ON r.id = x.regra_id
      WHERE x.id = $1 AND x.conta_id = ${contaSql()}`,
    [interacaoId],
  );
  const x = rows[0];
  if (!x) throw AppError.naoEncontrado('Interação');
  const ja = x.empresa_id ?? (await leadDoInstagram(deps.pool, x.pessoa_id));
  if (ja) return ja;
  const { empresaId } = await criarLead(
    deps,
    {
      empresa: x.nome || (x.usuario ? `@${x.usuario}` : 'Contato do Instagram'),
      contato: x.nome,
      instagram: x.usuario ? `https://instagram.com/${x.usuario}` : null,
    },
    {
      etapaId: x.etapa_id,
      responsavelId: x.responsavel_id,
      etiquetas: x.etiquetas?.length ? x.etiquetas : ['instagram'],
      agente: false,
    },
    usuarioAtual()?.nome ?? 'Instagram',
  );
  await deps.pool.query(
    `UPDATE comercial.oportunidades SET instagram_id = $2, instagram_usuario = $3,
            origem_instagram = coalesce(origem_instagram, $4::jsonb)
      WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [
      empresaId,
      x.pessoa_id,
      x.usuario,
      JSON.stringify({
        tipo: 'comentario',
        regraId: x.regra_id,
        midiaId: x.midia_id,
        legenda: x.midia_legenda?.slice(0, 200) ?? null,
        link: x.midia_link,
        midiaTipo: x.midia_tipo,
        comentario: x.comentario?.slice(0, 300) ?? null,
      }),
    ],
  );
  await deps.pool.query(
    `UPDATE comercial.instagram_interacoes SET empresa_id = $2 WHERE conta_id = ${contaSql()} AND pessoa_id = $1`,
    [x.pessoa_id, empresaId],
  );
  await deps.pool.query(
    `UPDATE comercial.instagram_comentarios SET empresa_id = $2
      WHERE conta_id = ${contaSql()} AND pessoa_id = $1 AND empresa_id IS NULL`,
    [x.pessoa_id, empresaId],
  );
  await funil.registrarAtividade(
    deps.pool,
    empresaId,
    {
      tipo: 'nota',
      direcao: null,
      texto: `Comentou “${x.comentario ?? ''}” no Instagram (lead criado à mão).`,
    },
    usuarioAtual()?.nome ?? 'Instagram',
  );
  return empresaId;
}

/* ───── Formulários dos anúncios ───── */

interface LinhaFormulario {
  id: number;
  nome: string;
  perguntas: PerguntaFormulario[];
  ligado: boolean;
  etapa_id: number | null;
  responsavel_id: number | null;
  etiquetas: string[];
  boas_vindas: string | null;
  avisar: boolean;
}

/** O formulário guardado, ou novo (com as perguntas e a sugestão de campo de cada uma). */
async function formulario(db: Executor, c: Conexao, formId: string): Promise<LinhaFormulario> {
  const sel = `SELECT id::int, nome, perguntas, ligado, etapa_id, responsavel_id, etiquetas, boas_vindas, avisar
                 FROM comercial.instagram_formularios WHERE conta_id = ${contaSql()} AND form_id = $1`;
  const { rows } = await db.query<LinhaFormulario>(sel, [formId]);
  if (rows[0]) return rows[0];
  const p = await exigirMeta().perguntas(formId, c.token);
  await db.query(
    `INSERT INTO comercial.instagram_formularios (conta_id, form_id, nome, perguntas)
     VALUES (${contaSql()}, $1, $2, $3) ON CONFLICT (conta_id, form_id) DO NOTHING`,
    [formId, p.nome, JSON.stringify(comSugestoes(p.perguntas))],
  );
  return (await db.query<LinhaFormulario>(sel, [formId])).rows[0]!;
}

const comSugestoes = (ps: { chave: string; rotulo: string; tipo: string }[]): PerguntaFormulario[] =>
  ps.map((q) => ({ ...q, campo: campoSugerido(q.tipo, q.chave) }));

async function receberCadastro(deps: DepsLead, paginaId: string, v: Record<string, unknown>) {
  const c = await conexaoPor(deps.pool, 'pagina_id', paginaId);
  if (!c || !metaAtual) return;
  const m = metaAtual;
  const leadgenId = String(v.leadgen_id ?? '');
  if (!leadgenId) return;
  await comConta(c.contaId, async () => {
    // Plano sem o Instagram (mudou de plano depois de conectar): os avisos não fazem nada.
    if (!(await temRecurso(deps.pool, 'instagram'))) return;
    const { pool } = deps;
    const { rows: novo } = await pool.query<{ id: number }>(
      `INSERT INTO comercial.instagram_cadastros (conta_id, leadgen_id, form_id)
       VALUES (${contaSql()}, $1, $2) ON CONFLICT (conta_id, leadgen_id) DO NOTHING RETURNING id::int`,
      [leadgenId, v.form_id ? String(v.form_id) : null],
    );
    const cadastroId = novo[0]?.id;
    if (!cadastroId) return; // a Meta avisou duas vezes
    const falhar = (erro: string) =>
      pool.query('UPDATE comercial.instagram_cadastros SET erro = $2 WHERE id = $1', [
        cadastroId,
        erro.slice(0, 300),
      ]);
    let cad: Awaited<ReturnType<ClienteMeta['cadastro']>>;
    try {
      cad = await m.cadastro(leadgenId, c.token);
    } catch (e) {
      await registrarErroDaMeta(pool, e);
      await falhar(`Não consegui ler o cadastro na Meta: ${(e as Error).message}`);
      throw e;
    }
    const formId = cad.formId ?? (v.form_id ? String(v.form_id) : null);
    await pool.query(
      `UPDATE comercial.instagram_cadastros SET form_id = $2, anuncio = $3, campanha = $4, plataforma = $5,
              respostas = $6, criado_em = coalesce($7::timestamptz, criado_em)
        WHERE id = $1`,
      [cadastroId, formId, cad.anuncio, cad.campanha, cad.plataforma, JSON.stringify(cad.respostas), cad.em],
    );
    if (!formId) return falhar('O cadastro veio sem o formulário.').then(() => undefined);
    const f = await formulario(pool, c, formId);
    if (!f.ligado) return falhar('Formulário desligado: o lead não foi para o funil.').then(() => undefined);
    const l = leadDoCadastro(cad.respostas, f.perguntas);
    const origemAnuncio = [
      cad.anuncio && `Anúncio: ${cad.anuncio}`,
      cad.campanha && `Campanha: ${cad.campanha}`,
      `Formulário: ${f.nome}`,
    ]
      .filter(Boolean)
      .join(' · ');
    const { empresaId, novo: leadNovo } = await criarLead(
      deps,
      {
        empresa: l.empresa || l.contato || 'Cadastro do anúncio',
        contato: l.contato,
        cargo: l.cargo,
        telefone: l.telefone,
        email: l.email,
        cidade: l.cidade,
        observacao: [l.anotacao, origemAnuncio].filter(Boolean).join('\n'),
      },
      { etapaId: f.etapa_id, responsavelId: f.responsavel_id, etiquetas: f.etiquetas, agente: false },
      'Anúncio',
    );
    await pool.query('UPDATE comercial.instagram_cadastros SET empresa_id = $2 WHERE id = $1', [
      cadastroId,
      empresaId,
    ]);
    await pool.query(
      `UPDATE comercial.oportunidades SET origem_instagram = coalesce(origem_instagram, $2::jsonb)
        WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [
        empresaId,
        JSON.stringify({
          tipo: 'formulario',
          formId,
          formulario: f.nome,
          anuncio: cad.anuncio,
          campanha: cad.campanha,
          plataforma: cad.plataforma,
        }),
      ],
    );
    if (!leadNovo)
      await funil.registrarAtividade(
        pool,
        empresaId,
        {
          tipo: 'nota',
          direcao: null,
          texto: `Preencheu de novo o formulário “${f.nome}”.\n${l.anotacao ?? ''}`.trim(),
        },
        'Anúncio',
      );
    // Boas-vindas no WhatsApp: entra na fila (sai pelo motor, no horário, como as sequências).
    const { telefone: fone } = await dadosDoLead(pool, empresaId);
    if (leadNovo && f.boas_vindas && fone)
      await agente.criarMensagem(pool, {
        empresaId,
        direcao: 'enviada',
        texto: comNome(f.boas_vindas, l.contato),
        telefone: fone,
        status: 'aprovada',
        origem: 'automatico',
        nota: `Boas-vindas do formulário ${f.nome}`,
      });
    if (f.avisar) {
      const titulo = `${leadNovo ? 'Lead novo' : 'Cadastro de novo'} do anúncio: ${l.contato ?? l.empresa ?? 'sem nome'}`;
      await notificarDono(pool, empresaId, { tipo: 'atribuido', titulo, texto: origemAnuncio });
    }
  });
}

/** Busca os formulários da página e guarda os novos (com a sugestão de campo de cada pergunta). */
export async function sincronizarFormularios(db: Executor): Promise<number> {
  const { m, c } = await exigirConexao(db);
  let lista: { id: string; nome: string; status: string | null }[];
  try {
    lista = await m.formularios(c.paginaId, c.token);
  } catch (e) {
    await registrarErroDaMeta(db, e);
    throw AppError.invalido(`A Meta não mostrou os formulários: ${(e as Error).message}`);
  }
  let novos = 0;
  for (const f of lista) {
    // O que já existe só atualiza o nome (o mapa de campos e o destino ficam como o gestor deixou).
    const { rowCount } = await db.query(
      `UPDATE comercial.instagram_formularios SET nome = $2 WHERE conta_id = ${contaSql()} AND form_id = $1`,
      [f.id, f.nome],
    );
    if (rowCount) continue;
    const p = await m.perguntas(f.id, c.token).catch(() => ({ nome: f.nome, perguntas: [] }));
    await db.query(
      `INSERT INTO comercial.instagram_formularios (conta_id, form_id, nome, perguntas, ligado)
       VALUES (${contaSql()}, $1, $2, $3, $4) ON CONFLICT (conta_id, form_id) DO NOTHING`,
      [f.id, f.nome, JSON.stringify(comSugestoes(p.perguntas)), f.status !== 'ARCHIVED'],
    );
    novos++;
  }
  return novos;
}

/** O dono da conta (administradores) fica sabendo quando a conexão cai. */
export async function avisarAdmins(db: Executor, titulo: string, texto: string): Promise<void> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.usuarios WHERE conta_id = ${conta()} AND papel = 'admin' AND ativo`,
  );
  for (const u of rows)
    await notificar(db, u.id, { tipo: 'sistema', titulo, texto, link: '/instagram?aba=conexao' });
}
