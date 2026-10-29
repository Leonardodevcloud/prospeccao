import { AppError, pessoaAtualizar, pessoaNova, unidadeAtualizar, unidadeNova } from '@prospeccao/shared';
import { type Request, Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { enderecoDoApp } from '../../endereco.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirGestor } from '../../middlewares/seguranca.js';
import { abrirSessao } from '../auth/sessao.js';
import { DIAS_CONVITE } from '../equipe/repositorio.js';
import * as repo from './repositorio.js';

/**
 * Organização (o cliente com várias unidades): o gestor vê e administra todas as unidades, as
 * pessoas e a cota de leads; a leitura (diretoria) só olha. A organização é sempre a da sessão.
 */
export function rotasOrganizacao(deps: DepsApi): Router {
  const { pool, origens, log } = deps;
  const r = Router();
  const link = (req: Request, token: string) =>
    `${enderecoDoApp(req.get('origin'), origens)}/convite/${token}`;
  const org = (req: Request) => req.usuario!.organizacaoId;

  r.get('/', exigirGestor, async (req, res) => {
    res.json(await repo.resumo(pool, org(req)));
  });

  r.post('/unidades', exigirGestor, async (req, res) => {
    const id = await repo.criarUnidade(pool, org(req), corpo(req, unidadeNova));
    log.info({ organizacao: org(req), unidade: id }, 'organização: unidade criada');
    res.status(201).json({ id });
  });

  r.patch('/unidades/:id', exigirGestor, async (req, res) => {
    await repo.atualizarUnidade(pool, org(req), idDaRota(req), corpo(req, unidadeAtualizar));
    res.json({ ok: true });
  });

  /** Entra na unidade: o sistema todo passa a mostrar os dados dela. */
  r.post('/unidades/:id/entrar', exigirGestor, async (req, res) => {
    const id = idDaRota(req);
    const u = req.usuario!;
    const unidade = await repo.unidadeDaOrganizacao(pool, org(req), id);
    if (!unidade.ativa && !u.master) throw AppError.invalido('Esta unidade está desativada.');
    abrirSessao(res, deps.auth, u.id, id === u.contaPropria ? null : id);
    res.json({ ok: true });
  });

  /** Volta para a própria unidade. */
  r.post('/voltar', exigirGestor, async (req, res) => {
    abrirSessao(res, deps.auth, req.usuario!.id, null);
    res.json({ ok: true });
  });

  r.post('/pessoas', exigirGestor, async (req, res) => {
    const { id, token } = await repo.criarPessoa(pool, org(req), corpo(req, pessoaNova));
    res.status(201).json({ id, convite: link(req, token), diasValidade: DIAS_CONVITE });
  });

  r.patch('/pessoas/:id', exigirGestor, async (req, res) => {
    const u = req.usuario!;
    await repo.atualizarPessoa(pool, org(req), idDaRota(req), corpo(req, pessoaAtualizar), {
      id: u.id,
      master: u.master,
    });
    res.json({ ok: true });
  });

  r.post('/pessoas/:id/convite', exigirGestor, async (req, res) => {
    const token = await repo.novoConvite(pool, org(req), idDaRota(req));
    res.json({ convite: link(req, token), diasValidade: DIAS_CONVITE });
  });

  return r;
}
