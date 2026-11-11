import type { Executor } from '@prospeccao/db';
import { cortesDePausa, noEditado, type Silencio, tempoComImagens } from '@prospeccao/integrations/videos';
import { AppError } from '@prospeccao/shared';
import type { novoVideoEntrada } from '@prospeccao/shared/videos';
import {
  type AnimacoesVideo,
  type ConferenciaVideo,
  type CorteVideo,
  type DetalheVideo,
  duracaoDosTrechos,
  type EtapaVideo,
  IMAGEM_SEM_NO_COMECO,
  IMAGENS_FRACAO_MAXIMA,
  type ImagemVideo,
  MAX_IMAGENS_VIDEO,
  MAX_VIDEOS_CONTA,
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
  analise: { silencios?: Silencio[]; duracao?: number } | null;
  erro: string | null;
  capa_chave: string | null;
  final_chave: string | null;
  original_chave: string;
  envio_id: string | null;
  envio_partes: { numero: number; etag: string }[];
  mudancas_pendentes: boolean;
  versao: number;
  criado_em: string;
  pronto_em: string | null;
}

const num = (v: string | null) => (v == null ? null : Number(v));
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
    versao: l.versao,
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
            capa_chave, criado_em, pronto_em
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
  };
}

/** Os arquivos que são só deste vídeo (as fotos da empresa ficam: são dos Carrosséis). */
export function arquivosDoVideo(l: {
  original_chave: string;
  final_chave: string | null;
  capa_chave: string | null;
  imagens?: ImagemVideo[] | null;
  som?: SomVideo | null;
}): string[] {
  return [
    l.original_chave,
    l.final_chave,
    l.capa_chave,
    ...(l.imagens ?? []).map((i) => i.chave),
    l.som?.musica.chave ?? null,
  ].filter((c): c is string => !!c && (c === l.original_chave || c.startsWith('videos/')));
}

/** As fotos da empresa (as mesmas dos Carrosséis), para trocar a imagem de um vídeo. */
export async function fotosDaEmpresa(
  db: Executor,
): Promise<{ id: number; nome: string; chave: string; descricao: string | null }[]> {
  const { rows } = await db.query<{ id: number; nome: string; chave: string; descricao_ia: string | null }>(
    `SELECT id, nome, chave, descricao_ia FROM comercial.carrossel_fotos
      WHERE conta_id = ${contaSql()} ORDER BY id DESC LIMIT 60`,
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

/** Uma imagem nova no momento `em` (tempo do editado), conferindo as regras. */
function novaImagemNoMomento(
  l: Linha,
  imagens: ImagemVideo[],
  em: number,
  o: Pick<ImagemVideo, 'origem' | 'chave' | 'fotoId'> & { descricao?: string },
): ImagemVideo {
  if (imagens.filter((i) => i.usar).length >= MAX_IMAGENS_VIDEO)
    throw AppError.invalido(`Até ${MAX_IMAGENS_VIDEO} imagens por vídeo: tire uma antes de pôr outra.`);
  const duracao = Number(l.analise?.duracao ?? l.duracao_original ?? 0);
  const ficam = trechosQueFicam(duracao, l.cortes ?? []);
  const editado = duracaoDosTrechos(ficam);
  if (em < IMAGEM_SEM_NO_COMECO)
    throw AppError.invalido('Nos 2 primeiros segundos fica o seu rosto: escolha um momento depois.');
  const fimE = Math.min(editado - 0.6, em + DURACAO_IMAGEM_MANUAL);
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
  if (tempoComImagens(imagens, ficam) + (fimE - em) > editado * IMAGENS_FRACAO_MAXIMA + 0.05)
    throw AppError.invalido(
      'O vídeo já tem imagem em quase 30% do tempo. Tire uma antes de pôr outra, para o seu rosto continuar aparecendo.',
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
    encaixe: 'acima',
    usar: true,
    pedido: o.chave ? null : 'escolher',
    conferencia: null,
    posta: null,
    manual: true,
  };
}

export async function apagar(db: Executor, id: number): Promise<Linha> {
  const l = await linha(db, id);
  await db.query(`DELETE FROM comercial.videos WHERE id = $1 AND conta_id = ${contaSql()}`, [id]);
  return l;
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
  for (const p of r.palavras) {
    const atual = palavras[p.indice];
    if (!atual || atual.t === p.texto) continue;
    palavras[p.indice] = { ...atual, t: p.texto, conferir: false };
    mudou = true;
  }
  const opcoes = opcoesVideoEntrada.parse({ ...(l.opcoes ?? {}) });
  for (const k of ['estilo', 'ritmo', 'transicao'] as const)
    if (r[k] && r[k] !== opcoes[k]) {
      (opcoes as Record<string, unknown>)[k] = r[k];
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
  if (animacoes && (r.momentos.length || r.novoMomento)) {
    let momentos: MomentoVideo[] = momentosDe(animacoes).map((m) => {
      const e = r.momentos.find((x) => x.id === m.id);
      if (!e) return m;
      const novo = {
        ...m,
        usar: e.usar ?? m.usar,
        titulo: e.titulo != null ? e.titulo.toUpperCase() : m.titulo,
        numero: e.numero ?? m.numero,
        itens:
          e.itens && m.tipo === 'lista'
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
      };
    }
    if (e.pedido === 'gerar_outra') {
      if (!deps.imagensGeradas)
        throw AppError.invalido(
          'A geração de imagens não está ligada. Troque por uma foto da empresa ou sua.',
        );
      novo = { ...novo, origem: 'gerada', fotoId: null, pedido: 'gerar_outra', usar: true };
    } else if (e.pedido === null && atual.pedido === 'gerar_outra') novo = { ...novo, pedido: null };
    if (JSON.stringify(novo) !== JSON.stringify(atual)) mudou = true;
    imagens[k] = novo;
  }
  if (r.novaImagem) {
    const f = r.novaImagem.fotoId != null ? await fotoDaEmpresa(db, r.novaImagem.fotoId) : null;
    imagens = [
      ...imagens,
      novaImagemNoMomento({ ...l, cortes }, imagens, r.novaImagem.em, {
        origem: f ? 'empresa' : 'gerada',
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
        throw AppError.invalido('A música ainda não está liberada na sua conta.');
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
  const { rows } = await db.query<Linha>(
    `UPDATE comercial.videos SET cortes = $2, palavras = $3, animacoes = $4, opcoes = $5, situacao = $6,
            mudancas_pendentes = mudancas_pendentes OR $7, imagens = $8, som = $9,
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
