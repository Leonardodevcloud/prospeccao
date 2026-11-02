/**
 * O que vai para o log de cada requisição: o caminho sem o que é segredo ou dado pessoal. Os links
 * de convite, de senha nova, da agenda, dos e-mails, dos webhooks e das salas levam o token no
 * caminho; a busca (`?q=`) pode levar nome ou telefone. Nada disso fica gravado no log.
 */
const SEGREDO_NO_CAMINHO =
  /^((?:\/api)?\/(?:auth\/(?:convite|redefinir)|teste\/confirmar|calendario|e\/(?:a|c|i|sair|resend)|webhooks\/(?:whatsapp|evolution)|v1\/entrada|salas|conversas\/nao-identificados))\/[^/?#]+/;

export function caminhoParaLog(url: string | undefined): string {
  const caminho = (url ?? '').split(/[?#]/)[0] ?? '';
  return caminho.replace(SEGREDO_NO_CAMINHO, '$1/…');
}
