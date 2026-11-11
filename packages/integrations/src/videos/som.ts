import { AppError } from '@prospeccao/shared';
import type { ClimaMusica, EfeitoVideo, ImagemPosta, TipoEfeito } from '@prospeccao/shared/videos';

/**
 * O som do vídeo (v129):
 * - a música, composta pela ElevenLabs (Eleven Music) no tamanho do vídeo, sempre instrumental;
 * - os efeitos sonoros discretos de cada animação (arquivos próprios, gerados por síntese no
 *   repositório: sem licença de terceiros);
 * - a mistura no ffmpeg: a música baixa sozinha quando a pessoa fala (compressão guiada pela voz)
 *   e sobe um pouco nas pausas e na tela final.
 */

export const URL_MUSICA_ELEVENLABS = 'https://api.elevenlabs.io/v1/music';
export const URL_EFEITOS_ELEVENLABS = 'https://api.elevenlabs.io/v1/sound-generation';

export interface ConfigMusica {
  chave: string;
  modelo?: string;
  url?: string;
}

const ESTILO_DO_CLIMA: Record<ClimaMusica, string> = {
  animada: 'upbeat modern pop instrumental, bright synths, punchy drums, energetic and positive',
  confiante: 'confident modern instrumental, warm guitar, steady light beat, clean and direct',
  calma: 'calm soft instrumental, gentle piano and light pads, relaxed and clear',
  corporativa:
    'polished corporate instrumental, soft piano, subtle strings and light percussion, trustworthy',
};

/** O pedido à ElevenLabs: sempre instrumental, para ficar por baixo da voz, com final limpo. */
export function promptDaMusica(clima: ClimaMusica, descricao: string, estiloDaIa = ''): string {
  const estilo = descricao.trim() || estiloDaIa.trim() || ESTILO_DO_CLIMA[clima];
  return [
    `Background music for a short vertical social video with a person talking over it. Style: ${estilo}.`,
    'Instrumental only, no vocals. Keep the mid frequencies light so speech stays clear.',
    'Steady energy, no sudden drops, ending with a clean resolved final hit.',
  ].join(' ');
}

/** Esperas entre as tentativas quando a ElevenLabs está ocupada (429 "system_busy") ou fora (5xx). */
export const ESPERAS_MUSICA_MS = [8_000, 25_000, 60_000];

/**
 * Compõe a música (MP3) com o tamanho pedido (entre 3 s e 10 min). Quando a ElevenLabs responde
 * que está ocupada, espera e tenta de novo (até 4 vezes); pedido recusado ou sem plano não repete.
 */
export async function comporMusica(
  cfg: ConfigMusica,
  e: { clima: ClimaMusica; descricao: string; estilo: string; segundos: number },
  esperas: readonly number[] = ESPERAS_MUSICA_MS,
): Promise<Uint8Array> {
  for (let k = 0; ; k++) {
    try {
      return await comporUmaVez(cfg, e);
    } catch (erro) {
      const repetivel = (erro as AppError).repetivel;
      if (!repetivel || k >= esperas.length) throw erro;
      await new Promise((r) => setTimeout(r, esperas[k]));
    }
  }
}

async function comporUmaVez(
  cfg: ConfigMusica,
  e: { clima: ClimaMusica; descricao: string; estilo: string; segundos: number },
): Promise<Uint8Array> {
  const ms = Math.round(Math.min(600, Math.max(3, e.segundos)) * 1000);
  let resposta: Response;
  try {
    resposta = await fetch(`${cfg.url ?? URL_MUSICA_ELEVENLABS}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': cfg.chave },
      body: JSON.stringify({
        prompt: promptDaMusica(e.clima, e.descricao, e.estilo),
        music_length_ms: ms,
        force_instrumental: true,
        model_id: cfg.modelo ?? 'music_v1',
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (erro) {
    throw new AppError(502, 'falha_externa', `Música: sem resposta (${(erro as Error).name})`, {
      repetivel: true,
      detalhes: { status: 0 },
    });
  }
  if (!resposta.ok) {
    const texto = (await resposta.text().catch(() => ''))
      .slice(0, 300)
      .replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '…');
    // A ElevenLabs recusa pedido que cita artista ou música conhecida ("bad_prompt").
    const pedidoRecusado = /bad_prompt|bad_composition_plan/i.test(texto);
    throw new AppError(502, 'falha_externa', `Música: HTTP ${resposta.status} ${texto}`.trim(), {
      repetivel: !pedidoRecusado && (resposta.status === 429 || resposta.status >= 500),
      detalhes: { status: resposta.status, pedidoRecusado },
    });
  }
  return new Uint8Array(await resposta.arrayBuffer());
}

/* ───────────────────────────── Efeitos ───────────────────────────── */

/**
 * Volume de cada efeito na mistura (a voz fica em 1). v138: bem mais baixo que antes, para o efeito
 * acompanhar a animação e nunca aparecer por cima da fala (os arquivos chegam nivelados em −20 LUFS).
 */
export const GANHO_EFEITO: Record<TipoEfeito, number> = {
  tique: 0.16,
  sopro: 0.12,
  estalo: 0.14,
  subida: 0.1,
};

/**
 * v138: a biblioteca de efeitos, feita uma vez pela ElevenLabs (Sound Effects) e guardada no
 * armazenamento: sons curtos e sutis, de edição profissional de Reels. Mudou o pedido, muda a
 * versão (`VERSAO_EFEITOS`) e a biblioteca é feita de novo.
 */
export const VERSAO_EFEITOS = 'v1';
export const BIBLIOTECA_EFEITOS: Record<TipoEfeito, { texto: string; segundos: number }> = {
  tique: {
    texto:
      'Very soft short UI tick, gentle muted click, clean and minimal, premium app interface sound, no reverb, no music',
    segundos: 0.5,
  },
  sopro: {
    texto:
      'Soft subtle airy whoosh, short smooth swish transition for a social media video edit, gentle and quiet, no music',
    segundos: 0.8,
  },
  estalo: {
    texto:
      'Soft subtle pop, gentle rounded bubble pop accent, clean and short, premium interface sound, no music',
    segundos: 0.5,
  },
  subida: {
    texto: 'Gentle soft swell, subtle airy rise that fades in smoothly, short and quiet, no impact, no music',
    segundos: 1,
  },
};

/** Gera um efeito sonoro pela ElevenLabs (MP3). Ocupada (429/5xx): tenta de novo. */
export async function gerarEfeito(
  cfg: { chave: string; url?: string },
  e: { texto: string; segundos: number },
  esperas: readonly number[] = ESPERAS_MUSICA_MS,
): Promise<Uint8Array> {
  for (let k = 0; ; k++) {
    let resposta: Response;
    try {
      resposta = await fetch(`${cfg.url ?? URL_EFEITOS_ELEVENLABS}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': cfg.chave },
        body: JSON.stringify({
          text: e.texto,
          duration_seconds: Math.min(30, Math.max(0.5, e.segundos)),
          prompt_influence: 0.6,
          model_id: 'eleven_text_to_sound_v2',
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (erro) {
      if (k < esperas.length) {
        await new Promise((r) => setTimeout(r, esperas[k]));
        continue;
      }
      throw new AppError(502, 'falha_externa', `Efeito: sem resposta (${(erro as Error).name})`);
    }
    if (resposta.ok) return new Uint8Array(await resposta.arrayBuffer());
    const repetivel = resposta.status === 429 || resposta.status >= 500;
    if (repetivel && k < esperas.length) {
      await new Promise((r) => setTimeout(r, esperas[k]));
      continue;
    }
    const texto = (await resposta.text().catch(() => ''))
      .slice(0, 300)
      .replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '…');
    throw new AppError(502, 'falha_externa', `Efeito: HTTP ${resposta.status} ${texto}`.trim(), {
      detalhes: { status: resposta.status },
    });
  }
}

/** Os efeitos que as animações pedem (tempos do vídeo editado). */
export function efeitosDoVideo(e: {
  titulo: boolean;
  momentos: { id: string; tipo: string; ini: number; itens: { em: number }[] }[];
  imagens: { id: string; ini: number; posta: ImagemPosta }[];
  chamadaEm: number | null;
}): EfeitoVideo[] {
  const lista: EfeitoVideo[] = [];
  // v138: o título entra com um sopro suave (a "subida" chamava atenção demais).
  if (e.titulo) lista.push({ id: 'titulo', tipo: 'sopro', em: 0.1, onde: 'Título de abertura' });
  for (const m of e.momentos) {
    if (m.tipo === 'lista')
      for (const [n, i] of m.itens.entries())
        lista.push({ id: `${m.id}:${n}`, tipo: 'tique', em: i.em, onde: `Item ${n + 1} da lista` });
    else if (m.tipo === 'numero') lista.push({ id: m.id, tipo: 'sopro', em: m.ini, onde: 'Número grande' });
    else if (m.tipo === 'selo') lista.push({ id: m.id, tipo: 'estalo', em: m.ini, onde: 'Selo' });
    else if (m.tipo === 'oferta') lista.push({ id: m.id, tipo: 'estalo', em: m.ini, onde: 'Oferta' });
  }
  for (const im of e.imagens)
    lista.push({ id: `img:${im.id}`, tipo: 'sopro', em: im.ini, onde: 'Entrada da imagem' });
  if (e.chamadaEm != null)
    lista.push({ id: 'chamada', tipo: 'estalo', em: e.chamadaEm, onde: 'Chamada no fim' });
  return lista
    .map((x) => ({ ...x, em: Math.round(Math.max(0, x.em) * 1000) / 1000 }))
    .sort((a, b) => a.em - b.em);
}

/**
 * Os argumentos do ffmpeg que misturam o som: a voz (entrada 0, o vídeo pronto), a música
 * (opcional) e os efeitos (um arquivo por tipo). A imagem é copiada sem recodificar.
 */
export function argumentosDaMistura(e: {
  pronto: string;
  saida: string;
  total: number;
  musica: { arquivo: string; volume: number } | null;
  efeitos: { arquivo: string; em: number; ganho: number }[];
}): string[] {
  const entradas = ['-i', e.pronto];
  const filtros: string[] = [];
  const mistura: string[] = [];
  let n = 1;
  const total = e.total.toFixed(3);
  filtros.push(`[0:a]apad,atrim=0:${total},asplit=2[voz][guia]`);
  mistura.push('[voz]');
  if (e.musica) {
    entradas.push('-i', e.musica.arquivo);
    // v139: a música é nivelada (−16 LUFS) e o volume de 0 a 100 vira 0 a 1,15: no padrão (35) ela
    // fica uns 13 dB abaixo da voz, como nos Reels com fala. Antes ficava 23 dB abaixo (muda).
    const v = (Math.max(0, Math.min(100, e.musica.volume)) / 100) * 1.15;
    const fade = Math.max(0, e.total - 1.2).toFixed(3);
    filtros.push(
      `[${n}:a]loudnorm=I=-16:TP=-2,aresample=48000,apad,atrim=0:${total},volume=${v.toFixed(3)},afade=t=in:d=0.4,afade=t=out:st=${fade}:d=1.2[mus]`,
      // Quando a pessoa fala, a música abaixa um pouco (3:1), não some.
      '[mus][guia]sidechaincompress=threshold=0.05:ratio=3:attack=30:release=600:makeup=1[musd]',
    );
    mistura.push('[musd]');
    n++;
  } else filtros.push('[guia]anullsink');
  for (const ef of e.efeitos) {
    entradas.push('-i', ef.arquivo);
    const ms = Math.max(0, Math.round(ef.em * 1000));
    filtros.push(`[${n}:a]aresample=48000,volume=${ef.ganho.toFixed(3)},adelay=${ms}:all=1[e${n}]`);
    mistura.push(`[e${n}]`);
    n++;
  }
  filtros.push(
    `${mistura.join('')}amix=inputs=${mistura.length}:duration=first:normalize=0,alimiter=limit=0.95,atrim=0:${total}[som]`,
  );
  return [
    '-v',
    'error',
    '-y',
    ...entradas,
    '-filter_complex',
    filtros.join(';'),
    '-map',
    '0:v',
    '-map',
    '[som]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    e.saida,
  ];
}
