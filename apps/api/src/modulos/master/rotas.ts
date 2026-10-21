import { credenciaisEfetivas, salvarCredenciais } from '@prospeccao/db';
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
  SERVICOS_TESTAVEIS,
  usuarioNovo,
} from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { comConta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { urlPublicaApi } from '../../endereco.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { abrirSessao } from '../auth/sessao.js';
import * as equipe from '../equipe/repositorio.js';
import * as repo from './repositorio.js';

/** Endereço da tela (para o link do convite): a origem do navegador ou a primeira configurada. */
function enderecoDoApp(req: Request, origens: string[]): string {
  const origem = req.get('origin');
  if (origem && origens.includes(origem.toLowerCase())) return origem;
  return origens[0] ?? '';
}

/**
 * Painel master (só quem administra a plataforma): cria contas, guarda as credenciais de cada uma,
 * convida o administrador e "entra" na conta para configurar ou dar suporte.
 */
export function rotasMaster(deps: DepsApi): Router {
  const { pool, credenciais, origens, log } = deps;
  const r = Router();
  const link = (req: Request, token: string) => `${enderecoDoApp(req, origens)}/convite/${token}`;

  r.get('/contas', async (_req, res) => {
    res.json(await repo.listar(pool));
  });

  r.post('/contas', async (req, res) => {
    const d = corpo(req, contaNova);
    const { id, token } = await repo.criar(pool, d);
    log.info({ conta: id, nome: d.nome }, 'master: conta criada');
    res.status(201).json({ id, convite: link(req, token), diasValidade: equipe.DIAS_CONVITE });
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
      // Endereços para colar no Resend e na Evolution da conta.
      webhooks: {
        resend: `${api}/e/resend/${conta.webhookToken}`,
        evolution: conta.webhookWhatsapp ? `${api}/webhooks/evolution/${conta.webhookWhatsapp}` : null,
      },
    });
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
        case 'evolution':
          if (!c.evolution) throw new Error('WhatsApp não configurado (endereço, chave e instância).');
          resultado = await estadoConexao(c.evolution);
          ok = resultado.startsWith('ok');
          break;
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
