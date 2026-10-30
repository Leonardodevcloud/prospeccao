import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';

/**
 * Apaga tudo o que é de uma ou mais contas, sem precisar listar tabela por tabela: lê do banco as
 * tabelas com conta_id e as chaves estrangeiras que apontam para as campanhas e os usuários delas.
 * Vai em várias passadas (a ordem das chaves estrangeiras se resolve sozinha), cada comando num
 * savepoint. Tudo dentro da transação de quem chama: dá erro, nada é apagado.
 *
 * Dados globais (empresas, enriquecimento dos leads) não são apagados: valem para todos os clientes.
 * Tabela global que só aponta para um usuário ou campanha da conta (quem atualizou a tabela de preços,
 * importação de leads…) fica com o campo vazio, sem perder a linha.
 */

/** Tabelas com conta_id que guardam o histórico da plataforma (o pedido do site que virou cliente). */
const PRESERVAR = ['cadastro.pedidos_site', 'cadastro.pedidos_site_historico'];

export interface OpcoesApagar {
  /** Empresas fictícias (CRM de demonstração) que também saem. */
  empresas?: number[];
  /** Apaga também as contas e a organização (excluir o cliente). */
  organizacaoId?: number;
  /**
   * Zerar sem excluir: as contas e os usuários ficam, e estas tabelas (configuração, chaves, histórico
   * de custo) também. Quem nelas aponta para uma campanha apagada fica com o campo vazio.
   */
  manter?: string[];
}

interface Comando {
  sql: string;
  params: unknown[];
}

export async function apagarContas(tx: Executor, contaIds: number[], op: OpcoesApagar = {}): Promise<void> {
  if (!contaIds.length) return;
  const ids = async (sql: string) =>
    (await tx.query<{ id: number }>(sql, [contaIds])).rows.map((r) => Number(r.id));
  const campanhas = await ids('SELECT id FROM cadastro.campanhas WHERE conta_id = ANY($1)');
  const manter = new Set(op.manter ?? []);
  const zerar = manter.size > 0;
  if (zerar) manter.add('cadastro.usuarios');
  const usuarios = zerar ? [] : await ids('SELECT id FROM cadastro.usuarios WHERE conta_id = ANY($1)');
  const empresas = op.empresas ?? [];

  const { rows: comConta } = await tx.query<{ tabela: string; nulo: boolean }>(
    `SELECT format('%I.%I', c.table_schema, c.table_name) AS tabela, c.is_nullable = 'YES' AS nulo
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.column_name = 'conta_id' AND t.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND NOT (c.table_schema = 'cadastro' AND c.table_name = 'contas')`,
  );
  const temConta = new Set(comConta.map((t) => t.tabela));
  const alvos = [
    "'cadastro.campanhas'::regclass",
    "'cadastro.usuarios'::regclass",
    ...(empresas.length ? ["'descoberta.empresas'::regclass", "'enriquecimento.leads'::regclass"] : []),
    ...(op.organizacaoId ? ["'cadastro.contas'::regclass", "'cadastro.organizacoes'::regclass"] : []),
  ];
  const { rows: chaves } = await tx.query<{ tabela: string; coluna: string; alvo: string; nulo: boolean }>(
    `SELECT format('%I.%I', n.nspname, r.relname) AS tabela, a.attname AS coluna,
            k.confrelid::regclass::text AS alvo, NOT a.attnotnull AS nulo
       FROM pg_constraint k
       JOIN pg_class r ON r.oid = k.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND k.confrelid IN (${alvos.join(', ')})`,
  );
  const valores = (alvo: string): unknown[] =>
    alvo === 'cadastro.campanhas'
      ? campanhas
      : alvo === 'cadastro.usuarios'
        ? usuarios
        : alvo === 'cadastro.contas'
          ? contaIds
          : alvo === 'cadastro.organizacoes'
            ? [op.organizacaoId]
            : empresas;

  const comandos: Comando[] = [];
  for (const t of comConta) {
    // Histórico da plataforma: a linha fica, só perde a conta (se a coluna aceita vazio).
    if (manter.has(t.tabela)) continue;
    if (PRESERVAR.includes(t.tabela)) {
      if (op.organizacaoId && t.nulo)
        comandos.push({
          sql: `UPDATE ${t.tabela} SET conta_id = NULL WHERE conta_id = ANY($1)`,
          params: [contaIds],
        });
      continue;
    }
    comandos.push({ sql: `DELETE FROM ${t.tabela} WHERE conta_id = ANY($1)`, params: [contaIds] });
  }
  for (const k of chaves) {
    const v = valores(k.alvo);
    if (!v.length) continue;
    if (k.tabela === 'cadastro.contas' && k.coluna === 'organizacao_id') continue; // as contas saem no fim
    // Tabela global (sem conta_id) que aceita vazio: só desliga o vínculo.
    const soDesliga =
      (!temConta.has(k.tabela) || PRESERVAR.includes(k.tabela) || manter.has(k.tabela)) && k.nulo;
    comandos.push({
      sql: soDesliga
        ? `UPDATE ${k.tabela} SET "${k.coluna}" = NULL WHERE "${k.coluna}" = ANY($1)`
        : `DELETE FROM ${k.tabela} WHERE "${k.coluna}" = ANY($1)`,
      params: [v],
    });
  }
  if (empresas.length)
    comandos.push({
      sql: 'DELETE FROM descoberta.empresas WHERE demonstracao AND id = ANY($1)',
      params: [empresas],
    });
  if (op.organizacaoId) {
    comandos.push({ sql: 'DELETE FROM cadastro.contas WHERE id = ANY($1)', params: [contaIds] });
    comandos.push({ sql: 'DELETE FROM cadastro.organizacoes WHERE id = $1', params: [op.organizacaoId] });
  }

  let faltam = comandos;
  for (let passada = 0; passada < 20 && faltam.length; passada++) {
    const ainda: Comando[] = [];
    let erro = '';
    for (const c of faltam) {
      await tx.query('SAVEPOINT apagar_contas');
      try {
        await tx.query(c.sql, c.params);
        await tx.query('RELEASE SAVEPOINT apagar_contas');
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT apagar_contas');
        erro = (e as Error).message;
        ainda.push(c);
      }
    }
    if (ainda.length === faltam.length)
      throw new AppError(500, 'apagar_contas', `Não deu para apagar tudo: ${erro}`);
    faltam = ainda;
  }
}
