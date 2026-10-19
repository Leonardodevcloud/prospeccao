import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import iconv from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { type FonteArquivos, FontePasta } from '../src/fonte.js';
import { importarBaseCnpj } from '../src/importador.js';
import { criarImportacao, importacaoDoJob, marcarFim } from '../src/repositorio.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const log = criarLogger('teste', 'silent');

/** Cria um zip no formato da Receita: um CSV latin1, ";" e aspas. */
function criarZip(pasta: string, nome: string, linhas: string[][]): Promise<void> {
  const csv = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n');
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(iconv.encode(`${csv}\n`, 'latin1'), nome.replace('.zip', '.CSV'));
    zip.outputStream
      .pipe(createWriteStream(join(pasta, nome)))
      .on('close', resolve)
      .on('error', reject);
    zip.end();
  });
}

function estab(
  basico: string,
  ordem: string,
  dv: string,
  nome: string,
  situacao: string,
  cnae: string,
  uf: string,
  mun: string,
) {
  return [
    basico,
    ordem,
    dv,
    '1',
    nome,
    situacao,
    '20200101',
    '00',
    '',
    '',
    '20140301',
    cnae,
    '',
    'RUA',
    'TESTE',
    '10',
    '',
    'CENTRO',
    '40000000',
    uf,
    mun,
    '71',
    '32410098',
    '',
    '',
    '',
    '',
    'a@b.com',
    '',
    '',
  ];
}

describe.skipIf(!URL_TESTE)('importação da base de CNPJ (com Postgres)', () => {
  let pool: Pool;
  let pasta: string;

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'cnpj'), aplicacao: 'teste-cnpj', max: 3 });
    await migrar(pool, log);
    await pool.query(
      'TRUNCATE base_cnpj.estabelecimentos, base_cnpj.empresas, base_cnpj.socios, base_cnpj.importacoes RESTART IDENTITY CASCADE',
    );
    await pool.query('TRUNCATE cadastro.campanhas, cadastro.nichos RESTART IDENTITY CASCADE');
    await pool.query(
      `INSERT INTO cadastro.nichos (nome, cnaes, termos_maps) VALUES ('Autopeças', '{4530703}', '{autopeças}')`,
    );
    await pool.query(
      `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, status)
       VALUES ('Teste', 1, '[{"cidade":"Salvador","uf":"BA"}]', 'ativa')`,
    );

    pasta = await mkdtemp(join(tmpdir(), 'cnpj-teste-'));
    await criarZip(pasta, 'Municipios.zip', [
      ['3849', 'SALVADOR'],
      ['7107', 'SAO PAULO'],
    ]);
    await criarZip(pasta, 'Qualificacoes.zip', [
      ['49', 'Sócio-Administrador'],
      ['22', 'Sócio'],
    ]);
    // Simples: a filial baixada (22333444) é MEI; 11222333 é do Simples, mas não MEI.
    await criarZip(pasta, 'Simples.zip', [
      ['11222333', 'S', '20140301', '', 'N', '', ''],
      ['22333444', 'S', '20180101', '', 'S', '20180101', ''],
      ['99999999', 'S', '20180101', '', 'S', '20180101', ''],
    ]);
    await criarZip(pasta, 'Cnaes.zip', [
      ['4530703', 'Comércio a varejo de peças e acessórios novos para veículos automotores'],
    ]);
    for (let i = 0; i < 10; i++) {
      const estabs =
        i === 0
          ? [
              estab('11222333', '0001', '81', 'LADEIRA NOVA PEÇAS', '02', '4530703', 'BA', '3849'), // entra
              estab('44555666', '0001', '00', 'FORA DO NICHO', '02', '4711302', 'BA', '3849'), // CNAE fora
              estab('77888999', '0001', '00', 'OUTRA UF', '02', '4530703', 'SP', '7107'), // UF fora
            ]
          : [];
      if (i === 3)
        estabs.push(estab('22333444', '0002', '11', 'FILIAL BAIXADA', '08', '4530703', 'BA', '3849')); // entra (situação registrada)
      await criarZip(pasta, `Estabelecimentos${i}.zip`, estabs);
      await criarZip(
        pasta,
        `Empresas${i}.zip`,
        i === 0
          ? [
              ['11222333', 'LADEIRA NOVA COMERCIO DE PECAS LTDA', '2062', '49', '50000,00', '03', ''],
              ['44555666', 'NAO ENTRA LTDA', '2062', '49', '1,00', '01', ''],
            ]
          : i === 5
            ? [['22333444', 'BAIXADA LTDA', '2062', '49', '10,00', '01', '']]
            : [],
      );
      await criarZip(
        pasta,
        `Socios${i}.zip`,
        i === 0
          ? [
              ['11222333', '2', 'CARLOS MENEZES', '***123456**', '49', '20140301', '', '', '', '', '5'],
              [
                '11222333',
                '2',
                'MARTA RIBEIRO MENEZES',
                '***654321**',
                '22',
                '20190501',
                '',
                '',
                '',
                '',
                '4',
              ],
              ['44555666', '2', 'NAO ENTRA', '***000000**', '49', '20140301', '', '', '', '', '4'],
            ]
          : [],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('importa só UFs e CNAEs-alvo, com empresas e sócios', async () => {
    const id = await criarImportacao(pool, 'manual', null);
    const r = await importarBaseCnpj({
      pool,
      log,
      fonte: new FontePasta(pasta, '2026-09'),
      importacaoId: id,
      ufsExtras: [],
    });
    await marcarFim(pool, id, null);

    expect(r).toMatchObject({ mes: '2026-09', estabelecimentos: 2, empresas: 2, socios: 2 });

    const { rows: estabs } = await pool.query(
      'SELECT cnpj, situacao, cidade, razao_social, porte FROM base_cnpj.v_estabelecimentos ORDER BY cnpj',
    );
    expect(estabs).toEqual([
      {
        cnpj: '11222333000181',
        situacao: '02',
        cidade: 'SALVADOR',
        razao_social: 'LADEIRA NOVA COMERCIO DE PECAS LTDA',
        porte: 'epp',
      },
      {
        cnpj: '22333444000211',
        situacao: '08',
        cidade: 'SALVADOR',
        razao_social: 'BAIXADA LTDA',
        porte: 'me',
      },
    ]);

    const { rows: socios } = await pool.query(
      'SELECT nome, qualificacao, prioridade FROM base_cnpj.v_socios ORDER BY prioridade',
    );
    expect(socios).toEqual([
      { nome: 'CARLOS MENEZES', qualificacao: 'Sócio-Administrador', prioridade: 1 },
      { nome: 'MARTA RIBEIRO MENEZES', qualificacao: 'Sócio', prioridade: 2 },
    ]);

    // MEI pela tabela do Simples, exposto na view que a descoberta lê.
    const { rows: mei } = await pool.query(
      'SELECT cnpj, mei FROM base_cnpj.v_estabelecimentos ORDER BY cnpj',
    );
    expect(mei).toEqual([
      { cnpj: '11222333000181', mei: false },
      { cnpj: '22333444000211', mei: true },
    ]);

    const { rows: imp } = await pool.query(
      'SELECT status, ufs, cnaes, linhas_lidas FROM base_cnpj.importacoes WHERE id = $1',
      [id],
    );
    expect(imp[0]).toMatchObject({ status: 'concluida', ufs: ['BA'], cnaes: ['4530703'] });
  });

  it('é idempotente: rodar de novo não duplica nada', async () => {
    const id = await criarImportacao(pool, 'manual', null);
    await importarBaseCnpj({
      pool,
      log,
      fonte: new FontePasta(pasta, '2026-09'),
      importacaoId: id,
      ufsExtras: [],
    });
    const { rows } = await pool.query(
      'SELECT (SELECT count(*) FROM base_cnpj.estabelecimentos) AS e, (SELECT count(*) FROM base_cnpj.socios) AS s',
    );
    expect(rows[0]).toEqual({ e: 2, s: 2 });
  });

  it('nova tentativa do mesmo job continua de onde parou, sem refazer arquivos nem duplicar sócios', async () => {
    const id = await importacaoDoJob(pool, 'job-retomada', 'manual', null);
    expect(await importacaoDoJob(pool, 'job-retomada', 'manual', null)).toBe(id);

    // 1ª tentativa: cai no meio dos sócios (deploy), depois do Socios0 já gravado.
    const pedidos: string[] = [];
    const pastaReal = new FontePasta(pasta, '2026-09');
    const fonte = (quebrarEm: string | null): FonteArquivos => ({
      resolverMes: (m) => pastaReal.resolverMes(m),
      liberar: async () => {},
      obter: async (nome) => {
        if (nome === quebrarEm) throw new Error('serviço reiniciou');
        pedidos.push(nome);
        return pastaReal.obter(nome);
      },
    });
    await expect(
      importarBaseCnpj({ pool, log, fonte: fonte('Socios4.zip'), importacaoId: id, ufsExtras: [] }),
    ).rejects.toThrow('serviço reiniciou');
    await marcarFim(pool, id, 'Interrompida');

    // 2ª tentativa: pula domínios, estabelecimentos e empresas; refaz só a etapa de sócios.
    pedidos.length = 0;
    const r = await importarBaseCnpj({ pool, log, fonte: fonte(null), importacaoId: id, ufsExtras: [] });
    await marcarFim(pool, id, null);
    expect(pedidos).toEqual([...Array.from({ length: 10 }, (_, i) => `Socios${i}.zip`), 'Simples.zip']);
    expect(r).toMatchObject({ estabelecimentos: 2, empresas: 2, socios: 2 });

    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM base_cnpj.socios) AS s,
              (SELECT status FROM base_cnpj.importacoes WHERE id = $1) AS status,
              (SELECT cardinality(arquivos_concluidos) FROM base_cnpj.importacoes WHERE id = $1) AS arquivos`,
      [id],
    );
    expect(rows[0]).toEqual({ s: 2, status: 'concluida', arquivos: 34 });
  });
});
