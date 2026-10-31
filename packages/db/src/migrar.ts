import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@prospeccao/shared';
import type { Pool } from './pool.js';

/** Em produção (código empacotado) a pasta vem de MIGRATIONS_DIR; no repo, ao lado do src. */
export const PASTA_MIGRATIONS =
  process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Chave fixa do advisory lock: duas instâncias subindo juntas não migram em paralelo.
const CHAVE_LOCK = 7_301_442_019;

/**
 * Versões anteriores de uma migration que já podem estar aplicadas em algum banco e que uma
 * migration seguinte completa (não é para editar migration aplicada; aqui foi um engano da v97,
 * corrigido pela 078). Com uma delas registrada, a conferência passa e a 078 faz o resto.
 */
const VERSOES_ANTERIORES: Record<string, string[]> = {
  '076_teste_e_assinatura.sql': [
    'a0adb03f1457f1615ede079272000484fc2c7437cf898fd9f806904573c100f7',
    'd43d8b7770a6e1734bae3a285b6eaa13d1b2ea6b011fa01923e135e6471f6e97',
  ],
};
const confere = (nome: string, aplicada: string, atual: string) =>
  aplicada === atual || (VERSOES_ANTERIORES[nome]?.includes(aplicada) ?? false);

interface Migration {
  nome: string;
  sql: string;
  checksum: string;
}

async function lerMigrations(pasta: string): Promise<Migration[]> {
  const arquivos = (await readdir(pasta)).filter((a) => /^\d{3}_.+\.sql$/.test(a)).sort();
  return Promise.all(
    arquivos.map(async (nome) => {
      const sql = await readFile(join(pasta, nome), 'utf8');
      return { nome, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

async function garantirTabela(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      nome        text PRIMARY KEY,
      checksum    text NOT NULL,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )`);
}

export interface StatusMigration {
  nome: string;
  aplicada: boolean;
  alterada: boolean;
}

export async function statusMigrations(pool: Pool, pasta = PASTA_MIGRATIONS): Promise<StatusMigration[]> {
  await garantirTabela(pool);
  const todas = await lerMigrations(pasta);
  const { rows } = await pool.query<{ nome: string; checksum: string }>(
    'SELECT nome, checksum FROM public.schema_migrations',
  );
  const aplicadas = new Map(rows.map((r) => [r.nome, r.checksum]));
  return todas.map((m) => ({
    nome: m.nome,
    aplicada: aplicadas.has(m.nome),
    alterada: aplicadas.has(m.nome) && !confere(m.nome, aplicadas.get(m.nome)!, m.checksum),
  }));
}

/**
 * Aplica as migrations pendentes, cada uma na sua transação. Recusa seguir se
 * uma migration já aplicada foi editada: migrations são imutáveis, crie outra.
 */
export async function migrar(pool: Pool, log: Logger, pasta = PASTA_MIGRATIONS): Promise<string[]> {
  const cliente = await pool.connect();
  const aplicadasAgora: string[] = [];
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [CHAVE_LOCK]);
    await garantirTabela(pool);
    const todas = await lerMigrations(pasta);
    const { rows } = await cliente.query<{ nome: string; checksum: string }>(
      'SELECT nome, checksum FROM public.schema_migrations',
    );
    const aplicadas = new Map(rows.map((r) => [r.nome, r.checksum]));

    for (const m of todas) {
      const anterior = aplicadas.get(m.nome);
      if (anterior) {
        if (!confere(m.nome, anterior, m.checksum)) {
          throw new Error(`A migration ${m.nome} foi alterada depois de aplicada. Crie uma nova migration.`);
        }
        continue;
      }
      log.info({ migration: m.nome }, 'aplicando migration');
      await cliente.query('BEGIN');
      try {
        await cliente.query(m.sql);
        await cliente.query('INSERT INTO public.schema_migrations (nome, checksum) VALUES ($1, $2)', [
          m.nome,
          m.checksum,
        ]);
        await cliente.query('COMMIT');
        aplicadasAgora.push(m.nome);
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw new Error(`Falha na migration ${m.nome}: ${(erro as Error).message}`, { cause: erro });
      }
    }
    return aplicadasAgora;
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [CHAVE_LOCK]).catch(() => {});
    cliente.release();
  }
}
