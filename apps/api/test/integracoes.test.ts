import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { ipInterno, rodadaAvisos } from '../src/modulos/integracoes/avisos.js';
import { ipPermitido, usoNoMinuto, zerarLimites } from '../src/modulos/integracoes/chaves.js';
import { esquecerRecursos } from '../src/recursos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const CHAVE_CIFRA = 'c'.repeat(32);

describe.skipIf(!URL_TESTE)('API aberta: chaves, /v1, formulários do site e avisos', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  let empresaId = 0;
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');

  // O sistema do cliente que recebe os avisos (responde 500 nas primeiras `falhar` vezes).
  let servidor: Server;
  let urlAvisos = '';
  const recebidos: { corpo: string; cabecalhos: Record<string, string | string[] | undefined> }[] = [];
  let falhar = 0;

  const ler = (rota: string) => request(app).get(rota).set('Cookie', cookie);
  const enviar = (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);
  const api = (chave: string) => ({
    get: (rota: string) => request(app).get(`/v1${rota}`).set('Authorization', `Bearer ${chave}`),
    post: (rota: string, corpo: object, cab: Record<string, string> = {}) =>
      request(app).post(`/v1${rota}`).set('Authorization', `Bearer ${chave}`).set(cab).send(corpo),
    patch: (rota: string, corpo: object) =>
      request(app).patch(`/v1${rota}`).set('Authorization', `Bearer ${chave}`).send(corpo),
    delete: (rota: string) => request(app).delete(`/v1${rota}`).set('Authorization', `Bearer ${chave}`),
  });
  const rodada = () => rodadaAvisos(pool, log, { chave: CHAVE_CIFRA, redeLocal: true });

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'integracoes'), aplicacao: 'teste-api', max: 4 });
    await migrar(pool, log);
    app = criarApp({
      pool,
      log,
      filas: {
        async publicar() {
          return 'job';
        },
        async publicarVarios(_n, p) {
          return p.length;
        },
        async cancelarPendentes() {
          return 0;
        },
        async tamanhos() {
          return {};
        },
      },
      auth: {
        jwtSegredo: 'j'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos: async (contaId) => ({
        contaId,
        whatsapp: null,
        ia: null,
        classificarEmail: null,
        personalizarAbertura: null,
        email: null,
        assistente: null,
        geocodificar: async () => null,
        rotas: null,
        origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
        iaDescricao: null,
        erro: null,
      }),
      credenciais: { chave: CHAVE_CIFRA, ambiente: {}, invalidar() {} },
      meta: null,
    });
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => {
        corpo += c;
      });
      req.on('end', () => {
        recebidos.push({ corpo, cabecalhos: req.headers });
        if (falhar > 0) {
          falhar--;
          res.writeHead(500).end('erro');
        } else res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
    urlAvisos = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/hook`;

    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    await enviar('post', '/nichos', { nome: 'Saúde', cnaes: ['8630-5/04'], termosMaps: ['clínica'] });
    const lead = await enviar('post', '/funil/leads', {
      empresa: 'Clínica Sorriso Pleno',
      contato: 'Fernanda Rocha',
      telefone: '(71) 99876-5432',
      email: 'fernanda@sorriso.com.br',
      cidade: 'Salvador',
      uf: 'BA',
    });
    empresaId = lead.body.empresaId;
  });

  afterAll(async () => {
    servidor?.close();
    await pool?.end();
  });

  it('a chave aparece uma vez, guarda só o hash e respeita as permissões', async () => {
    const criada = await enviar('post', '/integracoes/chaves', {
      nome: 'ERP Bling',
      permissoes: ['leads:criar', 'leads:ler', 'leads:mover', 'atividades', 'funil:ler', 'avisos'],
    });
    expect(criada.status).toBe(201);
    const chave = criada.body.chave as string;
    expect(chave).toMatch(/^pt_live_[A-Za-z0-9]{32}$/);
    const { rows } = await pool.query('SELECT hash, final FROM comercial.api_chaves WHERE id = $1', [
      criada.body.id,
    ]);
    expect(rows[0].hash).not.toContain(chave);
    expect(rows[0].final).toBe(chave.slice(-4));
    const lista = (await ler('/integracoes')).body;
    expect(lista.chaves[0]).toMatchObject({ nome: 'ERP Bling', final: chave.slice(-4) });
    expect(JSON.stringify(lista)).not.toContain(chave);

    expect((await request(app).get('/v1/')).status).toBe(401);
    expect((await api('pt_live_errada').get('/')).body.erro.codigo).toBe('chave_invalida');
    const eu = await api(chave).get('/');
    expect(eu.status).toBe(200);
    expect(eu.body.chave.nome).toBe('ERP Bling');

    // Só leitura: não cria.
    const leitura = (await enviar('post', '/integracoes/chaves', { nome: 'BI', permissoes: ['leads:ler'] }))
      .body.chave;
    const proibido = await api(leitura).post('/leads', { empresa: 'Teste' });
    expect(proibido.status).toBe(403);
    expect(proibido.body.erro.codigo).toBe('sem_permissao');
    expect((await api(leitura).get('/leads')).status).toBe(200);

    // Revogada deixa de valer na hora.
    const idLeitura = (await ler('/integracoes')).body.chaves.find(
      (c: { nome: string }) => c.nome === 'BI',
    ).id;
    await enviar('delete', `/integracoes/chaves/${idLeitura}`);
    expect((await api(leitura).get('/')).body.erro.codigo).toBe('chave_revogada');

    // Vencida e de IP não permitido.
    const venc = (
      await enviar('post', '/integracoes/chaves', {
        nome: 'Teste',
        permissoes: ['leads:ler'],
        validadeDias: 30,
      })
    ).body;
    await pool.query(`UPDATE comercial.api_chaves SET expira_em = now() - interval '1 day' WHERE id = $1`, [
      venc.id,
    ]);
    expect((await api(venc.chave).get('/')).body.erro.codigo).toBe('chave_vencida');
    const ip = (
      await enviar('post', '/integracoes/chaves', {
        nome: 'IP',
        permissoes: ['leads:ler'],
        ips: ['201.17.40.0/24'],
      })
    ).body.chave;
    expect((await api(ip).get('/')).body.erro.codigo).toBe('ip_nao_permitido');
    expect(ipPermitido('201.17.40.99', ['201.17.40.0/24'])).toBe(true);
    expect(ipPermitido('201.17.41.1', ['201.17.40.0/24'])).toBe(false);
    expect(ipPermitido('2001:db8::5', ['2001:db8::/32'])).toBe(true);
  });

  it('criar lead deduplica por telefone, e-mail e CNPJ; idempotência; listar, ver, mover e registrar', async () => {
    const chave = (
      await enviar('post', '/integracoes/chaves', {
        nome: 'Loja',
        permissoes: ['leads:criar', 'leads:ler', 'leads:mover', 'atividades', 'funil:ler'],
      })
    ).body.chave;
    const c = api(chave);
    const funis = (await c.get('/funis')).body.dados;
    const etapas = funis.flatMap((f: { etapas: unknown[] }) => f.etapas) as { id: number; papel: string }[];
    const usuarios = (await c.get('/usuarios')).body.dados;

    const novo = await c.post(
      '/leads',
      {
        empresa: 'Odonto Vida Center',
        contato: { nome: 'Ricardo Lima', telefone: '71 99123-0011', email: 'ricardo@odontovida.com.br' },
        cnpj: '11.222.333/0001-81',
        etapaId: etapas.find((e) => e.papel === 'abordado')!.id,
        responsavelId: usuarios[0].id,
        valorMensal: 890,
        etiquetas: ['loja'],
        origem: { canal: 'site', campanha: 'black-friday' },
        campos: { vendedores: '5 a 10' },
      },
      { 'Idempotency-Key': 'pedido-1' },
    );
    expect(novo.status).toBe(201);
    expect(novo.body).toMatchObject({
      empresa: 'Odonto Vida Center',
      duplicado: false,
      etapa: { papel: 'abordado' },
      responsavel: { id: usuarios[0].id },
      valorMensal: 890,
      etiquetas: ['loja'],
      contato: { nome: 'Ricardo Lima' },
    });
    expect(novo.body.link).toBe(`${ORIGEM}/funil?empresa=${novo.body.id}`);
    // O mesmo pedido de novo: a mesma resposta, sem criar outro.
    const repetido = await c.post('/leads', { empresa: 'Outro nome' }, { 'Idempotency-Key': 'pedido-1' });
    expect(repetido.status).toBe(201);
    expect(repetido.headers['idempotent-replayed']).toBe('true');
    expect(repetido.body.id).toBe(novo.body.id);

    // Telefone, e-mail e CNPJ que já existem: junta no lead.
    const porTel = await c.post('/leads', { empresa: 'Sorriso', contato: { telefone: '(71) 99876-5432' } });
    expect(porTel.status).toBe(200);
    expect(porTel.body).toMatchObject({ id: empresaId, duplicado: true });
    const porEmail = await c.post('/leads', {
      empresa: 'Xis',
      contato: { email: 'FERNANDA@sorriso.com.br' },
    });
    expect(porEmail.body).toMatchObject({ id: empresaId, duplicado: true });
    const porCnpj = await c.post('/leads', {
      empresa: 'Ypsilon',
      cnpj: '11222333000181',
      nota: 'Pedido 88213',
    });
    expect(porCnpj.body).toMatchObject({ id: novo.body.id, duplicado: true });
    const { rows: notas } = await pool.query(
      `SELECT texto FROM comercial.atividades WHERE empresa_id = $1 AND tipo = 'nota' ORDER BY id DESC LIMIT 1`,
      [novo.body.id],
    );
    expect(notas[0].texto).toContain('Chegou de novo pela API (Loja)');
    expect(notas[0].texto).toContain('Pedido 88213');

    // Etapa ou responsável de outra conta (ou inexistente): recusa.
    expect((await c.post('/leads', { empresa: 'Zeta', etapaId: 99999 })).status).toBe(422);
    expect((await c.post('/leads', { empresa: 'Zeta' })).status).toBe(201);
    expect((await c.post('/leads', { contato: { nome: 'sem empresa' } })).body.erro.codigo).toBe(
      'dados_invalidos',
    );

    // Listar com página e filtros.
    const p1 = await c.get('/leads?limite=2');
    expect(p1.body.dados).toHaveLength(2);
    expect(p1.body.proximo).toBeTruthy();
    const p2 = await c.get(`/leads?limite=2&depois=${p1.body.proximo}`);
    expect(p2.body.dados[0].id).toBeLessThan(p1.body.proximo);
    expect((await c.get('/leads?telefone=71991230011')).body.dados.map((l: { id: number }) => l.id)).toEqual([
      novo.body.id,
    ]);
    expect((await c.get('/leads?cnpj=11.222.333/0001-81')).body.dados).toHaveLength(1);

    // Ver, mover para ganho e registrar atividade.
    const ver = await c.get(`/leads/${novo.body.id}`);
    expect(ver.body.atividades.length).toBeGreaterThan(0);
    const ganho = etapas.find((e) => e.papel === 'ganho')!;
    const mov = await c.patch(`/leads/${novo.body.id}`, { etapaId: ganho.id, valorMensal: 1290 });
    expect(mov.status).toBe(200);
    expect(mov.body.etapa).toMatchObject({ id: ganho.id, papel: 'ganho' });
    const perdido = etapas.find((e) => e.papel === 'perdido')!;
    expect((await c.patch(`/leads/${empresaId}`, { etapaId: perdido.id })).status).toBe(422);
    const at = await c.post(`/leads/${empresaId}/atividades`, {
      tipo: 'nota',
      texto: 'Pedido faturado no ERP',
    });
    expect(at.status).toBe(201);
    const { rows: aud } = await pool.query(
      `SELECT usuario_nome, descricao FROM cadastro.auditoria WHERE acao = 'api' ORDER BY id`,
    );
    expect(aud.map((a) => a.usuario_nome)).toContain('API · Loja');
    expect(aud.some((a) => /etapa/.test(a.descricao))).toBe(true);

    const uso = (await ler('/integracoes')).body.uso;
    expect(uso.leads30).toBeGreaterThanOrEqual(2);
    expect(uso.duplicados30).toBe(3);
    expect(uso.chamadasHoje).toBeGreaterThan(10);
  });

  it('isolamento: a chave de uma conta não enxerga nem mexe em outra; plano sem API não usa', async () => {
    const outra = await enviar('post', '/master/contas', {
      nome: 'Fiix Peças',
      admin: { nome: 'Davi', email: 'davi@fiix.com.br' },
      plano: { plano: 'time', modulos: [] },
    });
    expect(outra.status).toBe(201);
    const dentro = await enviar('post', `/master/contas/${outra.body.id}/entrar`);
    const cookieOutra = (dentro.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const comOutra = (m: 'post' | 'get', rota: string, corpo?: object) =>
      m === 'get'
        ? request(app).get(rota).set('Cookie', cookieOutra)
        : request(app).post(rota).set('Origin', ORIGEM).set('Cookie', cookieOutra).send(corpo);
    const chaveOutra = (
      await comOutra('post', '/integracoes/chaves', {
        nome: 'Fiix',
        permissoes: ['leads:ler', 'leads:mover', 'leads:criar'],
      })
    ).body.chave as string;
    expect(chaveOutra).toBeTruthy();
    await comOutra('post', '/nichos', { nome: 'Autopeças', cnaes: ['4530-7/03'], termosMaps: ['autopeças'] });
    // A chave da Fiix não acha o lead da conta 1, nem pelo id nem pela lista.
    expect((await api(chaveOutra).get(`/leads/${empresaId}`)).status).toBe(404);
    expect((await api(chaveOutra).patch(`/leads/${empresaId}`, { valorMensal: 1 })).status).toBe(404);
    expect((await api(chaveOutra).get('/leads')).body.dados).toEqual([]);
    // O mesmo telefone na Fiix vira outro lead (não junta com o da outra conta).
    const l = await api(chaveOutra).post('/leads', {
      empresa: 'Sorriso na Fiix',
      contato: { telefone: '71 99876-5432' },
    });
    expect(l.status).toBe(201);
    expect(l.body.id).not.toBe(empresaId);

    // O plano passa para o Start (sem API): a chave deixa de funcionar e a tela mostra o cadeado.
    await enviar('put', `/master/contas/${outra.body.id}/plano`, { plano: 'start', modulos: [] });
    esquecerRecursos();
    const fora = await api(chaveOutra).get('/');
    expect(fora.status).toBe(403);
    expect(fora.body.erro.codigo).toBe('fora_do_plano');
    expect((await comOutra('get', '/integracoes')).body.plano).toBe(false);
    expect(
      (await comOutra('post', '/integracoes/chaves', { nome: 'X', permissoes: ['leads:ler'] })).status,
    ).toBe(403);
    await request(app).post('/master/sair').set('Origin', ORIGEM).set('Cookie', cookieOutra);
  });

  it('formulário do site: aprende os campos, cria o lead, junta o repetido e barra robô', async () => {
    const id = (await enviar('post', '/integracoes/formularios', { nome: 'Site — Fale com a gente' })).body
      .id;
    const f = (await ler('/integracoes/formularios')).body.find((x: { id: number }) => x.id === id);
    expect(f.chave).toMatch(/^f_/);
    const entrada = `/v1/entrada/${f.chave}`;

    // Elementor (formulário em urlencoded com os títulos).
    const r = await request(app)
      .post(entrada)
      .type('form')
      .send(
        'fields[name][title]=Nome&fields[name][value]=Mariana Souza&fields[field_3a][title]=WhatsApp&fields[field_3a][value]=71 98877-6655' +
          '&fields[empresa][title]=Empresa&fields[empresa][value]=Construtora Farol&fields[field_9c][title]=Quantos vendedores?&fields[field_9c][value]=5 a 10',
      );
    expect(r.status).toBe(201);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    const depois = (await ler('/integracoes/formularios')).body.find((x: { id: number }) => x.id === id);
    expect(depois.campos.map((c: { chave: string; campo: string }) => [c.chave, c.campo])).toEqual([
      ['fields.name', 'contato'],
      ['fields.field_3a', 'telefone'],
      ['fields.empresa', 'empresa'],
      ['fields.field_9c', 'anotacao'],
    ]);
    const envios = (await ler(`/integracoes/formularios/${id}/envios`)).body;
    expect(envios[0]).toMatchObject({ resultado: 'lead', lead: 'Construtora Farol' });
    const { rows: n } = await pool.query(
      `SELECT texto FROM comercial.atividades WHERE empresa_id = $1 AND tipo = 'nota'`,
      [envios[0].empresaId],
    );
    expect(n.map((x) => x.texto).join('\n')).toContain('Quantos vendedores?: 5 a 10');

    // O mesmo WhatsApp de novo (JSON): junta.
    const de = await request(app).post(entrada).send({ nome: 'Mariana', whatsapp: '(71) 98877-6655' });
    expect(de.status).toBe(201);
    expect((await ler(`/integracoes/formularios/${id}/envios`)).body[0]).toMatchObject({
      resultado: 'duplicado',
      empresaId: envios[0].empresaId,
    });
    // Campo novo fica marcado.
    const campos = (await ler('/integracoes/formularios')).body.find(
      (x: { id: number }) => x.id === id,
    ).campos;
    expect(campos.find((c: { chave: string }) => c.chave === 'whatsapp').novo).toBe(true);

    // Robô (campo-isca preenchido) não vira lead, mas não sabe disso.
    const robo = await request(app)
      .post(entrada)
      .send({ nome: 'Spam', email: 'spam@x.com', pt_confirmar: 'sim' });
    expect(robo.status).toBe(201);
    expect((await ler(`/integracoes/formularios/${id}/envios`)).body[0].resultado).toBe('robo');

    // Formulário HTML comum: volta para a página escolhida.
    await enviar('put', `/integracoes/formularios/${id}`, {
      nome: 'Site — Fale com a gente',
      ligado: true,
      campos,
      etiquetas: ['site'],
      avisar: false,
      redirecionar: 'https://nexo.com.br/obrigado',
    });
    const html = await request(app)
      .post(entrada)
      .set('Accept', 'text/html')
      .type('form')
      .send('nome=Paula&email=paula@bemestar.com.br');
    expect(html.status).toBe(303);
    expect(html.headers.location).toBe('https://nexo.com.br/obrigado');
    expect((await request(app).post('/v1/entrada/f_naoexiste1').send({ a: 1 })).status).toBe(404);
    expect((await request(app).post(entrada).send({})).status).toBe(422);
  });

  it('avisos: o gatilho anota, o motor assina e manda, tenta de novo e deixa reenviar', async () => {
    const criado = await enviar('post', '/integracoes/avisos', {
      nome: 'ERP',
      url: 'https://erp.exemplo.com/hook',
      eventos: ['lead.criado', 'lead.ganho', 'lead.etapa', 'reuniao.marcada'],
    });
    expect(criado.status).toBe(201);
    const segredo = criado.body.segredo as string;
    expect(segredo).toMatch(/^whsec_/);
    expect((await ler(`/integracoes/avisos/${criado.body.id}/segredo`)).body.segredo).toBe(segredo);
    // A url de teste é local (só os testes deixam): troca direto no banco.
    await pool.query('UPDATE comercial.webhooks SET url = $2 WHERE id = $1', [criado.body.id, urlAvisos]);

    const chave = (
      await enviar('post', '/integracoes/chaves', {
        nome: 'Avisos',
        permissoes: ['leads:criar', 'leads:mover', 'funil:ler'],
      })
    ).body.chave;
    const etapas = (await api(chave).get('/funis')).body.dados.flatMap(
      (f: { etapas: unknown[] }) => f.etapas,
    ) as {
      id: number;
      papel: string;
    }[];
    const lead = await api(chave).post('/leads', {
      empresa: 'Studio Fisio Mais',
      contato: { telefone: '71 99333-0044' },
    });
    await api(chave).patch(`/leads/${lead.body.id}`, {
      etapaId: etapas.find((e) => e.papel === 'ganho')!.id,
    });
    const { rows: anotadas } = await pool.query(
      'SELECT evento FROM comercial.webhook_entregas WHERE webhook_id = $1 ORDER BY id',
      [criado.body.id],
    );
    expect(anotadas.map((a) => a.evento)).toEqual(['lead.criado', 'lead.etapa', 'lead.ganho']);

    // 1ª rodada: a 1ª entrega falha (500) e fica para daqui a 1 min; as outras chegam assinadas.
    falhar = 1;
    recebidos.length = 0;
    await rodada();
    expect(recebidos).toHaveLength(3);
    const ok = recebidos.find((x) => JSON.parse(x.corpo).evento === 'lead.ganho')!;
    const corpo = JSON.parse(ok.corpo);
    expect(corpo).toMatchObject({
      evento: 'lead.ganho',
      lead: { id: lead.body.id, etapa: { papel: 'ganho' } },
    });
    const assinatura = String(ok.cabecalhos['x-prospect-assinatura']);
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(assinatura)!;
    expect(v1).toBe(createHmac('sha256', segredo).update(`${t}.${ok.corpo}`).digest('hex'));
    let entregas = (await ler(`/integracoes/avisos/${criado.body.id}/entregas`)).body as {
      id: number;
      situacao: string;
      tentativas: number;
      evento: string;
    }[];
    const falhou = entregas.find((e) => e.situacao === 'pendente')!;
    expect(falhou).toMatchObject({ tentativas: 1 });
    expect(entregas.filter((e) => e.situacao === 'entregue')).toHaveLength(2);

    // Reenviar: vai na próxima rodada (o corpo é o mesmo da 1ª tentativa).
    recebidos.length = 0;
    await enviar('post', `/integracoes/entregas/${falhou.id}/reenviar`);
    await rodada();
    expect(recebidos).toHaveLength(1);
    entregas = (await ler(`/integracoes/avisos/${criado.body.id}/entregas`)).body;
    expect(entregas.find((e) => e.id === falhou.id)).toMatchObject({ situacao: 'entregue', tentativas: 2 });

    // Teste pela tela; pausado não recebe eventos novos.
    await enviar('post', `/integracoes/avisos/${criado.body.id}/testar`);
    recebidos.length = 0;
    await rodada();
    expect(JSON.parse(recebidos[0]!.corpo).evento).toBe('teste');
    await enviar('post', `/integracoes/avisos/${criado.body.id}/pausar`);
    await api(chave).post('/leads', { empresa: 'Laboratório Vitta' });
    const { rows: depois } = await pool.query(
      `SELECT count(*)::int AS n FROM comercial.webhook_entregas WHERE webhook_id = $1 AND situacao = 'pendente'`,
      [criado.body.id],
    );
    expect(depois[0].n).toBe(0);

    // Sete tentativas sem sucesso: falhou de vez.
    await enviar('post', `/integracoes/avisos/${criado.body.id}/ativar`);
    await enviar('post', `/integracoes/avisos/${criado.body.id}/testar`);
    falhar = 10;
    for (let i = 0; i < 7; i++) {
      await pool.query(
        `UPDATE comercial.webhook_entregas SET proxima_em = now() WHERE webhook_id = $1 AND situacao = 'pendente'`,
        [criado.body.id],
      );
      await rodada();
    }
    falhar = 0;
    const ultima = (await ler(`/integracoes/avisos/${criado.body.id}/entregas`)).body[0];
    expect(ultima).toMatchObject({ evento: 'teste', situacao: 'falhou', tentativas: 7, statusHttp: 500 });

    // Endereço que não é https ou que aponta para a rede interna: recusado.
    expect(
      (
        await enviar('post', '/integracoes/avisos', {
          nome: 'X',
          url: 'http://a.com',
          eventos: ['lead.criado'],
        })
      ).status,
    ).toBe(422);
    expect(ipInterno('10.0.0.5')).toBe(true);
    expect(ipInterno('169.254.169.254')).toBe(true);
    expect(ipInterno('::1')).toBe(true);
    expect(ipInterno('8.8.8.8')).toBe(false);
  });

  it('o Make/Zapier se inscreve pela API e só apaga o que criou', async () => {
    const chave = (await enviar('post', '/integracoes/chaves', { nome: 'Make', permissoes: ['avisos'] })).body
      .chave;
    const r = await api(chave).post('/avisos', {
      url: 'https://hook.make.com/abc',
      eventos: ['lead.criado'],
    });
    expect(r.status).toBe(201);
    expect(r.body.segredo).toMatch(/^whsec_/);
    const lista = (await api(chave).get('/avisos')).body.dados;
    expect(lista.some((a: { id: number }) => a.id === r.body.id)).toBe(true);
    const daTela = (await ler('/integracoes/avisos')).body.find((a: { pelaApi: boolean }) => !a.pelaApi);
    expect((await api(chave).delete(`/avisos/${daTela.id}`)).status).toBe(404);
    expect((await api(chave).delete(`/avisos/${r.body.id}`)).status).toBe(204);
  });

  it('limite por minuto e a descrição OpenAPI', async () => {
    const doc = await request(app).get('/v1/openapi.json');
    expect(doc.status).toBe(200);
    expect(doc.body.openapi).toBe('3.1.0');
    expect(Object.keys(doc.body.paths)).toEqual(
      expect.arrayContaining([
        '/leads',
        '/leads/{id}',
        '/leads/{id}/atividades',
        '/funis',
        '/usuarios',
        '/entrada/{chave}',
        '/avisos',
      ]),
    );
    expect(
      doc.body.paths['/leads'].post.requestBody.content['application/json'].schema.properties.empresa,
    ).toBeTruthy();
    const exp = await request(app).post('/v1/experimentar/leads').send({ empresa: 'Teste da documentação' });
    expect(exp.status).toBe(201);
    expect((await request(app).post('/v1/experimentar/leads').send({})).status).toBe(422);

    const chave = (await enviar('post', '/integracoes/chaves', { nome: 'Rápida', permissoes: ['leads:ler'] }))
      .body.chave;
    zerarLimites();
    const id = Number(
      (await pool.query(`SELECT id FROM comercial.api_chaves WHERE nome = 'Rápida'`)).rows[0].id,
    );
    expect((await api(chave).get('/')).status).toBe(200);
    usoNoMinuto(id, 600);
    const passou = await api(chave).get('/');
    expect(passou.status).toBe(429);
    expect(passou.body.erro.codigo).toBe('limite_por_minuto');
  });
});
