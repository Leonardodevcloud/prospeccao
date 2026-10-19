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

export interface MensagemRecebida {
  /** Telefone sem o 55 (DDD + número). */
  telefone: string;
  texto: string;
  idExterno: string | null;
  /** true quando foi você que mandou pelo celular (não o lead). */
  deMim: boolean;
  nome: string | null;
  em: string;
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
  const legenda = (msg.imageMessage ?? msg.videoMessage ?? msg.documentMessage ?? {}) as Record<
    string,
    unknown
  >;
  const texto = String(msg.conversation ?? ext.text ?? legenda.caption ?? '').trim();
  const audio = !texto && (msg.audioMessage || msg.pttMessage);
  if (!texto && !audio) return null;
  const digitos = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
  const ts = Number(d.messageTimestamp);
  return {
    telefone: digitos.startsWith('55') ? digitos.slice(2) : digitos,
    texto: texto || '[áudio]',
    idExterno: chave.id ? String(chave.id) : null,
    deMim: chave.fromMe === true,
    nome: d.pushName ? String(d.pushName) : null,
    em: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
  };
}
