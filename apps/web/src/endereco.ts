/**
 * Endereço oficial do sistema (o primeiro de APP_ORIGENS, que a api manda em /auth/eu). Os links que
 * a tela copia ou manda (sala de reunião, agenda) saem com ele, mesmo que a pessoa esteja usando o
 * sistema por outro endereço (o antigo do Vercel, por exemplo). Antes de saber, o endereço aberto.
 */
let base = typeof location === 'undefined' ? '' : location.origin;

export function definirEnderecoDoSistema(endereco: string | null | undefined): void {
  if (endereco) base = endereco.replace(/\/+$/, '');
}

export const enderecoDoSistema = () => base;

/** Link da sala de reunião para mandar ao lead. */
export const linkDaSala = (codigo: string) => `${base}/r/${codigo}`;
