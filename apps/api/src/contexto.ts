import { AsyncLocalStorage } from 'node:async_hooks';
import type { PapelUsuario } from '@prospeccao/shared';

/**
 * Quem está fazendo a requisição, disponível em qualquer função chamada por ela (o histórico
 * grava o autor sem precisar passar o usuário de mão em mão). Fora de uma requisição (motor
 * do agente, automações) não há usuário: é o sistema.
 */
export interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  papel: PapelUsuario;
}

const contexto = new AsyncLocalStorage<UsuarioSessao>();

export function usuarioAtual(): UsuarioSessao | null {
  return contexto.getStore() ?? null;
}

export function comUsuario<T>(usuario: UsuarioSessao, fn: () => T): T {
  return contexto.run(usuario, fn);
}
