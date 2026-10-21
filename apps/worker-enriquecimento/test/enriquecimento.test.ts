import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { ResultadoGoogle } from '@prospeccao/integrations/enriquecimento';
import { criarLogger } from '@prospeccao/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enriquecerEmpresa } from '../src/casos.js';
import { Coletor, notaPorRegras } from '../src/coletor.js';
import type { Deps, Fontes } from '../src/dependencias.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const log = criarLogger('teste', 'silent');

describe('coletor', () => {
  it('junta o mesmo contato de fontes diferentes e sobe a confiança', () => {
    const c = new Coletor();
    c.contato({ canal: 'telefone', valor: '7132410098', fonte: 'maps', confianca: 70 });
    c.contato({ canal: 'telefone', valor: '7132410098', fonte: 'site', confianca: 60 });
    const t = c.contatos.get('telefone:7132410098');
    expect([...(t?.fontes ?? [])]).toEqual(['maps', 'site']);
    expect(t?.confianca).toBe(80);
  });

  it('telefone com WhatsApp vira contato de WhatsApp verificado; número sem conta fica marcado', () => {
    const c = new Coletor();
    c.contato({ canal: 'telefone', valor: '71998124410', fonte: 'maps', confianca: 70 });
    c.contato({ canal: 'whatsapp', valor: '71998124410', fonte: 'site', confianca: 80 });
    c.contato({ canal: 'whatsapp', valor: '71999990000', fonte: 'instagram', confianca: 80 });
    c.aplicarWhatsapp(
      new Map([
        ['71998124410', true],
        ['71999990000', false],
      ]),
    );
    expect(c.contatos.has('telefone:71998124410')).toBe(false);
    expect(c.contatos.get('whatsapp:71998124410')).toMatchObject({ status: 'verificado', whatsapp: true });
    expect([...(c.contatos.get('whatsapp:71998124410')?.fontes ?? [])].sort()).toEqual(['maps', 'site']);
    expect(c.contatos.get('whatsapp:71999990000')).toMatchObject({ status: 'invalido', whatsapp: false });
    expect(c.escolherPrincipal()?.valor).toBe('71998124410');
  });

  it('mesmo número como WhatsApp do site e telefone do Google vira um contato só', () => {
    const c = new Coletor();
    c.contato({ canal: 'whatsapp', valor: '7132487608', fonte: 'site', confianca: 80 });
    c.contato({ canal: 'telefone', valor: '7132487608', fonte: 'maps', confianca: 70 });
    c.escolherPrincipal();
    expect([...c.contatos.keys()]).toEqual(['whatsapp:7132487608']);
    expect([...(c.contatos.get('whatsapp:7132487608')?.fontes ?? [])]).toEqual(['site', 'maps']);
  });

  it('decisor: compras primeiro, depois quem administra na Receita', () => {
    const c = new Coletor();
    c.pessoa({
      nome: 'JOAO DA SILVA',
      fonte: 'receita',
      papel: 'socio',
      prioridadeReceita: 1,
      desde: '2010-01-01',
    });
    c.pessoa({ nome: 'Ana Lima', fonte: 'site', cargo: 'Gerente de loja' });
    expect(c.escolherDecisor()?.nome).toBe('JOAO DA SILVA');
    c.pessoa({ nome: 'Maria Souza', fonte: 'linkedin', cargo: 'Compradora' });
    expect(c.escolherDecisor()?.nome).toBe('Maria Souza');
    // O mesmo sócio achado no LinkedIn não duplica: ganha o perfil.
    c.pessoa({ nome: 'João da Silva', fonte: 'linkedin', linkedin: 'https://linkedin.com/in/joao' });
    expect(c.pessoas.size).toBe(3);
    expect([...c.pessoas.values()].find((p) => p.nome === 'JOAO DA SILVA')?.linkedin).toBe(
      'https://linkedin.com/in/joao',
    );
  });

  it('nome do site sem cargo de quem decide nunca vira decisor', () => {
    const c = new Coletor();
    c.pessoa({ nome: 'Emmanuel Junior', fonte: 'site', papel: 'outro' });
    c.pessoa({ nome: 'Vanderlei Gomes', fonte: 'site', papel: 'outro' });
    expect(c.escolherDecisor()).toBeNull();
    expect([...c.pessoas.values()].some((p) => p.decisor)).toBe(false);
  });

  it('nota por regras usa a mesma escala da IA', () => {
    const forte = notaPorRegras({
      avaliacoes: 380,
      nota: 4.7,
      entrega: true,
      temWhatsapp: true,
      temInstagram: true,
      temSite: true,
      anos: 12,
      porte: 'epp',
    });
    expect(forte.faixa).toBe('A');
    expect(forte.motivo).toContain('faz entrega');
    expect(
      notaPorRegras({
        avaliacoes: 3,
        nota: 3,
        entrega: null,
        temWhatsapp: false,
        temInstagram: false,
        temSite: false,
        anos: 1,
        porte: null,
      }).faixa,
    ).toBe('C');
  });
});

describe.skipIf(!URL_TESTE)('enriquecimento ponta a ponta (com Postgres e fontes simuladas)', () => {
  let pool: Pool;
  const consultas: string[] = [];
  const conferidos: string[][] = [];

  const resultado = (titulo: string, url: string, descricao = ''): ResultadoGoogle => ({
    titulo,
    url,
    descricao,
  });

  const fontesCompletas = (): Fontes => ({
    site: {
      async ler(url) {
        return {
          urlFinal: `${url}/`,
          paginas: [{ url, titulo: 'Ladeira' }],
          texto:
            'Entregamos em Salvador. Gerente: Carlos Mendes. O que dizem nossos clientes: ★★★★★ "Ótimo atendimento, recomendo!" Emmanuel Junior, Salvador',
          emails: ['compras@ladeira.com.br'],
          telefones: ['7132410098'],
          whatsapps: ['71998124410'],
          instagram: 'ladeirapecas',
          facebook: null,
          linkedinEmpresa: null,
          linkedinPessoas: [],
          cnpjs: [],
        };
      },
    },
    google: {
      async buscar(qs) {
        consultas.push(...qs);
        const m = new Map<string, ResultadoGoogle[]>();
        for (const q of qs) {
          if (q.includes('instagram'))
            m.set(q, [
              resultado('Nova Era (@novaeramotopecas)', 'https://www.instagram.com/novaeramotopecas/'),
            ]);
          else if (q.includes('"JOAO DA SILVA"'))
            m.set(q, [
              // Homônimo em outra empresa vem primeiro: não pode ser ligado ao sócio.
              resultado(
                'João da Silva Caldas - Operador de Produção - Tronox | LinkedIn',
                'https://br.linkedin.com/in/joaocaldas',
              ),
              resultado(
                'João da Silva - Sócio - Ladeira Auto Peças | LinkedIn',
                'https://br.linkedin.com/in/joaodasilva',
              ),
            ]);
          else
            m.set(q, [
              resultado(
                'Maria Souza - Compradora - Ladeira Auto Peças | LinkedIn',
                'https://br.linkedin.com/in/mariasouza',
              ),
              resultado(
                'Pedro Alves - Comprador - Outra Empresa Qualquer | LinkedIn',
                'https://br.linkedin.com/in/pedro',
              ),
            ]);
        }
        return m;
      },
    },
    instagram: {
      async ler(usuario) {
        return {
          usuario,
          nome: 'Loja',
          bio: 'Peças com entrega rápida',
          link: null,
          categoria: null,
          seguidores: 2300,
          email: null,
          telefone: null,
          whatsapps: usuario === 'ladeirapecas' ? ['71998124410'] : ['71988887777'],
          emailsNaBio: [],
          telefonesNaBio: [],
          cnpjs: usuario === 'novaeramotopecas' ? ['33444555000100'] : [],
        };
      },
    },
    ia: {
      async avaliar(e) {
        const ladeira = e.empresa.nome.includes('Ladeira');
        return {
          faixa: ladeira ? 'A' : 'C',
          score: ladeira ? 84 : 30,
          motivo: ladeira ? 'Entrega em Salvador, 380 avaliações' : 'Poucos sinais',
          resumo: 'Loja de autopeças',
          entrega: ladeira,
          pessoas: ladeira
            ? [
                {
                  nome: 'Carlos Mendes',
                  cargo: 'Gerente',
                  papel: 'gestao',
                  trecho: 'Gerente: Carlos Mendes',
                },
                // Autor de depoimento que a IA confundiu com equipe: não pode entrar.
                { nome: 'Emmanuel Junior', cargo: 'Gerente', papel: 'gestao', trecho: null },
              ]
            : [],
        };
      },
    },
    places: {
      async detalhes() {
        return { aberto: true, telefone: '(71) 3241-0098', site: null, nota: 4.7, avaliacoes: 380 };
      },
    },
    whatsapp: {
      async verificar(numeros) {
        conferidos.push(numeros);
        return new Map(numeros.map((n) => [n, n === '71998124410']));
      },
    },
  });

  const deps = (fontes: Fontes): Deps => ({
    pool,
    log,
    fontes,
    ajustes: {
      faixasLinkedin: new Set(['A', 'B']),
      faixasPlaces: new Set(['A', 'B']),
      buscarInstagram: true,
      acharNoGoogle: true,
      faixasBasePaga: new Set(['A']),
      refazerDias: 30,
      limiteContador: 5,
    },
  });

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'enriq'), aplicacao: 'teste-enriq', max: 4 });
    await migrar(pool, log);
    await pool.query(
      `TRUNCATE enriquecimento.leads, enriquecimento.pessoas, enriquecimento.contatos, enriquecimento.etapas RESTART IDENTITY CASCADE`,
    );
    await pool.query(`TRUNCATE descoberta.empresas RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE cadastro.campanhas, cadastro.nichos RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE base_cnpj.socios, base_cnpj.qualificacoes`);
    await pool.query(
      `INSERT INTO base_cnpj.qualificacoes VALUES ('49', 'Sócio-Administrador'), ('22', 'Sócio')`,
    );
    await pool.query(
      `INSERT INTO base_cnpj.socios (cnpj_basico, tipo, nome, qualificacao_codigo, data_entrada)
       VALUES ('11222333', 'pf', 'JOAO DA SILVA', '49', '2012-05-02'), ('11222333', 'pf', 'ANA SILVA', '22', '2015-01-01')`,
    );
    await pool.query(
      `INSERT INTO cadastro.nichos (conta_id, nome, cnaes, termos_maps, cargos_alvo) VALUES (1, 'Autopeças', '{4530703}', '{autopeças}', '{comprador,compras}')`,
    );
    await pool.query(
      `INSERT INTO cadastro.campanhas (conta_id, nome, nicho_id, cidades, raio_km, status) VALUES (1, 'Teste', 1, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa')`,
    );
    await pool.query(
      `INSERT INTO descoberta.empresas (cnpj, cnpj_basico, nome, razao_social, porte, data_abertura, cidade, uf,
         telefones_receita, email_receita, place_id, maps_telefone, maps_site, maps_avaliacoes, maps_nota, sinal_entrega)
       VALUES ('11222333000181', '11222333', 'Ladeira Auto Peças', 'LADEIRA COMERCIO LTDA', 'epp', '2012-05-02', 'SALVADOR', 'BA',
               '{7132410098}', 'fiscal@contabilidadeabc.com.br', 'p1', '(71) 99812-4410', 'ladeira.com.br', 380, 4.7, true),
              (NULL, NULL, 'Nova Era Moto Peças', NULL, NULL, NULL, 'SALVADOR', 'BA', '{}', NULL, 'p3', NULL, NULL, 12, 4.1, NULL)`,
    );
    await pool.query(
      `INSERT INTO descoberta.empresas (cnpj, cnpj_basico, nome, razao_social, cidade, uf, logradouro, numero, bairro, cep)
       VALUES ('14312706000101', '14312706', 'CEAVE NORTE DIESEL LTDA', 'CEAVE NORTE DIESEL LTDA', 'SALVADOR', 'BA',
               'AVENIDA BARROS REIS', '312', 'PAU MIUDO', '40310010')`,
    );
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem)
       VALUES (1, 1, 'ambos'), (1, 2, 'maps'), (1, 3, 'cnpj')`,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('lead A: decisor de compras pelo LinkedIn, WhatsApp verificado como contato principal, trilha completa', async () => {
    expect(await enriquecerEmpresa(deps(fontesCompletas()), { empresaId: 1, campanhaId: 1 })).toBe('feito');

    const { rows: lead } = await pool.query(
      `SELECT status, faixa, score, motivo, instagram, entrega FROM enriquecimento.leads WHERE empresa_id = 1`,
    );
    expect(lead[0]).toMatchObject({
      status: 'concluido',
      faixa: 'A',
      score: 84,
      instagram: 'ladeirapecas',
      entrega: true,
    });

    const { rows: pessoas } = await pool.query(
      `SELECT nome, papel, decisor, prioridade, linkedin_url, fontes FROM enriquecimento.pessoas WHERE empresa_id = 1 ORDER BY prioridade`,
    );
    expect(pessoas.map((p) => [p.nome, p.papel, p.decisor])).toEqual([
      ['Maria Souza', 'compras', true],
      ['JOAO DA SILVA', 'socio', false],
      ['Carlos Mendes', 'gestao', false],
      ['ANA SILVA', 'socio', false],
    ]);
    // Sócio achado no LinkedIn ganha o perfil; empresa de nome parecido fica de fora.
    expect(pessoas[1]).toMatchObject({ linkedin_url: 'https://br.linkedin.com/in/joaodasilva' });
    expect(pessoas.some((p) => p.nome === 'Pedro Alves')).toBe(false);
    // Além da busca por cargo, a busca ampla (nome da loja + cidade), como uma pessoa digitaria.
    expect(consultas).toContain('site:linkedin.com "Ladeira Auto Peças" salvador');
    expect(pessoas.some((p) => p.nome === 'Emmanuel Junior')).toBe(false);

    const { rows: contatos } = await pool.query(
      `SELECT canal, valor, status, principal, fontes, rotulo FROM enriquecimento.contatos WHERE empresa_id = 1 ORDER BY principal DESC, canal, valor`,
    );
    expect(contatos[0]).toMatchObject({
      canal: 'whatsapp',
      valor: '71998124410',
      status: 'verificado',
      principal: true,
    });
    expect([...contatos[0].fontes].sort()).toEqual(['instagram', 'maps', 'site']);
    expect(contatos.find((c) => c.valor === 'fiscal@contabilidadeabc.com.br')).toMatchObject({
      status: 'atencao',
      rotulo: 'Pode ser do contador',
    });
    expect(contatos.find((c) => c.valor === 'compras@ladeira.com.br')).toMatchObject({ rotulo: 'Compras' });

    const { rows: etapas } = await pool.query(
      `SELECT etapa, status FROM enriquecimento.etapas WHERE empresa_id = 1 ORDER BY ordem`,
    );
    expect(etapas.map((e) => `${e.etapa}:${e.status}`)).toEqual([
      'receita:encontrado',
      'maps:encontrado',
      'site:encontrado',
      'instagram:encontrado',
      'ia:encontrado',
      'linkedin:encontrado',
      'places:encontrado',
      'whatsapp:encontrado',
    ]);
  });

  it('lead só do Maps: acha Instagram pelo Google, CNPJ na bio, e não gasta LinkedIn com nota C', async () => {
    consultas.length = 0;
    await enriquecerEmpresa(deps(fontesCompletas()), { empresaId: 2, campanhaId: 1 });
    expect(consultas).toEqual(['"Nova Era Moto Peças" salvador instagram']);
    const { rows } = await pool.query(
      `SELECT faixa, instagram, cnpj_achado FROM enriquecimento.leads WHERE empresa_id = 2`,
    );
    expect(rows[0]).toEqual({ faixa: 'C', instagram: 'novaeramotopecas', cnpj_achado: '33444555000100' });
    const { rows: etapas } = await pool.query(
      `SELECT etapa, status, detalhe FROM enriquecimento.etapas WHERE empresa_id = 2 ORDER BY ordem`,
    );
    expect(etapas.find((e) => e.etapa === 'linkedin')).toMatchObject({
      status: 'pulada',
      detalhe: 'Só para leads A e B.',
    });
    expect(etapas.find((e) => e.etapa === 'receita')?.status).toBe('pulada');
  });

  it('não refaz empresa enriquecida há pouco, a não ser que peçam', async () => {
    expect(await enriquecerEmpresa(deps(fontesCompletas()), { empresaId: 1, campanhaId: 1 })).toBe('pulado');
    expect(
      await enriquecerEmpresa(deps(fontesCompletas()), { empresaId: 1, campanhaId: 1, forcar: true }),
    ).toBe('feito');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM enriquecimento.contatos WHERE empresa_id = 1 AND canal = 'whatsapp'`,
    );
    expect(rows[0].n).toBe(1); // refazer não duplica
  });

  it('sem nenhuma chave: só Receita, Maps e site, com nota por regras', async () => {
    const f = fontesCompletas();
    await enriquecerEmpresa(
      deps({ site: f.site, google: null, instagram: null, ia: null, places: null, whatsapp: null }),
      {
        empresaId: 1,
        campanhaId: 1,
        forcar: true,
      },
    );
    const { rows } = await pool.query(`SELECT faixa, motivo FROM enriquecimento.leads WHERE empresa_id = 1`);
    expect(rows[0].motivo).toMatch(/^Por regras: faz entrega/);
    const { rows: etapas } = await pool.query(
      `SELECT etapa, status, detalhe FROM enriquecimento.etapas WHERE empresa_id = 1 ORDER BY ordem`,
    );
    expect(etapas.filter((e) => e.status === 'pulada').map((e) => e.etapa)).toEqual([
      'instagram',
      'ia',
      'linkedin',
      'places',
      'whatsapp',
    ]);
    const { rows: principal } = await pool.query(
      `SELECT canal, valor FROM enriquecimento.contatos WHERE empresa_id = 1 AND principal`,
    );
    expect(principal[0]).toEqual({ canal: 'whatsapp', valor: '71998124410' }); // botão do site, ainda não verificado
  });

  it('lead só da base de CNPJ: acha no Google pelo nome e endereço; sem crédito na busca vira erro, não "não achou"', async () => {
    const f = fontesCompletas();
    const pedidos: string[] = [];
    let detalhes = 0;
    await enriquecerEmpresa(
      deps({
        ...f,
        google: {
          nome: 'Serper',
          async buscar() {
            throw new Error('Serper: HTTP 400 {"message":"Not enough credits"}');
          },
        },
        ia: {
          async avaliar() {
            return {
              faixa: 'A',
              score: 80,
              motivo: 'Tradicional',
              resumo: 'Diesel',
              entrega: null,
              pessoas: [],
            };
          },
        },
        places: {
          async detalhes() {
            detalhes++;
            return { aberto: true, telefone: null, site: null, nota: null, avaliacoes: null };
          },
        },
        lugar: {
          async achar(e) {
            pedidos.push(`${e.nome}|${e.numero}|${e.cep}`);
            return {
              texto: 'CEAVE NORTE DIESEL LTDA, AVENIDA BARROS REIS 312, SALVADOR - BA',
              candidatos: 1,
              fonte: 'places',
              lugar: {
                placeId: 'pceave',
                nome: 'Ceavê Norte Diesel',
                categoria: 'Loja de autopeças',
                telefone: '7132449744',
                endereco: 'Av. Barros Reis, 312 - Pau Miúdo, Salvador - BA',
                cep: '40310005',
                cidade: 'Salvador',
                uf: 'BA',
                lat: null,
                lng: null,
                nota: 4.3,
                avaliacoes: 28,
                site: null,
                url: 'https://maps.google.com/?cid=1',
                fechada: false,
                entrega: null,
                dados: {},
              },
            };
          },
        },
      }),
      { empresaId: 3, campanhaId: 1 },
    );
    expect(pedidos).toEqual(['CEAVE NORTE DIESEL LTDA|312|40310010']);
    expect(detalhes).toBe(0); // a busca por nome já trouxe tudo: não paga outra consulta

    const { rows: etapas } = await pool.query(
      `SELECT etapa, status, detalhe, url FROM enriquecimento.etapas WHERE empresa_id = 3 ORDER BY ordem`,
    );
    const de = (nome: string) => etapas.find((e) => e.etapa === nome);
    expect(de('maps')).toMatchObject({
      status: 'encontrado',
      detalhe: 'Achada no Google Maps pelo nome e endereço: telefone, nota 4.3, 28 avaliações.',
      url: 'https://maps.google.com/?cid=1',
    });
    expect(de('instagram')).toMatchObject({
      status: 'erro',
      detalhe: 'Sem crédito no Serper para a busca no Google.',
    });
    expect(de('linkedin')).toMatchObject({
      status: 'erro',
      detalhe: 'Sem crédito no Serper para a busca no Google.',
    });
    expect(de('linkedin')?.url).toMatch(/^https:\/\/www\.google\.com\/search\?q=site%3Alinkedin\.com/);
    expect(de('places')).toMatchObject({ status: 'encontrado' });

    const { rows: tel } = await pool.query(
      `SELECT fontes FROM enriquecimento.contatos WHERE empresa_id = 3 AND valor = '7132449744'`,
    );
    expect(tel[0].fontes).toContain('places');
  });

  it('diretórios no Google, Maps pelo Serper e WhatsApp Business: telefone e e-mail que só estavam fora do site', async () => {
    const f = fontesCompletas();
    const buscasSeparadas: string[] = [];
    await enriquecerEmpresa(
      deps({
        ...f,
        google: {
          nome: 'Serper',
          async buscar(qs) {
            buscasSeparadas.push(...qs);
            return new Map();
          },
        },
        ia: {
          async avaliar() {
            return { faixa: 'B', score: 60, motivo: 'Médio', resumo: 'Diesel', entrega: null, pessoas: [] };
          },
          async lerBusca(e) {
            expect(e.empresa.endereco).toBe('AVENIDA BARROS REIS, 312, PAU MIUDO');
            return {
              mesmaEmpresa: true,
              instagram: null,
              site: null,
              telefones: [],
              emails: [],
              pessoas: [
                {
                  nome: 'Marcos Lima',
                  cargo: 'Gerente de compras',
                  trecho: 'Marcos Lima, gerente de compras',
                  evidencia: 'Marcos Lima, gerente de compras',
                },
              ],
            };
          },
        },
        places: null,
        lugar: {
          async achar() {
            return {
              texto: 'x',
              candidatos: 1,
              fonte: 'serper',
              lugar: {
                placeId: 'cid:123',
                nome: 'Ceavê Norte Diesel',
                categoria: 'Loja de autopeças',
                telefone: '7132449744',
                endereco: 'Av. Barros Reis, 312 - Pau Miúdo, Salvador - BA, 40310-005',
                cep: '40310005',
                cidade: 'Salvador',
                uf: 'BA',
                lat: null,
                lng: null,
                nota: 4.3,
                avaliacoes: 28,
                site: null,
                url: 'https://maps.google.com/?cid=123',
                fechada: false,
                entrega: null,
                dados: {},
              },
            };
          },
        },
        diretorios: {
          async buscar(e) {
            expect(e.razaoSocial).toBe('CEAVE NORTE DIESEL LTDA');
            return {
              consulta: '"CEAVE NORTE DIESEL LTDA" salvador',
              painel: null,
              resultados: [
                resultado(
                  'Ceavê Norte Diesel (@ceavenortediesel) · Salvador, BA',
                  'https://www.instagram.com/ceavenortediesel/',
                  '46 Anos de Tradição',
                ),
                resultado(
                  'CEAVÊ NORTE DIESEL LTDA.',
                  'https://autoguiabr.com.br/index.php/empresa/ceave',
                  'CEAVÊ NORTE DIESEL LTDA. Telefone: (71) 3244 9744. Endereço: Principal Salvador - Bahia.',
                ),
                resultado(
                  'Loja - LavraleCEAVE NORTE DIESEL LTDA',
                  'https://www.lavrale.com.br/loja',
                  'CEAVE NORTE DIESEL LTDA · AVENIDA BARROS REIS, 312 · (71)3244-9327 · vendas@ceavenortediesel.com.br. Fale com contato@lavrale.com.br',
                ),
                resultado('Outra Loja Qualquer', 'https://x.com.br', 'Telefone (71) 3333-0000'),
              ],
            };
          },
        },
        whatsapp: {
          async verificar(numeros) {
            return new Map(numeros.map((n) => [n, n === '7132449744']));
          },
          async perfil(numero) {
            return numero === '7132449744'
              ? {
                  descricao: 'Ceavê Norte Diesel: peças para motores diesel',
                  email: 'compras@ceavenortediesel.com.br',
                  site: null,
                  categoria: null,
                  endereco: null,
                }
              : null;
          },
        },
      }),
      { empresaId: 3, campanhaId: 1, forcar: true },
    );
    // O Instagram veio da busca da razão social: só o LinkedIn fez busca própria.
    expect(buscasSeparadas.some((q) => q.includes('instagram'))).toBe(false);

    const { rows: contatos } = await pool.query(
      `SELECT canal, valor, fontes, status, confianca, principal FROM enriquecimento.contatos WHERE empresa_id = 3 ORDER BY canal, valor`,
    );
    const valores = contatos.map((x) => x.valor);
    expect(valores).toEqual(
      expect.arrayContaining([
        'vendas@ceavenortediesel.com.br',
        'compras@ceavenortediesel.com.br',
        '7132449327',
        '7132449744',
      ]),
    );
    expect(valores).not.toContain('contato@lavrale.com.br');
    expect(valores).not.toContain('7133330000');
    const wpp = contatos.find((x) => x.valor === '7132449744');
    expect(wpp).toMatchObject({ canal: 'whatsapp', status: 'verificado', principal: true });
    expect([...wpp.fontes].sort()).toEqual(expect.arrayContaining(['google', 'places', 'whatsapp']));

    const { rows: etapas } = await pool.query(
      `SELECT etapa, status, detalhe FROM enriquecimento.etapas WHERE empresa_id = 3 ORDER BY ordem`,
    );
    const de = (nome: string) => etapas.find((x) => x.etapa === nome);
    expect(de('maps')?.detalhe).toMatch(/^Achada no Google Maps pelo nome e endereço \(via Serper\)/);
    expect(de('google')).toMatchObject({ status: 'encontrado' });
    expect(de('google')?.detalhe).toContain('e-mail vendas@ceavenortediesel.com.br em lavrale.com.br');
    expect(de('google')?.detalhe).toContain('A IA leu a busca: Marcos Lima (Gerente de compras).');
    // A busca da razão social vem antes do site (pode dar o site quando o Maps não tem).
    expect(etapas.map((x) => x.etapa).indexOf('google')).toBeLessThan(
      etapas.map((x) => x.etapa).indexOf('site'),
    );
    const { rows: pessoas } = await pool.query(
      `SELECT nome, papel, decisor FROM enriquecimento.pessoas WHERE empresa_id = 3 AND nome = 'Marcos Lima'`,
    );
    expect(pessoas[0]).toMatchObject({ papel: 'compras', decisor: true });
    expect(de('instagram')).toMatchObject({ status: 'encontrado' });
    expect(de('places')?.detalhe).toMatch(/via Serper/);
    expect(de('whatsapp')?.detalhe).toMatch(/WhatsApp Business desta empresa/);
  });

  it('Google Places só enquanto a cota grátis do mês não acabou (campanhas + enriquecimento)', async () => {
    const { reservarPlacesGratis } = await import('../src/repositorio.js');
    await pool.query('UPDATE cadastro.config_places SET franquia_mensal = 3 WHERE conta_id = 1');
    await pool.query('TRUNCATE enriquecimento.uso_places');
    expect(await reservarPlacesGratis(pool, 2, 1)).toBe(true);
    expect(await reservarPlacesGratis(pool, 2, 1)).toBe(false); // passaria de 3: vai para o Serper
    expect(await reservarPlacesGratis(pool, 1, 1)).toBe(true);
    expect(await reservarPlacesGratis(pool, 1, 1)).toBe(false);
    // Outra conta tem a sua chave e a sua cota (não conta o que a conta 1 gastou).
    await pool.query(`INSERT INTO cadastro.contas (id, nome) VALUES (2, 'Parceira') ON CONFLICT DO NOTHING`);
    await pool.query('SELECT cadastro.preparar_conta(2)');
    expect(await reservarPlacesGratis(pool, 2, 2)).toBe(true);
    await pool.query('UPDATE cadastro.config_places SET franquia_mensal = 1000 WHERE conta_id = 1');
  });

  it('CNPJ antigo: telefone só da Receita sem WhatsApp vira "desativado"; base paga só quando falta WhatsApp atual', async () => {
    await pool.query(
      `UPDATE descoberta.empresas SET data_abertura = '1977-02-08', telefones_receita = '{7132449327}' WHERE id = 3`,
    );
    await pool.query('TRUNCATE enriquecimento.uso_base_paga');
    const consultas: string[] = [];
    const f = fontesCompletas();
    const fontesBase = (comWhatsappNoMaps: boolean): Fontes => ({
      site: f.site,
      google: null,
      instagram: null,
      places: null,
      lugar: comWhatsappNoMaps
        ? {
            async achar() {
              return {
                texto: 'x',
                candidatos: 1,
                fonte: 'places',
                lugar: {
                  placeId: 'p9',
                  nome: 'Ceavê Norte Diesel',
                  categoria: null,
                  telefone: '71999990000',
                  endereco: null,
                  cep: null,
                  cidade: 'Salvador',
                  uf: 'BA',
                  lat: null,
                  lng: null,
                  nota: null,
                  avaliacoes: null,
                  site: null,
                  url: null,
                  fechada: false,
                  entrega: null,
                  dados: {},
                },
              };
            },
          }
        : null,
      ia: {
        async avaliar() {
          return {
            faixa: 'A',
            score: 80,
            motivo: 'Tradicional',
            resumo: 'Diesel',
            entrega: null,
            pessoas: [],
          };
        },
      },
      basePaga: {
        nome: 'Direct Data',
        precoBrl: 0.16,
        async consultar(cnpj) {
          consultas.push(cnpj);
          return {
            telefones: [
              { numero: '71988776655', tipo: 'celular', operadora: 'VIVO', whatsapp: true, bloqueado: false },
              { numero: '7132449744', tipo: 'fixo', operadora: 'OI', whatsapp: false, bloqueado: false },
            ],
            emails: ['compras@ceavenortediesel.com.br'],
          };
        },
      },
      whatsapp: {
        async verificar(numeros) {
          return new Map(numeros.map((n) => [n, n === '71988776655' || n === '71999990000']));
        },
      },
    });

    // Sem WhatsApp atual em nenhuma fonte: consulta a base paga.
    await enriquecerEmpresa(deps(fontesBase(false)), { empresaId: 3, campanhaId: 1, forcar: true });
    expect(consultas).toEqual(['14312706000101']);
    const { rows: contatos } = await pool.query(
      `SELECT canal, valor, status, principal, rotulo FROM enriquecimento.contatos WHERE empresa_id = 3`,
    );
    expect(contatos.find((x) => x.principal)).toMatchObject({
      canal: 'whatsapp',
      valor: '71988776655',
      status: 'verificado',
    });
    expect(contatos.find((x) => x.valor === '7132449327')).toMatchObject({
      status: 'atencao',
      rotulo: expect.stringMatching(/^Provavelmente desativado \(sem WhatsApp; CNPJ de \d+ anos\)$/),
    });
    const { rows: etapa } = await pool.query(
      `SELECT status, detalhe FROM enriquecimento.etapas WHERE empresa_id = 3 AND etapa = 'base_paga'`,
    );
    expect(etapa[0]).toMatchObject({ status: 'encontrado' });
    expect(etapa[0].detalhe).toContain('1 celular, 1 com WhatsApp');
    expect((await pool.query('SELECT count(*)::int AS n FROM enriquecimento.uso_base_paga')).rows[0].n).toBe(
      1,
    );

    // O Maps já trouxe um WhatsApp atual: não gasta a consulta.
    await enriquecerEmpresa(deps(fontesBase(true)), { empresaId: 3, campanhaId: 1, forcar: true });
    expect(consultas).toHaveLength(1);
    const { rows: pulada } = await pool.query(
      `SELECT status, detalhe FROM enriquecimento.etapas WHERE empresa_id = 3 AND etapa = 'base_paga'`,
    );
    expect(pulada[0]).toMatchObject({ status: 'pulada' });
  });

  it('telefone repetido em muitos CNPJs vira "contador" e seu retorno vale na rodada seguinte', async () => {
    // O mesmo número da Receita em 6 empresas da base: é do escritório de contabilidade.
    await pool.query('DELETE FROM base_cnpj.estabelecimentos WHERE cnpj LIKE $1', ['9900000%']);
    for (let i = 0; i < 6; i++)
      await pool.query(
        `INSERT INTO base_cnpj.estabelecimentos (cnpj, cnpj_basico, matriz, situacao, cnae_principal, uf, municipio_codigo, telefones)
         VALUES ($1, $2, true, '02', '4530703', 'BA', '3849', '{7133330000}')`,
        [`9900000${i}000100`, `9900000${i}`],
      );
    await pool.query(
      `UPDATE descoberta.empresas SET telefones_receita = '{7133330000}', data_abertura = '2024-01-01' WHERE id = 3`,
    );
    await pool.query('DELETE FROM comercial.feedback WHERE empresa_id = 3');
    await pool.query(
      `INSERT INTO comercial.feedback (empresa_id, tipo, valor) VALUES (3, 'numero_errado', '71988776655'),
              (3, 'nao_decisor', 'Marcos Lima')`,
    );
    const f = fontesCompletas();
    await enriquecerEmpresa(
      deps({
        site: f.site,
        google: null,
        instagram: null,
        places: null,
        ia: {
          async avaliar() {
            return { faixa: 'B', score: 55, motivo: 'Médio', resumo: 'Diesel', entrega: null, pessoas: [] };
          },
        },
        diretorios: {
          async buscar() {
            return {
              consulta: 'x',
              painel: null,
              resultados: [
                {
                  titulo: 'CEAVE NORTE DIESEL - contato',
                  url: 'https://x.com.br/ceave',
                  descricao: 'Ceave Norte Diesel. Comprador: Marcos Lima. WhatsApp (71) 98877-6655',
                },
              ],
            };
          },
        },
        whatsapp: {
          async verificar(numeros) {
            return new Map(numeros.map((n) => [n, n === '71988776655']));
          },
        },
      }),
      { empresaId: 3, campanhaId: 1, forcar: true },
    );
    const { rows: contatos } = await pool.query(
      `SELECT valor, status, rotulo, principal FROM enriquecimento.contatos WHERE empresa_id = 3`,
    );
    expect(contatos.find((x) => x.valor === '7133330000')).toMatchObject({
      status: 'atencao',
      rotulo: 'Repetido em 6 empresas da base: provável contador',
      principal: false,
    });
    expect(contatos.find((x) => x.valor === '71988776655')).toMatchObject({
      status: 'invalido',
      rotulo: 'Marcado como errado por você',
      principal: false,
    });
    await pool.query('DELETE FROM comercial.feedback WHERE empresa_id = 3');
  });
});
