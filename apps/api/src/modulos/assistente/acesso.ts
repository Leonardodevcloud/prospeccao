import { createHash } from 'node:crypto';
import { criarPool, type Pool } from '@prospeccao/db';

/**
 * O acesso do Argos aos dados, em camadas (a IA escreve SQL sozinha, então a proteção fica no banco):
 *  1. papel `cerebro_leitura`: só leitura, só as views do schema `cerebro`, com limite de tempo;
 *  2. as views já tiram e-mails, telefones, senhas e tokens (migration 052);
 *  3. cada consulta leva o ESCOPO de quem pergunta, assinado aqui com a chave guardada no banco:
 *     sem assinatura válida, as views voltam vazias — nem um SQL "esperto" enxerga outra empresa;
 *  4. o SQL da IA passa pelo validador abaixo antes de chegar ao banco.
 */

export const PAPEL_LEITURA = 'cerebro_leitura';
export const SCHEMA_VITRINE = 'cerebro';

/** O que a pessoa pode ver: tudo (master da plataforma) ou só estas unidades. */
export interface Escopo {
  tudo: boolean;
  contas: number[];
  /** Recorte por pessoa: só as negociações em que ela é a responsável (migration 054). */
  dono?: number | null;
}

/** Senha do papel de leitura: derivada do segredo da api (nada novo para configurar). */
export function senhaLeitura(segredoApi: string): string {
  return createHash('sha256').update(`${segredoApi}|cerebro_leitura`).digest('base64url');
}

/**
 * Cria (ou atualiza) o papel só leitura e as permissões, com a conexão DONA do banco. Idempotente:
 * roda ao subir a api. As views em si vêm das migrations.
 */
export async function sincronizarAcesso(dono: Pool, senha: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{24,}$/.test(senha)) throw new Error('Senha do papel de leitura inválida.');
  const c = await dono.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('cerebro.sincronizar'))`);
    const { rowCount } = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [PAPEL_LEITURA]);
    // CREATE/ALTER ROLE não aceita parâmetro; a senha foi conferida acima (só [A-Za-z0-9_-]).
    if (rowCount) await c.query(`ALTER ROLE ${PAPEL_LEITURA} WITH LOGIN PASSWORD '${senha}'`);
    else
      await c.query(
        `CREATE ROLE ${PAPEL_LEITURA} WITH LOGIN PASSWORD '${senha}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
      );
    await c.query(`ALTER ROLE ${PAPEL_LEITURA} CONNECTION LIMIT 6`);
    await c.query(`ALTER ROLE ${PAPEL_LEITURA} SET default_transaction_read_only = on`);
    await c.query(`ALTER ROLE ${PAPEL_LEITURA} SET statement_timeout = '15s'`);
    await c.query(`ALTER ROLE ${PAPEL_LEITURA} SET idle_in_transaction_session_timeout = '30s'`);
    await c.query(`ALTER ROLE ${PAPEL_LEITURA} SET search_path = ${SCHEMA_VITRINE}`);
    // Nada fora da vitrine: nem as tabelas, nem os schemas do sistema.
    const { rows } = await c.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', $1, 'cerebro_priv') AND nspname NOT LIKE 'pg\\_%'`,
      [SCHEMA_VITRINE],
    );
    for (const { nspname } of rows) {
      const s = `"${nspname.replaceAll('"', '""')}"`;
      await c.query(`REVOKE ALL ON SCHEMA ${s} FROM ${PAPEL_LEITURA}`);
      await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${PAPEL_LEITURA}`);
    }
    await c.query(`GRANT USAGE ON SCHEMA ${SCHEMA_VITRINE}, cerebro_priv TO ${PAPEL_LEITURA}`);
    await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA_VITRINE} TO ${PAPEL_LEITURA}`);
    await c.query(`GRANT EXECUTE ON FUNCTION cerebro_priv.escopo(), cerebro_priv.dono() TO ${PAPEL_LEITURA}`);
    await c.query(`REVOKE ALL ON cerebro_priv.chave FROM ${PAPEL_LEITURA}`);
    await c.query('COMMIT');
  } catch (erro) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    c.release();
  }
}

/** Mesma URL do banco, trocando usuário e senha pelos do papel de leitura. */
export function criarPoolLeitura(urlBanco: string, senha: string): Pool {
  const url = new URL(urlBanco);
  url.username = PAPEL_LEITURA;
  url.password = senha;
  return criarPool({ url: url.toString(), aplicacao: 'argos', max: 4 });
}

/** A chave que assina o escopo (fica no banco, num schema que o papel de leitura não lê). */
export async function lerChave(dono: Pool): Promise<string> {
  const { rows } = await dono.query<{ segredo: string }>(
    'SELECT segredo FROM cerebro_priv.chave WHERE id = 1',
  );
  if (!rows[0]) throw new Error('Chave do escopo do Argos não encontrada (migration 052).');
  return rows[0].segredo;
}

/** Escopo assinado, válido por pouco tempo (só para a consulta em andamento). */
export function assinarEscopo(chave: string, e: Escopo, validadeSeg = 120, agora = Date.now()): string {
  const contas = [...new Set(e.contas.filter((c) => Number.isInteger(c) && c > 0))].join(',');
  const dono = !e.tudo && e.dono && Number.isInteger(e.dono) && e.dono > 0 ? e.dono : 0;
  const corpo = `v2;${e.tudo ? 1 : 0};${contas};${dono};${Math.floor(agora / 1000) + validadeSeg}`;
  const assinatura = createHash('sha256').update(`${chave}|${corpo}|${chave}`, 'utf8').digest('hex');
  return `${corpo};${assinatura}`;
}

export interface ResultadoConsulta {
  colunas: string[];
  linhas: Record<string, unknown>[];
  /** Havia mais linhas que o limite. */
  cortado: boolean;
  ms: number;
}

const PROIBIDAS =
  /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|cluster|reindex|lock|listen|notify|call|do|execute|prepare|deallocate|set|reset|discard|comment|security|refresh|import|load|checkpoint)\b/i;
const FUNCOES_PERIGOSAS =
  /\b(pg_sleep\w*|pg_read\w*|pg_ls_dir|pg_stat_file|lo_\w+|dblink\w*|pg_terminate_backend|pg_cancel_backend|set_config|current_setting|query_to_xml\w*|table_to_xml\w*|xpath|pg_advisory\w*|txid_\w+|pg_notify|nextval|setval)\s*\(/i;

/**
 * Confere o SQL escrito pela IA. É a segunda barreira: a primeira é o próprio banco
 * (papel só leitura, só com as views, com escopo assinado e limite de tempo).
 */
export function validarSql(sql: string): string {
  const limpo = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;\s*$/, '');
  if (!limpo) throw new Error('Consulta vazia.');
  if (limpo.includes(';')) throw new Error('Só uma consulta por vez.');
  if (!/^(select|with)\b/i.test(limpo)) throw new Error('Só consultas de leitura (SELECT).');
  // Tira os textos entre aspas antes de procurar comandos ("pedido cancelado" não é DELETE).
  // Nomes entre aspas duplas ("valor do mês") também saem: só importam as palavras do comando.
  const semTextos = limpo
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''")
    .replace(/"(?:[^"]|"")*"/g, 'x');
  if (/\$\w*\$/.test(semTextos)) throw new Error('Texto entre $$ não é permitido.');
  const proibida = semTextos.match(PROIBIDAS);
  if (proibida) throw new Error(`Comando não permitido na consulta: ${proibida[0]}.`);
  if (FUNCOES_PERIGOSAS.test(semTextos)) throw new Error('Função não permitida na consulta.');
  if (
    /\b(pg_\w+|information_schema|cerebro_priv|cadastro|comercial|descoberta|enriquecimento|base_cnpj|fila|public)\b/i.test(
      semTextos,
    )
  )
    throw new Error(`Use só as tabelas do catálogo (sem prefixo de schema).`);
  return limpo;
}

/** Executa uma consulta já validada: só leitura, no escopo assinado, com limite de linhas e de tempo. */
export async function consultar(
  pool: Pool,
  escopoAssinado: string,
  sql: string,
  params: unknown[] = [],
  { limite = 200, timeoutMs = 15_000 }: { limite?: number; timeoutMs?: number } = {},
): Promise<ResultadoConsulta> {
  const c = await pool.connect();
  const inicio = performance.now();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query(`SET LOCAL statement_timeout = ${Math.round(timeoutMs)}`);
    await c.query(`SET LOCAL search_path = ${SCHEMA_VITRINE}`);
    await c.query(`SELECT set_config('cerebro.escopo', $1, true)`, [escopoAssinado]);
    const r = await c.query({
      text: `SELECT * FROM (${sql}) AS consulta LIMIT ${Math.round(limite) + 1}`,
      values: params,
    });
    await c.query('COMMIT');
    const cortado = r.rows.length > limite;
    return {
      colunas: r.fields.map((f) => f.name),
      linhas: cortado ? r.rows.slice(0, limite) : r.rows,
      cortado,
      ms: Math.round(performance.now() - inicio),
    };
  } catch (erro) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    c.release();
  }
}
