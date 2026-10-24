import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { NomeJob } from '@prospeccao/queue';
import { criarLogger, lerLeads } from '@prospeccao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/dependencias.js';
import { importarLeads } from '../src/importacao.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const log = criarLogger('teste', 'silent');

describe.skipIf(!URL_TESTE)('importação de leads do cliente (com Postgres)', () => {
  let pool: Pool;
  const publicados: { nome: NomeJob; payload: unknown }[] = [];
  const deps = (): Deps =>
    ({
      pool,
      log,
      filas: {
        async publicar(nome: NomeJob, payload: unknown) {
          publicados.push({ nome, payload });
          return 'job';
        },
      },
    }) as unknown as Deps;

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'importacao'),
      aplicacao: 'teste-importacao',
      max: 4,
    });
    await migrar(pool, log);
    await pool.query(`TRUNCATE descoberta.empresas RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE base_cnpj.estabelecimentos, base_cnpj.empresas, base_cnpj.municipios`);
    await pool.query(`TRUNCATE cadastro.campanhas, cadastro.nichos RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE enriquecimento.contatos, enriquecimento.pessoas RESTART IDENTITY CASCADE`);
    await pool.query(
      `INSERT INTO cadastro.contas (id, nome) VALUES (2, 'Outra conta') ON CONFLICT DO NOTHING`,
    );
    await pool.query(`INSERT INTO base_cnpj.municipios VALUES ('3849', 'SALVADOR')`);
    await pool.query(
      `INSERT INTO base_cnpj.estabelecimentos
         (cnpj, cnpj_basico, matriz, nome_fantasia, situacao, data_inicio, cnae_principal, cep, uf, municipio_codigo, telefones)
       VALUES ('11222333000181', '11222333', true, 'LADEIRA NOVA PECAS', '02', '2014-03-01', '4530703', '40415000', 'BA', '3849', '{7132410098}')`,
    );
    await pool.query(
      `INSERT INTO base_cnpj.empresas (cnpj_basico, razao_social, porte) VALUES ('11222333', 'LADEIRA NOVA COMERCIO LTDA', 'epp')`,
    );
    // Empresa já na base (achada por outra conta), com o telefone do Maps.
    await pool.query(
      `INSERT INTO descoberta.empresas (nome, cidade, uf, maps_telefone) VALUES ('Moto Peças Nova Era', 'SALVADOR', 'BA', '71999990000')`,
    );
    await pool.query(
      `INSERT INTO cadastro.nichos (conta_id, nome, cnaes, termos_maps) VALUES (1, 'Autopeças', '{4530703}', '{autopeças}'), (2, 'Outro', '{4530703}', '{autopeças}')`,
    );
    await pool.query(
      `INSERT INTO cadastro.campanhas (conta_id, nome, nicho_id, cidades, raio_km, status, tipo)
       VALUES (1, 'Lista importada', 1, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa', 'importacao'),
              (2, 'Campanha da outra', 2, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa', 'busca')`,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('cria ou reaproveita a empresa, liga à lista, guarda os contatos só para a conta e manda enriquecer', async () => {
    const { leads } = lerLeads(
      [
        [
          'Ladeira Nova',
          'João Lima',
          'Comprador',
          '71 98888-1111',
          'joao@ladeira.com.br',
          '11.222.333/0001-81',
          'Salvador',
        ],
        ['Moto Peças Nova Era LTDA', 'Ana', '', '(71) 99999-0000', '', '', 'Salvador'],
        ['Loja Nova do Bairro', '', '', '', 'contato@lojanova.com', '', 'Salvador'],
      ],
      ['empresa', 'contato', 'cargo', 'whatsapp', 'email', 'cnpj', 'cidade'],
      { uf: 'BA' },
    );
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO cadastro.importacoes_leads (conta_id, arquivo, formato, status, campanha_id, leads, total, opcoes)
       VALUES (1, 'clientes.xlsx', 'xlsx', 'na_fila', 1, $1, 3, '{"enriquecer": true, "funil": {"responsavelId": null}}')
       RETURNING id`,
      [JSON.stringify(leads)],
    );
    const id = Number(rows[0]!.id);
    await importarLeads(deps(), id);

    const { rows: imp } = await pool.query(
      `SELECT status, gravados, resultado, cardinality(empresa_ids) AS n FROM cadastro.importacoes_leads WHERE id = $1`,
      [id],
    );
    // Uma veio da base da Receita (CNPJ), uma já existia (telefone + nome), uma é nova.
    expect(imp[0]).toMatchObject({ status: 'funil', gravados: 3, n: 3 });
    expect(imp[0].resultado).toMatchObject({ novas: 2, existentes: 1, enriquecer: 3 });

    const { rows: empresas } = await pool.query(
      `SELECT e.nome, e.cnpj, e.razao_social, ce.origem, ce.enriquecimento_solicitado_em IS NOT NULL AS pedido
         FROM descoberta.campanha_empresas ce JOIN descoberta.empresas e ON e.id = ce.empresa_id
        WHERE ce.campanha_id = 1 ORDER BY e.id`,
    );
    expect(empresas).toEqual([
      expect.objectContaining({ nome: 'Moto Peças Nova Era', origem: 'importacao', pedido: true }),
      expect.objectContaining({ cnpj: '11222333000181', razao_social: 'LADEIRA NOVA COMERCIO LTDA' }),
      expect.objectContaining({ nome: 'Loja Nova do Bairro', cnpj: null }),
    ]);
    expect(publicados.filter((p) => p.nome === 'enriquecimento.solicitar')).toHaveLength(3);

    // Os contatos do arquivo são da conta 1: privados, com a pessoa como decisora.
    const { rows: contatos } = await pool.query(
      `SELECT canal, valor, conta_id, fonte, principal FROM enriquecimento.contatos ORDER BY id`,
    );
    expect(contatos).toEqual([
      { canal: 'whatsapp', valor: '71988881111', conta_id: 1, fonte: 'importacao', principal: true },
      { canal: 'email', valor: 'joao@ladeira.com.br', conta_id: 1, fonte: 'importacao', principal: false },
      { canal: 'whatsapp', valor: '71999990000', conta_id: 1, fonte: 'importacao', principal: true },
      { canal: 'email', valor: 'contato@lojanova.com', conta_id: 1, fonte: 'importacao', principal: true },
    ]);
    const { rows: pessoas } = await pool.query(
      `SELECT nome, cargo, decisor, conta_id FROM enriquecimento.pessoas ORDER BY id`,
    );
    expect(pessoas[0]).toEqual({ nome: 'João Lima', cargo: 'Comprador', decisor: true, conta_id: 1 });

    // Importar de novo não duplica nem pede o enriquecimento outra vez.
    await pool.query(`UPDATE cadastro.importacoes_leads SET status = 'na_fila' WHERE id = $1`, [id]);
    await importarLeads(deps(), id);
    expect(publicados.filter((p) => p.nome === 'enriquecimento.solicitar')).toHaveLength(3);
    const { rows: n } = await pool.query(`SELECT count(*)::int AS n FROM enriquecimento.contatos`);
    expect(n[0].n).toBe(4);
  });

  it('o enriquecimento automático da campanha nunca pega o importado (só quando o cliente pede)', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM descoberta.campanha_empresas
        WHERE origem = 'importacao' AND dentro_do_raio IS NULL`,
    );
    expect(rows[0].n).toBe(0); // os 3 foram pedidos (dentro_do_raio = true)
    const { reservarParaEnriquecimento } = await import('../src/repositorio.js');
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, dentro_do_raio)
       SELECT 2, id, 'importacao', true FROM descoberta.empresas WHERE nome = 'Loja Nova do Bairro'`,
    );
    expect(await reservarParaEnriquecimento(pool, { campanhaId: 2 })).toEqual([]);
  });
});
