/**
 * Transcrição das reuniões: o áudio de cada pessoa é transcrito separado (Whisper, pela Groq por
 * padrão) e as falas são juntadas pela hora. Assim a transcrição sabe quem falou o quê sem adivinhar
 * pela voz.
 */

export interface ConfigTranscricao {
  /** API compatível com a OpenAI (padrão: https://api.groq.com/openai/v1). */
  baseUrl: string;
  chave: string;
  modelo: string;
  timeoutMs?: number;
}

/** Trecho falado, em milissegundos desde o começo do arquivo de áudio. */
export interface TrechoTranscrito {
  inicioMs: number;
  fimMs: number;
  texto: string;
}

/** Fala na linha do tempo da reunião (ms desde o começo da sessão). */
export interface FalaReuniao {
  identidade: string;
  nome: string;
  inicioMs: number;
  fimMs: number;
  texto: string;
}

interface SegmentoWhisper {
  start?: number;
  end?: number;
  text?: string;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
}

/** Frases que o Whisper costuma "ouvir" no silêncio (legendas de vídeo do treino dele). */
const ALUCINACOES =
  /^(legendas? (pela|por) .*|obrigad[oa] por assistir.*|inscreva-se.*|tchau,? tchau\.?|\.+|…|amara\.org.*|transcri(ção|cao) .*|e aí\.?)$/i;

/** Tira o que o Whisper inventou no silêncio e devolve os trechos em ms. */
export function lerSegmentos(segmentos: SegmentoWhisper[]): TrechoTranscrito[] {
  const out: TrechoTranscrito[] = [];
  for (const s of segmentos) {
    const texto = (s.text ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    if ((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.5) continue;
    if ((s.compression_ratio ?? 0) > 2.6) continue; // repetição em loop
    if (ALUCINACOES.test(texto)) continue;
    const inicioMs = Math.max(0, Math.round((s.start ?? 0) * 1000));
    const fimMs = Math.max(inicioMs, Math.round((s.end ?? s.start ?? 0) * 1000));
    out.push({ inicioMs, fimMs, texto });
  }
  return out;
}

const VOCABULARIO =
  'Reunião comercial em português do Brasil. Proposta, contrato, prazo, orçamento, valores, condições de pagamento, WhatsApp, Prospect Team.';

/**
 * A Groq recusou por limite (HTTP 429: minutos de áudio por hora ou por dia do plano). Não é erro do
 * áudio: é esperar `esperaS` segundos e mandar de novo.
 */
export class LimiteDaTranscricao extends Error {
  constructor(
    mensagem: string,
    readonly esperaS: number,
  ) {
    super(mensagem);
    this.name = 'LimiteDaTranscricao';
  }
}

/** "Please try again in 1h2m3.5s" / retry-after: quantos segundos esperar (padrão 10 min). */
export function esperaDoLimite(retryAfter: string | null, corpo: string): number {
  const n = Number(retryAfter);
  if (retryAfter && Number.isFinite(n) && n > 0) return Math.ceil(n);
  const m = /try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i.exec(corpo);
  if (m && (m[1] || m[2] || m[3]))
    return Math.ceil(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) || 600;
  return 600;
}

function formularioBase(cfg: ConfigTranscricao, opcoes: { vocabulario?: string }): FormData {
  const formulario = new FormData();
  formulario.append('model', cfg.modelo);
  formulario.append('language', 'pt');
  formulario.append('response_format', 'verbose_json');
  formulario.append('timestamp_granularities[]', 'segment');
  formulario.append('temperature', '0');
  formulario.append('prompt', (opcoes.vocabulario ?? VOCABULARIO).slice(0, 600));
  return formulario;
}

async function pedirTranscricao(cfg: ConfigTranscricao, formulario: FormData): Promise<TrechoTranscrito[]> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const resposta = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.chave}` },
    body: formulario,
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 300_000),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    if (resposta.status === 429)
      throw new LimiteDaTranscricao(
        `Transcrição: limite do serviço de transcrição (HTTP 429): ${corpo.slice(0, 200)}`,
        esperaDoLimite(resposta.headers.get('retry-after'), corpo),
      );
    throw new Error(`Transcrição falhou (HTTP ${resposta.status}): ${corpo.slice(0, 300)}`);
  }
  const j = (await resposta.json()) as { text?: string; segments?: SegmentoWhisper[] };
  if (j.segments?.length) return lerSegmentos(j.segments);
  const texto = (j.text ?? '').trim();
  return texto && !ALUCINACOES.test(texto) ? [{ inicioMs: 0, fimMs: 0, texto }] : [];
}

/** Maior arquivo que vai inteiro (o plano grátis da Groq aceita até 25 MB por envio). */
export const MAX_BYTES_TRANSCRICAO = 24 * 1024 * 1024;

/**
 * Transcreve um arquivo de áudio pelo link (a Groq baixa direto do armazenamento; não passa pela
 * memória da api). Serviço que não aceita link: baixa e manda o arquivo (até 24 MB). Áudio longo
 * (reunião de horas) vai em partes: ver `transcreverArquivo`.
 */
export async function transcreverAudio(
  cfg: ConfigTranscricao,
  url: string,
  opcoes: { vocabulario?: string } = {},
): Promise<TrechoTranscrito[]> {
  const formulario = formularioBase(cfg, opcoes);
  if (/groq\.com/i.test(cfg.baseUrl)) formulario.append('url', url);
  else {
    const audio = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!audio.ok) throw new Error(`Transcrição: não baixou o áudio (HTTP ${audio.status})`);
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (bytes.length > MAX_BYTES_TRANSCRICAO) throw new Error('Transcrição: áudio maior que 24 MB');
    formulario.append('file', new Blob([bytes], { type: 'audio/ogg' }), 'fala.ogg');
  }
  return pedirTranscricao(cfg, formulario);
}

/** Transcreve um arquivo que já está na memória (uma parte de um áudio longo). */
export async function transcreverArquivo(
  cfg: ConfigTranscricao,
  bytes: Uint8Array<ArrayBuffer>,
  opcoes: { vocabulario?: string; nome?: string; tipo?: string } = {},
): Promise<TrechoTranscrito[]> {
  if (bytes.length > MAX_BYTES_TRANSCRICAO) throw new Error('Transcrição: parte do áudio maior que 24 MB');
  const formulario = formularioBase(cfg, opcoes);
  formulario.append(
    'file',
    new Blob([bytes], { type: opcoes.tipo ?? 'audio/ogg' }),
    opcoes.nome ?? 'parte.ogg',
  );
  return pedirTranscricao(cfg, formulario);
}

/**
 * Junta as falas de todo mundo na ordem em que aconteceram. Trechos seguidos da mesma pessoa (pausa
 * curta) viram um parágrafo só, para a leitura não ficar picotada.
 */
export function juntarFalas(
  trilhas: { identidade: string; nome: string; deslocamentoMs: number; trechos: TrechoTranscrito[] }[],
  opcoes: { pausaMs?: number; maxLetras?: number } = {},
): FalaReuniao[] {
  const pausa = opcoes.pausaMs ?? 2000;
  const max = opcoes.maxLetras ?? 700;
  const todas: FalaReuniao[] = trilhas.flatMap((t) =>
    t.trechos.map((x) => ({
      identidade: t.identidade,
      nome: t.nome,
      inicioMs: Math.max(0, x.inicioMs + t.deslocamentoMs),
      fimMs: Math.max(0, x.fimMs + t.deslocamentoMs),
      texto: x.texto,
    })),
  );
  todas.sort((a, b) => a.inicioMs - b.inicioMs || a.fimMs - b.fimMs);
  const out: FalaReuniao[] = [];
  for (const f of todas) {
    const ultima = out[out.length - 1];
    if (
      ultima &&
      ultima.identidade === f.identidade &&
      f.inicioMs - ultima.fimMs <= pausa &&
      ultima.texto.length + f.texto.length < max
    ) {
      ultima.texto = `${ultima.texto} ${f.texto}`;
      ultima.fimMs = Math.max(ultima.fimMs, f.fimMs);
    } else out.push({ ...f });
  }
  return out;
}
