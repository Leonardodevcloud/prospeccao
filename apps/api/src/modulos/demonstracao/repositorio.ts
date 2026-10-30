import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import { apagarContas } from '../master/excluir.js';
import { gerarDados } from './dados.js';

/**
 * CRM de demonstração: uma organização separada (marcada), com dados fictícios, para apresentar o
 * sistema. "Recriar" apaga tudo o que é dela (e só as empresas fictícias) e gera de novo. Ela fica
 * fora do financeiro e da lista de clientes, e as campanhas dela nunca buscam empresas de verdade.
 */

export const NOME_ORGANIZACAO = 'CRM de demonstração';
/** A empresa que "vende" na demonstração (aparece nas mensagens e modelos). */
export const NOME_CONTA = 'Nexo Sistemas';

export interface Demonstracao {
  contaId: number;
  organizacaoId: number;
  geradaEm: string | null;
}

export async function obter(db: Executor): Promise<Demonstracao | null> {
  const { rows } = await db.query<Demonstracao>(
    `SELECT c.id AS "contaId", o.id AS "organizacaoId", o.demonstracao_gerada_em AS "geradaEm"
       FROM cadastro.organizacoes o JOIN cadastro.contas c ON c.organizacao_id = o.id
      WHERE o.demonstracao ORDER BY c.id LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** A conta de demonstração é esta? (para a faixa no CRM e para as travas). */
export async function ehDemonstracao(db: Executor, contaId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
      WHERE c.id = $1 AND o.demonstracao`,
    [contaId],
  );
  return rows.length > 0;
}

async function garantir(db: Executor): Promise<Demonstracao> {
  const atual = await obter(db);
  if (atual) return atual;
  const { rows: o } = await db.query<{ id: number }>(
    `INSERT INTO cadastro.organizacoes (nome, observacoes, demonstracao)
     VALUES ($1, 'Dados fictícios para apresentar o sistema. Não é cliente.', true) RETURNING id`,
    [NOME_ORGANIZACAO],
  );
  const { rows: c } = await db.query<{ id: number }>(
    `INSERT INTO cadastro.contas (nome, observacoes, organizacao_id) VALUES ($1, $2, $3) RETURNING id`,
    [NOME_CONTA, 'Conta do CRM de demonstração.', o[0]!.id],
  );
  return { contaId: c[0]!.id, organizacaoId: o[0]!.id, geradaEm: null };
}

/** Apaga tudo o que é da conta de demonstração, inclusive as empresas fictícias. */
async function apagar(tx: Executor, contaId: number): Promise<void> {
  const { rows } = await tx.query<{ id: number }>('SELECT id FROM descoberta.empresas WHERE demonstracao');
  await apagarContas(tx, [contaId], { empresas: rows.map((r) => Number(r.id)) });
}

/** Apaga e gera de novo os dados da demonstração. Devolve a conta. */
export async function recriar(pool: Pool): Promise<Demonstracao> {
  return comTransacao(pool, async (tx) => {
    const d = await garantir(tx);
    await apagar(tx, d.contaId);
    await tx.query('SELECT cadastro.preparar_conta($1)', [d.contaId]);
    await gerarDados(tx, d.contaId);
    // Sem o cartão de "Primeiros passos" no Meu dia: a demonstração já está toda montada.
    await tx.query('UPDATE cadastro.contas SET primeiros_passos_fechado_em = now() WHERE id = $1', [
      d.contaId,
    ]);
    const { rows } = await tx.query<{ em: string }>(
      'UPDATE cadastro.organizacoes SET demonstracao_gerada_em = now() WHERE id = $1 RETURNING demonstracao_gerada_em AS em',
      [d.organizacaoId],
    );
    return { ...d, geradaEm: rows[0]!.em };
  });
}
