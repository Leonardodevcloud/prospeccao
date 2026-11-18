import type { Executor } from '@prospeccao/db';
import {
  aplicarRegras,
  type ContextoDoPedido,
  cortesDePausa,
  noEditado,
  type Silencio,
  tempoComImagens,
} from '@prospeccao/integrations/videos';
import { AppError } from '@prospeccao/shared';
import type { novoApoioEntrada, novoVideoEntrada } from '@prospeccao/shared/videos';
import {
  type AndamentoVideo,
  type AnimacoesVideo,
  APOIO_FRACAO_MAXIMA,
  type ApoioGuardado,
  aplicarTrechos,
  apoioParaATela,
  type ConferenciaVideo,
  type CorteVideo,
  type DesenhoDoVideo,
  type DetalheVideo,
  desfazerSoOPedido,
  duracaoDosTrechos,
  type EtapaVideo,
  falaQueFica,
  IMAGEM_SEM_NO_COMECO,
  IMAGENS_FRACAO_MAXIMA,
  type ImagemVideo,
  LIMITE_SEGUNDOS_APOIO,
  MAX_APOIOS_VIDEO,
  MAX_IMAGENS_VIDEO,
  MAX_VIDEOS_CONTA,
  MIN_SEGUNDOS_NA_TELA,
  MOMENTOS_COM_ITENS,
  type MomentoVideo,
  momentosDe,
  type OpcoesVideo,
  opcoesVideoEntrada,
  type PalavraVideo,
  type ResumoVideo,
  type RevisaoVideo,
  type SituacaoVideo,
  type SomVideo,
  type TrechoSemImagem,
  tempoNoOriginal,
  trechosQueFicam,
} from '@prospeccao/shared/videos';
import type { z } from 'zod';
import { contaSql, usuarioAtual } from '../../contexto.js';

/** Vídeos com IA: o que a api guarda e devolve. Quem edita é o worker-videos. */

interface Linha {
  id: number;
  andamento?: AndamentoVideo | null;
  previa_chave?: string | null;
  previa_video_chave?: string | null;
  titulo: string;
  situacao: SituacaoVideo;
  etapa: EtapaVideo | null;
  progresso: number;
  opcoes: OpcoesVideo;
  duracao_original: string | null;
  duracao_final: string | null;
  cortes: CorteVideo[];
  palavras: PalavraVideo[];
  animacoes: AnimacoesVideo | null;
  imagens: ImagemVideo[] | null;
  sem_imagem: TrechoSemImagem[] | null;
  som: SomVideo | null;
  conferencia: ConferenciaVideo | null;
  analise: {
    silencios?: Silencio[];
    duracao?: number;
    antesDoPedido?: AntesDoPedido | null;
    /** v166: o desenho da última edição e o vídeo cortado sem legenda (o worker guarda). */
    desenho?: (Omit<DesenhoDoVideo, 'temVideo'> & { videoChave: string | null }) | null;
  } | null;
  erro: string | null;
  capa_chave: string | null;
  final_chave: string | null;
  original_chave: string;
  envio_id: string | null;
  envio_partes: { numero: number; etag: string }[];
  mudancas_pendentes: boolean;
  apoios?: ApoioGuardado[] | null;
  versao: number;
  criado_em: string;
  pronto_em: string | null;
  publicado_em: string | null;
  texto_post: string;
  hashtags: string[];
  texto_da_redatora: boolean;
  midia_link: string | null;
  midia_id: string | null;
  baixado_em: string | null;
}

const num = (v: string | null) => (v == null ? null : Number(v));
const arred = (n: number) => Math.round(n * 1000) / 1000;
const duvidas = (c: CorteVideo[]) =>
  c.filter((x) => x.duvida && !x.conferido && x.decisao === 'cortar').length;

function resumo(l: Linha): ResumoVideo {
  return {
    id: l.id,
    titulo: l.titulo,
    situacao: l.situacao,
    etapa: l.etapa,
    progresso: l.progresso,
    duracaoOriginal: num(l.duracao_original),
    duracaoFinal: num(l.duracao_final),
    duvidas: duvidas(l.cortes ?? []),
    erro: l.erro,
    temCapa: !!l.capa_chave,
    criadoEm: l.criado_em,
    prontoEm: l.pronto_em,
    publicadoEm: l.publicado_em ?? null,
  };
}

/** v161: o que a revisão tinha antes do último pedido à editora aplicado (para o Desfazer). */
interface AntesDoPedido {
  cortes: CorteVideo[];
  palavras: PalavraVideo[];
  animacoes: AnimacoesVideo | null;
  opcoes: unknown;
  som: SomVideo | null;
  situacao: SituacaoVideo;
  pendentes: boolean;
  /**
   * v169: como a revisão ficou logo depois do pedido. Com isso o Desfazer tira só o que o pedido
   * mudou e deixa o que a pessoa mexeu depois (antes voltava tudo, e levava junto cor, legenda,
   * cortes e animações feitos depois do pedido).
   */
  depois?: {
    cortes: CorteVideo[];
    palavras: PalavraVideo[];
    animacoes: AnimacoesVideo | null;
    opcoes: unknown;
    som: SomVideo | null;
  };
}

function detalhe(l: Linha): DetalheVideo {
  const o = opcoesVideoEntrada.safeParse(l.opcoes ?? {});
  return {
    ...resumo(l),
    opcoes: o.success ? o.data : opcoesVideoEntrada.parse({}),
    cortes: l.cortes ?? [],
    palavras: l.palavras ?? [],
    animacoes: l.animacoes,
    imagens: l.imagens ?? [],
    semImagem: l.sem_imagem ?? [],
    som: l.som,
    conferencia: l.conferencia,
    mudancasPendentes: l.mudancas_pendentes,
    podeDesfazerPedido: !!l.analise?.antesDoPedido,
    apoios: (l.apoios ?? []).map(apoioParaATela),
    desenho: l.analise?.desenho
      ? (({ videoChave, ...d }) => ({ ...d, temVideo: !!videoChave }))(l.analise.desenho)
      : null,
    silencios: (l.analise?.silencios ?? []).map((x) => ({ inicio: x.inicio, fim: x.fim })),
    versao: l.versao,
    textoPost: l.texto_post ?? '',
    hashtags: l.hashtags ?? [],
    textoDaRedatora: !!l.texto_da_redatora,
    midiaLink: l.midia_link ?? null,
    andamento: l.andamento ?? null,
    temPrevia: !!l.previa_chave,
    temPreviaVideo: !!l.previa_video_chave,
  };
}

async function linha(db: Executor, id: number): Promise<Linha> {
  const { rows } = await db.query<Linha>(
    `SELECT * FROM comercial.videos WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Vídeo');
  return rows[0];
}

export async function listar(db: Executor): Promise<ResumoVideo[]> {
  const { rows } = await db.query<Linha>(
    `SELECT id, titulo, situacao, etapa, progresso, opcoes, duracao_original, duracao_final, cortes, erro,
            capa_chave, criado_em, pronto_em, publicado_em
       FROM comercial.videos WHERE conta_id = ${contaSql()} ORDER BY id DESC LIMIT 200`,
  );
  return rows.map(resumo);
}

export async function buscar(db: Executor, id: number): Promise<DetalheVideo> {
  return detalhe(await linha(db, id));
}

export async function arquivos(db: Executor, id: number) {
  const l = await linha(db, id);
  return {
    titulo: l.titulo,
    original: l.original_chave,
    final: l.final_chave,
    capa: l.capa_chave,
    situacao: l.situacao,
    imagens: (l.imagens ?? []).map((i) => ({ id: i.id, chave: i.chave })),
    musica: l.som?.musica.chave ?? null,
    previa: l.previa_chave ?? null,
    previaVideo: l.previa_video_chave ?? null,
    limpo: l.analise?.desenho?.videoChave ?? null,
    apoios: (l.apoios ?? []).map((a) => ({
      id: a.id,
      // Antes de o editor preparar, a tela toca o arquivo enviado.
      video: a.chaveNorm ?? (a.enviado ? a.chave : null),
      capa: a.capaChave,
    })),
  };
}

/** Os arquivos que são só deste vídeo (as fotos da empresa ficam: são dos Carrosséis). */
export function arquivosDoVideo(l: {
  original_chave: string;
  final_chave: string | null;
  capa_chave: string | null;
  previa_chave?: string | null;
  previa_video_chave?: string | null;
  imagens?: ImagemVideo[] | null;
  som?: SomVideo | null;
  apoios?: ApoioGuardado[] | null;
  analise?: { desenho?: { videoChave: string | null } | null } | null;
}): string[] {
  return [
    l.analise?.desenho?.videoChave,
    ...(l.apoios ?? []).flatMap(arquivosDoApoio),
    l.original_chave,
    l.final_chave,
    l.capa_chave,
    l.previa_chave ?? null,
    l.previa_video_chave ?? null,
    ...(l.imagens ?? []).map((i) => i.chave),
    l.som?.musica.chave ?? null,
  ].filter((c): c is string => !!c && (c === l.original_chave || c.startsWith('videos/')));
}

/** As fotos da empresa (as mesmas dos Carrosséis), para trocar a imagem de um vídeo. */
export async function fotosDaEmpresa(
  db: Executor,
): Promise<{ id: number; nome: string; chave: string; descricao: string | null }[]> {
  const { rows } = await db.query<{ id: number; nome: string; chave: string; descricao_ia: string | null }>(
    // As cenas geradas para os carrosséis e as referências de estilo não são fotos reais da empresa.
    `SELECT id, nome, chave, descricao_ia FROM comercial.carrossel_fotos
      WHERE conta_id = ${contaSql()} AND origem IN ('enviada', 'cenario') ORDER BY id DESC LIMIT 60`,
  );
  return rows.map((r) => ({ id: r.id, nome: r.nome, chave: r.chave, descricao: r.descricao_ia }));
}

async function fotoDaEmpresa(db: Executor, id: number) {
  const { rows } = await db.query<{ id: number; nome: string; chave: string; descricao_ia: string | null }>(
    `SELECT id, nome, chave, descricao_ia FROM comercial.carrossel_fotos WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Foto da empresa');
  return rows[0];
}

/** Vídeos que contaram na franquia neste mês (a primeira edição pronta; gerar de novo não conta). */
export async function usadosNoMes(db: Executor): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.videos
      WHERE conta_id = ${contaSql()}
        AND (contou_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
             OR situacao IN ('na_fila', 'editando') AND contou_em IS NULL)`,
  );
  return rows[0]!.n;
}

export async function criar(
  db: Executor,
  d: z.infer<typeof novoVideoEntrada>,
  chave: (id: number) => string,
): Promise<number> {
  const { rows: total } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.videos WHERE conta_id = ${contaSql()}`,
  );
  if (total[0]!.n >= MAX_VIDEOS_CONTA)
    throw AppError.invalido(
      `A conta já tem ${MAX_VIDEOS_CONTA} vídeos. Apague os antigos para enviar outro.`,
    );
  const titulo = d.titulo || d.opcoes.assunto || d.nome.replace(/\.[a-z0-9]{2,4}$/i, '');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.videos (conta_id, titulo, opcoes, original_chave, original_nome, original_tipo, original_bytes, duracao_original, criado_por)
     VALUES (${contaSql()}, $1, $2, '', $3, $4, $5, $6, $7) RETURNING id`,
    [
      titulo.slice(0, 120),
      JSON.stringify(d.opcoes),
      d.nome.slice(0, 200),
      d.tipo,
      d.bytes,
      d.duracao,
      usuarioAtual()?.id ?? null,
    ],
  );
  const id = rows[0]!.id;
  await db.query('UPDATE comercial.videos SET original_chave = $2 WHERE id = $1', [id, chave(id)]);
  return id;
}

export async function guardarEnvio(db: Executor, id: number, envioId: string) {
  await db.query(`UPDATE comercial.videos SET envio_id = $2 WHERE id = $1 AND conta_id = ${contaSql()}`, [
    id,
    envioId,
  ]);
}

export async function envio(db: Executor, id: number) {
  const l = await linha(db, id);
  if (l.situacao !== 'enviando' || !l.envio_id) throw AppError.invalido('Este vídeo já foi enviado.');
  return { chave: l.original_chave, envioId: l.envio_id, partes: l.envio_partes ?? [] };
}

export async function anotarParte(db: Executor, id: number, parte: { numero: number; etag: string }) {
  await db.query(
    `UPDATE comercial.videos
        SET envio_partes = (SELECT coalesce(jsonb_agg(p), '[]') FROM jsonb_array_elements(envio_partes) p
                             WHERE (p->>'numero')::int <> $2) || jsonb_build_array(jsonb_build_object('numero', $2::int, 'etag', $3::text)),
            atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} AND situacao = 'enviando'`,
    [id, parte.numero, parte.etag],
  );
}

export async function paraFila(db: Executor, id: number) {
  await db.query(
    `UPDATE comercial.videos SET situacao = 'na_fila', etapa = NULL, progresso = 0, envio_id = NULL,
            envio_partes = '[]', erro = NULL, tentativas = 0, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
}

/* ───────────────────────── v162: vídeos de apoio ───────────────────────── */

const arquivosDoApoio = (a: ApoioGuardado): string[] =>
  [a.chave, a.chaveNorm, a.capaChave].filter((c): c is string => !!c);

async function salvarApoios(db: Executor, id: number, apoios: ApoioGuardado[], pendente = false) {
  const { rows } = await db.query<Linha>(
    `UPDATE comercial.videos SET apoios = $2, mudancas_pendentes = mudancas_pendentes OR $3, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} RETURNING *`,
    [id, JSON.stringify(apoios), pendente],
  );
  return rows[0]!;
}

/** Começa o envio de um vídeo de apoio: vale enquanto o principal sobe e depois, na revisão. */
export async function criarApoio(
  db: Executor,
  id: number,
  d: z.infer<typeof novoApoioEntrada>,
  chave: (apoioId: string) => string,
): Promise<ApoioGuardado> {
  const l = await linha(db, id);
  if (l.situacao === 'na_fila' || l.situacao === 'editando')
    throw AppError.invalido('Espere a edição terminar para mandar um vídeo de apoio.');
  if (d.duracao != null && d.duracao > LIMITE_SEGUNDOS_APOIO + 1)
    throw AppError.invalido(
      `O vídeo de apoio passa de ${Math.round(LIMITE_SEGUNDOS_APOIO / 60)} minutos. Corte um trecho antes de enviar.`,
    );
  const apoios = l.apoios ?? [];
  if (apoios.length >= MAX_APOIOS_VIDEO)
    throw AppError.invalido(
      `Até ${MAX_APOIOS_VIDEO} vídeos de apoio por vídeo: tire um antes de mandar outro.`,
    );
  const apoioId = `a${Date.now().toString(36)}${apoios.length}`;
  const novo: ApoioGuardado = {
    id: apoioId,
    nome: d.nome.slice(0, 200),
    tipo: d.tipo,
    bytes: d.bytes,
    chave: chave(apoioId),
    envioId: null,
    partes: [],
    enviado: false,
    chaveNorm: null,
    capaChave: null,
    duracao: d.duracao,
    descricao: '',
    erro: null,
  };
  await salvarApoios(db, id, [...apoios, novo]);
  return novo;
}

/** Muda um apoio (o envio anda uma parte por vez: o navegador manda em fila). */
export async function mudarApoio(
  db: Executor,
  id: number,
  apoioId: string,
  mudar: (a: ApoioGuardado) => ApoioGuardado,
): Promise<ApoioGuardado> {
  const l = await linha(db, id);
  const atual = (l.apoios ?? []).find((a) => a.id === apoioId);
  if (!atual) throw AppError.naoEncontrado('Vídeo de apoio');
  const novo = mudar(atual);
  await salvarApoios(
    db,
    id,
    (l.apoios ?? []).map((a) => (a.id === apoioId ? novo : a)),
  );
  return novo;
}

export async function apoio(db: Executor, id: number, apoioId: string): Promise<ApoioGuardado> {
  const l = await linha(db, id);
  const a = (l.apoios ?? []).find((x) => x.id === apoioId);
  if (!a) throw AppError.naoEncontrado('Vídeo de apoio');
  return a;
}

/** Tira um apoio: os trechos dele saem do vídeo; devolve os arquivos para apagar. */
export async function apagarApoio(
  db: Executor,
  id: number,
  apoioId: string,
): Promise<{ detalhe: DetalheVideo; arquivos: string[]; envioId: string | null; chave: string }> {
  const l = await linha(db, id);
  if (l.situacao === 'na_fila' || l.situacao === 'editando')
    throw AppError.invalido('Espere a edição terminar para tirar o vídeo de apoio.');
  const a = (l.apoios ?? []).find((x) => x.id === apoioId);
  if (!a) throw AppError.naoEncontrado('Vídeo de apoio');
  const antes = l.imagens ?? [];
  const imagens = antes.filter((i) => i.apoioId !== apoioId);
  const usado = antes.some((i) => i.apoioId === apoioId && i.usar);
  const { rows } = await db.query<Linha>(
    `UPDATE comercial.videos SET apoios = $2, imagens = $3, mudancas_pendentes = mudancas_pendentes OR $4,
            versao = versao + 1, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} RETURNING *`,
    [id, JSON.stringify((l.apoios ?? []).filter((x) => x.id !== apoioId)), JSON.stringify(imagens), usado],
  );
  return {
    detalhe: detalhe(rows[0]!),
    arquivos: a.enviado ? arquivosDoApoio(a) : arquivosDoApoio(a).filter((c) => c !== a.chave),
    envioId: a.enviado ? null : a.envioId,
    chave: a.chave,
  };
}

/**
 * v163: espalha trechos dos vídeos de apoio pelo vídeo já editado (um a cada 5 s de fala), sem
 * mexer nas imagens que já estão lá nem nos pontos em que a IA pediu o rosto. Vale para o vídeo
 * editado antes de o apoio existir, ou quando a pessoa quer mais trechos.
 */
export async function espalharApoio(db: Executor, id: number, versao: number): Promise<DetalheVideo> {
  const l = await linha(db, id);
  if (l.versao !== versao)
    throw new AppError(409, 'conflito', 'Outra pessoa mudou este vídeo agora há pouco. Recarregue para ver.');
  if (l.situacao !== 'pronto' && l.situacao !== 'revisar')
    throw AppError.invalido('Espere a edição terminar para espalhar o apoio.');
  const apoios = (l.apoios ?? [])
    .filter((a) => a.enviado && !a.erro)
    .map((a) => ({ id: a.id, descricao: a.descricao || a.nome, duracao: a.duracao ?? 8 }));
  if (!apoios.length) throw AppError.invalido('Mande um vídeo de apoio primeiro.');
  const palavras = l.palavras ?? [];
  const duracao = Number(l.analise?.duracao ?? l.duracao_original ?? 0);
  const ficam = trechosQueFicam(duracao, l.cortes ?? []);
  const atuais = l.imagens ?? [];
  const propostas = aplicarRegras(
    { momentos: [], imagens: [], semImagem: [], musica: { clima: 'confiante', estilo: '' } },
    {
      palavras,
      ficam,
      duracaoEditado: duracaoDosTrechos(ficam),
      comTitulo: !!l.animacoes?.titulo.usar && !!l.animacoes.titulo.texto,
      modo: 'nenhuma',
      fotos: [],
      promocoes: [],
      apoios,
    },
  ).imagens;
  const livres = propostas.filter(
    (n) =>
      !atuais.some((i) => i.usar && i.inicio < n.fim + 2 && n.inicio < i.fim + 2) &&
      !(l.sem_imagem ?? []).slice(1).some((s) => s.inicio < n.fim && n.inicio < s.fim),
  );
  // O total com o que já havia continua dentro do limite do apoio.
  const teto = duracaoDosTrechos(ficam) * APOIO_FRACAO_MAXIMA;
  let total = tempoComImagens(atuais, ficam);
  const novas: ImagemVideo[] = [];
  for (const n of livres) {
    const a = noEditado(n.inicio, ficam);
    const b = noEditado(n.fim, ficam);
    if (a == null || b == null || total + (b - a) > teto) continue;
    total += b - a;
    novas.push({ ...n, id: `ia${Date.now().toString(36)}${novas.length}` });
  }
  if (!novas.length)
    throw AppError.invalido('Não achei espaço livre: o vídeo já tem imagem ou apoio nos pontos possíveis.');
  const { rows } = await db.query<Linha>(
    `UPDATE comercial.videos SET imagens = $2, mudancas_pendentes = true, versao = versao + 1, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} RETURNING *`,
    [id, JSON.stringify([...atuais, ...novas].sort((x, y) => x.inicio - y.inicio))],
  );
  return detalhe(rows[0]!);
}

/** A fala entre dois instantes do original (para a imagem ou animação posta à mão). */
function falaEntre(palavras: PalavraVideo[], a: number, b: number) {
  return palavras
    .filter((p) => p.f > a && p.i < b)
    .map((p) => p.t)
    .join(' ')
    .slice(0, 200);
}

/**
 * Foto que a pessoa mandou para uma imagem do vídeo (ou para pôr uma imagem nova num momento).
 * A chave já foi gravada no armazenamento pela rota; devolve a chave que saiu (para apagar).
 */
export async function usarFotoPropria(
  db: Executor,
  id: number,
  d: { imagemId: string | null; em: number | null; chave: string },
): Promise<{ detalhe: DetalheVideo; antiga: string | null }> {
  const l = await linha(db, id);
  if (['enviando', 'na_fila', 'editando'].includes(l.situacao))
    throw AppError.invalido('Espere a edição terminar para mudar as imagens.');
  const imagens = [...(l.imagens ?? [])];
  let antiga: string | null = null;
  if (d.imagemId) {
    const k = imagens.findIndex((i) => i.id === d.imagemId);
    if (k < 0) throw AppError.naoEncontrado('Imagem');
    antiga = imagens[k]!.chave?.startsWith('videos/') ? imagens[k]!.chave : null;
    imagens[k] = {
      ...imagens[k]!,
      origem: 'propria',
      fotoId: null,
      chave: d.chave,
      descricao: 'Foto sua',
      pedido: null,
      conferencia: null,
      usar: true,
    };
  } else {
    if (d.em == null) throw AppError.invalido('Diga em que momento a imagem entra.');
    imagens.push(novaImagemNoMomento(l, imagens, d.em, { origem: 'propria', chave: d.chave, fotoId: null }));
  }
  const { rows } = await db.query<Linha>(
    `UPDATE comercial.videos SET imagens = $2, mudancas_pendentes = true, versao = versao + 1, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} RETURNING *`,
    [id, JSON.stringify(imagens)],
  );
  return { detalhe: detalhe(rows[0]!), antiga };
}

const DURACAO_IMAGEM_MANUAL = 3;

/** Onde o próximo trecho de um apoio começa: depois do último já usado (volta ao começo se acabar). */
function proximoTrechoDoApoio(
  imagens: ImagemVideo[],
  a: { id: string; duracao: number | null },
  segundos: number,
): number {
  const fimDoUltimo = Math.max(
    0,
    ...imagens.filter((i) => i.apoioId === a.id).map((i) => (i.apoioDe ?? 0) + (i.fim - i.inicio)),
  );
  return a.duracao != null && fimDoUltimo + segundos <= a.duracao ? Math.round(fimDoUltimo * 100) / 100 : 0;
}

/** Uma imagem nova no momento `em` (tempo do editado), conferindo as regras. */
function novaImagemNoMomento(
  l: Linha,
  imagens: ImagemVideo[],
  em: number,
  o: Pick<ImagemVideo, 'origem' | 'chave' | 'fotoId'> & {
    descricao?: string;
    apoio?: { id: string; duracao: number | null };
  },
): ImagemVideo {
  if (imagens.filter((i) => i.usar).length >= MAX_IMAGENS_VIDEO)
    throw AppError.invalido(`Até ${MAX_IMAGENS_VIDEO} imagens por vídeo: tire uma antes de pôr outra.`);
  const duracao = Number(l.analise?.duracao ?? l.duracao_original ?? 0);
  const ficam = trechosQueFicam(duracao, l.cortes ?? []);
  const editado = duracaoDosTrechos(ficam);
  if (em < IMAGEM_SEM_NO_COMECO)
    throw AppError.invalido('Nos 2 primeiros segundos fica o seu rosto: escolha um momento depois.');
  const fimE = Math.min(
    editado - 0.6,
    em + Math.min(DURACAO_IMAGEM_MANUAL, o.apoio?.duracao ?? DURACAO_IMAGEM_MANUAL),
  );
  if (fimE - em < 1.4) throw AppError.invalido('Esse momento está muito perto do fim do vídeo.');
  const ini = tempoNoOriginal(em, ficam);
  const fim = tempoNoOriginal(fimE, ficam);
  if (ini == null || fim == null) throw AppError.invalido('Esse momento não está no vídeo.');
  const ocupado = imagens.some((i) => {
    if (!i.usar) return false;
    const a = noEditado(i.inicio, ficam);
    const b = noEditado(i.fim, ficam);
    return a != null && b != null && a < fimE + 0.3 && em < b + 0.3;
  });
  if (ocupado) throw AppError.invalido('Já tem uma imagem nesse momento.');
  const fracao = o.apoio ? APOIO_FRACAO_MAXIMA : IMAGENS_FRACAO_MAXIMA;
  if (tempoComImagens(imagens, ficam) + (fimE - em) > editado * fracao + 0.05)
    throw AppError.invalido(
      `O vídeo já tem imagem em quase ${Math.round(fracao * 100)}% do tempo. Tire uma antes de pôr outra, para o seu rosto continuar aparecendo.`,
    );
  return {
    id: `im${Date.now().toString(36)}`,
    inicio: ini,
    fim,
    fala: falaEntre(l.palavras ?? [], ini, fim),
    motivo: 'Você pôs aqui.',
    origem: o.origem,
    fotoId: o.fotoId,
    chave: o.chave,
    descricao: o.descricao ?? '',
    encaixe: o.apoio ? 'cheia' : 'acima',
    usar: true,
    pedido: o.chave || o.apoio ? null : 'escolher',
    conferencia: null,
    posta: null,
    manual: true,
    ...(o.apoio ? { apoioId: o.apoio.id, apoioDe: proximoTrechoDoApoio(imagens, o.apoio, fimE - em) } : {}),
  };
}

export async function apagar(db: Executor, id: number): Promise<Linha & { arquivosDaRegra: string[] }> {
  const l = await linha(db, id);
  // A regra que ainda esperava o Reels sai junto (a que já está valendo fica, sem o vídeo).
  const { rows: regras } = await db.query<{ arquivo_chave: string | null }>(
    `DELETE FROM comercial.instagram_regras WHERE video_id = $1 AND conta_id = ${contaSql()} AND alvo = 'video'
     RETURNING arquivo_chave`,
    [id],
  );
  await db.query(`DELETE FROM comercial.videos WHERE id = $1 AND conta_id = ${contaSql()}`, [id]);
  return { ...l, arquivosDaRegra: regras.flatMap((r) => (r.arquivo_chave ? [r.arquivo_chave] : [])) };
}

/* ───────────────────────────── v131: o texto do post ───────────────────────────── */

/** A palavra do "Comente X" do fim do vídeo (a chamada revisada vale mais que a da criação). */
function palavraDoVideo(a: AnimacoesVideo | null, o: OpcoesVideo): string | null {
  const c = a?.chamada ?? { usar: true, ...o.chamada };
  return c.usar && c.tipo === 'comente' && c.palavra ? c.palavra.toUpperCase() : null;
}

/** O que a aba Publicação e a redatora precisam do vídeo. */
export async function paraPublicar(db: Executor, id: number) {
  const l = await linha(db, id);
  const o = opcoesVideoEntrada.safeParse(l.opcoes ?? {});
  const opcoes = o.success ? o.data : opcoesVideoEntrada.parse({});
  const duracao = l.analise?.duracao ?? num(l.duracao_original) ?? 0;
  const ficam = trechosQueFicam(duracao, l.cortes ?? []);
  const oferta = momentosDe(l.animacoes).find((m) => m.tipo === 'oferta' && m.usar !== false);
  return {
    id: l.id,
    titulo: l.titulo,
    situacao: l.situacao,
    opcoes,
    fala: falaQueFica(l.palavras ?? [], ficam),
    textoPost: l.texto_post ?? '',
    hashtags: l.hashtags ?? [],
    textoDaRedatora: !!l.texto_da_redatora,
    divulgarId: oferta?.divulgarId ?? null,
    palavra: palavraDoVideo(l.animacoes, opcoes),
    midiaId: l.midia_id ?? null,
    midiaLink: l.midia_link ?? null,
    publicadoEm: l.publicado_em ?? null,
    prontoEm: l.pronto_em,
    baixadoEm: l.baixado_em ?? null,
    criadoEm: l.criado_em,
  };
}

export async function salvarTextoPost(
  db: Executor,
  id: number,
  d: { texto: string; hashtags: string[]; daRedatora: boolean },
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.videos SET texto_post = $2, hashtags = $3, texto_da_redatora = $4, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, d.texto, d.hashtags, d.daRedatora],
  );
  if (!rowCount) throw AppError.naoEncontrado('Vídeo');
}

export async function marcarBaixado(db: Executor, id: number): Promise<void> {
  await db.query(
    `UPDATE comercial.videos SET baixado_em = now() WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
}

/**
 * Grava o que a pessoa mudou na revisão: devolver um corte, corrigir uma palavra, o título, a
 * chamada, o estilo, o ritmo. Ritmo novo refaz as pausas pelos silêncios guardados (as palavras que
 * a IA tirou continuam). O vídeo só muda ao gerar de novo; as dúvidas conferidas tiram o "para revisar".
 */
export async function revisar(
  db: Executor,
  id: number,
  r: RevisaoVideo,
  deps: { imagensGeradas: boolean; musicaLiberada: boolean } = {
    imagensGeradas: false,
    musicaLiberada: false,
  },
): Promise<DetalheVideo> {
  const l = await linha(db, id);
  if (l.versao !== r.versao)
    throw new AppError(409, 'conflito', 'Outra pessoa mudou este vídeo agora há pouco. Recarregue para ver.');
  if (l.situacao === 'enviando' || l.situacao === 'na_fila' || l.situacao === 'editando')
    throw AppError.invalido('Espere a edição terminar para revisar.');
  let cortes = l.cortes ?? [];
  let mudou = false;
  const porId = new Map(r.cortes.map((c) => [c.id, c]));
  cortes = cortes.map((c) => {
    const m = porId.get(c.id);
    if (!m) return c;
    if (m.decisao !== c.decisao) mudou = true;
    return { ...c, decisao: m.decisao, conferido: m.conferido || c.conferido };
  });
  const palavras = [...(l.palavras ?? [])];
  // v142: cortar ou devolver um trecho escolhido palavra por palavra.
  if (r.trechos.length) {
    cortes = aplicarTrechos(cortes, palavras, r.trechos);
    mudou = true;
  }
  for (const p of r.palavras) {
    const atual = palavras[p.indice];
    if (!atual || atual.t === p.texto) continue;
    palavras[p.indice] = { ...atual, t: p.texto, conferir: false };
    mudou = true;
  }
  const opcoes = opcoesVideoEntrada.parse({ ...(l.opcoes ?? {}) });
  for (const k of ['estilo', 'ritmo', 'transicao', 'transicaoApoio', 'imagem', 'acabamento'] as const)
    if (r[k] && r[k] !== opcoes[k]) {
      (opcoes as Record<string, unknown>)[k] = r[k];
      mudou = true;
    }
  // v166: a legenda (fonte, tamanho, cores, posição) e a posição do título e das animações.
  if (r.legenda && JSON.stringify(r.legenda) !== JSON.stringify(opcoes.legenda)) {
    opcoes.legenda = r.legenda;
    mudou = true;
  }
  if (r.camadas && JSON.stringify(r.camadas) !== JSON.stringify(opcoes.camadas)) {
    opcoes.camadas = r.camadas;
    mudou = true;
  }
  // v167: a tarja com o nome e o cargo de quem fala.
  if (r.tarja && JSON.stringify(r.tarja) !== JSON.stringify(opcoes.tarja)) {
    opcoes.tarja = r.tarja;
    mudou = true;
  }
  if (r.cores !== undefined && JSON.stringify(r.cores) !== JSON.stringify(opcoes.cores ?? null)) {
    opcoes.cores = r.cores;
    mudou = true;
  }
  if (r.ritmo && l.analise?.silencios && l.analise.duracao && r.ritmo !== (l.opcoes?.ritmo ?? 'dinamico')) {
    const decididos = cortes.filter((c) => c.tipo !== 'pausa');
    const pausas = cortesDePausa(l.analise.silencios, r.ritmo, l.analise.duracao).filter(
      (p) => !decididos.some((c) => p.inicio >= c.inicio - 0.05 && p.fim <= c.fim + 0.05),
    );
    cortes = [...decididos, ...pausas.map((p, k) => ({ ...p, id: `p${Date.now().toString(36)}${k}` }))].sort(
      (a, b) => a.inicio - b.inicio,
    );
  }
  let animacoes = l.animacoes;
  if (
    animacoes &&
    r.titulo &&
    (r.titulo.usar !== animacoes.titulo.usar || r.titulo.texto !== animacoes.titulo.texto)
  ) {
    animacoes = { ...animacoes, titulo: { usar: r.titulo.usar, texto: r.titulo.texto.toUpperCase() } };
    mudou = true;
  }
  if (animacoes && r.chamada) {
    const c = animacoes.chamada;
    if (
      r.chamada.usar !== c.usar ||
      r.chamada.tipo !== c.tipo ||
      r.chamada.palavra !== c.palavra ||
      r.chamada.texto !== c.texto
    ) {
      animacoes = { ...animacoes, chamada: { ...r.chamada } };
      mudou = true;
    }
  }
  // v129: as animações que acompanham a fala.
  if (animacoes && (r.momentos.length || r.novoMomento || r.novosMomentos.length)) {
    let momentos: MomentoVideo[] = momentosDe(animacoes).map((m) => {
      const e = r.momentos.find((x) => x.id === m.id);
      if (!e) return m;
      const novo = {
        ...m,
        usar: e.usar ?? m.usar,
        titulo: e.titulo != null ? e.titulo.toUpperCase() : m.titulo,
        numero: e.numero ?? m.numero,
        itens:
          e.itens && MOMENTOS_COM_ITENS.includes(m.tipo)
            ? m.itens.map((it, n) => ({ ...it, texto: (e.itens![n] ?? it.texto).toUpperCase() }))
            : m.itens,
      };
      if (JSON.stringify(novo) !== JSON.stringify(m)) mudou = true;
      return novo;
    });
    if (r.novoMomento) {
      const n = r.novoMomento;
      if (n.tipo === 'selo' && !n.titulo) throw AppError.invalido('Escreva o texto do selo.');
      if (n.tipo === 'numero' && !n.numero) throw AppError.invalido('Escreva o número.');
      const duracao = Number(l.analise?.duracao ?? l.duracao_original ?? 0);
      const ficam = trechosQueFicam(duracao, cortes);
      const fimE = Math.min(duracaoDosTrechos(ficam) - 0.6, n.em + (n.tipo === 'destaque' ? 2 : 2.8));
      const ini = tempoNoOriginal(n.em, ficam);
      const fim = tempoNoOriginal(fimE, ficam);
      if (ini == null || fim == null || fimE - n.em < 0.8)
        throw AppError.invalido('Esse momento não está no vídeo (ou está perto demais do fim).');
      momentos = [
        ...momentos,
        {
          id: `mm${Date.now().toString(36)}`,
          tipo: n.tipo,
          inicio: ini,
          fim,
          fala: falaEntre(palavras, ini, fim),
          usar: true,
          titulo: n.titulo.toUpperCase(),
          numero: n.numero,
          itens: [],
          divulgarId: null,
          oferta: null,
          manual: true,
        },
      ].sort((a, b) => a.inicio - b.inicio);
      mudou = true;
    }
    // v161: as animações pedidas à editora (com itens, cada um no momento em que é falado).
    if (r.novosMomentos.length) {
      const duracao = Number(l.analise?.duracao ?? l.duracao_original ?? 0);
      const ficam = trechosQueFicam(duracao, cortes);
      const fimDoVideo = duracaoDosTrechos(ficam) - 0.6;
      for (const [k, n] of r.novosMomentos.entries()) {
        const itens = n.itens
          .map((i) => ({
            texto: i.texto.toUpperCase(),
            em: tempoNoOriginal(Math.min(i.em, fimDoVideo), ficam),
          }))
          .filter((i): i is { texto: string; em: number } => i.em != null);
        if (MOMENTOS_COM_ITENS.includes(n.tipo) && itens.length < 2) continue;
        const fimE = Math.min(fimDoVideo, Math.max(n.ate ?? 0, n.em + (n.tipo === 'destaque' ? 2 : 2.8)));
        const ini = tempoNoOriginal(n.em, ficam);
        const fim = tempoNoOriginal(fimE, ficam);
        if (ini == null || fim == null || fimE - n.em < 0.8) continue;
        // A nova fica no lugar da que já estava ali (duas não cabem acima da cabeça ao mesmo tempo).
        if (n.tipo !== 'destaque')
          momentos = momentos.map((m) =>
            m.usar && m.tipo !== 'destaque' && m.inicio < fim + 0.3 && ini < m.fim + 0.3
              ? { ...m, usar: false }
              : m,
          );
        momentos.push({
          id: `me${Date.now().toString(36)}${k}`,
          tipo: n.tipo,
          inicio: ini,
          fim,
          fala: falaEntre(palavras, ini, fim),
          usar: true,
          titulo:
            n.tipo === 'compara' || n.tipo === 'troca' || n.tipo === 'destaque' ? '' : n.titulo.toUpperCase(),
          numero: n.tipo === 'numero' ? n.numero : '',
          itens: MOMENTOS_COM_ITENS.includes(n.tipo) ? itens : [],
          divulgarId: null,
          oferta: null,
          manual: true,
        });
      }
      momentos.sort((a, b) => a.inicio - b.inicio);
      mudou = true;
    }
    animacoes = { ...animacoes, momentos };
  }

  // v129: as imagens.
  let imagens = [...(l.imagens ?? [])];
  for (const e of r.imagens) {
    const k = imagens.findIndex((i) => i.id === e.id);
    if (k < 0) continue;
    const atual = imagens[k]!;
    let novo: ImagemVideo = { ...atual, usar: e.usar ?? atual.usar, encaixe: e.encaixe ?? atual.encaixe };
    if (e.fotoId != null && e.fotoId !== atual.fotoId) {
      const f = await fotoDaEmpresa(db, e.fotoId);
      novo = {
        ...novo,
        origem: 'empresa',
        fotoId: f.id,
        chave: f.chave,
        descricao: f.descricao_ia ?? f.nome,
        pedido: null,
        conferencia: null,
        usar: true,
        apoioId: null,
      };
    }
    // v162: trocar por um trecho de um vídeo de apoio, ou mudar onde o trecho começa.
    if (e.apoioId != null && e.apoioId !== atual.apoioId) {
      const a = (l.apoios ?? []).find((x) => x.id === e.apoioId);
      if (!a?.enviado) throw AppError.invalido('Esse vídeo de apoio não está mais neste vídeo.');
      novo = {
        ...novo,
        origem: 'apoio',
        fotoId: null,
        chave: null,
        descricao: a.descricao,
        encaixe: 'cheia',
        pedido: null,
        conferencia: null,
        usar: true,
        apoioId: a.id,
        apoioDe: proximoTrechoDoApoio(imagens, a, atual.fim - atual.inicio),
      };
    }
    if (e.apoioDe != null && novo.origem === 'apoio') {
      const a = (l.apoios ?? []).find((x) => x.id === novo.apoioId);
      const sobra = (a?.duracao ?? LIMITE_SEGUNDOS_APOIO) - (novo.fim - novo.inicio);
      novo = { ...novo, apoioDe: Math.max(0, Math.min(e.apoioDe, Math.max(0, sobra))) };
    }
    // v169: aumentar ou diminuir o tempo na tela. Os limites são só os físicos: não entrar na
    // próxima imagem, não passar do fim do vídeo e, no apoio, não passar do que o apoio tem.
    if (e.segundos != null && novo.usar) {
      const seguinte = imagens
        .filter((x) => x.usar && x.id !== novo.id && x.inicio > novo.inicio)
        .sort((x, y) => x.inicio - y.inicio)[0];
      let segundos = e.segundos;
      if (novo.origem === 'apoio') {
        const a = (l.apoios ?? []).find((x) => x.id === novo.apoioId);
        if (a?.duracao) {
          segundos = Math.min(segundos, a.duracao);
          // O trecho começa mais cedo no apoio quando o que sobra dele não cobre o tempo pedido.
          novo = { ...novo, apoioDe: arred(Math.max(0, Math.min(novo.apoioDe ?? 0, a.duracao - segundos))) };
        }
      }
      const teto = Math.min(
        (l.analise?.duracao ?? num(l.duracao_original) ?? Number.POSITIVE_INFINITY) - 0.2,
        seguinte ? seguinte.inicio - 0.2 : Number.POSITIVE_INFINITY,
      );
      const fim = Math.max(novo.inicio + MIN_SEGUNDOS_NA_TELA, Math.min(novo.inicio + segundos, teto));
      novo = { ...novo, fim: arred(fim) };
    }
    if (e.pedido === 'gerar_outra') {
      if (!deps.imagensGeradas)
        throw AppError.invalido(
          'A geração de imagens não está ligada. Troque por uma foto da empresa ou sua.',
        );
      novo = { ...novo, origem: 'gerada', fotoId: null, pedido: 'gerar_outra', usar: true, apoioId: null };
    } else if (e.pedido === null && atual.pedido === 'gerar_outra') novo = { ...novo, pedido: null };
    if (JSON.stringify(novo) !== JSON.stringify(atual)) mudou = true;
    imagens[k] = novo;
  }
  if (r.novaImagem) {
    const f = r.novaImagem.fotoId != null ? await fotoDaEmpresa(db, r.novaImagem.fotoId) : null;
    const ap = r.novaImagem.apoioId ? (l.apoios ?? []).find((x) => x.id === r.novaImagem!.apoioId) : null;
    if (r.novaImagem.apoioId && !ap?.enviado)
      throw AppError.invalido('Esse vídeo de apoio não está mais neste vídeo.');
    imagens = [
      ...imagens,
      novaImagemNoMomento({ ...l, cortes }, imagens, r.novaImagem.em, {
        ...(ap ? { apoio: { id: ap.id, duracao: ap.duracao } } : {}),
        origem: ap ? 'apoio' : f ? 'empresa' : 'gerada',
        chave: f?.chave ?? null,
        fotoId: f?.id ?? null,
        descricao: f ? (f.descricao_ia ?? f.nome) : '',
      }),
    ].sort((a, b) => a.inicio - b.inicio);
    mudou = true;
  }

  // v129: música e efeitos.
  let som = l.som;
  if (som && (r.musica || r.efeitos)) {
    const m = { ...som.musica };
    if (r.musica) {
      if (r.musica.usar && !deps.musicaLiberada)
        throw AppError.invalido('A música ainda não foi ligada na plataforma. Fale com a gente.');
      if (r.musica.usar != null) m.usar = r.musica.usar;
      if (r.musica.clima && r.musica.clima !== m.clima) {
        m.clima = r.musica.clima;
        m.estiloIa = '';
        m.pedirOutra = true;
      }
      if (r.musica.descricao != null && r.musica.descricao !== m.descricao) {
        m.descricao = r.musica.descricao;
        m.pedirOutra = true;
      }
      if (r.musica.volume != null) m.volume = r.musica.volume;
      if (r.musica.outra) m.pedirOutra = true;
      if (m.usar) m.erro = null;
    }
    const efeitos = {
      ...som.efeitos,
      ligados: r.efeitos?.ligados ?? som.efeitos.ligados,
      desligados: r.efeitos?.desligados ?? som.efeitos.desligados,
    };
    const novo = { musica: m, efeitos };
    if (JSON.stringify(novo) !== JSON.stringify(som)) mudou = true;
    som = novo;
  }

  const situacao = l.situacao === 'revisar' && duvidas(cortes) === 0 ? 'pronto' : l.situacao;
  // v161: o pedido à editora guarda o estado de antes (um nível de Desfazer).
  const antes: AntesDoPedido | null =
    r.doPedido && mudou
      ? {
          cortes: l.cortes ?? [],
          palavras: l.palavras ?? [],
          animacoes: l.animacoes,
          opcoes: l.opcoes ?? {},
          som: l.som,
          situacao: l.situacao,
          pendentes: l.mudancas_pendentes,
          depois: { cortes, palavras, animacoes: animacoes ?? null, opcoes, som: som ?? null },
        }
      : null;
  const { rows } = await db.query<Linha>(
    `UPDATE comercial.videos SET cortes = $2, palavras = $3, animacoes = $4, opcoes = $5, situacao = $6,
            mudancas_pendentes = mudancas_pendentes OR $7, imagens = $8, som = $9,
            analise = CASE WHEN $10::jsonb IS NULL THEN analise
                           ELSE coalesce(analise, '{}'::jsonb) || jsonb_build_object('antesDoPedido', $10::jsonb) END,
            versao = versao + 1, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} RETURNING *`,
    [
      id,
      JSON.stringify(cortes),
      JSON.stringify(palavras),
      animacoes ? JSON.stringify(animacoes) : null,
      JSON.stringify(opcoes),
      situacao,
      mudou,
      JSON.stringify(imagens),
      som ? JSON.stringify(som) : null,
      antes ? JSON.stringify(antes) : null,
    ],
  );
  return detalhe(rows[0]!);
}

/** v161: o que a editora precisa saber do vídeo para responder a um pedido. */
export async function contextoDoPedido(
  db: Executor,
  id: number,
  deps: { musicaLiberada: boolean },
): Promise<ContextoDoPedido> {
  const l = await linha(db, id);
  if (l.situacao !== 'pronto' && l.situacao !== 'revisar')
    throw AppError.invalido('Espere a edição terminar para pedir mudanças.');
  const palavras = l.palavras ?? [];
  if (!palavras.length)
    throw AppError.invalido('Este vídeo não tem a fala guardada: a editora não tem o que ler.');
  const cortes = l.cortes ?? [];
  const duracao = Number(l.analise?.duracao ?? l.duracao_original ?? 0);
  const o = opcoesVideoEntrada.safeParse(l.opcoes ?? {});
  return {
    palavras,
    cortes,
    ficam: trechosQueFicam(duracao, cortes),
    animacoes: l.animacoes,
    som: l.som,
    estilo: o.success ? o.data.estilo : 'acesa',
    cores: o.success ? o.data.cores : null,
    musicaLiberada: deps.musicaLiberada,
  };
}

/** v161: volta a revisão para como estava antes do último pedido à editora aplicado. */
export async function desfazerPedido(db: Executor, id: number, versao: number): Promise<DetalheVideo> {
  const l = await linha(db, id);
  if (l.versao !== versao)
    throw new AppError(409, 'conflito', 'Outra pessoa mudou este vídeo agora há pouco. Recarregue para ver.');
  if (l.situacao === 'enviando' || l.situacao === 'na_fila' || l.situacao === 'editando')
    throw AppError.invalido('Espere a edição terminar para desfazer.');
  const a = l.analise?.antesDoPedido;
  if (!a) throw AppError.invalido('Não há pedido para desfazer.');
  // v169: só o que o pedido mudou volta; o que foi mexido depois dele fica.
  const d = a.depois;
  const volta = d
    ? {
        cortes: desfazerSoOPedido(a.cortes, d.cortes, l.cortes ?? []),
        palavras: desfazerSoOPedido(a.palavras, d.palavras, l.palavras ?? []),
        animacoes: desfazerSoOPedido(a.animacoes, d.animacoes, l.animacoes),
        opcoes: desfazerSoOPedido(a.opcoes ?? {}, d.opcoes ?? {}, l.opcoes ?? {}),
        som: desfazerSoOPedido(a.som, d.som, l.som),
      }
    : a;
  const ficouAlgo =
    !!d &&
    JSON.stringify([volta.cortes, volta.palavras, volta.animacoes, volta.opcoes, volta.som]) !==
      JSON.stringify([a.cortes, a.palavras, a.animacoes, a.opcoes ?? {}, a.som]);
  const { rows } = await db.query<Linha>(
    `UPDATE comercial.videos SET cortes = $2, palavras = $3, animacoes = $4, opcoes = $5, som = $6, situacao = $7,
            mudancas_pendentes = $8, analise = analise - 'antesDoPedido',
            versao = versao + 1, atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()} RETURNING *`,
    [
      id,
      JSON.stringify(volta.cortes),
      JSON.stringify(volta.palavras),
      volta.animacoes ? JSON.stringify(volta.animacoes) : null,
      JSON.stringify(volta.opcoes ?? {}),
      volta.som ? JSON.stringify(volta.som) : null,
      // O vídeo pode ter sido gerado de novo depois do pedido: aí desfazer é uma mudança a gerar.
      l.situacao === 'pronto' || l.situacao === 'revisar'
        ? duvidas(volta.cortes)
          ? 'revisar'
          : 'pronto'
        : l.situacao,
      // Ficou alguma mudança feita depois do pedido? Continua havendo o que gerar.
      a.pendentes || !l.mudancas_pendentes || ficouAlgo,
    ],
  );
  return detalhe(rows[0]!);
}

/** Gerar de novo: volta para a fila no modo que reaproveita a fala e o mapa do rosto. */
export async function pedirDeNovo(db: Executor, id: number): Promise<void> {
  const l = await linha(db, id);
  if (!['pronto', 'revisar', 'falhou'].includes(l.situacao))
    throw AppError.invalido('Este vídeo ainda está sendo editado.');
  if (!l.palavras?.length && l.situacao !== 'falhou')
    throw AppError.invalido('Este vídeo não tem a fala guardada para gerar de novo.');
  await db.query(
    `UPDATE comercial.videos SET situacao = 'na_fila', etapa = NULL, progresso = 0, erro = NULL, tentativas = 0,
            atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
}

/**
 * v164: ouvir a fala de novo e refazer a edição do zero (a transcrição, os cortes, as animações e
 * as imagens são refeitos; o que foi mudado na revisão se perde). Para o vídeo editado antes de
 * uma melhoria na escuta, ou quando as palavras saíram no lugar errado.
 */
export async function pedirDoZero(db: Executor, id: number): Promise<void> {
  const l = await linha(db, id);
  if (!['pronto', 'revisar', 'falhou'].includes(l.situacao))
    throw AppError.invalido('Este vídeo ainda está sendo editado.');
  if (!l.original_chave) throw AppError.invalido('O vídeo original não está mais guardado: envie de novo.');
  await db.query(
    `UPDATE comercial.videos SET situacao = 'na_fila', etapa = NULL, progresso = 0, erro = NULL, tentativas = 0,
            mudancas_pendentes = false, analise = analise - 'antesDoPedido', atualizado_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
}

export async function vocabulario(db: Executor): Promise<string[]> {
  const { rows } = await db.query<{ v: string[] }>(
    `SELECT vocabulario AS v FROM comercial.video_preferencias WHERE conta_id = ${contaSql()}`,
  );
  return rows[0]?.v ?? [];
}

export async function salvarVocabulario(db: Executor, palavras: string[]): Promise<void> {
  await db.query(
    `INSERT INTO comercial.video_preferencias (conta_id, vocabulario) VALUES (${contaSql()}, $1)
     ON CONFLICT (conta_id) DO UPDATE SET vocabulario = EXCLUDED.vocabulario, atualizado_em = now()`,
    [palavras],
  );
}

/** O worker-videos deu sinal de vida nos últimos 3 minutos? */
/** A música está ligada quando o worker-videos tem a chave da ElevenLabs (o último sinal de vida diz). */
export async function musicaNoWorker(db: Executor): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT coalesce((info->>'musica')::boolean, false) AS ok FROM cadastro.servicos_vivos WHERE nome = 'worker-videos'`,
  );
  return !!rows[0]?.ok;
}

export async function servicoNoAr(db: Executor): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT visto_em > now() - interval '3 minutes' AS ok FROM cadastro.servicos_vivos WHERE nome = 'worker-videos'`,
  );
  return !!rows[0]?.ok;
}

/** Vídeos na fila antes deste (para a tela dizer "na fila, 2 antes do seu"). */
export async function naFrente(db: Executor, id: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.videos WHERE situacao IN ('na_fila', 'editando') AND id < $1`,
    [id],
  );
  return rows[0]!.n;
}
