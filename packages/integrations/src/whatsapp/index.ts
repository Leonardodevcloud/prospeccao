import { formatarTelefone, lerVcard } from '@prospeccao/shared';
import { requisitarJson } from '../http.js';

/**
 * WhatsApp pela Z-API. Cada número (chip) é uma instância da Z-API com ID e token próprios; a
 * plataforma é parceira da Z-API e cria, assina e cancela as instâncias dos clientes pela API de
 * parceiro. O cliente conecta o próprio número lendo o QR Code na tela do sistema.
 *
 * O leitor do webhook também entende o formato antigo da Evolution API (mensagens que chegarem
 * durante a troca não se perdem).
 */

const BASE = 'https://api.z-api.io/instances';

export interface ConfigWhatsapp {
  /** ID da instância na Z-API. */
  instancia: string;
  /** Token da instância. */
  token: string;
  /** Token de segurança da conta Z-API (cabeçalho Client-Token), se estiver ligado. */
  clientToken: string | null;
  /** Só nos testes: outro endereço no lugar do da Z-API. */
  base?: string;
}

const urlDe = (cfg: ConfigWhatsapp, caminho: string) =>
  `${cfg.base ?? BASE}/${encodeURIComponent(cfg.instancia)}/token/${encodeURIComponent(cfg.token)}/${caminho}`;
const cabecalhos = (cfg: ConfigWhatsapp): Record<string, string> =>
  cfg.clientToken ? { 'Client-Token': cfg.clientToken } : {};

/** Número para o WhatsApp: 55 + DDD + número, só dígitos. */
export function numeroWhatsapp(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  return d.length >= 12 && d.startsWith('55') ? d : `55${d}`;
}

interface RespostaEnvio {
  messageId?: string;
  id?: string;
  zaapId?: string;
}
const idDoEnvio = (r: RespostaEnvio) => r.messageId ?? r.id ?? r.zaapId ?? null;

export async function enviarTexto(
  cfg: ConfigWhatsapp,
  telefone: string,
  texto: string,
  opcoes: { digitandoMs?: number } = {},
): Promise<{ idExterno: string | null }> {
  // "digitando…" antes de enviar (a Z-API aceita de 1 a 15 segundos).
  const segundos = Math.max(0, Math.min(15, Math.round((opcoes.digitandoMs ?? 0) / 1000)));
  const r = await requisitarJson<RespostaEnvio>(urlDe(cfg, 'send-text'), {
    servico: 'Z-API',
    method: 'POST',
    headers: cabecalhos(cfg),
    body: { phone: numeroWhatsapp(telefone), message: texto, ...(segundos ? { delayTyping: segundos } : {}) },
    timeoutMs: 30_000 + segundos * 1000,
  });
  return { idExterno: idDoEnvio(r) };
}

export interface StatusWhatsapp {
  conectado: boolean;
  /** O celular está com internet. */
  celularOnline: boolean;
  /** O que a Z-API diz ("You are not connected"…). */
  detalhe: string | null;
}

export async function statusInstancia(cfg: ConfigWhatsapp): Promise<StatusWhatsapp> {
  const r = await requisitarJson<{ connected?: boolean; smartphoneConnected?: boolean; error?: string }>(
    urlDe(cfg, 'status'),
    { servico: 'Z-API', headers: cabecalhos(cfg), timeoutMs: 15_000 },
  );
  return {
    conectado: r.connected === true,
    celularOnline: r.smartphoneConnected !== false,
    detalhe: r.error ?? null,
  };
}

/** Estado do chip em texto ("ok (WhatsApp conectado)" quando está pronto para enviar). */
export async function estadoConexao(cfg: ConfigWhatsapp): Promise<string> {
  const s = await statusInstancia(cfg);
  if (s.conectado && s.celularOnline) return 'ok (WhatsApp conectado)';
  if (s.conectado) return 'conectado, mas o celular está sem internet';
  return 'desconectado: leia o QR Code para conectar';
}

/**
 * QR Code para conectar o número (imagem em data URI). Já conectado: `conectado` true e sem
 * imagem. O QR muda a cada ~20 segundos: a tela pede de novo.
 */
export async function qrCode(cfg: ConfigWhatsapp): Promise<{ conectado: boolean; imagem: string | null }> {
  const r = await requisitarJson<{ value?: string; connected?: boolean } | string>(
    urlDe(cfg, 'qr-code/image'),
    {
      servico: 'Z-API',
      headers: cabecalhos(cfg),
      timeoutMs: 20_000,
    },
  );
  const valor = typeof r === 'string' ? r : (r.value ?? null);
  if (typeof r === 'object' && r.connected === true) return { conectado: true, imagem: null };
  if (!valor) return { conectado: false, imagem: null };
  return {
    conectado: false,
    imagem: valor.startsWith('data:') ? valor : `data:image/png;base64,${valor}`,
  };
}

/** Desconecta o número da instância (o cliente pode conectar outro lendo o QR de novo). */
export async function desconectar(cfg: ConfigWhatsapp): Promise<void> {
  await requisitarJson(urlDe(cfg, 'disconnect'), { servico: 'Z-API', headers: cabecalhos(cfg) });
}

export interface ConversaExistente {
  /** Só dígitos, com 55. */
  telefone: string;
  nome: string | null;
  ultimaEm: string | null;
}

/**
 * Conversas que já existem no WhatsApp do número (uma página). Grupos e listas de transmissão ficam
 * de fora. Vazio: acabou.
 */
export async function listarConversas(
  cfg: ConfigWhatsapp,
  pagina: number,
  tamanho = 100,
): Promise<{ conversas: ConversaExistente[]; lidas: number }> {
  const r = await requisitarJson<
    { phone?: string; name?: string; lastMessageTime?: string | number; isGroup?: boolean }[]
  >(urlDe(cfg, `chats?page=${Math.max(1, pagina)}&pageSize=${Math.max(1, Math.min(tamanho, 500))}`), {
    servico: 'Z-API',
    headers: cabecalhos(cfg),
    timeoutMs: 30_000,
  });
  const lista = Array.isArray(r) ? r : [];
  const conversas: ConversaExistente[] = [];
  for (const c of lista) {
    const fone = String(c.phone ?? '');
    // Grupo ("…-group", "@g.us"), lista de transmissão e status não são conversas com pessoas.
    if (c.isGroup || /group|broadcast|status|@g\.us|-/.test(fone)) continue;
    const digitos = fone.replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 13) continue;
    const t = Number(c.lastMessageTime);
    conversas.push({
      telefone: digitos,
      nome: c.name && !/^\d+$/.test(c.name) ? c.name.slice(0, 120) : null,
      ultimaEm: Number.isFinite(t) && t > 0 ? new Date(t < 1e12 ? t * 1000 : t).toISOString() : null,
    });
  }
  return { conversas, lidas: lista.length };
}

/** Aponta todos os webhooks da instância para o sistema (recebidas, enviadas pelo celular, status). */
export async function configurarWebhook(cfg: ConfigWhatsapp, url: string): Promise<void> {
  await requisitarJson(urlDe(cfg, 'update-every-webhooks'), {
    servico: 'Z-API',
    method: 'PUT',
    headers: cabecalhos(cfg),
    body: { value: url, notifySentByMe: true },
  });
}

export type TipoMidiaWhatsapp = 'imagem' | 'audio' | 'video' | 'documento';

const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Envia foto, vídeo, documento ou áudio (base64 sem o prefixo data:). Áudio vai como mensagem de voz. */
export async function enviarMidia(
  cfg: ConfigWhatsapp,
  telefone: string,
  m: { tipo: TipoMidiaWhatsapp; mime: string; base64: string; nome?: string; legenda?: string },
): Promise<{ idExterno: string | null }> {
  const phone = numeroWhatsapp(telefone);
  const dataUri = `data:${m.mime};base64,${m.base64}`;
  const legenda = m.legenda ? { caption: m.legenda } : {};
  let caminho: string;
  let body: Record<string, unknown>;
  if (m.tipo === 'audio') {
    caminho = 'send-audio';
    body = { phone, audio: dataUri, waveform: true };
  } else if (m.tipo === 'imagem') {
    caminho = 'send-image';
    body = { phone, image: dataUri, ...legenda };
  } else if (m.tipo === 'video') {
    caminho = 'send-video';
    body = { phone, video: dataUri, ...legenda };
  } else {
    const ext =
      m.nome?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? EXTENSAO[m.mime.toLowerCase()] ?? 'pdf';
    caminho = `send-document/${ext}`;
    body = { phone, document: dataUri, fileName: m.nome ?? `arquivo.${ext}`, ...legenda };
  }
  const r = await requisitarJson<RespostaEnvio>(urlDe(cfg, caminho), {
    servico: 'Z-API',
    method: 'POST',
    headers: cabecalhos(cfg),
    body,
    timeoutMs: 60_000,
  });
  return { idExterno: idDoEnvio(r) };
}

/** Baixa o arquivo de uma mensagem recebida (a Z-API manda o link no webhook; vale por 30 dias). */
export async function baixarMidia(url: string): Promise<{ base64: string; mime: string | null } | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  const bytes = Buffer.from(await r.arrayBuffer());
  return { base64: bytes.toString('base64'), mime: r.headers.get('content-type')?.split(';')[0] ?? null };
}

/** Confere quais números têm WhatsApp (DDD + número → tem). Só consulta, não envia nada. */
export async function verificarNumeros(
  cfg: ConfigWhatsapp,
  numeros: string[],
): Promise<Map<string, boolean>> {
  const saida = new Map<string, boolean>();
  for (const n of numeros) {
    const r = await requisitarJson<{ exists?: boolean } | { exists?: boolean }[]>(
      urlDe(cfg, `phone-exists/${numeroWhatsapp(n)}`),
      { servico: 'Z-API', headers: cabecalhos(cfg), timeoutMs: 15_000 },
    );
    const item = Array.isArray(r) ? r[0] : r;
    saida.set(n, item?.exists === true);
  }
  return saida;
}

/* ---------------- Parceiro: instâncias dos clientes ---------------- */

export interface ConfigParceiro {
  /** Token de parceiro da Z-API (Authorization: Bearer). */
  token: string;
}

const parceiro = (p: ConfigParceiro) => ({ Authorization: `Bearer ${p.token}` });

/** Cria a instância de um cliente (2 dias de teste; depois precisa ser assinada). */
export async function criarInstancia(
  p: ConfigParceiro,
  nome: string,
): Promise<{ instancia: string; token: string; vencimento: string | null }> {
  const r = await requisitarJson<{ id: string; token: string; due?: number | string }>(
    `${BASE}/integrator/on-demand`,
    { servico: 'Z-API', method: 'POST', headers: parceiro(p), body: { name: nome.slice(0, 60) } },
  );
  const due = r.due == null ? null : new Date(Number(r.due)).toISOString();
  return { instancia: r.id, token: r.token, vencimento: due && due !== 'Invalid Date' ? due : null };
}

/** Assina a instância (passa a ser cobrada no mês; sem isso, fica pendente depois do teste). */
export async function assinarInstancia(p: ConfigParceiro, cfg: Pick<ConfigWhatsapp, 'instancia' | 'token'>) {
  await requisitarJson(
    `${BASE}/${encodeURIComponent(cfg.instancia)}/token/${encodeURIComponent(cfg.token)}/integrator/on-demand/subscription`,
    { servico: 'Z-API', method: 'POST', headers: parceiro(p), body: {} },
  );
}

/** Cancela a instância (para de cobrar). */
export async function cancelarInstancia(p: ConfigParceiro, cfg: Pick<ConfigWhatsapp, 'instancia' | 'token'>) {
  await requisitarJson(
    `${BASE}/${encodeURIComponent(cfg.instancia)}/token/${encodeURIComponent(cfg.token)}/integrator/on-demand/cancel`,
    { servico: 'Z-API', method: 'POST', headers: parceiro(p), body: {} },
  );
}

/* ---------------- Webhook ---------------- */

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
  /** Foto, áudio, vídeo ou documento: o link para baixar (Z-API) ou o base64 (Evolution). */
  midia: {
    tipo: TipoMidiaWhatsapp;
    mime: string | null;
    nome: string | null;
    base64: string | null;
    url: string | null;
  } | null;
  /** Cartões de contato compartilhados na mensagem (uma indicação, quase sempre). */
  contatos: { nome: string | null; telefones: string[] }[];
}

const ROTULO_MIDIA: Record<TipoMidiaWhatsapp, string> = {
  imagem: '[foto]',
  video: '[vídeo]',
  documento: '[documento]',
  audio: '[áudio]',
};

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Mudança de conexão do número (webhook da Z-API): para atualizar o chip na hora. */
export function eventoDeConexao(corpo: unknown): { instancia: string; conectado: boolean } | null {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const tipo = String(c.type ?? '');
  const instancia = texto(c.instanceId);
  if (!instancia) return null;
  if (tipo === 'ConnectedCallback') return { instancia, conectado: true };
  if (tipo === 'DisconnectedCallback') return { instancia, conectado: false };
  return null;
}

/** Mensagem recebida da Z-API (ReceivedCallback). */
function interpretarZapi(c: Record<string, unknown>): MensagemRecebida | null {
  if (c.type && c.type !== 'ReceivedCallback') return null;
  if (c.isGroup === true || c.isNewsletter === true || c.broadcast === true || c.isStatusReply === true)
    return null;
  const fone = String(c.phone ?? '');
  if (!fone || fone.includes('-') || fone.includes('@')) return null; // grupo, canal, lista
  const sub = (k: string) => (c[k] && typeof c[k] === 'object' ? (c[k] as Record<string, unknown>) : null);
  const midias: [TipoMidiaWhatsapp, Record<string, unknown> | null, string][] = [
    ['imagem', sub('image'), 'imageUrl'],
    ['video', sub('video'), 'videoUrl'],
    ['documento', sub('document'), 'documentUrl'],
    ['audio', sub('audio'), 'audioUrl'],
    ['imagem', sub('sticker'), 'stickerUrl'],
  ];
  const achada = midias.find(([, v]) => v);
  const info = achada?.[1] ?? {};
  const contato = sub('contact');
  const cartoes = contato
    ? [lerVcard(String(contato.vCard ?? contato.vcard ?? ''), texto(contato.displayName))].filter(
        (x) => x.telefones.length,
      )
    : [];
  const textoCartoes = cartoes
    .map((x) => `[contato] ${x.nome ?? 'sem nome'} ${x.telefones.map((t) => formatarTelefone(t)).join(', ')}`)
    .join('\n');
  const corpoTexto = texto(sub('text')?.message) ?? texto(info.caption) ?? textoCartoes;
  if (!corpoTexto && !achada) return null;
  const digitos = fone.replace(/\D/g, '');
  const ms = Number(c.momment ?? c.moment);
  return {
    telefone: digitos.startsWith('55') ? digitos.slice(2) : digitos,
    texto:
      corpoTexto || (achada?.[1] === sub('sticker') ? '[figurinha]' : achada ? ROTULO_MIDIA[achada[0]] : ''),
    idExterno: texto(c.messageId),
    deMim: c.fromMe === true,
    nome: texto(c.senderName) ?? texto(c.chatName),
    em: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString(),
    instancia: texto(c.instanceId),
    midia: achada
      ? {
          tipo: achada[0],
          mime: texto(info.mimeType),
          nome: texto(info.fileName) ?? texto(info.title),
          base64: null,
          url: texto(info[achada[2]]),
        }
      : null,
    contatos: cartoes,
  };
}

/** Mensagem do formato antigo da Evolution (messages.upsert). */
function interpretarEvolution(c: Record<string, unknown>): MensagemRecebida | null {
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
    ['imagem', msg.stickerMessage],
  ];
  const achada = tipos.find(([, v]) => v && typeof v === 'object');
  const info = (achada?.[1] ?? {}) as Record<string, unknown>;
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
  const corpoTexto = String(msg.conversation ?? ext.text ?? info.caption ?? '').trim() || textoCartoes;
  if (!corpoTexto && !achada) return null;
  const base64 = typeof msg.base64 === 'string' ? msg.base64 : typeof d.base64 === 'string' ? d.base64 : null;
  const digitos = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
  const ts = Number(d.messageTimestamp);
  return {
    telefone: digitos.startsWith('55') ? digitos.slice(2) : digitos,
    texto:
      corpoTexto ||
      (achada?.[1] === msg.stickerMessage ? '[figurinha]' : achada ? ROTULO_MIDIA[achada[0]] : ''),
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
          url: null,
        }
      : null,
    contatos: cartoes,
  };
}

/** Lê o webhook de mensagem (Z-API; aceita também o formato antigo da Evolution). null para o resto. */
export function interpretarWebhook(corpo: unknown): MensagemRecebida | null {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (c.event !== undefined || c.data !== undefined) return interpretarEvolution(c);
  return interpretarZapi(c);
}
