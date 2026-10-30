import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
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

/**
 * Apaga tudo o que é da conta de demonstração: as linhas com conta_id dela, o que aponta para as
 * campanhas, os usuários e as empresas fictícias, e as empresas fictícias. Vai em várias passadas
 * (a ordem das chaves estrangeiras se resolve sozinha), cada comando num savepoint.
 */
async function apagar(tx: Executor, contaId: number): Promise<void> {
  const ids = async (sql: string) =>
    (await tx.query<{ id: number }>(sql, [contaId])).rows.map((r) => Number(r.id));
  const empresas = (
    await tx.query<{ id: number }>('SELECT id FROM descoberta.empresas WHERE demonstracao')
  ).rows.map((r) => Number(r.id));
  const campanhas = await ids('SELECT id FROM cadastro.campanhas WHERE conta_id = $1');
  const usuarios = await ids('SELECT id FROM cadastro.usuarios WHERE conta_id = $1');

  const { rows: comConta } = await tx.query<{ tabela: string }>(
    `SELECT format('%I.%I', c.table_schema, c.table_name) AS tabela
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.column_name = 'conta_id' AND t.table_type = 'BASE TABLE'
        AND c.table_schema IN ('cadastro', 'comercial', 'descoberta', 'enriquecimento')
        AND NOT (c.table_schema = 'cadastro' AND c.table_name IN ('contas', 'pedidos_site', 'pedidos_site_historico'))`,
  );
  const { rows: chaves } = await tx.query<{ tabela: string; coluna: string; alvo: string }>(
    `SELECT format('%I.%I', n.nspname, r.relname) AS tabela, a.attname AS coluna, k.confrelid::regclass::text AS alvo
       FROM pg_constraint k
       JOIN pg_class r ON r.oid = k.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1
        AND k.confrelid IN ('descoberta.empresas'::regclass, 'enriquecimento.leads'::regclass,
                            'cadastro.campanhas'::regclass, 'cadastro.usuarios'::regclass)`,
  );
  const lista = (alvo: string) =>
    alvo === 'cadastro.campanhas' ? campanhas : alvo === 'cadastro.usuarios' ? usuarios : empresas;
  const comandos: { sql: string; params: unknown[] }[] = [
    ...comConta.map((t) => ({ sql: `DELETE FROM ${t.tabela} WHERE conta_id = $1`, params: [contaId] })),
    ...chaves
      .filter((k) => lista(k.alvo).length)
      .map((k) => ({
        sql: `DELETE FROM ${k.tabela} WHERE "${k.coluna}" = ANY($1)`,
        params: [lista(k.alvo)],
      })),
    { sql: 'DELETE FROM descoberta.empresas WHERE demonstracao AND id = ANY($1)', params: [empresas] },
  ];
  let faltam = comandos;
  for (let passada = 0; passada < 15 && faltam.length; passada++) {
    const ainda: typeof comandos = [];
    let erro = '';
    for (const c of faltam) {
      await tx.query('SAVEPOINT apagar_demo');
      try {
        await tx.query(c.sql, c.params);
        await tx.query('RELEASE SAVEPOINT apagar_demo');
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT apagar_demo');
        erro = (e as Error).message;
        ainda.push(c);
      }
    }
    if (ainda.length === faltam.length)
      throw new AppError(500, 'demonstracao', `Não deu para limpar a demonstração: ${erro}`);
    faltam = ainda;
  }
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
