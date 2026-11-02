import { AppError } from '@prospeccao/shared';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

/**
 * Quantos proxies ficam à frente da api: o Vercel (o app chama /api, que o Vercel repassa) e a
 * borda do Railway. Com os dois, `req.ip` é o endereço de quem usa o sistema, não o do Vercel
 * (com 1, todo mundo que saía pelo mesmo endereço do Vercel dividia o mesmo limite de login).
 * PROXIES_CONFIAVEIS muda isso se a api passar a ter outro caminho (ex.: Cloudflare na frente).
 */
export const PROXIES_CONFIAVEIS = Math.max(
  0,
  Math.min(5, Number.parseInt(process.env.PROXIES_CONFIAVEIS ?? '', 10) || 2),
);

/**
 * O endereço que chegou na borda do Railway (o último do x-forwarded-for). Pelo Vercel, é um
 * endereço do Vercel (muita gente junta); chamando a api direto, é o de quem chama, e esse ele
 * não consegue inventar. Serve de teto para quem tenta driblar o limite por pessoa mandando um
 * x-forwarded-for falso direto no endereço do Railway.
 */
export function enderecoDoSalto(req: Request): string {
  const lista = String(req.get('x-forwarded-for') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return lista[lista.length - 1] ?? req.socket.remoteAddress ?? '';
}

interface OpcoesLimite {
  janelaMs: number;
  limite: number;
  mensagem: string;
  /** De quem é a conta do limite (padrão: o endereço de quem usa). */
  chave?: (req: Request) => string;
}

export function limitar(o: OpcoesLimite): RequestHandler {
  return rateLimit({
    windowMs: o.janelaMs,
    limit: o.limite,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(o.chave ? { keyGenerator: o.chave } : {}),
    handler: (_req, _res, next) => next(new AppError(429, 'muitas_tentativas', o.mensagem)),
  });
}

/** Teto por endereço que chegou no Railway (ver `enderecoDoSalto`): bem mais alto que o por pessoa. */
export function limitarPorSalto(o: Omit<OpcoesLimite, 'chave'>): RequestHandler {
  return limitar({ ...o, chave: (req) => `salto:${ipKeyGenerator(enderecoDoSalto(req))}` });
}
