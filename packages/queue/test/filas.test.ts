import { criarPool, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectarFilas, type Filas, jobsAbertos } from '../src/index.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const log = criarLogger('teste', 'silent');
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

describe.skipIf(!URL_TESTE)('filas (pg-boss de verdade)', () => {
  let url: string;
  let db: Pool;
  const abertas: Filas[] = [];
  const conectar = async () => {
    const f = await conectarFilas({ url, aplicacao: 'teste', log, filas: ['cnpj.importar'] });
    abertas.push(f);
    return f;
  };

  beforeAll(async () => {
    url = await bancoDeTeste(URL_TESTE!, 'filas');
    db = criarPool({ url, aplicacao: 'teste-filas', max: 2 });
  });

  afterAll(async () => {
    // O worker "morto" segura o job até o timeout do desligamento gracioso (20 s).
    await Promise.all(abertas.map((f) => f.parar().catch(() => {})));
    await db?.end();
  }, 40_000);

  it('aplica o heartbeat também em fila que já existia', async () => {
    await conectar();
    await db.query(`UPDATE fila.queue SET heartbeat_seconds = NULL WHERE name = 'cnpj.importar'`);
    await conectar(); // segundo serviço subindo: atualiza a fila existente
    const { rows } = await db.query(
      `SELECT heartbeat_seconds, retry_limit FROM fila.queue WHERE name = 'cnpj.importar'`,
    );
    expect(rows[0]).toEqual({ heartbeat_seconds: 60, retry_limit: 6 });
  });

  it('libera para nova tentativa o job que ficou ativo quando o processo morreu', async () => {
    const antigo = await conectar();
    let comecou = false;
    await antigo.consumir(
      'cnpj.importar',
      async () => {
        comecou = true;
        await new Promise(() => {}); // "morre" no meio: nunca termina
      },
      { intervaloSegundos: 0.5 },
    );
    await antigo.publicar('cnpj.importar', { motivo: 'manual' });
    for (let i = 0; i < 40 && !comecou; i++) await espera(250);
    expect(comecou).toBe(true);
    expect((await jobsAbertos(db, 'cnpj.importar'))[0]?.estado).toBe('rodando');

    // Serviço novo sobe (deploy): o job preso volta para a fila em vez de esperar 8 h.
    const novo = await conectar();
    expect(await novo.liberarTravados('cnpj.importar')).toBe(1);
    const [job] = await jobsAbertos(db, 'cnpj.importar');
    expect(job).toMatchObject({ estado: 'nova_tentativa', falhas: 1, limiteTentativas: 6 });
  });
});
