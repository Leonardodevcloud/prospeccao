import type { Executor, Pool } from '@prospeccao/db';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { AppError, type Logger } from '@prospeccao/shared';
import { MAX_SLIDES, MODELO } from '@prospeccao/shared/carrosseis';
import { palavraDaChamada } from '@prospeccao/shared/carrosseis-publicacao';
import { LIMITE_TEXTO_POST, textoComHashtags } from '@prospeccao/shared/videos';
import { comConta, conta, contaSql } from '../../contexto.js';
import { temRecurso } from '../../recursos.js';
import { desenhar, materialDaConta } from '../carrosseis/desenho.js';
import type { Peca } from '../carrosseis/publicacao.js';
import * as carrosseis from '../carrosseis/repositorio.js';
import { notificar } from '../notificacoes/repositorio.js';
import { ErroMeta, type PublicacaoMeta } from './meta.js';
import * as instagram from './servico.js';

/**
 * Publicar e agendar pelo CRM (v133). A pessoa escolhe o dia e a hora (ou "agora"); a rotina, a cada
 * minuto, publica pela API da Meta: desenha os slides do carrossel (ou pega o vídeo editado), guarda
 * num link temporário que a Meta baixa, cria o contêiner, espera a Meta processar e publica. Com o
 * Comente e receba, a regra liga direto no post publicado. Só funciona depois que a Meta aprova a
 * permissão instagram_content_publish (META_PUBLICAR=sim e o Instagram reconectado).
 */

export const PERMISSAO_PUBLICAR = 'instagram_content_publish';
/** Até quantos dias à frente dá para agendar. */
export const DIAS_PARA_AGENDAR = 75;
/** A Meta não terminou de processar em meia hora: desiste e avisa. */
const ESPERA_MAXIMA_MS = 30 * 60_000;
const MAX_TENTATIVAS = 3;

export type SituacaoAgendamento = 'agendado' | 'publicando' | 'publicado' | 'falhou' | 'cancelado';

export interface Agendamento {
  id: number;
  para: string;
  legenda: string;
  comente: boolean;
  situacao: SituacaoAgendamento;
  midiaLink: string | null;
  erro: string | null;
  publicadoEm: string | null;
}

interface LinhaAgendamento {
  id: number;
  conta_id: number;
  carrossel_id: number | null;
  video_id: number | null;
  para: Date;
  legenda: string;
  comente: boolean;
  situacao: SituacaoAgendamento;
  container_id: string | null;
  midia_id: string | null;
  midia_link: string | null;
  erro: string | null;
  tentativas: number;
  criado_por: number | null;
  criado_em: Date;
  publicado_em: Date | null;
}

const paraAgendamento = (l: LinhaAgendamento): Agendamento => ({
  id: l.id,
  para: l.para.toISOString(),
  legenda: l.legenda,
  comente: l.comente,
  situacao: l.situacao,
  midiaLink: l.midia_link,
  erro: l.erro,
  publicadoEm: l.publicado_em?.toISOString() ?? null,
});

const colunaDa = (p: Peca) => (p.tipo === 'video' ? 'video_id' : 'carrossel_id');

/* ───────────────────────────── A situação ───────────────────────────── */

export interface SituacaoPublicar {
  /** A plataforma liberou publicar (META_PUBLICAR=sim). */
  ligado: boolean;
  /** O Instagram da empresa está conectado. */
  conectado: boolean;
  /** A conexão tem a permissão de publicar (se não, reconectar depois da aprovação). */
  permissao: boolean;
  /** Publicações pela API nas últimas 24 h e o limite da conta (quando a Meta responde). */
  limite: { usadas: number; limite: number } | null;
}

export async function situacao(db: Executor): Promise<SituacaoPublicar> {
  const m = instagram.meta();
  const ligado = !!m?.publicarLigado && (await temRecurso(db, 'instagram'));
  const c = await instagram.conexaoDaConta(db);
  if (!ligado || !c || !m) return { ligado, conectado: !!c, permissao: false, limite: null };
  const escopos = m.escopos ? await m.escopos(c.token).catch(() => [] as string[]) : [];
  const permissao = escopos.includes(PERMISSAO_PUBLICAR);
  const limite =
    permissao && m.limitePublicacao ? await m.limitePublicacao(c.igId, c.token).catch(() => null) : null;
  return { ligado, conectado: true, permissao, limite };
}

/* ───────────────────────────── Agendar ───────────────────────────── */

async function pendente(db: Executor, peca: Peca): Promise<LinhaAgendamento | null> {
  const { rows } = await db.query<LinhaAgendamento>(
    `SELECT * FROM comercial.instagram_agendamentos
      WHERE conta_id = ${contaSql()} AND ${colunaDa(peca)} = $1 ORDER BY id DESC LIMIT 1`,
    [peca.id],
  );
  return rows[0] ?? null;
}

/** O último agendamento da peça (o pendente ou o que já saiu). */
export async function agendamentoDa(db: Executor, peca: Peca): Promise<Agendamento | null> {
  const l = await pendente(db, peca);
  return l ? paraAgendamento(l) : null;
}

/** O que o post é, para o time aprender (v134): guardado ao agendar. */
async function dnaDa(db: Executor, peca: Peca, para: Date): Promise<Record<string, unknown>> {
  const sp = new Date(para.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const quando = { diaSemana: sp.getDay(), hora: sp.getHours() };
  if (peca.tipo === 'video') {
    const { rows } = await db.query<{
      duracao_final: string | null;
      imagens: { usar?: boolean }[] | null;
      animacoes: { momentos?: { tipo: string; usar?: boolean }[] } | null;
      som: { musica?: { usar?: boolean } } | null;
      opcoes: { chamada?: { tipo?: string; palavra?: string }; assunto?: string };
    }>(
      `SELECT duracao_final, imagens, animacoes, som, opcoes FROM comercial.videos
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [peca.id],
    );
    const v = rows[0];
    return {
      tipo: 'video',
      segundos: v?.duracao_final ? Math.round(Number(v.duracao_final)) : null,
      imagens: (v?.imagens ?? []).filter((i) => i.usar !== false).length,
      animacoes: [
        ...new Set((v?.animacoes?.momentos ?? []).filter((m) => m.usar !== false).map((m) => m.tipo)),
      ],
      musica: v?.som?.musica?.usar !== false && !!v?.som,
      chamada: v?.opcoes?.chamada?.tipo ?? null,
      assunto: v?.opcoes?.assunto ?? null,
      ...quando,
    };
  }
  const c = await carrosseis.carrossel(db, peca.id);
  const { rows } = await db.query<{
    origem: string;
    divulgar_id: number | null;
    relatorio: { angulo?: string } | null;
  }>(
    `SELECT origem, divulgar_id, relatorio FROM comercial.carrosseis WHERE id = $1 AND conta_id = ${contaSql()}`,
    [peca.id],
  );
  const fotos = c.conteudo.map((s) => s.fotoId).filter((x): x is number => !!x);
  const { rows: ia } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.carrossel_fotos
      WHERE conta_id = ${contaSql()} AND id = ANY($1::int[]) AND origem IN ('gerada', 'cenario')`,
    [fotos],
  );
  return {
    tipo: 'carrossel',
    estilo: c.estilo,
    slides: c.conteudo.length,
    modelos: c.conteudo.map((s) => s.modelo),
    fotos: fotos.length,
    fotosIa: ia[0]?.n ?? 0,
    gancho: c.conteudo[0]?.titulo ?? '',
    chamada: palavraDaChamada(c.conteudo) ? 'comentar' : (c.conteudo.at(-1)?.botao ?? null),
    origem: rows[0]?.origem ?? null,
    promocao: !!rows[0]?.divulgar_id,
    angulo: rows[0]?.relatorio?.angulo ?? null,
    ...quando,
  };
}

/** Confere se a peça pode ir ao Instagram e devolve a legenda padrão. */
async function conferirPeca(db: Executor, peca: Peca): Promise<{ legenda: string; titulo: string }> {
  if (peca.tipo === 'video') {
    const { rows } = await db.query<{
      titulo: string;
      situacao: string;
      final_chave: string | null;
      texto_post: string;
      hashtags: string[];
      midia_id: string | null;
    }>(
      `SELECT titulo, situacao, final_chave, texto_post, hashtags, midia_id FROM comercial.videos
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [peca.id],
    );
    const v = rows[0];
    if (!v) throw AppError.naoEncontrado('Vídeo');
    if (v.midia_id) throw AppError.conflito('Este vídeo já está no Instagram.');
    if (!v.final_chave || !['pronto', 'revisar'].includes(v.situacao))
      throw AppError.conflito('O vídeo ainda não está pronto.');
    return { legenda: textoComHashtags(v.texto_post, v.hashtags), titulo: v.titulo };
  }
  const c = await carrosseis.carrossel(db, peca.id);
  if (c.situacao === 'publicado') throw AppError.conflito('Este carrossel já está no Instagram.');
  if (c.situacao === 'rascunho') throw AppError.conflito('Marque o carrossel como pronto antes de publicar.');
  if (c.conteudo.length > MAX_SLIDES || c.conteudo.length < 1)
    throw AppError.invalido(`O Instagram aceita até ${MAX_SLIDES} imagens por carrossel.`);
  if (c.conteudo.some((s) => MODELO[s.modelo].foto && s.modelo === 'foto' && !s.fotoId))
    throw AppError.invalido('Um slide de foto está sem a foto: escolha a foto ou troque o modelo.');
  return { legenda: c.legenda, titulo: c.titulo };
}

/** Publicar agora (para = null) ou agendar. Agendar de novo troca o dia, a hora e a legenda. */
export async function agendar(
  db: Executor,
  peca: Peca,
  d: { para: Date | null; legenda: string | null; comente: boolean },
  criadoPor: number | null,
): Promise<Agendamento> {
  const s = await situacao(db);
  if (!s.ligado) throw AppError.invalido('Publicar pelo CRM ainda não está liberado pela Meta.');
  if (!s.conectado) throw AppError.invalido('Conecte o Instagram da empresa primeiro.');
  if (!s.permissao)
    throw AppError.invalido(
      'A conexão do Instagram não tem a permissão de publicar: reconecte o Instagram (aba Conexão).',
    );
  const { legenda: padrao } = await conferirPeca(db, peca);
  const legenda = (d.legenda ?? padrao).trim();
  if (legenda.length > LIMITE_TEXTO_POST) throw AppError.invalido('A legenda pode ter até 2.200 letras.');
  const agora = Date.now();
  const para = d.para ?? new Date(agora);
  if (para.getTime() < agora - 60_000) throw AppError.invalido('Escolha um horário que ainda não passou.');
  if (para.getTime() > agora + DIAS_PARA_AGENDAR * 86_400_000)
    throw AppError.invalido(`Dá para agendar até ${DIAS_PARA_AGENDAR} dias à frente.`);
  const dna = await dnaDa(db, peca, para);
  const atual = await pendente(db, peca);
  let id: number;
  if (atual && (atual.situacao === 'agendado' || atual.situacao === 'publicando')) {
    if (atual.situacao === 'publicando') throw AppError.conflito('Este post já está sendo publicado.');
    await db.query(
      `UPDATE comercial.instagram_agendamentos SET para = $2, legenda = $3, comente = $4, dna = $5, erro = NULL
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [atual.id, para, legenda, d.comente, JSON.stringify(dna)],
    );
    id = atual.id;
  } else {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO comercial.instagram_agendamentos (conta_id, ${colunaDa(peca)}, para, legenda, comente, dna, criado_por)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6) RETURNING id::int`,
      [peca.id, para, legenda, d.comente, JSON.stringify(dna), criadoPor],
    );
    id = rows[0]!.id;
  }
  await marcarAgendado(db, peca, para);
  const { rows } = await db.query<LinhaAgendamento>(
    'SELECT * FROM comercial.instagram_agendamentos WHERE id = $1',
    [id],
  );
  return paraAgendamento(rows[0]!);
}

async function marcarAgendado(db: Executor, peca: Peca, para: Date | null) {
  if (peca.tipo === 'video')
    await db.query(
      `UPDATE comercial.videos SET agendado_para = $2 WHERE id = $1 AND conta_id = ${contaSql()}`,
      [peca.id, para],
    );
  else
    await db.query(
      `UPDATE comercial.carrosseis
          SET agendado_para = $2,
              situacao = CASE WHEN situacao = 'publicado' THEN situacao WHEN $2::timestamptz IS NULL THEN 'pronto' ELSE 'agendado' END
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [peca.id, para],
    );
}

export async function cancelar(db: Executor, peca: Peca): Promise<void> {
  const atual = await pendente(db, peca);
  if (!atual || atual.situacao !== 'agendado')
    throw AppError.conflito('Não há publicação agendada para cancelar.');
  await db.query(
    `UPDATE comercial.instagram_agendamentos SET situacao = 'cancelado' WHERE id = $1 AND conta_id = ${contaSql()}`,
    [atual.id],
  );
  await marcarAgendado(db, peca, null);
}

/* ───────────────────────────── Publicar ───────────────────────────── */

export interface DepsPublicar {
  pool: Pool;
  log: Logger;
  filas: instagram.DepsLead['filas'];
  armazenamento: Armazenamento | null;
}

/** Os links que a Meta baixa: os slides desenhados agora ou o vídeo editado. */
async function linksDaPeca(
  deps: DepsPublicar,
  ag: LinhaAgendamento,
): Promise<
  | { tipo: 'carrossel'; imagens: string[]; story: boolean }
  | { tipo: 'video'; video: string; capa: string | null }
> {
  const arm = deps.armazenamento;
  if (!arm) throw AppError.invalido('O armazenamento de arquivos não está ligado.');
  if (ag.video_id) {
    const { rows } = await deps.pool.query<{ final_chave: string | null; capa_chave: string | null }>(
      `SELECT final_chave, capa_chave FROM comercial.videos WHERE id = $1 AND conta_id = ${contaSql()}`,
      [ag.video_id],
    );
    if (!rows[0]?.final_chave) throw AppError.conflito('O vídeo editado não foi encontrado.');
    return {
      tipo: 'video',
      video: await arm.urlAssinada(rows[0].final_chave, { segundos: 7200 }),
      capa: rows[0].capa_chave ? await arm.urlAssinada(rows[0].capa_chave, { segundos: 7200 }) : null,
    };
  }
  const c = await carrosseis.carrossel(deps.pool, ag.carrossel_id!);
  const material = await materialDaConta(deps.pool, arm);
  const imagens: string[] = [];
  for (const [i, slide] of c.conteudo.entries()) {
    const img = await desenhar(deps.pool, arm, material, {
      slide,
      indice: i,
      total: c.conteudo.length,
      estilo: c.estilo,
      formato: c.formato,
    });
    const chave = `carrosseis/${conta()}/publicar/${ag.id}/${String(i + 1).padStart(2, '0')}.jpg`;
    await arm.enviar(chave, new Uint8Array(img.jpeg), 'image/jpeg');
    imagens.push(await arm.urlAssinada(chave, { segundos: 7200 }));
  }
  return { tipo: 'carrossel', imagens, story: c.formato === 'story' };
}

async function avisar(db: Executor, ag: LinhaAgendamento, aviso: { titulo: string; texto: string }) {
  const link = ag.video_id
    ? `/videos/${ag.video_id}?aba=publicacao`
    : `/carrosseis/${ag.carrossel_id}?aba=publicacao`;
  if (ag.criado_por)
    await notificar(db, ag.criado_por, { tipo: 'sistema', ...aviso, link }).catch(() => undefined);
}

async function falhou(deps: DepsPublicar, ag: LinhaAgendamento, motivo: string) {
  await deps.pool.query(
    `UPDATE comercial.instagram_agendamentos SET situacao = 'falhou', erro = $2 WHERE id = $1`,
    [ag.id, motivo.slice(0, 300)],
  );
  await marcarAgendado(
    deps.pool,
    ag.video_id ? { tipo: 'video', id: ag.video_id } : { tipo: 'carrossel', id: ag.carrossel_id! },
    null,
  );
  await avisar(deps.pool, ag, {
    titulo: 'A Meta não publicou o post',
    texto: `${motivo.slice(0, 200)} ${ag.video_id ? 'O vídeo' : 'O carrossel'} voltou para Pronto.`,
  });
}

/**
 * Um passo da publicação (a rotina chama até sair): cria o contêiner, espera a Meta processar e
 * publica. Devolve a situação depois do passo.
 */
export async function tentarPublicar(deps: DepsPublicar, ag: LinhaAgendamento): Promise<SituacaoAgendamento> {
  const m = instagram.meta();
  const c = await instagram.conexaoDaConta(deps.pool);
  if (!m?.criarMidia || !m.situacaoMidia || !m.publicarMidia || !c) {
    await falhou(deps, ag, 'O Instagram da empresa não está conectado.');
    return 'falhou';
  }
  try {
    let container = ag.container_id;
    if (!container) {
      await deps.pool.query(
        `UPDATE comercial.instagram_agendamentos SET situacao = 'publicando', tentativas = tentativas + 1 WHERE id = $1`,
        [ag.id],
      );
      const l = await linksDaPeca(deps, ag);
      if (l.tipo === 'video')
        container = await m.criarMidia(c.igId, c.token, {
          tipo: 'reels',
          video: l.video,
          legenda: ag.legenda,
          capa: l.capa,
        });
      else if (l.story)
        container = await m.criarMidia(c.igId, c.token, { tipo: 'story', imagem: l.imagens[0]! });
      else if (l.imagens.length === 1)
        container = await m.criarMidia(c.igId, c.token, {
          tipo: 'imagem',
          imagem: l.imagens[0]!,
          legenda: ag.legenda,
        });
      else {
        const filhos: string[] = [];
        for (const imagem of l.imagens)
          filhos.push(await m.criarMidia(c.igId, c.token, { tipo: 'item', imagem }));
        container = await m.criarMidia(c.igId, c.token, { tipo: 'carrossel', filhos, legenda: ag.legenda });
      }
      await deps.pool.query('UPDATE comercial.instagram_agendamentos SET container_id = $2 WHERE id = $1', [
        ag.id,
        container,
      ]);
    }
    const st = await m.situacaoMidia(container, c.token);
    if (st === 'ERROR' || st === 'EXPIRED') {
      await falhou(deps, ag, 'A Meta não aceitou o arquivo (formato ou tamanho).');
      return 'falhou';
    }
    if (st !== 'FINISHED' && st !== 'PUBLISHED') {
      if (Date.now() - ag.para.getTime() > ESPERA_MAXIMA_MS) {
        await falhou(deps, ag, 'A Meta demorou demais para processar o post.');
        return 'falhou';
      }
      return 'publicando';
    }
    const midiaId = await m.publicarMidia(c.igId, container, c.token);
    const pub: PublicacaoMeta = (await m.publicacao(midiaId, c.token).catch(() => null)) ?? {
      id: midiaId,
      legenda: ag.legenda,
      tipo: ag.video_id ? 'REELS' : 'CAROUSEL_ALBUM',
      link: null,
      imagem: null,
      em: new Date().toISOString(),
      comentarios: 0,
    };
    await deps.pool.query(
      `UPDATE comercial.instagram_agendamentos
          SET situacao = 'publicado', midia_id = $2, midia_link = $3, publicado_em = now(), erro = NULL
        WHERE id = $1`,
      [ag.id, midiaId, pub.link],
    );
    await ligarNaPeca(deps, c, ag, pub);
    await avisar(deps.pool, ag, {
      titulo: 'Publicado no Instagram',
      texto: ag.video_id ? 'O Reels foi publicado pelo CRM.' : 'O carrossel foi publicado pelo CRM.',
    });
    return 'publicado';
  } catch (erro) {
    const msg =
      erro instanceof ErroMeta ? erro.message : erro instanceof AppError ? erro.message : 'Erro ao publicar.';
    deps.log.warn({ err: erro, agendamento: ag.id }, 'instagram: publicar falhou');
    if (ag.tentativas + 1 >= MAX_TENTATIVAS || (erro instanceof ErroMeta && erro.status === 400)) {
      await falhou(deps, ag, msg);
      return 'falhou';
    }
    // Erro passageiro: volta para a fila (tenta de novo no próximo minuto, do começo).
    await deps.pool.query(
      `UPDATE comercial.instagram_agendamentos SET situacao = 'agendado', container_id = NULL, erro = $2 WHERE id = $1`,
      [ag.id, msg.slice(0, 300)],
    );
    return 'agendado';
  }
}

/** O post publicado: a regra do Comente e receba liga direto nele (ou só a peça fica publicada). */
async function ligarNaPeca(
  deps: DepsPublicar,
  c: instagram.Conexao,
  ag: LinhaAgendamento,
  pub: PublicacaoMeta,
) {
  const coluna = ag.video_id ? 'video_id' : 'carrossel_id';
  const id = ag.video_id ?? ag.carrossel_id!;
  const { rows } = await deps.pool.query<{ id: number }>(
    `SELECT id::int FROM comercial.instagram_regras WHERE conta_id = ${contaSql()} AND ${coluna} = $1 AND midia_id IS NULL`,
    [id],
  );
  if (ag.comente && rows[0]) {
    await instagram.ligarRegraNoPost(deps, c, rows[0].id, pub, { avisar: false });
    await deps.pool.query(
      `UPDATE comercial.${ag.video_id ? 'videos' : 'carrosseis'} SET agendado_para = NULL
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id],
    );
    return;
  }
  if (ag.video_id)
    await deps.pool.query(
      `UPDATE comercial.videos SET midia_id = $2, midia_link = $3, publicado_em = now(), agendado_para = NULL
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id, pub.id, pub.link],
    );
  else
    await deps.pool.query(
      `UPDATE comercial.carrosseis SET situacao = 'publicado', midia_id = $2, midia_link = $3, publicado_em = now(),
              agendado_para = NULL
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id, pub.id, pub.link],
    );
}

/** A rotina: publica o que chegou a hora e acompanha o que a Meta ainda está processando. */
export async function publicarOsAgendados(deps: DepsPublicar): Promise<number> {
  const { rows } = await deps.pool.query<LinhaAgendamento>(
    `SELECT * FROM comercial.instagram_agendamentos
      WHERE situacao IN ('agendado', 'publicando') AND para <= now()
      ORDER BY para LIMIT 20`,
  );
  let publicados = 0;
  for (const ag of rows)
    await comConta(ag.conta_id, async () => {
      if ((await tentarPublicar(deps, ag)) === 'publicado') publicados++;
    }).catch((e) => deps.log.warn({ err: e, agendamento: ag.id }, 'instagram: agendamento falhou'));
  return publicados;
}

export function iniciarPublicacoes(deps: DepsPublicar): () => void {
  const rodar = async () => {
    const cliente = await deps.pool.connect();
    try {
      const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(860133) AS ok');
      if (!rows[0]?.ok) return;
      try {
        await publicarOsAgendados(deps);
      } finally {
        await cliente.query('SELECT pg_advisory_unlock(860133)');
      }
    } catch (e) {
      deps.log.warn({ err: e }, 'instagram: rotina de publicar falhou');
    } finally {
      cliente.release();
    }
  };
  const t = setInterval(() => void rodar(), 60_000);
  t.unref();
  return () => clearInterval(t);
}

/* ───────────────────────────── O calendário ───────────────────────────── */

export interface ItemDoCalendario {
  tipo: 'carrossel' | 'video';
  id: number;
  titulo: string;
  /** O dia e a hora (o agendado ou o publicado). */
  em: string;
  situacao: 'agendado' | 'publicando' | 'publicado' | 'falhou';
  /** Publicado pelo CRM ou postado à mão (e reconhecido). */
  peloCrm: boolean;
  link: string | null;
}

/** O mês (AAAA-MM, no horário de Brasília): os agendados e os publicados. */
export async function calendario(db: Executor, mes: string): Promise<ItemDoCalendario[]> {
  const inicio = `${mes}-01`;
  const { rows } = await db.query<{
    tipo: 'carrossel' | 'video';
    id: number;
    titulo: string;
    em: Date;
    situacao: ItemDoCalendario['situacao'];
    pelo_crm: boolean;
    link: string | null;
  }>(
    `WITH janela AS (
       SELECT ($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS de,
              (($1::date) + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo' AS ate),
     ag AS (
       SELECT CASE WHEN a.video_id IS NULL THEN 'carrossel' ELSE 'video' END AS tipo,
              coalesce(a.carrossel_id, a.video_id)::int AS id,
              coalesce(c.titulo, v.titulo) AS titulo,
              coalesce(a.publicado_em, a.para) AS em, a.situacao, true AS pelo_crm, a.midia_link AS link
         FROM comercial.instagram_agendamentos a
         LEFT JOIN comercial.carrosseis c ON c.id = a.carrossel_id
         LEFT JOIN comercial.videos v ON v.id = a.video_id, janela j
        WHERE a.conta_id = ${contaSql()} AND a.situacao IN ('agendado', 'publicando', 'publicado', 'falhou')
          AND coalesce(a.publicado_em, a.para) >= j.de AND coalesce(a.publicado_em, a.para) < j.ate)
     SELECT * FROM ag
     UNION ALL
     SELECT 'carrossel', c.id, c.titulo, c.publicado_em, 'publicado', false, c.midia_link
       FROM comercial.carrosseis c, janela j
      WHERE c.conta_id = ${contaSql()} AND c.publicado_em >= j.de AND c.publicado_em < j.ate
        AND NOT EXISTS (SELECT 1 FROM ag WHERE ag.tipo = 'carrossel' AND ag.id = c.id AND ag.situacao = 'publicado')
     UNION ALL
     SELECT 'video', v.id, v.titulo, v.publicado_em, 'publicado', false, v.midia_link
       FROM comercial.videos v, janela j
      WHERE v.conta_id = ${contaSql()} AND v.publicado_em >= j.de AND v.publicado_em < j.ate
        AND NOT EXISTS (SELECT 1 FROM ag WHERE ag.tipo = 'video' AND ag.id = v.id AND ag.situacao = 'publicado')
     ORDER BY em`,
    [inicio],
  );
  return rows.map((r) => ({
    tipo: r.tipo,
    id: r.id,
    titulo: r.titulo,
    em: r.em.toISOString(),
    situacao: r.situacao,
    peloCrm: r.pelo_crm,
    link: r.link,
  }));
}
