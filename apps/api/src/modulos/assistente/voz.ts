import { randomUUID } from 'node:crypto';

/**
 * Voz do Argos: ouvir (Whisper por API compatível com a OpenAI; padrão Groq, rápido e barato) e
 * falar (gpt-4o-mini-tts, entregue em pedaços enquanto é gerado). As chaves ficam só no servidor.
 */

export const LIMITE_AUDIO_BYTES = 8 * 1024 * 1024;

export interface ProvedorTranscricao {
  readonly nome: string;
  transcrever(audio: Uint8Array, mime: string): Promise<string>;
}

export interface ProvedorFala {
  readonly nome: string;
  falar(texto: string, opcoes: { voz: string; velocidade: number }): Promise<Uint8Array>;
  /** O mesmo áudio, em pedaços enquanto é gerado (começa a tocar antes de terminar). */
  falarFluxo?(texto: string, opcoes: { voz: string; velocidade: number }): Promise<AsyncIterable<Uint8Array>>;
}

const EXTENSAO: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

// Vocabulário da casa: ajuda o Whisper com termos e nomes próprios.
const VOCABULARIO =
  'Argos, como está o funil hoje? Quantos leads faixa A a campanha de farmácias encontrou? Follow-ups atrasados, reuniões marcadas, ' +
  'negócios ganhos, taxa de conversão, SDR, closer, prospecção, WhatsApp, Prospect Team. ' +
  'Marca uma ligação amanhã às 15h com contato@empresa.com.br.';

export class TranscricaoCompativelOpenAI implements ProvedorTranscricao {
  readonly nome: string;

  constructor(private readonly cfg: { baseUrl: string; chave: string; modelo: string; timeoutMs?: number }) {
    this.nome = `${new URL(cfg.baseUrl).hostname}/${cfg.modelo}`;
  }

  async transcrever(audio: Uint8Array, mime: string): Promise<string> {
    const tipo = mime.split(';')[0]?.trim() || 'audio/webm';
    const formulario = new FormData();
    formulario.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: tipo }),
      `fala.${EXTENSAO[tipo] ?? 'webm'}`,
    );
    formulario.append('model', this.cfg.modelo);
    formulario.append('language', 'pt');
    formulario.append('response_format', 'verbose_json');
    formulario.append('temperature', '0');
    formulario.append('prompt', VOCABULARIO);
    const resposta = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.chave}` },
      body: formulario,
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
    });
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      throw new Error(`Transcrição falhou (${resposta.status}): ${corpo.slice(0, 300)}`);
    }
    return lerTranscricao(
      (await resposta.json()) as {
        text?: string;
        segments?: { text?: string; no_speech_prob?: number; avg_logprob?: number }[];
      },
    );
  }
}

/** "contato arroba empresa ponto com ponto br" → "contato@empresa.com.br". */
export function normalizarEmailFalado(texto: string): string {
  let t = texto.replace(/\s+(?:arroba|arrouba|aroba)\s+/gi, '@').replace(/\s*@\s*/g, '@');
  if (!t.includes('@')) return texto;
  t = t.replace(
    /@([a-z0-9À-ÿ_-]+)((?:\s*(?:\bponto\b|\.)\s*[a-z0-9_-]+)+)/gi,
    (_m, nome: string, resto: string) => `@${nome}${resto.replace(/\s*(?:\bponto\b|\.)\s*/gi, '.')}`,
  );
  t = t.replace(/([a-z0-9_-]+)\s+ponto\s+([a-z0-9_-]+)@/gi, '$1.$2@');
  return t.replace(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi, (e) => e.toLowerCase());
}

/** Marca no fim quando o Whisper teve pouca confiança: o Argos confirma antes de agir. */
export const MARCA_INCERTA = '[áudio pouco claro]';

/** Tira o que o Whisper "ouviu" no silêncio e marca a transcrição quando a confiança é baixa. */
export function lerTranscricao(dados: {
  text?: string;
  segments?: { text?: string; no_speech_prob?: number; avg_logprob?: number }[];
}): string {
  const segmentos = dados.segments ?? [];
  if (!segmentos.length) return normalizarEmailFalado((dados.text ?? '').trim());
  const bons = segmentos.filter((s) => (s.no_speech_prob ?? 0) < 0.6 && (s.avg_logprob ?? 0) > -1.6);
  const texto = bons
    .map((s) => (s.text ?? '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return '';
  const media = bons.reduce((t, s) => t + (s.avg_logprob ?? 0), 0) / bons.length;
  const final = normalizarEmailFalado(texto);
  return media < -0.9 ? `${final} ${MARCA_INCERTA}` : final;
}

/** Vozes do gpt-4o-mini-tts (todas falam português; as mais naturais em pt-BR primeiro). */
export const VOZES_FALA = [
  'marin',
  'cedar',
  'coral',
  'nova',
  'shimmer',
  'sage',
  'ballad',
  'ash',
  'verse',
  'alloy',
  'echo',
  'fable',
  'onyx',
] as const;

const INSTRUCOES_FALA =
  'Fale em português do Brasil, com sotaque brasileiro natural. Tom de um colega de trabalho simpático e seguro: ' +
  'caloroso, direto, conversado, nunca robótico nem de locutor. Ritmo ágil, frases fluidas, pausas curtas. ' +
  'Diga números e valores como uma pessoa diria ("trinta e oito mil reais", "noventa e um por cento").';

export class FalaCompativelOpenAI implements ProvedorFala {
  readonly nome: string;

  constructor(private readonly cfg: { baseUrl: string; chave: string; modelo: string; timeoutMs?: number }) {
    this.nome = `${new URL(cfg.baseUrl).hostname}/${cfg.modelo}`;
  }

  async falar(texto: string, opcoes: { voz: string; velocidade: number }): Promise<Uint8Array> {
    const r = await this.pedir(texto, opcoes);
    return new Uint8Array(await r.arrayBuffer());
  }

  async falarFluxo(
    texto: string,
    opcoes: { voz: string; velocidade: number },
  ): Promise<AsyncIterable<Uint8Array>> {
    const r = await this.pedir(texto, opcoes);
    if (!r.body) {
      const tudo = new Uint8Array(await r.arrayBuffer());
      return (async function* () {
        yield tudo;
      })();
    }
    return r.body as unknown as AsyncIterable<Uint8Array>;
  }

  private async pedir(texto: string, opcoes: { voz: string; velocidade: number }) {
    const r = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.chave}` },
      body: JSON.stringify({
        model: this.cfg.modelo,
        voice: opcoes.voz,
        input: texto,
        instructions: INSTRUCOES_FALA,
        speed: opcoes.velocidade,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
    });
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      throw new Error(`A voz falhou (${r.status}): ${corpo.slice(0, 300)}`);
    }
    return r;
  }
}

/* ───────────── Voz em fluxo: a geração começa já e o navegador toca enquanto chega ───────────── */

export interface FalaEmCurso {
  /** Só quem pediu ouve (o id já é imprevisível; isto é a segunda tranca). */
  usuarioId: number;
  pedacos: Uint8Array[];
  terminou: boolean;
  falhou: boolean;
  criadaEm: number;
  avisar: Set<() => void>;
}

const falasEmCurso = new Map<string, FalaEmCurso>();
const cacheFala = new Map<string, Uint8Array>();
const VALIDADE_FALA_MS = 3 * 60_000;

function limparFalasVelhas() {
  const agora = Date.now();
  for (const [id, f] of falasEmCurso) if (agora - f.criadaEm > VALIDADE_FALA_MS) falasEmCurso.delete(id);
  while (falasEmCurso.size > 300) falasEmCurso.delete(falasEmCurso.keys().next().value as string);
}

function guardarNoCache(chave: string, audio: Uint8Array) {
  cacheFala.set(chave, audio);
  if (cacheFala.size > 80) cacheFala.delete(cacheFala.keys().next().value as string);
}

export interface ConfigVoz {
  voz: string;
  velocidade: number;
}

const limparTexto = (texto: string) => texto.replace(/\s+/g, ' ').trim().slice(0, 1200);

/** Texto → MP3 inteiro (amostra de voz e reserva do iPhone). Frases repetidas saem do cache. */
export async function gerarFala(fala: ProvedorFala, texto: string, cfg: ConfigVoz): Promise<Uint8Array> {
  const limpo = limparTexto(texto);
  const chave = `${cfg.voz}|${cfg.velocidade}|${limpo}`;
  const guardado = cacheFala.get(chave);
  if (guardado) return guardado;
  const audio = await fala.falar(limpo, cfg);
  guardarNoCache(chave, audio);
  return audio;
}

/**
 * Começa a gerar a voz agora e devolve um id. O áudio sai em GET /assistente/falar/:id, que entrega
 * os pedaços conforme chegam — a fala começa sem esperar o arquivo inteiro.
 */
export function prepararFala(
  fala: ProvedorFala,
  texto: string,
  cfg: ConfigVoz,
  usuarioId: number,
  aoFalhar: (erro: Error) => void,
): string {
  const limpo = limparTexto(texto);
  const chave = `${cfg.voz}|${cfg.velocidade}|${limpo}`;
  limparFalasVelhas();
  const id = randomUUID();
  const f: FalaEmCurso = {
    usuarioId,
    pedacos: [],
    terminou: false,
    falhou: false,
    criadaEm: Date.now(),
    avisar: new Set(),
  };
  falasEmCurso.set(id, f);
  const mudou = () => {
    for (const fn of f.avisar) fn();
  };
  const guardado = cacheFala.get(chave);
  if (guardado) {
    f.pedacos.push(guardado);
    f.terminou = true;
    return id;
  }
  void (async () => {
    try {
      if (fala.falarFluxo) {
        for await (const pedaco of await fala.falarFluxo(limpo, cfg)) {
          f.pedacos.push(pedaco);
          mudou();
        }
      } else f.pedacos.push(await fala.falar(limpo, cfg));
      f.terminou = true;
      const total = new Uint8Array(f.pedacos.reduce((n, p) => n + p.byteLength, 0));
      let pos = 0;
      for (const p of f.pedacos) {
        total.set(p, pos);
        pos += p.byteLength;
      }
      guardarNoCache(chave, total);
    } catch (erro) {
      aoFalhar(erro as Error);
      f.falhou = true;
      f.terminou = true;
    }
    mudou();
  })();
  return id;
}

export const falaEmCurso = (id: string): FalaEmCurso | null => falasEmCurso.get(id) ?? null;

/**
 * Divide o texto falado em trechos: o primeiro curto (sai rápido) e os outros maiores, gerados
 * enquanto o primeiro toca. A interface usa a mesma regra (shared/assistente).
 */
export { dividirFala } from '@prospeccao/shared/assistente';
