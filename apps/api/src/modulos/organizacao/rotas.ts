import {
  AppError,
  marcaEntrada,
  pessoaAtualizar,
  pessoaNova,
  segurancaOrganizacao,
  unidadeAtualizar,
  unidadeNova,
} from '@prospeccao/shared';
import { type Request, Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { enderecoDoApp } from '../../endereco.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirGestor } from '../../middlewares/seguranca.js';
import { exigirRecurso } from '../../recursos.js';
import { abrirSessao } from '../auth/sessao.js';
import { DIAS_CONVITE } from '../equipe/repositorio.js';
import * as painel from './painel.js';
import { gerarPdf } from './pdf.js';
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
  const filtroPeriodo = (req: Request) => ({
    dias: Number(req.query.dias) || undefined,
    mes: typeof req.query.mes === 'string' ? req.query.mes : undefined,
  });

  /** Logo da organização (todo mundo dela vê no menu). */
  r.get('/marca/logo', async (req, res) => {
    const l = await repo.logo(pool, org(req));
    if (!l) throw AppError.naoEncontrado('Logo');
    res.setHeader('Content-Type', l.tipo);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(l.dados);
  });

  r.put('/marca', exigirGestor, async (req, res) => {
    await exigirRecurso(pool, 'marca');
    await repo.salvarMarca(pool, org(req), corpo(req, marcaEntrada));
    log.info({ organizacao: org(req) }, 'organização: marca salva');
    res.json({ ok: true });
  });

  /** Exigir verificação em duas etapas de todo mundo da organização. */
  r.put('/seguranca', exigirGestor, async (req, res) => {
    const { exigirDuasEtapas } = corpo(req, segurancaOrganizacao);
    if (exigirDuasEtapas) await exigirRecurso(pool, 'seguranca');
    const u = req.usuario!;
    if (exigirDuasEtapas && !u.master) {
      const { rows } = await pool.query<{ ativo: boolean }>(
        'SELECT totp_ativo AS ativo FROM cadastro.usuarios WHERE id = $1',
        [u.id],
      );
      if (!rows[0]?.ativo)
        throw AppError.invalido(
          'Ligue a verificação em duas etapas na sua conta antes de exigir dos outros.',
        );
    }
    await pool.query('UPDATE cadastro.organizacoes SET exigir_2fa = $2 WHERE id = $1', [
      org(req),
      exigirDuasEtapas,
    ]);
    res.json({ ok: true });
  });

  r.post('/pessoas/:id/zerar-duas-etapas', exigirGestor, async (req, res) => {
    await repo.zerarDuasEtapas(pool, org(req), idDaRota(req));
    res.json({ ok: true });
  });

  r.get('/', exigirGestor, async (req, res) => {
    res.json(await repo.resumo(pool, org(req)));
  });

  /** Painel do gestor: a organização somada, por unidade e por pessoa, no período. */
  r.get('/painel', exigirGestor, async (req, res) => {
    res.json(await painel.painel(pool, org(req), painel.periodo(filtroPeriodo(req))));
  });

  /** O mesmo painel em PDF, para a diretoria. */
  r.get('/relatorio.pdf', exigirGestor, async (req, res) => {
    const p = painel.periodo(filtroPeriodo(req));
    const [dados, nome] = await Promise.all([
      painel.painel(pool, org(req), p),
      pool.query<{ nome: string }>('SELECT nome FROM cadastro.organizacoes WHERE id = $1', [org(req)]),
    ]);
    const m = await repo.marca(pool, org(req));
    const logo = await repo.logo(pool, org(req));
    const organizacao = m?.marca_nome || nome.rows[0]?.nome || 'Organização';
    const pdf = await gerarPdf(dados, organizacao, { cor: m?.marca_cor, logo: logo?.dados ?? null });
    const arquivo = `relatorio-${organizacao}-${p.rotulo}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo}.pdf"`);
    res.send(pdf);
  });

  r.post('/unidades', exigirGestor, async (req, res) => {
    await exigirRecurso(pool, 'unidades');
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
    abrirSessao(res, deps.auth, u.id, id === u.contaPropria ? null : id, u.sessaoId);
    res.json({ ok: true });
  });

  /** Volta para a própria unidade. */
  r.post('/voltar', exigirGestor, async (req, res) => {
    abrirSessao(res, deps.auth, req.usuario!.id, null, req.usuario!.sessaoId);
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
