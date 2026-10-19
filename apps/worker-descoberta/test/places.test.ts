import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { converterLugar, type PaginaPlaces, textoDaBusca } from '@prospeccao/integrations/places';
import type { NomeJob, PayloadJob } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as casos from '../src/casos.js';
import type { Deps } from '../src/dependencias.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const log = criarLogger('teste', 'silent');

/** Lugar no formato bruto do Places (New). */
function lugar(id: string, nome: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    displayName: { text: nome, languageCode: 'pt-BR' },
    formattedAddress: 'R. Exemplo, 10 - Pituba, Salvador - BA, 41810-000, Brasil',
    addressComponents: [
      { longText: 'Pituba', shortText: 'Pituba', types: ['sublocality_level_1', 'sublocality', 'political'] },
      { longText: 'Salvador', shortText: 'Salvador', types: ['administrative_area_level_2', 'political'] },
      { longText: 'Bahia', shortText: 'BA', types: ['administrative_area_level_1', 'political'] },
      { longText: '41810-000', shortText: '41810-000', types: ['postal_code'] },
    ],
    location: { latitude: -12.99, longitude: -38.45 },
    nationalPhoneNumber: '(71) 3240-0000',
    rating: 4.6,
    userRatingCount: 88,
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    businessStatus: 'OPERATIONAL',
    primaryTypeDisplayName: { text: 'Loja de autopeças' },
    ...extra,
  };
}

describe('conversão do Places', () => {
  it('lê telefone, CEP, cidade, UF e fechamento', () => {
    const i = converterLugar(lugar('x1', 'Peças Pituba', { businessStatus: 'CLOSED_PERMANENTLY' }))!;
    expect(i).toMatchObject({
      placeId: 'x1',
      nome: 'Peças Pituba',
      categoria: 'Loja de autopeças',
      telefone: '7132400000',
      cep: '41810000',
      cidade: 'Salvador',
      uf: 'BA',
      lat: -12.99,
      fechada: true,
      entrega: null,
    });
    expect(converterLugar({ placeId: 'apify' })).toBeNull();
  });

  it('monta o texto da busca com o bairro', () => {
    expect(textoDaBusca({ termo: 'autopeças', cidade: 'Salvador', uf: 'BA', bairro: 'PITUBA' })).toBe(
      'autopeças em PITUBA, Salvador - BA',
    );
    expect(textoDaBusca({ termo: 'autopeças', cidade: 'Salvador', uf: 'BA', bairro: null })).toBe(
      'autopeças em Salvador - BA',
    );
  });
});

describe.skipIf(!URL_TESTE)(
  'busca no Google Places com franquia e teto (Postgres real, Google simulado)',
  () => {
    let pool: Pool;
    const publicados: { nome: NomeJob; payload: object }[] = [];
    const chamadas: { texto: string; pagina: string | null }[] = [];

    /** Cidade inteira: 3 páginas cheias (encheu → divide por bairro). Bairro: uma página com 5. */
    async function buscar(b: { texto: string; pagina?: string | null }): Promise<PaginaPlaces> {
      chamadas.push({ texto: b.texto, pagina: b.pagina ?? null });
      const bairro = /em (PITUBA|BROTAS),/.exec(b.texto)?.[1];
      if (bairro) {
        const brutos = Array.from({ length: 5 }, (_, k) => lugar(`${bairro}-${k}`, `Peças ${bairro} ${k}`));
        return { itens: brutos.map((x) => converterLugar(x)!), ignorados: 0, proximaPagina: null };
      }
      const n = b.pagina ? Number(b.pagina) : 1;
      const brutos = Array.from({ length: 20 }, (_, k) => lugar(`cid-${n}-${k}`, `Autopeças ${n}-${k}`));
      return {
        itens: brutos.map((x) => converterLugar(x)!),
        ignorados: 0,
        proximaPagina: n < 3 ? String(n + 1) : null,
      };
    }

    const deps = (): Deps => ({
      pool,
      log,
      filas: {
        async publicar<N extends NomeJob>(nome: N, payload: PayloadJob<N>) {
          publicados.push({ nome, payload });
          return 'job';
        },
      },
      places: { buscar },
      maps: null,
      geo: null,
      ajustes: { rebuscaDias: 30, esperaColetaSegundos: 60, maxVerificacoes: 5, confiancaMinimaGeo: 0.6 },
    });

    async function drenar(d: Deps) {
      let guarda = 0;
      while (publicados.length && guarda++ < 500) {
        const job = publicados.shift()!;
        const p = job.payload as Record<string, number>;
        if (job.nome === 'campanha.buscar_cnpj') await casos.buscarNaBaseCnpj(d, p.campanhaId!);
        else if (job.nome === 'maps.buscar') await casos.dispararBuscaMaps(d, p.buscaId!);
      }
    }

    const uso = async () =>
      (
        await pool.query<{ pedidos: number; pagos: number; gasto: number }>(
          `SELECT count(*)::int AS pedidos, count(*) FILTER (WHERE paga)::int AS pagos,
                coalesce(sum(custo_usd), 0)::float8 AS gasto FROM descoberta.uso_places`,
        )
      ).rows[0]!;

    beforeAll(async () => {
      pool = criarPool({
        url: await bancoDeTeste(URL_TESTE!, 'descoberta_places'),
        aplicacao: 'teste-places',
        max: 4,
      });
      await migrar(pool, log);
      await pool.query(`INSERT INTO base_cnpj.municipios VALUES ('3849', 'SALVADOR')`);
      await pool.query(
        `INSERT INTO base_cnpj.estabelecimentos
         (cnpj, cnpj_basico, matriz, nome_fantasia, situacao, data_inicio, cnae_principal, bairro, cep, uf, municipio_codigo)
       VALUES ('11000000000100', '11000000', true, 'A', '02', '2010-01-01', '4530703', 'Pituba', '41810000', 'BA', '3849'),
              ('12000000000100', '12000000', true, 'B', '02', '2010-01-01', '4530703', 'PITUBA ', '41810000', 'BA', '3849'),
              ('13000000000100', '13000000', true, 'C', '02', '2010-01-01', '4530703', 'Brotas', '40285000', 'BA', '3849'),
              ('14000000000100', '14000000', true, 'D', '02', '2010-01-01', '5611201', 'Barra', '40140000', 'BA', '3849')`,
      );
      await pool.query(
        `INSERT INTO cadastro.nichos (nome, cnaes, termos_maps) VALUES ('Autopeças', '{4530703}', '{autopeças}')`,
      );
      await pool.query(`UPDATE cadastro.config_places SET franquia_mensal = 70`);
      await pool.query(
        `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, status)
       VALUES ('Places Salvador', 1, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa')`,
      );
    });

    afterAll(async () => {
      await pool?.end();
    });

    it('busca a cidade, divide por bairro quando enche e conta cada página', async () => {
      const d = deps();
      await casos.iniciarCampanha(d, 1);
      await drenar(d);

      // 3 páginas da cidade + 1 por bairro (Pituba e Brotas; Barra não tem o nicho)
      expect(chamadas.map((c) => c.texto)).toEqual([
        'autopeças em Salvador - BA',
        'autopeças em Salvador - BA',
        'autopeças em Salvador - BA',
        'autopeças em PITUBA, Salvador - BA',
        'autopeças em BROTAS, Salvador - BA',
      ]);
      expect(chamadas.map((c) => c.pagina)).toEqual([null, '2', '3', null, null]);
      expect(await uso()).toEqual({ pedidos: 5, pagos: 0, gasto: 0 });

      const { rows: buscas } = await pool.query(
        `SELECT bairro, status, itens, paginas, fonte FROM descoberta.buscas_maps ORDER BY id`,
      );
      expect(buscas).toEqual([
        { bairro: null, status: 'concluida', itens: 60, paginas: 3, fonte: 'places' },
        { bairro: 'PITUBA', status: 'concluida', itens: 5, paginas: 1, fonte: 'places' },
        { bairro: 'BROTAS', status: 'concluida', itens: 5, paginas: 1, fonte: 'places' },
      ]);
      const { rows: emp } = await pool.query(
        `SELECT count(*)::int AS n FROM descoberta.v_empresas_campanha WHERE campanha_id = 1 AND place_id IS NOT NULL`,
      );
      expect(emp[0].n).toBe(70);
    });

    it('"só o grátis" para a busca quando a franquia acaba; liberar o teto retoma de onde parou', async () => {
      // Sobra 1 pedido grátis (franquia 6, já usados 5).
      await pool.query(`UPDATE cadastro.config_places SET franquia_mensal = 6`);
      await pool.query(
        `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, status, teto_places_usd)
       VALUES ('Só grátis', 1, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa', 0)`,
      );
      const d = deps();
      chamadas.length = 0;
      await casos.iniciarCampanha(d, 2);
      await drenar(d);

      expect(chamadas).toHaveLength(1);
      const { rows: b1 } = await pool.query(
        `SELECT status, paginas, erro FROM descoberta.buscas_maps WHERE campanha_id = 2`,
      );
      expect(b1[0]).toMatchObject({ status: 'bloqueada', paginas: 1 });
      expect(b1[0].erro).toMatch(/só o grátis/);
      expect(await uso()).toEqual({ pedidos: 6, pagos: 0, gasto: 0 });

      // Libera até US$ 1: retoma da página 2 e as pagas custam US$ 0,035 cada.
      await pool.query(`UPDATE cadastro.campanhas SET teto_places_usd = 1 WHERE id = 2`);
      chamadas.length = 0;
      await casos.iniciarCampanha(d, 2);
      await drenar(d);
      expect(chamadas.map((c) => c.pagina)).toEqual(['2', '3', null, null]);
      const u = await uso();
      expect(u.pedidos).toBe(10);
      expect(u.pagos).toBe(4);
      expect(u.gasto).toBeCloseTo(0.14, 6);
    });

    it('teto da campanha em dinheiro bloqueia no pedido que passaria do valor', async () => {
      await pool.query(
        `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, status, teto_places_usd)
       VALUES ('Teto curto', 1, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa', 0.07)`,
      );
      const d = deps();
      chamadas.length = 0;
      await casos.iniciarCampanha(d, 3);
      await drenar(d);
      // 2 pagas (US$ 0,07) e a terceira passaria do teto.
      expect(chamadas).toHaveLength(2);
      const { rows } = await pool.query(
        `SELECT status, erro FROM descoberta.buscas_maps WHERE campanha_id = 3`,
      );
      expect(rows[0].status).toBe('bloqueada');
      expect(rows[0].erro).toMatch(/Teto da campanha atingido: US\$ 0,07/);
    });

    it('pedido que falha no Google não conta no uso e a busca volta para pendente', async () => {
      await pool.query(`UPDATE cadastro.config_places SET franquia_mensal = 1000`);
      await pool.query(
        `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, status)
       VALUES ('Falha', 1, '[{"cidade":"Lauro de Freitas","uf":"BA"}]', NULL, 'ativa')`,
      );
      const antes = (await uso()).pedidos;
      const d = deps();
      d.places = {
        async buscar() {
          throw new Error(
            'Google Places: HTTP 403 {"error":{"status":"PERMISSION_DENIED","message":"SERVICE_DISABLED"}}',
          );
        },
      };
      await casos.iniciarCampanha(d, 4);
      const job = publicados.find((p) => p.nome === 'maps.buscar')!;
      const buscaId = (job.payload as { buscaId: number }).buscaId;
      await expect(casos.dispararBuscaMaps(d, buscaId)).rejects.toThrow();
      await casos.registrarFalhaBusca(
        d,
        buscaId,
        new Error('Google Places: HTTP 403 SERVICE_DISABLED'),
        false,
      );
      publicados.length = 0;
      expect((await uso()).pedidos).toBe(antes);
      const { rows } = await pool.query(`SELECT status, erro FROM descoberta.buscas_maps WHERE id = $1`, [
        buscaId,
      ]);
      expect(rows[0].status).toBe('pendente');
      expect(rows[0].erro).toMatch(/Places API \(New\)/);
    });
  },
);
