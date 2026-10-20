import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

/**
 * E-mail pela caixa da própria empresa: envia por SMTP e lê as respostas por IMAP (Google
 * Workspace, Gmail com senha de app, Zoho, Hostinger, Outlook…). Assim a resposta do lead cai
 * na mesma caixa e o sistema lê de lá.
 */

export interface ConfigSmtp {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
}

export interface ConfigImap {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
}

export interface EmailParaEnviar {
  de: { nome: string; email: string };
  para: string;
  responderPara?: string | null;
  assunto: string;
  html: string;
  texto: string;
  anexos?: { nome: string; mime: string; conteudo: Buffer }[];
  /** Para responder dentro da mesma conversa. */
  emRespostaA?: string | null;
  referencias?: string[];
  /** Link de descadastro (cabeçalho List-Unsubscribe: o Gmail mostra "Cancelar inscrição"). */
  descadastro?: string | null;
}

export function criarEnvioSmtp(cfg: ConfigSmtp) {
  const transporte = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.porta,
    secure: cfg.porta === 465,
    auth: { user: cfg.usuario, pass: cfg.senha },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  return {
    async enviar(e: EmailParaEnviar): Promise<{ messageId: string }> {
      const info = await transporte.sendMail({
        from: { name: e.de.nome, address: e.de.email },
        to: e.para,
        replyTo: e.responderPara ?? undefined,
        subject: e.assunto,
        html: e.html,
        text: e.texto,
        attachments: e.anexos?.map((a) => ({ filename: a.nome, contentType: a.mime, content: a.conteudo })),
        inReplyTo: e.emRespostaA ?? undefined,
        references: e.referencias?.length ? e.referencias : undefined,
        headers: e.descadastro
          ? {
              'List-Unsubscribe': `<${e.descadastro}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : undefined,
      });
      return { messageId: info.messageId };
    },
    async verificar(): Promise<void> {
      await transporte.verify();
    },
  };
}

export interface EmailRecebido {
  uid: number;
  messageId: string | null;
  emRespostaA: string | null;
  referencias: string[];
  de: string;
  deNome: string | null;
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

/**
 * Lê as mensagens novas da caixa de entrada desde o último UID lido. Na primeira vez (sem UID)
 * só marca onde a caixa está: e-mails antigos não entram.
 */
export async function lerNovos(
  cfg: ConfigImap,
  desdeUid: number | null,
  limite = 100,
): Promise<{ itens: EmailRecebido[]; ultimoUid: number }> {
  const cliente = new ImapFlow({
    host: cfg.host,
    port: cfg.porta,
    secure: cfg.porta === 993,
    auth: { user: cfg.usuario, pass: cfg.senha },
    logger: false,
  });
  await cliente.connect();
  const itens: EmailRecebido[] = [];
  let ultimoUid = desdeUid ?? 0;
  const trava = await cliente.getMailboxLock('INBOX');
  try {
    const caixa = cliente.mailbox;
    const proximo = caixa && typeof caixa === 'object' ? Number(caixa.uidNext ?? 1) : 1;
    if (desdeUid == null) return { itens, ultimoUid: proximo - 1 };
    if (proximo - 1 <= desdeUid) return { itens, ultimoUid: desdeUid };
    for await (const m of cliente.fetch(`${desdeUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
      if (m.uid <= desdeUid || !m.source) continue;
      ultimoUid = Math.max(ultimoUid, m.uid);
      if (itens.length >= limite) continue;
      const p = await simpleParser(m.source);
      const de = p.from?.value?.[0];
      const cab = (n: string) => String(p.headers.get(n) ?? '').toLowerCase();
      const assunto = p.subject ?? '';
      const remetente = (de?.address ?? '').toLowerCase();
      const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : [];
      itens.push({
        uid: m.uid,
        messageId: p.messageId ?? null,
        emRespostaA: p.inReplyTo ?? null,
        referencias: refs,
        de: remetente,
        deNome: de?.name || null,
        assunto,
        texto: textoNovo(p.text ?? ''),
        data: (p.date ?? new Date()).toISOString(),
        automatica:
          (cab('auto-submitted') !== '' && cab('auto-submitted') !== 'no') ||
          cab('x-autoreply') !== '' ||
          cab('x-autorespond') !== '' ||
          /auto_reply|bulk|junk/.test(cab('precedence')),
        devolucao:
          /^(mailer-daemon|postmaster)@/.test(remetente) ||
          /(delivery status notification|undeliver|não foi possível entregar|falha na entrega|returned mail)/i.test(
            assunto,
          ),
      });
    }
  } finally {
    trava.release();
    await cliente.logout().catch(() => undefined);
  }
  return { itens, ultimoUid };
}
