import { AsyncLocalStorage } from 'node:async_hooks';
import type { PapelUsuario } from '@prospeccao/shared';

/**
 * Quem está fazendo a requisição e em qual conta, disponível em qualquer função chamada por ela
 * (o histórico grava o autor e toda consulta filtra a conta sem passar isso de mão em mão).
 * Fora de uma requisição (motores, webhooks) não há usuário: é o sistema, rodando para uma conta
 * de cada vez (comConta).
 */
export interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  papel: PapelUsuario;
  /** Conta (unidade) em que a pessoa está trabalhando agora. */
  contaId: number;
  contaNome: string;
  /** Organização da unidade. */
  organizacaoId: number;
  /** Papel na organização inteira: gestor (administra todas as unidades) ou leitura (só olha). */
  papelOrganizacao: 'gestor' | 'leitura' | null;
  /** Administra todas as contas (painel master). */
  master: boolean;
  /** Conta da própria pessoa (o master pode estar "dentro" de outra). */
  contaPropria: number;
  /** Sessão registrada (null: cookie antigo, de antes do registro de sessões). */
  sessaoId: string | null;
  /** A organização exige duas etapas e a pessoa ainda não configurou. */
  precisaDuasEtapas: boolean;
}

interface Contexto {
  usuario: UsuarioSessao | null;
  contaId: number;
}

const contexto = new AsyncLocalStorage<Contexto>();

export function usuarioAtual(): UsuarioSessao | null {
  return contexto.getStore()?.usuario ?? null;
}

export function contaAtual(): number | null {
  return contexto.getStore()?.contaId ?? null;
}

/** Conta da requisição ou da rodada do motor. Sem conta, é erro de programação: nada roda "em todas". */
export function conta(): number {
  const id = contaAtual();
  if (!Number.isInteger(id) || (id as number) <= 0) throw new Error('Operação sem conta definida');
  return id as number;
}

/**
 * A conta como número para pôr direto no SQL. Vem só da sessão (nunca do que o usuário manda) e é
 * conferida como inteiro, então não abre espaço para injeção; evita renumerar os $1, $2… de
 * consultas montadas em pedaços.
 */
export function contaSql(): string {
  return String(conta());
}

export function comUsuario<T>(usuario: UsuarioSessao, fn: () => T): T {
  return contexto.run({ usuario, contaId: usuario.contaId }, fn);
}

/** Roda como o sistema dentro de uma conta (motores, webhooks, rotinas). */
export function comConta<T>(contaId: number, fn: () => T): T {
  return contexto.run({ usuario: null, contaId }, fn);
}
