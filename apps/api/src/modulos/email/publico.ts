import { assinaturaValida } from '@prospeccao/integrations/email';
import express, { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { type EventoResend, processarEvento } from './motor.js';
import * as repo from './repositorio.js';

/**
 * Links que vão dentro do e-mail (sem login): a imagem que marca a abertura, o clique e o
 * "sair da lista". O token de cada envio é aleatório e não revela nada do lead.
 */

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function pagina(titulo: string, corpo: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f4;color:#1f2933">
<main style="max-width:440px;margin:15vh auto;padding:32px 24px;background:#fff;border:1px solid #e7e5e4;border-radius:12px;text-align:center">${corpo}</main></body></html>`;
}

export function rotasEmailPublico({ pool, log }: DepsApi): Router {
  const r = Router();
  const token = (t: string) =>
    t
      .replace(/\.gif$/, '')
      .replace(/[^a-f0-9]/gi, '')
      .slice(0, 64);

  r.get('/a/:token', async (req, res) => {
    // A resposta sai sempre (a imagem não pode quebrar o e-mail); a contagem é melhor esforço.
    pool
      .query(
        `UPDATE comercial.envios_email SET aberto_em = coalesce(aberto_em, now()), aberturas = aberturas + 1
          WHERE token = $1 AND status = 'enviado'`,
        [token(req.params.token)],
      )
      .catch((erro) => log.warn({ err: erro }, 'e-mail: falha ao contar abertura'));
    res
      .type('image/gif')
      .set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      .set('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(GIF);
  });

  r.get('/c/:token/:i', async (req, res) => {
    const i = Number(req.params.i);
    const { rows } = await pool.query<{ link: string | null }>(
      `UPDATE comercial.envios_email
          SET clicado_em = coalesce(clicado_em, now()), cliques = cliques + 1, aberto_em = coalesce(aberto_em, now())
        WHERE token = $1 AND links[$2::int + 1] IS NOT NULL RETURNING links[$2::int + 1] AS link`,
      [token(req.params.token), Number.isInteger(i) && i >= 0 && i < 100 ? i : -1],
    );
    const link = rows[0]?.link;
    // Só redireciona para o link que estava no e-mail (nada de redirecionar para qualquer lugar).
    if (!link || !/^https?:\/\//i.test(link)) {
      res
        .status(404)
        .type('html')
        .send(pagina('Link não encontrado', '<h1 style="font-size:20px">Link não encontrado</h1>'));
      return;
    }
    res.redirect(302, link);
  });

  async function emailDoToken(t: string): Promise<string | null> {
    const { rows } = await pool.query<{ email: string }>(
      'SELECT email FROM comercial.envios_email WHERE token = $1',
      [token(t)],
    );
    return rows[0]?.email ?? null;
  }

  // GET só pergunta (antivírus e pré-visualizações abrem links sozinhos); quem tira da lista é o POST.
  r.get('/sair/:token', async (req, res) => {
    const email = await emailDoToken(req.params.token);
    res.type('html').send(
      email
        ? pagina(
            'Sair da lista',
            `<h1 style="font-size:20px;margin:0 0 12px">Não quer mais receber nossos e-mails?</h1>
             <p style="margin:0 0 24px;color:#57534e">${email.replace(/[<>&"]/g, '')}</p>
             <form method="post"><button style="font-size:15px;padding:12px 20px;border:0;border-radius:8px;background:#0f766e;color:#fff;cursor:pointer">Sim, me tire da lista</button></form>`,
          )
        : pagina('Link inválido', '<h1 style="font-size:20px">Link inválido ou expirado.</h1>'),
    );
  });

  r.post('/sair/:token', async (req, res) => {
    const email = await emailDoToken(req.params.token);
    if (email) await repo.descadastrar(pool, email, 'Clicou em "sair da lista"');
    res
      .type('html')
      .send(
        pagina(
          'Pronto',
          '<h1 style="font-size:20px;margin:0 0 12px">Pronto, você saiu da lista.</h1><p style="margin:0;color:#57534e">Não vamos mais mandar e-mails para este endereço.</p>',
        ),
      );
  });

  return r;
}

/**
 * Webhook do Resend (entregue, abriu, clicou, voltou, spam, resposta recebida). Só aceita aviso
 * assinado com o segredo do webhook; precisa do corpo cru para conferir a assinatura.
 */
export function rotasWebhookResend(deps: DepsApi): Router {
  const r = Router();
  r.post('/', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
    const segredo = deps.email?.segredoWebhook;
    if (!deps.email || !segredo) {
      res
        .status(404)
        .json({ erro: { codigo: 'nao_configurado', mensagem: 'Webhook do Resend não configurado.' } });
      return;
    }
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const ok = assinaturaValida(
      segredo,
      { id: req.get('svix-id'), timestamp: req.get('svix-timestamp'), assinatura: req.get('svix-signature') },
      corpo,
    );
    if (!ok) {
      res.status(401).json({ erro: { codigo: 'assinatura_invalida', mensagem: 'Assinatura inválida.' } });
      return;
    }
    let evento: EventoResend;
    try {
      evento = JSON.parse(corpo.toString('utf8')) as EventoResend;
    } catch {
      res.status(400).json({ erro: { codigo: 'json_invalido', mensagem: 'Corpo inválido.' } });
      return;
    }
    try {
      const feito = await processarEvento(deps, evento);
      deps.log.info({ tipo: evento.type, feito }, 'resend: aviso processado');
      res.json({ ok: true, feito });
    } catch (erro) {
      // 500 faz o Resend tentar de novo mais tarde.
      deps.log.error({ err: erro, tipo: evento.type }, 'resend: falha ao processar aviso');
      res
        .status(500)
        .json({ erro: { codigo: 'falha', mensagem: 'Falha ao processar; o Resend vai tentar de novo.' } });
    }
  });
  return r;
}
