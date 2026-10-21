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

/** Endereço da tela (para links de convite e de senha): a origem do navegador ou a primeira configurada. */
export function enderecoDoApp(origemDoPedido: string | undefined, origens: string[]): string {
  if (origemDoPedido && origens.includes(origemDoPedido.toLowerCase())) return origemDoPedido;
  return origens[0] ?? '';
}
