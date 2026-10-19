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
    const f = await conectarFilas({
      url,
      aplicacao: 'teste',
      log,
      filas: ['cnpj.importar', 'enriquecimento.solicitar'],
    });
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
    // Job criado quando a política ainda tinha 2 tentativas.
    await db.query(`UPDATE fila.job SET retry_limit = 2 WHERE name = 'cnpj.importar'`);

    // Serviço novo sobe (deploy): o job preso volta para a fila em vez de esperar 8 h.
    const novo = await conectar();
    expect(await novo.liberarTravados('cnpj.importar')).toBe(1);
    const [job] = await jobsAbertos(db, 'cnpj.importar');
    expect(job).toMatchObject({ estado: 'nova_tentativa', falhas: 1, limiteTentativas: 6 });
    // A hora mostrada é a da próxima tentativa, não a do começo da que falhou.
    expect(new Date(job!.quando).getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('publica em massa, em lotes, sem duplicar o que já está na fila', async () => {
    const f = await conectarFilas({ url, aplicacao: 'teste', log, filas: ['enriquecimento.solicitar'] });
    abertas.push(f);
    const pedidos = Array.from({ length: 1200 }, (_, i) => ({
      empresaId: i + 1,
      campanhaId: 9,
      forcar: true,
    }));
    expect(await f.publicarVarios('enriquecimento.solicitar', pedidos)).toBe(1200);
    // Mesmo pedido de novo: os que já estão na fila não entram duas vezes.
    await f.publicarVarios('enriquecimento.solicitar', pedidos.slice(0, 10));
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM fila.job WHERE name = 'enriquecimento.solicitar' AND state = 'created'`,
    );
    expect(rows[0].n).toBe(1200);
  });
});
