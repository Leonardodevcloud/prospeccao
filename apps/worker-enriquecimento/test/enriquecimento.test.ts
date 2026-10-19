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
      refazerDias: 30,
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
      `INSERT INTO cadastro.nichos (nome, cnaes, termos_maps, cargos_alvo) VALUES ('Autopeças', '{4530703}', '{autopeças}', '{comprador,compras}')`,
    );
    await pool.query(
      `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, status) VALUES ('Teste', 1, '[{"cidade":"Salvador","uf":"BA"}]', NULL, 'ativa')`,
    );
    await pool.query(
      `INSERT INTO descoberta.empresas (cnpj, cnpj_basico, nome, razao_social, porte, data_abertura, cidade, uf,
         telefones_receita, email_receita, place_id, maps_telefone, maps_site, maps_avaliacoes, maps_nota, sinal_entrega)
       VALUES ('11222333000181', '11222333', 'Ladeira Auto Peças', 'LADEIRA COMERCIO LTDA', 'epp', '2012-05-02', 'SALVADOR', 'BA',
               '{7132410098}', 'fiscal@contabilidadeabc.com.br', 'p1', '(71) 99812-4410', 'ladeira.com.br', 380, 4.7, true),
              (NULL, NULL, 'Nova Era Moto Peças', NULL, NULL, NULL, 'SALVADOR', 'BA', '{}', NULL, 'p3', NULL, NULL, 12, 4.1, NULL)`,
    );
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem) VALUES (1, 1, 'ambos'), (1, 2, 'maps')`,
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
});
