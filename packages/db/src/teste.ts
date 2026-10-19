import pg from 'pg';

/**
 * Cria (do zero) um banco só para a suíte de testes de um pacote, a partir de
 * TEST_DATABASE_URL. Cada pacote usa o seu, então as suítes rodam em paralelo
 * sem uma apagar os dados da outra.
 */
export async function bancoDeTeste(urlBase: string, sufixo: string): Promise<string> {
  const url = new URL(urlBase);
  const nome = `${url.pathname.replace(/^\//, '') || 'postgres'}_${sufixo}`
    .replace(/[^a-z0-9_]/gi, '_')
    .toLowerCase();
  // Conecta no banco de manutenção do servidor: o banco base pode nem existir.
  const urlAdmin = new URL(urlBase);
  urlAdmin.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: urlAdmin.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${nome}"`);
  } finally {
    await admin.end();
  }
  url.pathname = `/${nome}`;
  return url.toString();
}
