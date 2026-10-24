import { createHmac, timingSafeEqual } from 'node:crypto';
import { requisitarJson } from '../http.js';

/**
 * E-mail pelo Resend: envia pela API, recebe os avisos (entregue, voltou, spam, abriu, clicou)
 * e as respostas dos leads por webhook. A resposta chega num endereço do domínio de recebimento
 * configurado no Resend (r-<token>@respostas.suaempresa.com.br): o token diz de qual envio ela é.
 */

const API = 'https://api.resend.com';

export interface ConfigResend {
  apiKey: string;
}

export interface EmailParaEnviar {
  de: { nome: string; email: string };
  para: string;
  /** Para onde vai a resposta do lead (o endereço com o token, quando há domínio de respostas). */
  responderPara?: string | null;
  assunto: string;
  html: string;
  texto: string;
  anexos?: { nome: string; mime: string; conteudo: Buffer }[];
  /** Para o follow-up cair na mesma conversa do e-mail anterior. */
  emRespostaA?: string | null;
  referencias?: string[];
  /** Link de descadastro (cabeçalho List-Unsubscribe: o Gmail mostra "Cancelar inscrição"). */
  descadastro?: string | null;
  /** Etiquetas que voltam nos webhooks (ex.: o id do envio). */
  etiquetas?: Record<string, string>;
  /** Evita mandar duas vezes se a mesma chamada repetir. */
  chave?: string;
}

const nomeSeguro = (s: string) => s.replace(/["<>\r\n]/g, '').trim();

export async function enviarEmail(cfg: ConfigResend, e: EmailParaEnviar): Promise<{ id: string }> {
  const cabecalhos: Record<string, string> = {};
  if (e.descadastro) {
    cabecalhos['List-Unsubscribe'] = `<${e.descadastro}>`;
    cabecalhos['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  if (e.emRespostaA) cabecalhos['In-Reply-To'] = e.emRespostaA;
  if (e.referencias?.length) cabecalhos.References = e.referencias.join(' ');
  return requisitarJson<{ id: string }>(`${API}/emails`, {
    servico: 'Resend',
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      ...(e.chave ? { 'idempotency-key': e.chave } : {}),
    },
    body: {
      from: `${nomeSeguro(e.de.nome)} <${e.de.email}>`,
      to: [e.para],
      subject: e.assunto,
      html: e.html,
      text: e.texto,
      ...(e.responderPara ? { reply_to: e.responderPara } : {}),
      ...(Object.keys(cabecalhos).length ? { headers: cabecalhos } : {}),
      ...(e.anexos?.length
        ? {
            attachments: e.anexos.map((a) => ({
              filename: a.nome,
              content: a.conteudo.toString('base64'),
              content_type: a.mime,
            })),
          }
        : {}),
      ...(e.etiquetas
        ? {
            tags: Object.entries(e.etiquetas).map(([name, value]) => ({
              name,
              value: value.replace(/[^\w-]/g, '_'),
            })),
          }
        : {}),
    },
    timeoutMs: 60_000,
  });
}

/** Confere a chave e se o domínio do remetente está verificado no Resend. */
export async function verificarResend(cfg: ConfigResend, remetente: string): Promise<string> {
  const r = await requisitarJson<{ data?: { name: string; status: string }[] }>(`${API}/domains`, {
    servico: 'Resend',
    headers: { authorization: `Bearer ${cfg.apiKey}` },
  });
  const dominio = remetente.split('@')[1]?.toLowerCase() ?? '';
  const d = r.data?.find((x) => x.name.toLowerCase() === dominio);
  if (!d) return `chave ok, mas o domínio ${dominio} não está cadastrado no Resend`;
  return d.status === 'verified'
    ? `ok (${dominio} verificado)`
    : `domínio ${dominio}: ${d.status} (falta verificar o DNS)`;
}

export interface EmailRecebido {
  id: string;
  messageId: string | null;
  emRespostaA: string | null;
  referencias: string[];
  de: string;
  deNome: string | null;
  /** Endereços para onde o lead respondeu (o do token está aqui). */
  para: string[];
  assunto: string;
  /** Só o que a pessoa escreveu (sem o e-mail citado abaixo, quando dá para separar). */
  texto: string;
  data: string;
  /** Resposta automática (férias, ausência): não conta como resposta. */
  automatica: boolean;
  /** Aviso de entrega falha (endereço não existe). */
  devolucao: boolean;
}

/** Corta o histórico citado ("Em seg., fulano escreveu:", linhas com ">"). */
export function textoNovo(texto: string): string {
  const linhas = texto.replace(/\r/g, '').split('\n');
  const fim = linhas.findIndex(
    (l) =>
      /^\s*>/.test(l) ||
      /^(em|on) .{4,120}(escreveu|wrote):?\s*$/i.test(l.trim()) ||
      /^-{2,}\s*(mensagem original|original message)/i.test(l.trim()) ||
      /^(de|from):\s.+@/i.test(l.trim()),
  );
  const novo = (fim >= 0 ? linhas.slice(0, fim) : linhas).join('\n').trim();
  return (novo || texto).trim().slice(0, 20_000);
}

/** HTML → texto simples (quando o e-mail recebido não traz a versão em texto). */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "Fulano <a@b.com>" → { email, nome }. */
export function lerEndereco(bruto: string): { email: string; nome: string | null } {
  const m = bruto.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: (m[2] ?? '').trim().toLowerCase(), nome: m[1]?.trim() || null };
  return { email: bruto.trim().toLowerCase(), nome: null };
}

interface RecebidoResend {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  headers: Record<string, string | string[]> | null;
  message_id: string | null;
  created_at: string;
}

/** Busca o e-mail recebido completo (o webhook só traz o resumo). */
export async function buscarRecebido(cfg: ConfigResend, id: string): Promise<EmailRecebido> {
  const r = await requisitarJson<RecebidoResend>(`${API}/emails/receiving/${encodeURIComponent(id)}`, {
    servico: 'Resend',
    headers: { authorization: `Bearer ${cfg.apiKey}` },
  });
  const cab = (n: string) => {
    const h = r.headers ?? {};
    const k = Object.keys(h).find((x) => x.toLowerCase() === n);
    const v = k ? h[k] : '';
    return (Array.isArray(v) ? v.join(' ') : String(v ?? '')).trim();
  };
  const de = lerEndereco(r.from ?? '');
  const assunto = r.subject ?? '';
  return {
    id: r.id,
    messageId: r.message_id ?? (cab('message-id') || null),
    emRespostaA: cab('in-reply-to') || null,
    referencias: cab('references').split(/\s+/).filter(Boolean),
    de: de.email,
    deNome: de.nome,
    para: (r.to ?? []).map((t) => lerEndereco(t).email),
    assunto,
    texto: textoNovo(r.text?.trim() ? r.text : htmlParaTexto(r.html ?? '')),
    data: r.created_at ?? new Date().toISOString(),
    automatica:
      (cab('auto-submitted') !== '' && cab('auto-submitted').toLowerCase() !== 'no') ||
      cab('x-autoreply') !== '' ||
      cab('x-autorespond') !== '' ||
      /auto_reply|bulk|junk/i.test(cab('precedence')),
    devolucao:
      /^(mailer-daemon|postmaster)@/.test(de.email) ||
      /(delivery status notification|undeliver|não foi possível entregar|falha na entrega|returned mail)/i.test(
        assunto,
      ),
  };
}

/**
 * Confere a assinatura do webhook do Resend (padrão Svix): HMAC-SHA256 de "id.timestamp.corpo"
 * com o segredo (whsec_…), comparado a uma das assinaturas "v1,…" do cabeçalho. Recusa
 * mensagens com mais de 5 minutos (evita reenvio de uma mensagem antiga capturada).
 */
export function assinaturaValida(
  segredo: string,
  cab: { id?: string; timestamp?: string; assinatura?: string },
  corpo: Buffer | string,
  agora = Date.now(),
): boolean {
  if (!cab.id || !cab.timestamp || !cab.assinatura) return false;
  const ts = Number(cab.timestamp);
  if (!Number.isFinite(ts) || Math.abs(agora / 1000 - ts) > 300) return false;
  const chave = Buffer.from(segredo.replace(/^whsec_/, ''), 'base64');
  const esperado = createHmac('sha256', chave)
    .update(`${cab.id}.${cab.timestamp}.${Buffer.isBuffer(corpo) ? corpo.toString('utf8') : corpo}`)
    .digest();
  return cab.assinatura.split(' ').some((parte) => {
    const [versao, valor] = parte.split(',');
    if (versao !== 'v1' || !valor) return false;
    const recebido = Buffer.from(valor, 'base64');
    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
  });
}

/* ───────── Domínios (a conta do Resend é da plataforma; cada cliente cadastra o domínio dele) ───────── */

export type SituacaoDominio = 'pendente' | 'verificado' | 'falhou';

export interface RegistroDns {
  /** Para que serve: envio (SPF/MX de retorno), assinatura (DKIM) ou política (DMARC). */
  finalidade: string;
  tipo: string;
  /** Nome do registro como se digita no painel do DNS (relativo ao domínio). */
  nome: string;
  valor: string;
  prioridade: number | null;
  ttl: string | null;
  situacao: SituacaoDominio;
}

export interface DominioResend {
  id: string;
  nome: string;
  situacao: SituacaoDominio;
  registros: RegistroDns[];
}

interface DominioResendCru {
  id: string;
  name: string;
  status?: string;
  records?: {
    record?: string;
    name?: string;
    type?: string;
    ttl?: string;
    status?: string;
    value?: string;
    priority?: number;
  }[];
}

const situacaoDe = (s: string | undefined): SituacaoDominio =>
  s === 'verified' ? 'verificado' : s === 'failed' ? 'falhou' : 'pendente';

const FINALIDADE: Record<string, string> = {
  SPF: 'Envio (SPF)',
  DKIM: 'Assinatura (DKIM)',
  MX: 'Retorno de envio (MX)',
  DMARC: 'Política (DMARC)',
};

export function converterDominio(d: DominioResendCru): DominioResend {
  return {
    id: d.id,
    nome: d.name,
    situacao: situacaoDe(d.status),
    registros: (d.records ?? []).map((r) => ({
      finalidade: FINALIDADE[r.record ?? ''] ?? r.record ?? '',
      tipo: r.type ?? '',
      nome: r.name ?? '',
      valor: r.value ?? '',
      prioridade: r.priority ?? null,
      ttl: r.ttl ?? null,
      situacao: situacaoDe(r.status),
    })),
  };
}

/** Registro de DMARC recomendado (o Resend não cria; o Gmail e o Yahoo exigem para volume). */
export function registroDmarc(dominio: string): RegistroDns {
  return {
    finalidade: FINALIDADE.DMARC!,
    tipo: 'TXT',
    nome: '_dmarc',
    valor: `v=DMARC1; p=none; rua=mailto:dmarc@${dominio}`,
    prioridade: null,
    ttl: 'Auto',
    situacao: 'pendente',
  };
}

const opcoesResend = (cfg: ConfigResend) => ({
  servico: 'Resend',
  headers: { authorization: `Bearer ${cfg.apiKey}` },
});

export async function criarDominio(
  cfg: ConfigResend & { base?: string },
  nome: string,
): Promise<DominioResend> {
  const d = await requisitarJson<DominioResendCru>(`${cfg.base ?? API}/domains`, {
    ...opcoesResend(cfg),
    method: 'POST',
    body: { name: nome, region: 'sa-east-1' },
  });
  return converterDominio(d);
}

export async function lerDominio(cfg: ConfigResend & { base?: string }, id: string): Promise<DominioResend> {
  return converterDominio(
    await requisitarJson<DominioResendCru>(
      `${cfg.base ?? API}/domains/${encodeURIComponent(id)}`,
      opcoesResend(cfg),
    ),
  );
}

/** Pede ao Resend para conferir o DNS agora (a conferência roda em segundo plano por até 72 h). */
export async function verificarDominio(cfg: ConfigResend & { base?: string }, id: string): Promise<void> {
  await requisitarJson(`${cfg.base ?? API}/domains/${encodeURIComponent(id)}/verify`, {
    ...opcoesResend(cfg),
    method: 'POST',
  });
}

export async function apagarDominio(cfg: ConfigResend & { base?: string }, id: string): Promise<void> {
  await requisitarJson(`${cfg.base ?? API}/domains/${encodeURIComponent(id)}`, {
    ...opcoesResend(cfg),
    method: 'DELETE',
  });
}
