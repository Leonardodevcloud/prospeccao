import type { Executor } from '@prospeccao/db';
import type { FotoParaIa, PromocaoParaIa, QuadroRosto, Silencio } from '@prospeccao/integrations/videos';
import {
  type AndamentoVideo,
  type AnimacoesVideo,
  type ConferenciaVideo,
  type CorteVideo,
  type EtapaVideo,
  type ImagemVideo,
  type OpcoesVideo,
  opcoesVideoEntrada,
  type PalavraVideo,
  type SomVideo,
  type TrechoSemImagem,
} from '@prospeccao/shared/videos';

/** O que a edição lê e grava de um vídeo (o worker não tem sessão: o conta_id vai explícito). */

export interface AnaliseVideo {
  duracao: number;
  silencios: Silencio[];
  /** Mapa do rosto no vídeo em pé (1080 × 1920), na taxa `fps`. */
  rostos: QuadroRosto[];
  fps: number;
  /** Vídeo gravado deitado: o centro do recorte em pé (px do original na largura). */
  recorteX: number | null;
}

export interface LinhaVideo {
  id: number;
  conta_id: number;
  titulo: string;
  situacao: string;
  opcoes: OpcoesVideo;
  original_chave: string;
  original_tipo: string;
  duracao_original: number | null;
  analise: AnaliseVideo | null;
  cortes: CorteVideo[];
  palavras: PalavraVideo[];
  animacoes: AnimacoesVideo | null;
  imagens: ImagemVideo[];
  sem_imagem: TrechoSemImagem[];
  som: SomVideo | null;
  final_chave: string | null;
  capa_chave: string | null;
  previa_chave: string | null;
  contou_em: string | null;
  criado_por: number | null;
  versao: number;
  tentativas: number;
}

export async function carregar(db: Executor, id: number): Promise<LinhaVideo | null> {
  const { rows } = await db.query<LinhaVideo & { duracao_original: string | null }>(
    `SELECT id, conta_id, titulo, situacao, opcoes, original_chave, original_tipo, duracao_original, analise,
            cortes, palavras, animacoes, imagens, sem_imagem, som, final_chave, capa_chave, previa_chave, contou_em, criado_por, versao, tentativas
       FROM comercial.videos WHERE id = $1`,
    [id],
  );
  const l = rows[0];
  if (!l) return null;
  const o = opcoesVideoEntrada.safeParse(l.opcoes ?? {});
  return {
    ...l,
    opcoes: o.success ? o.data : opcoesVideoEntrada.parse({}),
    imagens: l.imagens ?? [],
    sem_imagem: l.sem_imagem ?? [],
    duracao_original: l.duracao_original == null ? null : Number(l.duracao_original),
  };
}

export async function marcarEtapa(db: Executor, id: number, etapa: EtapaVideo, progresso: number) {
  await db.query(
    `UPDATE comercial.videos SET situacao = 'editando', etapa = $2, progresso = $3, atualizado_em = now()
      WHERE id = $1`,
    [id, etapa, Math.max(0, Math.min(99, Math.round(progresso)))],
  );
}

export async function comecar(db: Executor, id: number) {
  await db.query(
    `UPDATE comercial.videos SET situacao = 'editando', etapa = 'preparando', progresso = 2, erro = NULL,
            tentativas = tentativas + 1, atualizado_em = now(),
            andamento = coalesce(andamento, '{}'::jsonb) || jsonb_build_object('inicio', now())
      WHERE id = $1`,
    [id],
  );
}

/** v136: o que a etapa achou (a tela mostra no lugar da dica). */
export async function anotar(db: Executor, id: number, parte: Partial<AndamentoVideo>) {
  await db.query(
    `UPDATE comercial.videos SET andamento = coalesce(andamento, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [id, JSON.stringify(parte)],
  );
}

/** v136: o quadro do vídeo já em pé, para a prévia do mapa na tela da edição. */
export async function guardarPrevia(db: Executor, id: number, chave: string) {
  await db.query('UPDATE comercial.videos SET previa_chave = $2 WHERE id = $1', [id, chave]);
}

export async function salvarAnalise(
  db: Executor,
  id: number,
  d: {
    duracao: number;
    analise: AnaliseVideo;
    cortes: CorteVideo[];
    palavras: PalavraVideo[];
    animacoes: AnimacoesVideo;
  },
) {
  await db.query(
    `UPDATE comercial.videos SET duracao_original = $2, analise = $3, cortes = $4, palavras = $5, animacoes = $6,
            atualizado_em = now()
      WHERE id = $1`,
    [
      id,
      d.duracao,
      JSON.stringify(d.analise),
      JSON.stringify(d.cortes),
      JSON.stringify(d.palavras),
      JSON.stringify(d.animacoes),
    ],
  );
}

/** O plano dos enfeites (e cada imagem gerada assim que fica pronta: uma queda não gera de novo). */
export async function salvarEnfeites(
  db: Executor,
  id: number,
  d: { animacoes: AnimacoesVideo; imagens: ImagemVideo[]; semImagem: TrechoSemImagem[]; som: SomVideo },
) {
  await db.query(
    `UPDATE comercial.videos SET animacoes = $2, imagens = $3, sem_imagem = $4, som = $5, atualizado_em = now()
      WHERE id = $1`,
    [
      id,
      JSON.stringify(d.animacoes),
      JSON.stringify(d.imagens),
      JSON.stringify(d.semImagem),
      JSON.stringify(d.som),
    ],
  );
}

/**
 * Se a pessoa mexeu na revisão enquanto o vídeo era gerado, fica o que ela mudou; do que a edição
 * fez, entram só os arquivos novos (imagem gerada, música) das imagens que ela não mudou.
 */
export async function mesclarComAtual(
  db: Executor,
  id: number,
  versaoLida: number,
  novo: { animacoes: AnimacoesVideo; imagens: ImagemVideo[]; som: SomVideo },
): Promise<{ animacoes: AnimacoesVideo; imagens: ImagemVideo[]; som: SomVideo }> {
  const { rows } = await db.query<{
    versao: number;
    animacoes: AnimacoesVideo | null;
    imagens: ImagemVideo[] | null;
    som: SomVideo | null;
  }>('SELECT versao, animacoes, imagens, som FROM comercial.videos WHERE id = $1', [id]);
  const a = rows[0];
  if (!a || a.versao === versaoLida) return novo;
  const imagens = (a.imagens ?? []).map((im) => {
    const n = novo.imagens.find((x) => x.id === im.id);
    if (!n || im.pedido || im.fotoId !== n.fotoId || im.origem !== n.origem) return im;
    return { ...im, chave: n.chave, conferencia: n.conferencia, posta: n.posta, descricao: n.descricao };
  });
  const som = a.som
    ? {
        ...a.som,
        musica: a.som.musica.pedirOutra
          ? a.som.musica
          : {
              ...a.som.musica,
              chave: novo.som.musica.chave,
              segundos: novo.som.musica.segundos,
              erro: novo.som.musica.erro,
            },
        efeitos: { ...a.som.efeitos, lista: novo.som.efeitos.lista },
      }
    : novo.som;
  return { animacoes: a.animacoes ?? novo.animacoes, imagens, som };
}

export async function concluir(
  db: Executor,
  id: number,
  d: {
    finalChave: string;
    capaChave: string;
    duracaoFinal: number;
    conferencia: ConferenciaVideo;
    cortes: CorteVideo[];
    custoUsd: number;
    versaoLida: number;
    animacoes: AnimacoesVideo;
    imagens: ImagemVideo[];
    som: SomVideo;
  },
): Promise<{ contouAgora: boolean }> {
  const duvidas = d.cortes.some((c) => c.duvida && !c.conferido && c.decisao === 'cortar');
  const { rows } = await db.query<{ contou_agora: boolean }>(
    `UPDATE comercial.videos v SET
            situacao = CASE WHEN $6 THEN 'revisar' ELSE 'pronto' END,
            etapa = NULL, progresso = 100, final_chave = $2, capa_chave = $3, duracao_final = $4,
            conferencia = $5, cortes = $7, erro = NULL, pronto_em = now(), atualizado_em = now(),
            custo_usd = v.custo_usd + $8,
            -- Mudou algo na revisão enquanto gerava? Continua pendente.
            mudancas_pendentes = v.versao <> $9,
            animacoes = $10, imagens = $11, som = $12,
            contou_em = COALESCE(v.contou_em, now())
      WHERE v.id = $1
      RETURNING (SELECT contou_em IS NULL FROM comercial.videos WHERE id = $1) AS contou_agora`,
    [
      id,
      d.finalChave,
      d.capaChave,
      d.duracaoFinal,
      JSON.stringify(d.conferencia),
      duvidas,
      JSON.stringify(d.cortes),
      d.custoUsd,
      d.versaoLida,
      JSON.stringify(d.animacoes),
      JSON.stringify(d.imagens),
      JSON.stringify(d.som),
    ],
  );
  return { contouAgora: !!rows[0]?.contou_agora };
}

export async function falhar(db: Executor, id: number, mensagem: string, custoUsd = 0) {
  await db.query(
    `UPDATE comercial.videos SET situacao = 'falhou', etapa = NULL, erro = $2, atualizado_em = now(),
            custo_usd = custo_usd + $3
      WHERE id = $1`,
    [id, mensagem.slice(0, 400), custoUsd],
  );
}

/** Volta para a fila (o serviço vai tentar de novo depois). */
export async function devolverParaFila(db: Executor, id: number, mensagem: string) {
  await db.query(
    `UPDATE comercial.videos SET situacao = 'na_fila', etapa = NULL, progresso = 0, erro = $2, atualizado_em = now()
      WHERE id = $1`,
    [id, mensagem.slice(0, 400)],
  );
}

/** Cores da marca: as da identidade dos carrosséis; sem ela, as de Marca própria; sem nada, o padrão. */
export async function marcaDaConta(
  db: Executor,
  contaId: number,
): Promise<{ primaria: string; destaque: string }> {
  const { rows } = await db.query<{
    p: string | null;
    d: string | null;
    mp: string | null;
    md: string | null;
  }>(
    `SELECT ci.dados #>> '{cores,principal}' AS p, ci.dados #>> '{cores,destaque}' AS d,
            o.marca_cor AS mp, o.marca_cor_destaque AS md
       FROM cadastro.contas c
       JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
       LEFT JOIN comercial.carrossel_identidade ci ON ci.conta_id = c.id
      WHERE c.id = $1`,
    [contaId],
  );
  const r = rows[0];
  const hex = (v: string | null | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
  return {
    primaria: hex(r?.p) ?? hex(r?.mp) ?? '#7c3aed',
    destaque: hex(r?.d) ?? hex(r?.md) ?? '#f97316',
  };
}

/** As fotos da empresa (as mesmas dos Carrosséis), com o que cada uma mostra. */
export async function fotosDaConta(
  db: Executor,
  contaId: number,
): Promise<(FotoParaIa & { chave: string; descrita: boolean })[]> {
  const { rows } = await db.query<{ id: number; nome: string; chave: string; descricao_ia: string | null }>(
    // As cenas geradas para os carrosséis e as referências de estilo não são fotos reais da empresa.
    `SELECT id, nome, chave, descricao_ia FROM comercial.carrossel_fotos
      WHERE conta_id = $1 AND origem IN ('enviada', 'cenario') ORDER BY id DESC LIMIT 60`,
    [contaId],
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    chave: r.chave,
    descricao: r.descricao_ia ?? '',
    descrita: !!r.descricao_ia,
  }));
}

export async function salvarDescricaoFoto(db: Executor, fotoId: number, descricao: string) {
  await db.query(
    'UPDATE comercial.carrossel_fotos SET descricao_ia = $2, descrita_em = now() WHERE id = $1',
    [fotoId, descricao.slice(0, 200)],
  );
}

/** As promoções em andamento do O que divulgar (a oferta do vídeo usa os valores exatos). */
export async function promocoesDaConta(db: Executor, contaId: number): Promise<PromocaoParaIa[]> {
  const { rows } = await db.query<{ id: number; titulo: string; dados: Record<string, unknown> }>(
    `SELECT id, titulo, dados FROM comercial.carrossel_divulgar
      WHERE conta_id = $1 AND tipo = 'promocao' AND NOT arquivado
        AND (ate IS NULL OR ate >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
      ORDER BY criado_em DESC LIMIT 10`,
    [contaId],
  );
  const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return rows.map((r) => ({
    id: r.id,
    titulo: r.titulo,
    produto: txt(r.dados.produto),
    precoDe: txt(r.dados.precoDe),
    precoPor: txt(r.dados.precoPor),
    validade: txt(r.dados.validade),
  }));
}

export async function vocabularioDaConta(db: Executor, contaId: number): Promise<string[]> {
  const { rows } = await db.query<{ v: string[] }>(
    'SELECT vocabulario AS v FROM comercial.video_preferencias WHERE conta_id = $1',
    [contaId],
  );
  return rows[0]?.v ?? [];
}

export async function registrarConsumo(
  db: Executor,
  contaId: number,
  c: {
    videos: number;
    segundosVideo: number;
    segundosServidor: number;
    transcricaoSeg: number;
    claudeUsd: number;
    custoUsd: number;
    imagens?: number;
    imagensUsd?: number;
    musicaSeg?: number;
    musicaUsd?: number;
  },
) {
  await db.query(
    `INSERT INTO cadastro.consumo_videos
       (conta_id, dia, videos, segundos_video, segundos_servidor, transcricao_seg, claude_usd, custo_usd,
        imagens, imagens_usd, musica_seg, musica_usd)
     VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (conta_id, dia) DO UPDATE SET
       videos = consumo_videos.videos + EXCLUDED.videos,
       segundos_video = consumo_videos.segundos_video + EXCLUDED.segundos_video,
       segundos_servidor = consumo_videos.segundos_servidor + EXCLUDED.segundos_servidor,
       transcricao_seg = consumo_videos.transcricao_seg + EXCLUDED.transcricao_seg,
       claude_usd = consumo_videos.claude_usd + EXCLUDED.claude_usd,
       custo_usd = consumo_videos.custo_usd + EXCLUDED.custo_usd,
       imagens = consumo_videos.imagens + EXCLUDED.imagens,
       imagens_usd = consumo_videos.imagens_usd + EXCLUDED.imagens_usd,
       musica_seg = consumo_videos.musica_seg + EXCLUDED.musica_seg,
       musica_usd = consumo_videos.musica_usd + EXCLUDED.musica_usd`,
    [
      contaId,
      c.videos,
      c.segundosVideo,
      c.segundosServidor,
      c.transcricaoSeg,
      c.claudeUsd,
      c.custoUsd,
      c.imagens ?? 0,
      c.imagensUsd ?? 0,
      c.musicaSeg ?? 0,
      c.musicaUsd ?? 0,
    ],
  );
}

/** Aviso no sino de quem enviou (o celular só pela api; aqui fica no sistema). */
export async function avisar(
  db: Executor,
  contaId: number,
  usuarioId: number,
  a: { titulo: string; texto: string; link: string },
) {
  await db.query(
    `INSERT INTO comercial.notificacoes (conta_id, usuario_id, tipo, titulo, texto, link)
     VALUES ($1, $2, 'sistema', $3, $4, $5)`,
    [contaId, usuarioId, a.titulo.slice(0, 200), a.texto.slice(0, 500), a.link],
  );
}
