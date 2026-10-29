import { credenciaisEfetivas, lerChipWhatsapp, salvarCredenciais } from '@prospeccao/db';
import { verificarResend } from '@prospeccao/integrations/email';
import { configIa, testarIa } from '@prospeccao/integrations/ia';
import * as ors from '@prospeccao/integrations/ors';
import * as places from '@prospeccao/integrations/places';
import { estadoConexao } from '@prospeccao/integrations/whatsapp';
import {
  AppError,
  contaAtualizar,
  contaNova,
  credenciaisEntrada,
  limitesConta,
  organizacaoAtualizar,
  pessoaMasterAtualizar,
  planoContaEntrada,
  SERVICOS_TESTAVEIS,
  tabelaPrecosEntrada,
  type UsuarioAtualizar,
  unidadeAtualizar,
  unidadeNova,
  usuarioNovo,
} from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { comConta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { enderecoDoApp, urlPublicaApi } from '../../endereco.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import * as auditoria from '../auditoria/repositorio.js';
import { abrirSessao } from '../auth/sessao.js';
import * as consumo from '../consumo/repositorio.js';
import * as equipe from '../equipe/repositorio.js';
import * as org from '../organizacao/repositorio.js';
import * as plano from '../plano/repositorio.js';
import * as repo from './repositorio.js';

/**
 * Painel master (só quem administra a plataforma): cria contas, guarda as credenciais de cada uma,
 * convida o administrador e "entra" na conta para configurar ou dar suporte.
 */
export function rotasMaster(deps: DepsApi): Router {
  const { pool, credenciais, origens, log } = deps;
  const r = Router();
  const link = (req: Request, token: string) =>
    `${enderecoDoApp(req.get('origin'), origens)}/convite/${token}`;

  r.get('/contas', async (_req, res) => {
    const [contas, ia] = await Promise.all([repo.listar(pool), consumo.iaPlataformaPorConta(pool)]);
    const planos = await Promise.all(contas.map((c) => plano.planoDaConta(pool, c.id as number)));
    res.json(
      contas.map((c, i) => ({ ...c, iaPlataformaMes: ia.get(c.id as number) ?? 0, plano: planos[i] })),
    );
  });

  /** Tabela de preços dos planos, módulos, usuário e mil leads (vale para o cálculo de todas as contas). */
  r.get('/precos', async (_req, res) => {
    res.json(await plano.tabelaDePrecos(pool));
  });
  r.put('/precos', async (req, res) => {
    await plano.salvarTabelaDePrecos(pool, corpo(req, tabelaPrecosEntrada), req.usuario!.id);
    res.json(await plano.tabelaDePrecos(pool));
  });

  /** Plano da conta: o que foi contratado, os números trocados só para ela e o uso do mês. */
  r.get('/contas/:id/plano', async (req, res) => {
    res.json(await plano.planoDaConta(pool, idDaRota(req)));
  });
  /** O plano é do cliente (organização): vale para todas as unidades dele. */
  r.put('/contas/:id/plano', async (req, res) => {
    const id = idDaRota(req);
    const d = corpo(req, planoContaEntrada);
    const org = await plano.organizacaoDaConta(pool, id);
    await plano.salvarPlano(pool, org, d);
    // Módulos mudam o que as unidades podem usar: esquece as credenciais lembradas.
    credenciais.invalidar();
    log.info({ organizacao: org, plano: d.plano, modulos: d.modulos }, 'master: plano do cliente salvo');
    res.json(await plano.planoDaConta(pool, id));
  });

  /** Clientes (organizações) e as unidades de cada um. */
  r.get('/organizacoes', async (_req, res) => {
    res.json(await repo.organizacoes(pool));
  });
  r.patch('/organizacoes/:id', async (req, res) => {
    await repo.atualizarOrganizacao(pool, idDaRota(req), corpo(req, organizacaoAtualizar));
    res.json({ ok: true });
  });
  /** Nova unidade no cliente (o gestor também cria pela tela da organização). */
  r.post('/organizacoes/:id/unidades', async (req, res) => {
    const id = await org.criarUnidade(pool, idDaRota(req), corpo(req, unidadeNova));
    log.info({ organizacao: idDaRota(req), unidade: id }, 'master: unidade criada');
    res.status(201).json({ id });
  });
  r.patch('/organizacoes/:id/unidades/:unidade', async (req, res) => {
    const unidade = Number(req.params.unidade);
    if (!Number.isInteger(unidade) || unidade <= 0) throw AppError.naoEncontrado('Unidade');
    await org.atualizarUnidade(pool, idDaRota(req), unidade, corpo(req, unidadeAtualizar));
    res.json({ ok: true });
  });

  /** Usuário de qualquer conta: nome, papel, ativo (reativar respeita a vaga do plano). */
  r.patch('/usuarios/:id', async (req, res) => {
    const id = idDaRota(req);
    const { rows } = await pool.query<{ conta_id: number; master: boolean }>(
      'SELECT conta_id, master FROM cadastro.usuarios WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Usuário');
    if (rows[0].master && id === req.usuario!.id)
      throw AppError.invalido('Você não pode mudar o seu próprio acesso de master por aqui.');
    const d = corpo(req, pessoaMasterAtualizar);
    const { rows: atual } = await pool.query<{ papel: string; organizacao_id: number }>(
      `SELECT u.papel, c.organizacao_id FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
        WHERE u.id = $1`,
      [id],
    );
    const daOrganizacao = (p?: string) => p === 'gestor' || p === 'leitura';
    if (daOrganizacao(atual[0]?.papel) || daOrganizacao(d.papel))
      await org.atualizarPessoa(pool, atual[0]!.organizacao_id, id, d, { id: req.usuario!.id, master: true });
    else
      await comConta(rows[0].conta_id, () =>
        equipe.atualizar(pool, id, { ...d, papel: d.papel as UsuarioAtualizar['papel'] }),
      );
    res.json(await repo.usuarios(pool, rows[0].conta_id));
  });

  r.post('/contas', async (req, res) => {
    const d = corpo(req, contaNova);
    const { id, organizacaoId, token } = await repo.criar(pool, d);
    if (d.plano) await plano.salvarPlano(pool, organizacaoId, d.plano);
    log.info({ conta: id, nome: d.nome }, 'master: conta criada');
    res.status(201).json({ id, organizacaoId, convite: link(req, token), diasValidade: equipe.DIAS_CONVITE });
  });

  r.get('/contas/:id', async (req, res) => {
    const id = idDaRota(req);
    const conta = await repo.obter(pool, id);
    const [usuarios, cred] = await Promise.all([
      repo.usuarios(pool, id),
      repo.credenciais(pool, id, credenciais.chave, credenciais.ambiente),
    ]);
    const api = urlPublicaApi(origens);
    res.json({
      ...conta,
      webhookToken: undefined,
      webhookWhatsapp: undefined,
      usuarios,
      credenciais: cred,
      // Endereços de webhook da conta (o do WhatsApp a plataforma configura sozinha em cada número).
      webhooks: {
        resend: `${api}/e/resend/${conta.webhookToken}`,
        whatsapp: conta.webhookWhatsapp ? `${api}/webhooks/whatsapp/${conta.webhookWhatsapp}` : null,
      },
    });
  });

  /** Consumo do mês (IA, e-mails, WhatsApp, Places) e os tetos da conta. */
  r.get('/contas/:id/consumo', async (req, res) => {
    res.json(await consumo.consumoDaConta(pool, idDaRota(req)));
  });

  /** O que aconteceu na conta (inclusive o que o master fez nela). */
  r.get('/contas/:id/auditoria', async (req, res) => {
    res.json(await auditoria.daConta(pool, idDaRota(req)));
  });

  r.put('/contas/:id/limites', async (req, res) => {
    const id = idDaRota(req);
    await consumo.salvarLimites(pool, id, corpo(req, limitesConta));
    // Ligar ou desligar a IA da plataforma muda o que a conta usa: esquece o que estava lembrado.
    credenciais.invalidar(id);
    res.json(await consumo.consumoDaConta(pool, id));
  });

  r.patch('/contas/:id', async (req, res) => {
    const id = idDaRota(req);
    await repo.atualizar(pool, id, corpo(req, contaAtualizar));
    credenciais.invalidar(id);
    res.json(await repo.obter(pool, id));
  });

  r.put('/contas/:id/credenciais', async (req, res) => {
    const id = idDaRota(req);
    await repo.obter(pool, id);
    const d = corpo(req, credenciaisEntrada);
    try {
      await salvarCredenciais(pool, id, d, credenciais.chave, req.usuario?.id ?? null);
    } catch (erro) {
      throw AppError.invalido(erro instanceof Error ? erro.message : String(erro));
    }
    credenciais.invalidar(id);
    log.info(
      {
        conta: id,
        segredos: Object.keys(d.segredos ?? {}).filter((k) => d.segredos?.[k as never] !== undefined),
      },
      'master: credenciais da conta atualizadas',
    );
    res.json(await repo.credenciais(pool, id, credenciais.chave, credenciais.ambiente));
  });

  /** Confere uma credencial de verdade (chama o serviço com o mínimo possível). */
  r.post('/contas/:id/testar', async (req, res) => {
    const id = idDaRota(req);
    const { servico } = corpo(req, z.object({ servico: z.enum(SERVICOS_TESTAVEIS) }));
    const c = await credenciaisEfetivas(pool, id, credenciais.chave, credenciais.ambiente);
    let resultado: string;
    let ok = false;
    try {
      switch (servico) {
        case 'resend':
          if (!c.resend) throw new Error('Resend não configurado (chave e remetente).');
          resultado = await verificarResend({ apiKey: c.resend.apiKey }, c.resend.remetente);
          ok = resultado.startsWith('ok');
          break;
        case 'whatsapp': {
          if (!c.whatsapp)
            throw new Error('Z-API não configurada na plataforma (ZAPI_PARCEIRO_TOKEN no serviço da api).');
          const chip = await lerChipWhatsapp(pool, id, credenciais.chave, null);
          if (!chip) {
            resultado = 'Z-API da plataforma ok; o cliente ainda não conectou nenhum número.';
            ok = true;
            break;
          }
          resultado = await estadoConexao({ ...chip, clientToken: c.whatsapp.clientToken });
          ok = resultado.startsWith('ok');
          break;
        }
        case 'ia': {
          const cfg = c.ia ? configIa(c.ia) : null;
          if (!cfg)
            throw new Error('IA não configurada (para "compatível com OpenAI", informe também o modelo).');
          resultado = await testarIa(cfg);
          ok = true;
          break;
        }
        case 'places': {
          if (!c.places) throw new Error('Google Places não configurado.');
          // Uma busca pequena (conta como 1 pedido na franquia do mês).
          const p = await places.buscarTexto(c.places, { texto: 'padaria em Salvador, BA' });
          resultado = `ok (${p.itens.length} lugares na busca de teste)`;
          ok = true;
          break;
        }
        case 'ors': {
          if (!c.ors) throw new Error('OpenRouteService não configurado.');
          const g = await ors.geocodificar(c.ors, 'Praça da Sé, Salvador, BA');
          resultado = g ? `ok (achou: ${g.rotulo})` : 'a chave respondeu, mas não achou o endereço de teste';
          ok = !!g;
          break;
        }
      }
    } catch (erro) {
      resultado = erro instanceof Error ? erro.message : String(erro);
    }
    res.json({ servico, ok, resultado: resultado!.slice(0, 400) });
  });

  /** Usuário novo dentro da conta (o administrador dela também pode, na tela Equipe). */
  r.post('/contas/:id/usuarios', async (req, res) => {
    const id = idDaRota(req);
    await repo.obter(pool, id);
    const d = corpo(req, usuarioNovo);
    const { id: usuarioId, token } = await comConta(id, () => equipe.criar(pool, d));
    res.status(201).json({ id: usuarioId, convite: link(req, token), diasValidade: equipe.DIAS_CONVITE });
  });

  /** Novo link de acesso para alguém de qualquer conta (convite vencido, senha esquecida). */
  r.post('/usuarios/:id/convite', async (req, res) => {
    const id = idDaRota(req);
    const { rows } = await pool.query<{ conta_id: number }>(
      'SELECT conta_id FROM cadastro.usuarios WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Usuário');
    const token = await comConta(rows[0].conta_id, () => equipe.novoConvite(pool, id));
    res.json({ convite: link(req, token), diasValidade: equipe.DIAS_CONVITE });
  });

  /** Entra na conta (o sistema todo passa a mostrar os dados dela; você age como administrador). */
  r.post('/contas/:id/entrar', async (req, res) => {
    const id = idDaRota(req);
    await repo.obter(pool, id);
    const u = req.usuario!;
    abrirSessao(res, deps.auth, u.id, id === u.contaPropria ? null : id);
    log.info({ master: u.id, conta: id }, 'master: entrou na conta');
    res.json({ ok: true });
  });

  /** Volta para a própria conta. */
  r.post('/sair', async (req, res) => {
    abrirSessao(res, deps.auth, req.usuario!.id, null);
    res.json({ ok: true });
  });

  return r;
}
