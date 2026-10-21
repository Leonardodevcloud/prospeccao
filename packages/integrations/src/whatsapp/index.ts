import { formatarTelefone, lerVcard } from '@prospeccao/shared';
import { requisitarJson } from '../http.js';

/**
 * WhatsApp pela Evolution API (o chip já aquecido): enviar texto e entender o webhook de
 * mensagens recebidas. Funciona com a v1 e a v2 da Evolution (os campos mudam de nome).
 */

export interface ConfigEvolution {
  url: string;
  apiKey: string;
  instancia: string;
}

/** Número para a Evolution: 55 + DDD + número, só dígitos. */
export function numeroWhatsapp(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  return d.length >= 12 && d.startsWith('55') ? d : `55${d}`;
}

export async function enviarTexto(
  cfg: ConfigEvolution,
  telefone: string,
  texto: string,
): Promise<{ idExterno: string | null }> {
  const r = await requisitarJson<{ key?: { id?: string } }>(
    `${cfg.url.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(cfg.instancia)}`,
    {
      servico: 'Evolution API',
      method: 'POST',
      headers: { apikey: cfg.apiKey },
      // v2 usa "text"; v1 usa "textMessage.text". Mandar os dois funciona nas duas.
      body: { number: numeroWhatsapp(telefone), text: texto, textMessage: { text: texto } },
      timeoutMs: 30_000,
    },
  );
  return { idExterno: r.key?.id ?? null };
}

/** Estado do chip na Evolution ("open" = conectado). Serve para o botão "Testar" do painel. */
export async function estadoConexao(cfg: ConfigEvolution): Promise<string> {
  const r = await requisitarJson<{ instance?: { state?: string }; state?: string }>(
    `${cfg.url.replace(/\/$/, '')}/instance/connectionState/${encodeURIComponent(cfg.instancia)}`,
    { servico: 'Evolution API', headers: { apikey: cfg.apiKey }, timeoutMs: 15_000 },
  );
  const estado = r.instance?.state ?? r.state ?? 'desconhecido';
  return estado === 'open'
    ? 'ok (WhatsApp conectado)'
    : `instância ${cfg.instancia}: ${estado} (leia o QR Code na Evolution)`;
}

export type TipoMidiaWhatsapp = 'imagem' | 'audio' | 'video' | 'documento';

/**
 * Envia foto, vídeo, documento ou áudio (base64 sem o prefixo data:). Áudio vai como mensagem
 * de voz (a Evolution converte para o formato do WhatsApp).
 */
export async function enviarMidia(
  cfg: ConfigEvolution,
  telefone: string,
  m: { tipo: TipoMidiaWhatsapp; mime: string; base64: string; nome?: string; legenda?: string },
): Promise<{ idExterno: string | null }> {
  const base = cfg.url.replace(/\/$/, '');
  const inst = encodeURIComponent(cfg.instancia);
  const number = numeroWhatsapp(telefone);
  if (m.tipo === 'audio') {
    const r = await requisitarJson<{ key?: { id?: string } }>(`${base}/message/sendWhatsAppAudio/${inst}`, {
      servico: 'Evolution API',
      method: 'POST',
      headers: { apikey: cfg.apiKey },
      // v2: "audio"; v1: "audioMessage.audio".
      body: { number, audio: m.base64, audioMessage: { audio: m.base64 }, encoding: true },
      timeoutMs: 60_000,
    });
    return { idExterno: r.key?.id ?? null };
  }
  const mediatype = m.tipo === 'imagem' ? 'image' : m.tipo === 'video' ? 'video' : 'document';
  const midia = {
    mediatype,
    mimetype: m.mime,
    media: m.base64,
    fileName: m.nome ?? (mediatype === 'document' ? 'arquivo' : undefined),
    caption: m.legenda ?? '',
  };
  const r = await requisitarJson<{ key?: { id?: string } }>(`${base}/message/sendMedia/${inst}`, {
    servico: 'Evolution API',
    method: 'POST',
    headers: { apikey: cfg.apiKey },
    // v2: campos na raiz; v1: dentro de "mediaMessage".
    body: { number, ...midia, mediaMessage: midia },
    timeoutMs: 60_000,
  });
  return { idExterno: r.key?.id ?? null };
}

/** Baixa o arquivo de uma mensagem recebida (a Evolution devolve em base64). */
export async function baixarMidia(
  cfg: ConfigEvolution,
  idExterno: string,
): Promise<{ base64: string; mime: string | null } | null> {
  const r = await requisitarJson<{ base64?: string; mimetype?: string; mimeType?: string }>(
    `${cfg.url.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(cfg.instancia)}`,
    {
      servico: 'Evolution API',
      method: 'POST',
      headers: { apikey: cfg.apiKey },
      body: { message: { key: { id: idExterno } }, convertToMp4: false },
      timeoutMs: 60_000,
    },
  );
  return r.base64 ? { base64: r.base64, mime: r.mimetype ?? r.mimeType ?? null } : null;
}

export interface MensagemRecebida {
  /** Telefone sem o 55 (DDD + número). */
  telefone: string;
  texto: string;
  idExterno: string | null;
  /** true quando foi você que mandou pelo celular (não o lead). */
  deMim: boolean;
  nome: string | null;
  em: string;
  /** Instância (chip) que recebeu: com vários chips na conta, diz por qual número foi. */
  instancia: string | null;
  /** Foto, áudio, vídeo ou documento; base64 quando a Evolution já manda junto. */
  midia: { tipo: TipoMidiaWhatsapp; mime: string | null; nome: string | null; base64: string | null } | null;
  /** Cartões de contato compartilhados na mensagem (uma indicação, quase sempre). */
  contatos: { nome: string | null; telefones: string[] }[];
}

/** Lê o webhook "messages.upsert" da Evolution. null para o que não é mensagem de texto de pessoa. */
export function interpretarWebhook(corpo: unknown): MensagemRecebida | null {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const evento = String(c.event ?? c.type ?? '').toLowerCase();
  if (evento && !/messages[._]upsert/.test(evento)) return null;
  const bruto = Array.isArray(c.data) ? c.data[0] : (c.data ?? c);
  const d = (bruto ?? {}) as Record<string, unknown>;
  const chave = (d.key ?? {}) as Record<string, unknown>;
  const jid = String(chave.remoteJid ?? '');
  if (!jid.endsWith('@s.whatsapp.net')) return null; // grupo, status, newsletter
  const msg = (d.message ?? {}) as Record<string, unknown>;
  const ext = (msg.extendedTextMessage ?? {}) as Record<string, unknown>;
  const docComLegenda = (msg.documentWithCaptionMessage as { message?: Record<string, unknown> } | undefined)
    ?.message?.documentMessage;
  const tipos: [TipoMidiaWhatsapp, unknown][] = [
    ['imagem', msg.imageMessage],
    ['video', msg.videoMessage],
    ['documento', msg.documentMessage ?? docComLegenda],
    ['audio', msg.audioMessage ?? msg.pttMessage],
    // Figurinha é uma imagem (webp).
    ['imagem', msg.stickerMessage],
  ];
  const achada = tipos.find(([, v]) => v && typeof v === 'object');
  const info = (achada?.[1] ?? {}) as Record<string, unknown>;
  // Cartão de contato: um (contactMessage) ou vários (contactsArrayMessage).
  const cartoes = [
    msg.contactMessage,
    ...(((msg.contactsArrayMessage as { contacts?: unknown[] } | undefined)?.contacts ?? []) as unknown[]),
  ]
    .filter((x): x is { displayName?: string; vcard?: string } => !!x && typeof x === 'object')
    .map((x) => lerVcard(String(x.vcard ?? ''), x.displayName ?? null))
    .filter((x) => x.telefones.length);
  const textoCartoes = cartoes
    .map((x) => `[contato] ${x.nome ?? 'sem nome'} ${x.telefones.map((t) => formatarTelefone(t)).join(', ')}`)
    .join('\n');
  const texto = String(msg.conversation ?? ext.text ?? info.caption ?? '').trim() || textoCartoes;
  if (!texto && !achada) return null;
  const rotulo: Record<TipoMidiaWhatsapp, string> = {
    imagem: '[foto]',
    video: '[vídeo]',
    documento: '[documento]',
    audio: '[áudio]',
  };
  const base64 = typeof msg.base64 === 'string' ? msg.base64 : typeof d.base64 === 'string' ? d.base64 : null;
  const digitos = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
  const ts = Number(d.messageTimestamp);
  return {
    telefone: digitos.startsWith('55') ? digitos.slice(2) : digitos,
    texto: texto || (achada?.[1] === msg.stickerMessage ? '[figurinha]' : achada ? rotulo[achada[0]] : ''),
    idExterno: chave.id ? String(chave.id) : null,
    deMim: chave.fromMe === true,
    nome: d.pushName ? String(d.pushName) : null,
    em: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    instancia:
      typeof c.instance === 'string'
        ? c.instance
        : typeof c.instanceName === 'string'
          ? c.instanceName
          : null,
    midia: achada
      ? {
          tipo: achada[0],
          mime: info.mimetype ? String(info.mimetype) : null,
          nome: info.fileName ? String(info.fileName) : null,
          base64,
        }
      : null,
    contatos: cartoes,
  };
}
