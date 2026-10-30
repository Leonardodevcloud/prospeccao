import type { Executor } from '@prospeccao/db';

/**
 * Domínios próprios ativos dos clientes (marca própria), lembrados em memória: é deles que saem os
 * links (reunião, convite, senha) de cada conta, e eles entram na lista de origens aceitas. Recarrega
 * a cada minuto e logo depois de qualquer mudança (ativou, removeu).
 */

let porConta = new Map<number, string>();
let ativos = new Set<string>();

export async function recarregarDominios(db: Executor): Promise<void> {
  const { rows } = await db.query<{ conta: number; dominio: string }>(
    `SELECT c.id AS conta, o.dominio
       FROM cadastro.organizacoes o JOIN cadastro.contas c ON c.organizacao_id = o.id
      WHERE o.dominio_situacao = 'ativo' AND o.ativa`,
  );
  porConta = new Map(rows.map((r) => [Number(r.conta), r.dominio]));
  ativos = new Set(rows.map((r) => r.dominio));
}

/** Endereço (https://dominio) da conta, quando o cliente dela tem domínio próprio ativo. */
export function enderecoDaConta(contaId: number | null | undefined): string | null {
  const d = contaId ? porConta.get(contaId) : undefined;
  return d ? `https://${d}` : null;
}

/** A origem do navegador é o domínio próprio ativo de algum cliente. */
export function origemDeCliente(origem: string): boolean {
  try {
    const u = new URL(origem);
    return u.protocol === 'https:' && ativos.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Mantém a lista em dia (a cada minuto). Devolve como parar. */
export function manterDominios(db: Executor, aoFalhar: (erro: unknown) => void): () => void {
  const rodar = () => void recarregarDominios(db).catch(aoFalhar);
  rodar();
  const t = setInterval(rodar, 60_000);
  t.unref();
  return () => clearInterval(t);
}
