import { contaAtual } from './contexto.js';
import { enderecoDaConta } from './dominios.js';

/**
 * Endereço público da API (para quem está fora do sistema chamar: Evolution, o pixel e os links
 * dos e-mails, o Google Agenda): API_URL_PUBLICA, ou o domínio que o Railway informa
 * (RAILWAY_PUBLIC_DOMAIN), ou o site + /api (o Vercel repassa para a API).
 */
export function urlPublicaApi(origens: string[]): string {
  const env = process.env.API_URL_PUBLICA?.replace(/\/$/, '');
  if (env) return env;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `${origens[0] ?? ''}/api`;
}

/**
 * Endereço oficial do sistema para uma conta (links de convite, de senha e das reuniões): o domínio
 * próprio do cliente, quando ele configurou um (marca própria); senão, o primeiro de APP_ORIGENS,
 * mesmo que a pessoa esteja usando outro endereço permitido (o antigo do Vercel, por exemplo). Sem
 * conta informada, a da requisição. Sem APP_ORIGENS, a origem do navegador.
 */
export function enderecoDoApp(
  origemDoPedido: string | undefined,
  origens: string[],
  contaId: number | null = contaAtual(),
): string {
  return (enderecoDaConta(contaId) ?? origens[0] ?? origemDoPedido ?? '').replace(/\/+$/, '');
}
