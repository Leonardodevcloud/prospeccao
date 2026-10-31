import { AppError, dominioEntrada, marcaEntrada } from '@prospeccao/shared';
import { configFundosEntrada, fotoFundoEntrada } from '@prospeccao/shared/fundos';
import { type Request, Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { exigirRecurso, temRecurso } from '../../recursos.js';
import * as auditoria from '../auditoria/repositorio.js';
import { salvarMarca } from '../organizacao/repositorio.js';
import * as fundos from './fundos.js';
import * as repo from './repositorio.js';
import { type DominiosSite, dominiosDoAmbiente } from './vercel.js';

/**
 * Marca e domínio do cliente (tela Marca e domínio): o gestor da organização, ou o administrador
 * quando ela tem uma unidade só. Tudo vale para a organização inteira.
 */
export function rotasMarca(deps: DepsApi & { dominiosSite?: DominiosSite | null }): Router {
  const { pool, log, origens } = deps;
  const r = Router();
  const site = () =>
    deps.dominiosSite !== undefined ? deps.dominiosSite : dominiosDoAmbiente(deps.credenciais.ambiente);
  const org = (req: Request) => req.usuario!.organizacaoId;
  const exigirDono = async (req: Request) => {
    if (!(await repo.podeEditar(pool, req.usuario!)))
      throw AppError.proibido('Só o gestor da organização muda a marca e o domínio.');
    await exigirRecurso(pool, 'marca');
  };
  const registrar = (req: Request, descricao: string) =>
    auditoria.registrar(pool, {
      contaId: req.usuario!.contaId,
      usuarioId: req.usuario!.id,
      usuarioNome: req.usuario!.nome,
      comoMaster: req.usuario!.master,
      acao: 'marca',
      descricao,
      metodo: req.method,
      caminho: req.baseUrl + req.path,
    });

  /** O que a tela mostra (o mesmo em todas as respostas, para a tela só trocar os dados). */
  const tela = async (req: Request) => ({
    ...(await repo.dados(pool, org(req))),
    podeEditar: await repo.podeEditar(pool, req.usuario!),
    // A plataforma tem o Vercel configurado (sem isso, o domínio próprio fica indisponível).
    dominioDisponivel: !!site(),
  });

  r.get('/', async (req, res) => {
    res.json(await tela(req));
  });

  /** Logo, ícone e imagem de divulgação (para a prévia na tela). */
  r.get('/arquivo/:tipo', async (req, res) => {
    const tipo = String(req.params.tipo) as repo.ArquivoMarca;
    if (!repo.ARQUIVOS_MARCA.includes(tipo)) throw AppError.naoEncontrado('Arquivo');
    const a = await repo.arquivo(pool, org(req), tipo);
    if (!a) throw AppError.naoEncontrado('Arquivo');
    res.setHeader('Content-Type', a.tipo);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(a.dados);
  });

  r.put('/', async (req, res) => {
    await exigirDono(req);
    await salvarMarca(pool, org(req), corpo(req, marcaEntrada));
    await registrar(req, 'Mudou a marca (nome, cor ou imagens).');
    log.info({ organizacao: org(req) }, 'marca: salva');
    res.json(await tela(req));
  });

  /** Domínio próprio: cadastra no Vercel e devolve o registro que o cliente cria no DNS. */
  r.post('/dominio', async (req, res) => {
    await exigirDono(req);
    const s = site();
    if (!s)
      throw AppError.invalido(
        'O domínio próprio ainda não está disponível na plataforma. Fale com o suporte.',
      );
    const { dominio } = corpo(req, dominioEntrada);
    if (repo.dominioDaPlataforma(dominio, origens))
      throw AppError.invalido('Use um endereço da sua empresa (por exemplo, crm.suaempresa.com.br).');
    await repo.definirDominio(pool, s, org(req), dominio);
    await registrar(req, `Configurou o domínio próprio ${dominio}.`);
    log.info({ organizacao: org(req), dominio }, 'marca: domínio cadastrado');
    res.json(await tela(req));
  });

  r.post('/dominio/conferir', async (req, res) => {
    await exigirDono(req);
    const s = site();
    if (!s)
      throw AppError.invalido(
        'O domínio próprio ainda não está disponível na plataforma. Fale com o suporte.',
      );
    if (await repo.conferirDominio(pool, s, org(req)))
      log.info({ organizacao: org(req) }, 'marca: domínio ativo');
    res.json(await tela(req));
  });

  r.delete('/dominio', async (req, res) => {
    await exigirDono(req);
    const antes = (await repo.dados(pool, org(req))).dominio?.endereco;
    await repo.removerDominio(pool, site(), org(req));
    if (antes) await registrar(req, `Tirou o domínio próprio ${antes}.`);
    res.json(await tela(req));
  });

  /* ---------- Fundos das reuniões ---------- */

  const telaFundos = async (req: Request) => {
    const d = await repo.dados(pool, org(req));
    return {
      config: await fundos.config(pool, org(req)),
      fotos: await fundos.fotos(pool, org(req)),
      limiteFotos: fundos.LIMITE_FOTOS,
      podeEditar: await repo.podeEditar(pool, req.usuario!),
      // Fundos com a logo são da marca própria (o desfoque e os cenários sem logo valem para todos).
      comMarca: await temRecurso(pool, 'marca'),
      logo: d.logo ? `/marca/arquivo/logo?v=${d.versao}` : null,
      cor: d.cor,
    };
  };

  r.get('/fundos', async (req, res) => {
    res.json(await telaFundos(req));
  });

  r.put('/fundos', async (req, res) => {
    await exigirDono(req);
    await fundos.salvarConfig(pool, org(req), corpo(req, configFundosEntrada));
    await registrar(req, 'Mudou os fundos das reuniões.');
    res.json(await telaFundos(req));
  });

  r.post('/fundos/fotos', async (req, res) => {
    await exigirDono(req);
    const f = await fundos.adicionarFoto(pool, org(req), corpo(req, fotoFundoEntrada));
    await registrar(req, `Enviou a foto de fundo "${f.nome}".`);
    res.status(201).json(await telaFundos(req));
  });

  r.delete('/fundos/fotos/:id', async (req, res) => {
    await exigirDono(req);
    await fundos.removerFoto(pool, org(req), Number(req.params.id) || 0);
    await registrar(req, 'Tirou uma foto de fundo.');
    res.json(await telaFundos(req));
  });

  r.get('/fundos/fotos/:id', async (req, res) => {
    const f = await fundos.imagemDaFoto(pool, org(req), Number(req.params.id) || 0);
    if (!f) throw AppError.naoEncontrado('Foto');
    res.setHeader('Content-Type', f.tipo);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.imagem);
  });

  return r;
}
