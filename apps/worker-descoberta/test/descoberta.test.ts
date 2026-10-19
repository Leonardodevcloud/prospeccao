import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { ItemMaps, Run } from '@prospeccao/integrations/apify';
import type { NomeJob, PayloadJob } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as casos from '../src/casos.js';
import { temPalavraNegativa } from '../src/cruzamento.js';
import type { Deps } from '../src/dependencias.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const log = criarLogger('teste', 'silent');

describe('palavras negativas', () => {
  it('casa palavra inteira no nome ou na categoria', () => {
    expect(temPalavraNegativa({ nome: 'Oficina do Zé', categoria: null }, ['oficina'])).toBe(true);
    expect(temPalavraNegativa({ nome: 'Zé Peças', categoria: 'Oficina mecânica' }, ['oficina'])).toBe(true);
    expect(temPalavraNegativa({ nome: 'Oficinal Peças', categoria: null }, ['oficina'])).toBe(false);
    expect(temPalavraNegativa({ nome: 'Qualquer', categoria: null }, [])).toBe(false);
  });
});

function item(p: Partial<ItemMaps> & Pick<ItemMaps, 'placeId' | 'nome'>): ItemMaps {
  return {
    categoria: 'Loja de autopeças',
    telefone: null,
    endereco: null,
    cep: null,
    cidade: 'Salvador',
    uf: 'BA',
    lat: -12.95,
    lng: -38.5,
    nota: 4.5,
    avaliacoes: 100,
    site: null,
    url: null,
    fechada: false,
    entrega: null,
    dados: {},
    ...p,
  };
}

describe.skipIf(!URL_TESTE)('descoberta ponta a ponta (com Postgres, Apify e ORS simulados)', () => {
  let pool: Pool;
  const publicados: { nome: NomeJob; payload: object }[] = [];

  const itensMaps: ItemMaps[] = [
    item({ placeId: 'p1', nome: 'Autopeças Ladeira Nova', telefone: '7132410098', entrega: true }),
    item({ placeId: 'p2', nome: 'Auto Center Brotas Peças', cep: '40285000' }),
    item({ placeId: 'p3', nome: 'Moto Peças Nova Era', telefone: '71999990000' }),
    item({ placeId: 'p4', nome: 'Mecânica do Zé', categoria: 'Oficina mecânica' }),
  ];
  // dados brutos = o próprio item no formato do Apify, para a reidratação
  for (const i of itensMaps) {
    i.dados = {
      placeId: i.placeId,
      title: i.nome,
      categoryName: i.categoria,
      phoneUnformatted: i.telefone,
      postalCode: i.cep,
      city: i.cidade,
      state: 'Bahia',
      location: { lat: i.lat, lng: i.lng },
      totalScore: i.nota,
      reviewsCount: i.avaliacoes,
      ...(i.entrega ? { additionalInfo: { Serviços: [{ Entrega: true }] } } : {}),
    };
  }

  let chamadasObter = 0;
  const deps = (): Deps => ({
    pool,
    log,
    filas: {
      async publicar<N extends NomeJob>(nome: N, payload: PayloadJob<N>) {
        publicados.push({ nome, payload });
        return 'job';
      },
    },
    places: null, // este teste cobre o caminho do Apify (legado); o Places está em places.test.ts
    maps: {
      async iniciar(): Promise<Run> {
        return { id: 'run1', status: 'RUNNING', datasetId: 'ds1' };
      },
      async obter(): Promise<Run> {
        chamadasObter++;
        return { id: 'run1', status: chamadasObter > 1 ? 'SUCCEEDED' : 'RUNNING', datasetId: 'ds1' };
      },
      async itens() {
        return { itens: itensMaps, ignorados: 0 };
      },
    },
    geo: {
      // Só a empresa C (sem Maps) chega aqui: fica a ~80 km da base.
      async geocodificar() {
        return { lat: -12.4, lng: -38.0, confianca: 0.9, rotulo: 'longe' };
      },
    },
    ajustes: { rebuscaDias: 30, esperaColetaSegundos: 60, maxVerificacoes: 5, confiancaMinimaGeo: 0.6 },
  });

  /** Executa os jobs publicados, como os workers fariam, até a fila esvaziar. */
  async function drenar(d: Deps) {
    let guarda = 0;
    while (publicados.length && guarda++ < 200) {
      const job = publicados.shift()!;
      const p = job.payload as Record<string, number>;
      if (job.nome === 'campanha.buscar_cnpj') await casos.buscarNaBaseCnpj(d, p.campanhaId!);
      else if (job.nome === 'maps.buscar') await casos.dispararBuscaMaps(d, p.buscaId!);
      else if (job.nome === 'maps.coletar') await casos.coletarBuscaMaps(d, p.buscaId!);
      else if (job.nome === 'empresa.localizar') await casos.localizarEmpresa(d, p.empresaId!);
      else if (job.nome === 'enriquecimento.solicitar')
        enriquecer.push(p as { empresaId: number; campanhaId: number });
    }
  }
  const enriquecer: { empresaId: number; campanhaId: number }[] = [];

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'descoberta'),
      aplicacao: 'teste-descoberta',
      max: 4,
    });
    await migrar(pool, log);
    await pool.query(`TRUNCATE descoberta.empresas, descoberta.buscas_maps RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE base_cnpj.estabelecimentos, base_cnpj.empresas, base_cnpj.municipios`);
    await pool.query(`TRUNCATE cadastro.campanhas, cadastro.nichos, cadastro.bases RESTART IDENTITY CASCADE`);

    await pool.query(`INSERT INTO base_cnpj.municipios VALUES ('3849', 'SALVADOR')`);
    await pool.query(
      `INSERT INTO base_cnpj.estabelecimentos
         (cnpj, cnpj_basico, matriz, nome_fantasia, situacao, data_inicio, cnae_principal, cep, uf, municipio_codigo, telefones)
       VALUES ('11222333000181', '11222333', true, 'LADEIRA NOVA PECAS', '02', '2014-03-01', '4530703', '40415000', 'BA', '3849', '{7132410098}'),
              ('22333444000100', '22333444', true, 'AUTO CENTER BROTAS', '02', '2010-01-01', '4530703', '40285000', 'BA', '3849', '{}'),
              ('33444555000100', '33444555', true, 'PECAS LONGE', '02', '2012-01-01', '4530703', '48000000', 'BA', '3849', '{}'),
              ('44555666000100', '44555666', true, 'FECHADA PECAS', '08', '2012-01-01', '4530703', '40000000', 'BA', '3849', '{}'),
              ('55666777000100', '55666777', true, NULL, '02', '2015-01-01', '4530703', '40000000', 'BA', '3849', '{}')`,
    );
    await pool.query(
      `INSERT INTO base_cnpj.empresas (cnpj_basico, razao_social, porte)
       VALUES ('11222333', 'LADEIRA NOVA COMERCIO DE PECAS LTDA', 'epp'), ('22333444', 'BROTAS AUTO LTDA', 'me'),
              ('33444555', 'LONGE LTDA', 'me'), ('44555666', 'FECHADA LTDA', 'me')`,
    );
    // MEI (marcado pela Receita): nem entra na campanha.
    await pool.query(
      `INSERT INTO base_cnpj.empresas (cnpj_basico, razao_social, natureza_juridica, porte, mei, mei_fonte)
       VALUES ('55666777', '55.666.777 JOSE DA SILVA', '2135', 'me', true, 'nome')`,
    );
    await pool.query(`INSERT INTO cadastro.bases (nome, lat, lng) VALUES ('Base Centro', -12.97, -38.51)`);
    await pool.query(
      `INSERT INTO cadastro.nichos (nome, cnaes, termos_maps, palavras_negativas)
       VALUES ('Autopeças', '{4530703}', '{autopeças}', '{oficina}')`,
    );
    await pool.query(
      `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, status)
       VALUES ('Autopeças Salvador', 1, '[{"cidade":"Salvador","uf":"BA"}]', 12, 'ativa')`,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('encontra, cruza, localiza e libera para enriquecimento', async () => {
    const d = deps();
    await casos.iniciarCampanha(d, 1);
    await drenar(d);

    const { rows } = await pool.query(
      `SELECT nome, cnpj, place_id, origem, dentro_do_raio, sinal_entrega, round(distancia_base_km) AS km
         FROM descoberta.v_empresas_campanha WHERE campanha_id = 1 ORDER BY nome`,
    );
    const porNome = Object.fromEntries(rows.map((r) => [r.nome, r]));

    // A: casou pelo telefone; nome do Maps prevalece; entrega detectada
    expect(porNome['Autopeças Ladeira Nova']).toMatchObject({
      cnpj: '11222333000181',
      place_id: 'p1',
      origem: 'ambos',
      dentro_do_raio: true,
      sinal_entrega: true,
    });
    // B: casou por nome no mesmo CEP
    expect(porNome['Auto Center Brotas Peças']).toMatchObject({
      cnpj: '22333444000100',
      place_id: 'p2',
      origem: 'ambos',
    });
    // C: só na base, localizada pelo ORS longe da base → fora do raio
    expect(porNome['PECAS LONGE']).toMatchObject({ place_id: null, origem: 'cnpj', dentro_do_raio: false });
    // Nova no Maps, sem CNPJ
    expect(porNome['Moto Peças Nova Era']).toMatchObject({
      cnpj: null,
      origem: 'maps',
      dentro_do_raio: true,
    });
    // Fechada na Receita e oficina (palavra negativa) não entram
    expect(rows.map((r) => r.nome)).not.toContain('FECHADA PECAS');
    expect(rows.map((r) => r.nome)).not.toContain('Mecânica do Zé');
    // MEI não entra
    expect(rows.some((r) => r.cnpj === '55666777000100')).toBe(false);

    const { rows: cruz } = await pool.query(
      'SELECT place_id, cruzamento FROM descoberta.maps_resultados ORDER BY place_id',
    );
    expect(cruz).toEqual([
      { place_id: 'p1', cruzamento: 'telefone' },
      { place_id: 'p2', cruzamento: 'nome_cep' },
      { place_id: 'p3', cruzamento: 'novo' },
      { place_id: 'p4', cruzamento: 'descartado' },
    ]);

    // Só as 3 dentro do raio vão para o enriquecimento, uma vez cada
    expect(enriquecer).toHaveLength(3);
    expect(new Set(enriquecer.map((e) => e.empresaId)).size).toBe(3);

    const { rows: busca } = await pool.query('SELECT status, itens FROM descoberta.buscas_maps');
    expect(busca).toEqual([{ status: 'concluida', itens: 4 }]);
  });

  it('reiniciar a campanha não repete a busca nem o enriquecimento', async () => {
    const d = deps();
    const antes = enriquecer.length;
    await casos.iniciarCampanha(d, 1);
    expect(publicados.filter((p) => p.nome === 'maps.buscar')).toHaveLength(0);
    await drenar(d);
    expect(enriquecer.length).toBe(antes);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM descoberta.buscas_maps');
    expect(rows[0].n).toBe(1);
  });

  it('campanha nacional (sem raio) libera tudo e não geocodifica', async () => {
    await pool.query(
      `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, status)
       VALUES ('Autopeças nacional', 1, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa')`,
    );
    const d = { ...deps(), geo: null };
    const localizar = () => publicados.filter((p) => p.nome === 'empresa.localizar').length;
    const antesLocalizar = localizar();

    await casos.iniciarCampanha(d, 2);
    await drenar(d);

    const { rows } = await pool.query(
      `SELECT nome, dentro_do_raio FROM descoberta.v_empresas_campanha WHERE campanha_id = 2 ORDER BY nome`,
    );
    // Inclusive a que fica a ~80 km da base: no nacional, distância não exclui ninguém.
    expect(rows.map((r) => r.nome)).toContain('PECAS LONGE');
    expect(rows.every((r) => r.dentro_do_raio === true)).toBe(true);
    expect(enriquecer.filter((e) => e.campanhaId === 2)).toHaveLength(rows.length);
    expect(localizar()).toBe(antesLocalizar);
  });

  it('planilha do Maps: cruza com a base pelo nome e CEP, cria os novos e manda enriquecer', async () => {
    const d = { ...deps(), geo: null };
    const antes = enriquecer.length;
    await casos.importarPlanilha(d, {
      campanhaId: 2,
      cidade: 'Salvador',
      uf: 'BA',
      itens: [
        {
          nome: 'Peças Longe',
          telefone: '(71) 3555-1234',
          endereco: 'Rua das Flores, 10 - Centro, Salvador - BA, 48000-000',
          nota: 4.5,
          avaliacoes: 87,
        },
        { nome: 'Loja Nova da Planilha', telefone: '71 98888-7777', categoria: 'Loja de autopeças' },
        { nome: 'Oficina do Beto', categoria: 'Oficina mecânica' },
      ],
    });
    await drenar(d);
    const { rows } = await pool.query(
      `SELECT nome, cruzamento, telefone FROM descoberta.maps_resultados r
         JOIN descoberta.buscas_maps b ON b.id = r.busca_id WHERE b.fonte = 'planilha' ORDER BY nome`,
    );
    expect(rows).toEqual([
      { nome: 'Loja Nova da Planilha', cruzamento: 'novo', telefone: '71988887777' },
      { nome: 'Oficina do Beto', cruzamento: 'descartado', telefone: null },
      { nome: 'Peças Longe', cruzamento: 'nome_cep', telefone: '7135551234' },
    ]);
    const { rows: longe } = await pool.query(
      `SELECT maps_telefone, maps_avaliacoes FROM descoberta.empresas WHERE cnpj = '33444555000100'`,
    );
    expect(longe[0]).toMatchObject({ maps_telefone: '7135551234', maps_avaliacoes: 87 });
    const { rows: busca } = await pool.query(
      `SELECT status, itens FROM descoberta.buscas_maps WHERE fonte = 'planilha'`,
    );
    expect(busca).toEqual([{ status: 'concluida', itens: 3 }]);
    expect(enriquecer.length).toBeGreaterThan(antes);
  });
});
