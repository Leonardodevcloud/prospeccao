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

/** v152: o modelo de música padrão (o mais novo da ElevenLabs) e o de reserva. */
export const MODELO_MUSICA_PADRAO = 'music_v2_5';
export const MODELO_MUSICA_RESERVA = 'music_v1';
/** Os modelos que compõem por partes (plano com a duração de cada trecho respeitada). */
export const compoePorPartes = (modelo: string) => /^music_v[2-9]/.test(modelo);

/**
 * v152: as partes do vídeo, para a música acompanhar: entra no gancho, fica por baixo da explicação,
 * sobe na oferta e fecha junto com a chamada (antes era uma faixa só, do começo ao fim).
 */
export type NomeParteMusica = 'gancho' | 'explicacao' | 'oferta' | 'chamada';
export interface ParteMusica {
  nome: NomeParteMusica;
  segundos: number;
}
export const ROTULO_PARTE_MUSICA: Record<NomeParteMusica, string> = {
  gancho: 'Gancho',
  explicacao: 'Explicação',
  oferta: 'Oferta',
  chamada: 'Chamada',
};

const DIRECAO_DA_PARTE: Record<NomeParteMusica, { texto: string; estilos: string[] }> = {
  gancho: {
    texto: '[Intro] {instrumental, starts immediately with the beat, confident hook, no slow fade-in}',
    estilos: ['immediate start', 'punchy intro', 'clear beat'],
  },
  explicacao: {
    texto:
      '[Verse] {instrumental, light and steady under a person talking, sparse arrangement, no lead melody}',
    estilos: ['sparse arrangement', 'steady groove', 'light mid frequencies', 'background bed'],
  },
  oferta: {
    texto: '[Chorus] {instrumental, energy lifts, fuller arrangement, positive and bright}',
    estilos: ['energy lift', 'fuller drums', 'bright', 'uplifting'],
  },
  chamada: {
    texto:
      '[Outro] {instrumental, resolves and ends with one clean final hit exactly at the end, no fade-out}',
    estilos: ['resolved ending', 'clean final hit'],
  },
};

/** Cada parte tem de 3 s a 2 min (o que a ElevenLabs aceita por trecho). Vídeo curto: sem partes. */
export function partesDaMusica(e: {
  total: number;
  ofertaEm?: number | null;
  chamadaEm?: number | null;
}): ParteMusica[] {
  const total = Math.round(e.total);
  if (total < 14) return [];
  const gancho = Math.max(3, Math.min(4, Math.round(total * 0.12)));
  let chamadaIni = e.chamadaEm != null ? Math.round(e.chamadaEm) : total - 4;
  chamadaIni = Math.max(gancho + 6, Math.min(total - 3, chamadaIni));
  let ofertaIni = e.ofertaEm != null ? Math.round(e.ofertaEm) : null;
  // A oferta precisa de 3 s antes da chamada e de 3 s de explicação antes dela.
  if (ofertaIni != null && (chamadaIni - ofertaIni < 3 || ofertaIni - gancho < 3)) ofertaIni = null;
  const partes: ParteMusica[] = [{ nome: 'gancho', segundos: gancho }];
  let resto = (ofertaIni ?? chamadaIni) - gancho;
  while (resto > 0) {
    // Trecho de até 2 min; o que sobra nunca fica com menos de 3 s.
    const n = resto > 120 ? (resto - 120 < 3 ? resto - 3 : 120) : resto;
    partes.push({ nome: 'explicacao', segundos: n });
    resto -= n;
  }
  if (ofertaIni != null) partes.push({ nome: 'oferta', segundos: Math.min(120, chamadaIni - ofertaIni) });
  partes.push({ nome: 'chamada', segundos: Math.min(120, total - chamadaIni) });
  return partes;
}

/** O plano de composição (modelos v2): uma parte do vídeo, um trecho da música, sempre instrumental. */
export function planoDaMusica(partes: ParteMusica[], estilo: string) {
  const base = estilo
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
  return {
    chunks: partes.map((p) => ({
      text: DIRECAO_DA_PARTE[p.nome].texto,
      duration_ms: Math.round(Math.min(120, Math.max(3, p.segundos)) * 1000),
      positive_styles: ['instrumental', ...base, ...DIRECAO_DA_PARTE[p.nome].estilos].slice(0, 8),
      negative_styles: ['vocals', 'singing', 'lyrics', 'spoken word'],
    })),
  };
}

interface PedidoMusica {
  clima: ClimaMusica;
  descricao: string;
  estilo: string;
  segundos: number;
  /** v152: as partes do vídeo (sem elas, ou num modelo que não compõe por partes: uma faixa só). */
  partes?: ParteMusica[];
}

/**
 * Compõe a música (MP3) com o tamanho pedido (entre 3 s e 10 min). Quando a ElevenLabs responde
 * que está ocupada, espera e tenta de novo (até 4 vezes); pedido recusado ou sem plano não repete.
 * v152: com as partes do vídeo e um modelo v2, compõe por partes; se a ElevenLabs recusar o plano,
 * cai na faixa única, e se recusar o modelo, no de reserva.
 */
export async function comporMusica(
  cfg: ConfigMusica,
  e: PedidoMusica,
  esperas: readonly number[] = ESPERAS_MUSICA_MS,
): Promise<Uint8Array> {
  const modelo = cfg.modelo ?? MODELO_MUSICA_PADRAO;
  const jeitos: { modelo: string; partes: boolean }[] = [];
  if (e.partes && e.partes.length >= 2 && compoePorPartes(modelo)) jeitos.push({ modelo, partes: true });
  jeitos.push({ modelo, partes: false });
  if (modelo !== MODELO_MUSICA_RESERVA) jeitos.push({ modelo: MODELO_MUSICA_RESERVA, partes: false });
  let ultimo: unknown;
  for (const j of jeitos) {
    for (let k = 0; ; k++) {
      try {
        return await comporUmaVez({ ...cfg, modelo: j.modelo }, e, j.partes);
      } catch (erro) {
        ultimo = erro;
        const a = erro as AppError;
        if (a.repetivel && k < esperas.length) {
          await new Promise((r) => setTimeout(r, esperas[k]));
          continue;
        }
        break;
      }
    }
    // Ocupada até o fim, sem plano (401/402/403) ou pedido recusado: outro jeito não resolve.
    const d = (ultimo as AppError).detalhes as { status?: number; pedidoRecusado?: boolean } | undefined;
    const trocar = !!d && [400, 404, 422].includes(d.status ?? 0) && !d.pedidoRecusado;
    if (!trocar) break;
  }
  throw ultimo;
}

async function comporUmaVez(cfg: ConfigMusica, e: PedidoMusica, porPartes: boolean): Promise<Uint8Array> {
  const ms = Math.round(Math.min(600, Math.max(3, e.segundos)) * 1000);
  const estilo = e.descricao.trim() || e.estilo.trim() || ESTILO_DO_CLIMA[e.clima];
  let resposta: Response;
  try {
    resposta = await fetch(`${cfg.url ?? URL_MUSICA_ELEVENLABS}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': cfg.chave },
      body: JSON.stringify(
        porPartes
          ? { composition_plan: planoDaMusica(e.partes ?? [], estilo), model_id: cfg.modelo }
          : {
              prompt: promptDaMusica(e.clima, e.descricao, e.estilo),
              music_length_ms: ms,
              force_instrumental: true,
              model_id: cfg.modelo ?? MODELO_MUSICA_PADRAO,
            },
      ),
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
    const pedidoRecusado = /bad_prompt/i.test(texto);
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

/** O abaixa-música guiado pela voz: leve (uns 4 dB com a voz a −14 LUFS). */
export const ABAIXA_MUSICA = 'threshold=0.12:ratio=2:attack=40:release=500:makeup=1';

/**
 * O volume da tela (0 a 100) vira o ganho da música já nivelada em −16 LUFS: no padrão (35)
 * ela entra a −20 LUFS e, com o abaixa-música, fica uns 10 a 11 dB abaixo da voz. No máximo,
 * fica quase no nível da voz (o limitador do fim segura o pico).
 */
export function ganhoDaMusica(volume: number): number {
  const vol = Math.max(0, Math.min(100, volume));
  return Math.min(1.4, (vol / 35) * 0.63);
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
    // v140: medido com a voz no nível final do vídeo (−14 LUFS). A v139 deixava a música 10 dB
    // abaixo antes do abaixa-música, e ele tirava mais 9 dB com a pessoa falando o tempo todo:
    // ficava 21 dB abaixo (muda no celular). Agora, no padrão, ela fica uns 10 a 11 dB abaixo
    // enquanto a pessoa fala, e sobe nas pausas e na tela final.
    const v = ganhoDaMusica(e.musica.volume);
    const fade = Math.max(0, e.total - 1.2).toFixed(3);
    filtros.push(
      `[${n}:a]loudnorm=I=-16:TP=-2,aresample=48000,apad,atrim=0:${total},volume=${v.toFixed(3)},afade=t=in:d=0.4,afade=t=out:st=${fade}:d=1.2[mus]`,
      // Quando a pessoa fala, a música abaixa uns 4 dB (2:1), não some.
      `[mus][guia]sidechaincompress=${ABAIXA_MUSICA}[musd]`,
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
