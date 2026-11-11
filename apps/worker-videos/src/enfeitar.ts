import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Executor } from '@prospeccao/db';
import type { ClienteClaude } from '@prospeccao/integrations/carrosseis';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import {
  aplicarRegras,
  BIBLIOTECA_EFEITOS,
  conferirImagem,
  type DecisaoEnfeites,
  descreverFotos,
  enfeitesPelasRegras,
  type FotoParaIa,
  GANHO_EFEITO,
  type PromocaoParaIa,
  pedirEnfeites,
  pedirImagemPara,
  VERSAO_EFEITOS,
} from '@prospeccao/integrations/videos';
import type { Logger } from '@prospeccao/shared';
import {
  CLIMAS_MUSICA,
  type ClimaMusica,
  type EfeitoVideo,
  type ImagemVideo,
  type MomentoVideo,
  type OpcoesVideo,
  type PalavraVideo,
  type SomVideo,
  type TipoEfeito,
  type TrechoSemImagem,
  VOLUME_MUSICA_PADRAO,
} from '@prospeccao/shared/videos';
import { rodar } from './ferramentas.js';
import * as repo from './repositorio.js';

/**
 * Os enfeites na edição: descrever as fotos da empresa (uma vez), pedir o plano à IA, gerar e
 * conferir as imagens que faltam, compor a música. Cada arquivo novo vai para o armazenamento e
 * para o banco assim que fica pronto: se o serviço cair, o "tentar de novo" aproveita.
 */

type Trecho = { inicio: number; fim: number };

export interface DepsEnfeites {
  db: Executor;
  arm: Armazenamento;
  log: Logger;
  /** Um cliente do Claude que soma o custo de cada pedido (null: sem a chave). */
  claude: ((somar: (usd: number) => void) => ClienteClaude) | null;
  gerarImagem: ((e: { descricao: string; formato: 'cheia' | 'acima' }) => Promise<Uint8Array>) | null;
  comporMusica:
    | ((e: {
        clima: ClimaMusica;
        descricao: string;
        estilo: string;
        segundos: number;
      }) => Promise<Uint8Array>)
    | null;
  /** A música só sai para as contas liberadas (contrato da ElevenLabs). */
  musicaLiberada: (contaId: number) => boolean;
  /** v138: os efeitos sonoros da biblioteca (ElevenLabs Sound Effects; null: só os de reserva). */
  gerarEfeito?: ((e: { texto: string; segundos: number }) => Promise<Uint8Array>) | null;
  custoImagemUsd: number;
  custoMusicaMinutoUsd: number;
}

export interface CustosEnfeites {
  claudeUsd: number;
  imagens: number;
  imagensUsd: number;
  musicaSeg: number;
  musicaUsd: number;
}

/** A pasta dos efeitos sonoros (no pacote: sons/, ao lado de dist/ e de src/). */
export const PASTA_SONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'sons');
/** Os efeitos da biblioteca já no disco (o resto usa os de reserva, mais simples, em sons/). */
const daBiblioteca = new Map<TipoEfeito, string>();
export const arquivoDoEfeito = (t: TipoEfeito) => daBiblioteca.get(t) ?? join(PASTA_SONS, `${t}.wav`);

/**
 * v138: a biblioteca de efeitos sutis. Na primeira vez a ElevenLabs faz cada som; ele é nivelado
 * (−20 LUFS) e guardado no armazenamento (sons/<versão>/). Daí em diante, só é baixado.
 */
export async function prepararBiblioteca(
  d: Pick<DepsEnfeites, 'arm' | 'log' | 'gerarEfeito'>,
  pasta = join(tmpdir(), 'sons-biblioteca', VERSAO_EFEITOS),
): Promise<void> {
  await mkdir(pasta, { recursive: true });
  for (const t of Object.keys(BIBLIOTECA_EFEITOS) as TipoEfeito[]) {
    if (daBiblioteca.has(t)) continue;
    const local = join(pasta, `${t}.wav`);
    try {
      await readFile(local);
      daBiblioteca.set(t, local);
      continue;
    } catch {
      // ainda não está no disco
    }
    const chave = `sons/${VERSAO_EFEITOS}/${t}.wav`;
    try {
      await writeFile(local, await baixarBytes(d.arm, chave));
      daBiblioteca.set(t, local);
      continue;
    } catch {
      // ainda não está no armazenamento
    }
    if (!d.gerarEfeito) continue;
    try {
      const mp3 = join(pasta, `${t}.mp3`);
      await writeFile(mp3, await d.gerarEfeito(BIBLIOTECA_EFEITOS[t]));
      await rodar(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-i',
          mp3,
          '-af',
          'loudnorm=I=-20:TP=-3:LRA=7',
          '-ar',
          '48000',
          '-ac',
          '2',
          local,
        ],
        { timeoutMs: 60_000 },
      );
      await d.arm.enviar(chave, new Uint8Array(await readFile(local)), 'audio/wav');
      daBiblioteca.set(t, local);
      d.log.info({ efeito: t }, 'efeito da biblioteca feito pela ElevenLabs');
    } catch (erro) {
      d.log.warn({ err: erro, efeito: t }, 'o efeito da biblioteca não saiu; fica o de reserva');
    }
  }
}

const climaDasOpcoes = (o: OpcoesVideo): ClimaMusica | null =>
  CLIMAS_MUSICA.some((c) => c.id === o.musica) ? (o.musica as ClimaMusica) : null;

/** O som de um vídeo sem plano ainda (ou dos vídeos da v128, que não tinham música nem efeitos). */
export function somPadrao(o: OpcoesVideo, e: { liberada: boolean; antigo: boolean }): SomVideo {
  const usar = !e.antigo && o.musica !== 'nenhuma' && e.liberada;
  return {
    musica: {
      usar,
      clima: climaDasOpcoes(o) ?? 'confiante',
      descricao: '',
      estiloIa: '',
      volume: VOLUME_MUSICA_PADRAO,
      chave: null,
      segundos: null,
      pedirOutra: false,
      erro: e.liberada ? null : 'A música ainda não foi ligada na plataforma. Fale com a gente.',
    },
    efeitos: { ligados: !e.antigo && o.efeitos, desligados: [], lista: [] },
  };
}

const medidor = (deps: DepsEnfeites, custos: CustosEnfeites) =>
  deps.claude ? deps.claude((usd) => (custos.claudeUsd += usd)) : null;

/** Descreve (uma vez) as fotos da empresa que ainda não têm descrição. */
export async function fotosDescritas(
  deps: DepsEnfeites,
  contaId: number,
  custos: CustosEnfeites,
): Promise<(FotoParaIa & { chave: string })[]> {
  const fotos = await repo.fotosDaConta(deps.db, contaId);
  const claude = medidor(deps, custos);
  const faltam = fotos.filter((f) => !f.descrita);
  if (!claude || !faltam.length) return fotos;
  for (let k = 0; k < faltam.length; k += 8) {
    const lote: { id: number; nome: string; jpeg: Uint8Array }[] = [];
    for (const f of faltam.slice(k, k + 8)) {
      try {
        lote.push({ id: f.id, nome: f.nome, jpeg: await baixarBytes(deps.arm, f.chave) });
      } catch {
        /* foto que sumiu do armazenamento: fica sem descrição */
      }
    }
    try {
      for (const d of await descreverFotos(claude, lote)) {
        await repo.salvarDescricaoFoto(deps.db, d.id, d.descricao);
        const f = fotos.find((x) => x.id === d.id);
        if (f) f.descricao = d.descricao;
      }
    } catch (erro) {
      deps.log.warn({ err: erro, contaId }, 'não deu para descrever as fotos da empresa');
      break;
    }
  }
  return fotos;
}

async function baixarBytes(arm: Armazenamento, chave: string): Promise<Uint8Array> {
  const url = await arm.urlAssinada(chave, { segundos: 600 });
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** O plano da primeira edição: as animações, as imagens, onde não pôr imagem e o som. */
export async function planejar(
  deps: DepsEnfeites,
  e: {
    contaId: number;
    palavras: PalavraVideo[];
    ficam: Trecho[];
    duracaoEditado: number;
    opcoes: OpcoesVideo;
    comTitulo: boolean;
    fotos: FotoParaIa[];
    promocoes: PromocaoParaIa[];
  },
  custos: CustosEnfeites,
): Promise<{
  momentos: MomentoVideo[];
  imagens: ImagemVideo[];
  semImagem: TrechoSemImagem[];
  som: SomVideo;
}> {
  const claude = medidor(deps, custos);
  let d: DecisaoEnfeites;
  if (claude) {
    try {
      d = await pedirEnfeites(claude, { ...e, fotos: e.opcoes.imagens === 'nenhuma' ? [] : e.fotos });
    } catch (erro) {
      deps.log.warn({ err: erro }, 'a IA não propôs os enfeites; seguindo sem animações e imagens');
      d = enfeitesPelasRegras(e.opcoes);
    }
  } else d = enfeitesPelasRegras(e.opcoes);
  const r = aplicarRegras(d, {
    palavras: e.palavras,
    ficam: e.ficam,
    duracaoEditado: e.duracaoEditado,
    comTitulo: e.comTitulo,
    modo: deps.gerarImagem ? e.opcoes.imagens : e.opcoes.imagens === 'ia' ? 'fotos' : e.opcoes.imagens,
    fotos: e.fotos,
    promocoes: e.promocoes,
  });
  const som = somPadrao(e.opcoes, { liberada: deps.musicaLiberada(e.contaId), antigo: false });
  som.musica.clima = climaDasOpcoes(e.opcoes) ?? d.musica.clima;
  som.musica.estiloIa = climaDasOpcoes(e.opcoes) ? '' : d.musica.estilo;
  return { ...r, som };
}

/**
 * Deixa cada imagem usada com o arquivo no disco: a foto da empresa ou a da pessoa é baixada; a que
 * falta é gerada (duas tentativas, cada uma conferida pelo modelo de visão) e guardada. A que não
 * deu certo fica sem arquivo, com o motivo, e não entra no vídeo.
 */
export async function prepararImagens(
  deps: DepsEnfeites,
  e: {
    contaId: number;
    videoId: number;
    opcoes: OpcoesVideo;
    imagens: ImagemVideo[];
    fotos: (FotoParaIa & { chave: string })[];
    pasta: string;
    aoGuardar: (imagens: ImagemVideo[]) => Promise<void>;
  },
  custos: CustosEnfeites,
): Promise<{ imagens: ImagemVideo[]; arquivos: Map<string, string>; descartadas: string[] }> {
  const imagens = e.imagens.map((x) => ({ ...x }));
  const arquivos = new Map<string, string>();
  const descartadas: string[] = [];
  const claude = medidor(deps, custos);
  for (const im of imagens) {
    if (!im.usar) continue;
    try {
      if (im.pedido === 'escolher') {
        if (!claude) throw new Error('sem a IA para escolher');
        const ok = await pedirImagemPara(claude, {
          fala: im.fala,
          assunto: e.opcoes.assunto,
          fotos: e.fotos,
          modo: deps.gerarImagem ? e.opcoes.imagens : 'fotos',
        });
        im.motivo = im.motivo || ok.motivo;
        im.encaixe = ok.encaixe;
        const foto = ok.fotoId != null ? e.fotos.find((f) => f.id === ok.fotoId) : undefined;
        if (foto)
          Object.assign(im, {
            origem: 'empresa',
            fotoId: foto.id,
            chave: foto.chave,
            descricao: foto.descricao || foto.nome,
          });
        else if (ok.gerar)
          Object.assign(im, { origem: 'gerada', fotoId: null, chave: null, descricao: ok.gerar });
        else throw new Error('nenhuma foto serve e não dá para gerar');
        im.pedido = null;
      }
      if (im.origem === 'empresa' && im.fotoId != null && !im.chave) {
        const foto = e.fotos.find((f) => f.id === im.fotoId);
        if (!foto) throw new Error('a foto da empresa foi apagada');
        im.chave = foto.chave;
      }
      if (im.origem === 'gerada' && (!im.chave || im.pedido === 'gerar_outra')) {
        if (!deps.gerarImagem) throw new Error('a geração de imagens não está ligada');
        const antiga = im.chave;
        const r = await gerarConferida(deps, claude, im.descricao, im.encaixe, custos);
        const chave = `videos/${e.contaId}/${e.videoId}/img-${im.id}-${Date.now().toString(36)}.jpg`;
        await deps.arm.enviar(chave, r.jpeg, 'image/jpeg');
        if (antiga?.startsWith('videos/')) await deps.arm.apagar([antiga]).catch(() => undefined);
        im.chave = chave;
        im.conferencia = r.conferencia;
        im.pedido = null;
        await e.aoGuardar(imagens);
      }
      if (!im.chave) throw new Error('imagem sem arquivo');
      const destino = join(e.pasta, `img-${im.id}.jpg`);
      await writeFile(destino, await baixarBytes(deps.arm, im.chave));
      arquivos.set(im.id, destino);
    } catch (erro) {
      deps.log.warn({ err: erro, imagem: im.id }, 'imagem ficou de fora');
      im.conferencia = `Não entrou: ${(erro as Error).message}`.slice(0, 200);
      im.posta = null;
      if (im.pedido === 'gerar_outra') im.pedido = null;
      descartadas.push(im.id);
    }
  }
  return { imagens, arquivos, descartadas };
}

async function gerarConferida(
  deps: DepsEnfeites,
  claude: ClienteClaude | null,
  descricao: string,
  formato: 'cheia' | 'acima',
  custos: CustosEnfeites,
): Promise<{ jpeg: Uint8Array; conferencia: string }> {
  let ultimo: string[] = [];
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const jpeg = await deps.gerarImagem!({ descricao, formato });
    custos.imagens++;
    custos.imagensUsd += deps.custoImagemUsd;
    if (!claude) return { jpeg, conferencia: 'Sem conferência: a IA de visão não está ligada.' };
    const c = await conferirImagem(claude, { jpeg, descricao });
    if (c.aprovada) return { jpeg, conferencia: 'Conferida: sem letra, sem marca, sem defeito.' };
    ultimo = c.problemas;
  }
  throw new Error(`a imagem gerada não passou na conferência (${ultimo.join(' ') || 'sem detalhe'})`);
}

/** A música no tamanho do vídeo: reaproveita a última se o tamanho mal mudou e ninguém pediu outra. */
export async function prepararMusica(
  deps: DepsEnfeites,
  e: { contaId: number; videoId: number; som: SomVideo; total: number; pasta: string },
  custos: CustosEnfeites,
): Promise<{ som: SomVideo; arquivo: string | null }> {
  const som: SomVideo = { ...e.som, musica: { ...e.som.musica } };
  const m = som.musica;
  if (!m.usar) return { som, arquivo: null };
  if (!deps.musicaLiberada(e.contaId) || !deps.comporMusica) {
    m.erro = 'A música ainda não foi ligada na plataforma. Fale com a gente.';
    return { som, arquivo: null };
  }
  const destino = join(e.pasta, 'musica.mp3');
  const serve = m.chave && !m.pedirOutra && m.segundos != null && Math.abs(m.segundos - e.total) <= 1;
  try {
    if (serve) {
      await writeFile(destino, await baixarBytes(deps.arm, m.chave!));
      m.erro = null;
      return { som, arquivo: destino };
    }
    const segundos = Math.ceil(e.total + 0.5);
    const mp3 = await deps.comporMusica({
      clima: m.clima,
      descricao: m.descricao,
      estilo: m.estiloIa,
      segundos,
    });
    custos.musicaSeg += segundos;
    custos.musicaUsd += (segundos / 60) * deps.custoMusicaMinutoUsd;
    const chave = `videos/${e.contaId}/${e.videoId}/musica-${Date.now().toString(36)}.mp3`;
    await deps.arm.enviar(chave, mp3, 'audio/mpeg');
    if (m.chave?.startsWith('videos/')) await deps.arm.apagar([m.chave]).catch(() => undefined);
    await writeFile(destino, mp3);
    Object.assign(m, { chave, segundos: e.total, pedirOutra: false, erro: null });
    return { som, arquivo: destino };
  } catch (erro) {
    const recusado = (erro as { detalhes?: { pedidoRecusado?: boolean } }).detalhes?.pedidoRecusado;
    deps.log.warn({ err: erro, videoId: e.videoId }, 'a música não saiu');
    m.erro = recusado
      ? 'A música não saiu: descreva o estilo sem nome de artista ou de música.'
      : 'A música não saiu desta vez. Gere de novo para tentar outra vez.';
    m.pedirOutra = false;
    return { som, arquivo: null };
  }
}

/** Os efeitos que entram na mistura (ligados e não tirados), com o arquivo e o volume. */
export function efeitosParaMisturar(som: SomVideo, lista: EfeitoVideo[]) {
  if (!som.efeitos.ligados) return [];
  return lista
    .filter((ef) => !som.efeitos.desligados.includes(ef.id))
    .map((ef) => ({ arquivo: arquivoDoEfeito(ef.tipo), em: ef.em, ganho: GANHO_EFEITO[ef.tipo] }));
}

/** Os efeitos estão no lugar? (o serviço sobe sem eles se a pasta não foi copiada). */
export async function sonsPresentes(): Promise<boolean> {
  try {
    await readFile(arquivoDoEfeito('tique'));
    return true;
  } catch {
    return false;
  }
}
