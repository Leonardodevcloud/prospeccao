import {
  AppError,
  atividadeApiEntrada,
  avisoEntrada,
  cnpjDoTexto,
  type LeadApiEntrada,
  leadApiAtualizar,
  leadApiEntrada,
  type PermissaoApi,
} from '@prospeccao/shared';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from 'express';
import { z } from 'zod';
import { comConta, contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { enderecoDoApp, urlPublicaApi } from '../../endereco.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirRecurso } from '../../recursos.js';
import { registrar } from '../auditoria/repositorio.js';
import * as pipelines from '../funil/pipelines.js';
import * as funil from '../funil/repositorio.js';
import * as avisos from './avisos.js';
import { autenticar, type ChaveAutenticada, contarUso } from './chaves.js';
import * as formularios from './formularios.js';
import { conferirDestino, criarOuJuntar, exigirLeadApi, type LeadApi, leadApi, leadsApi } from './leads.js';
import { documentoOpenApi } from './openapi.js';

/**
 * API pública v1 (/v1): a chave no cabeçalho diz a conta; tudo roda dentro dela, como o sistema,
 * com o nome da chave como autor. Fica fora da sessão e da conferência de origem do navegador.
 */

declare global {
  namespace Express {
    interface Request {
      chaveApi?: ChaveAutenticada;
    }
  }
}

const BASE = '/v1';

/** O ip de quem chamou (atrás do proxy do Railway/Vercel). */
const ipDe = (req: Request) => (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

/** Formulários e a descrição da API podem ser chamados de qualquer site (sem cookie, sem credencial). */
const cors: RequestHandler = (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return void res.status(204).end();
  next();
};

const exigir =
  (p: PermissaoApi): RequestHandler =>
  (req, _res, next) => {
    next(
      req.chaveApi?.permissoes.includes(p)
        ? undefined
        : new AppError(
            403,
            'sem_permissao',
            `Esta chave não tem a permissão "${p}". Ajuste em Gestão › Integrações.`,
          ),
    );
  };

const assincrono =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function rotasApiV1(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  const json = express.json({ limit: '200kb' });
  const formulario = express.urlencoded({ extended: true, limit: '200kb' });

  const link = (contaId: number, empresaId: number) =>
    `${enderecoDoApp(undefined, deps.origens, contaId)}/funil?empresa=${empresaId}`;
  const comLink = (contaId: number, l: LeadApi) => ({ ...l, link: link(contaId, l.id) });
  const autor = (req: Request) => `API · ${req.chaveApi!.nome}`;
  const auditar = (req: Request, descricao: string, empresaId: number | null = null) =>
    registrar(pool, {
      contaId: req.chaveApi!.contaId,
      usuarioId: null,
      usuarioNome: autor(req),
      acao: 'api',
      descricao,
      metodo: req.method,
      caminho: `${BASE}${req.path}`,
      empresaId,
      ip: ipDe(req),
    }).catch((e) => deps.log.warn({ err: e }, 'api: não deu para registrar na auditoria'));

  /* ───── Sem chave ───── */

  r.get('/openapi.json', cors, (_req, res) => {
    res.json(documentoOpenApi(`${urlPublicaApi(deps.origens)}${BASE}`));
  });

  // Formulário do site: a chave do endereço diz a conta.
  r.options('/entrada/:chave', cors);
  r.post(
    '/entrada/:chave',
    cors,
    json,
    formulario,
    assincrono(async (req, res) => {
      const chave = String(req.params.chave);
      if (!/^f_[\w-]{6,40}$/.test(chave)) throw AppError.naoEncontrado('Formulário');
      const r2 = await formularios.receber(deps, chave, req.body, ipDe(req));
      // Formulário HTML comum (o navegador espera uma página): volta para o site.
      const html =
        req.is('application/x-www-form-urlencoded') && (req.get('accept') ?? '').includes('text/html');
      if (html) {
        if (r2.redirecionar) return void res.redirect(303, r2.redirecionar);
        return void res
          .status(200)
          .type('html')
          .send(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Recebido</title>' +
              '<body style="font-family:system-ui;max-width:520px;margin:15vh auto;padding:0 20px;text-align:center">' +
              '<h1 style="font-size:22px">Recebemos o seu contato. Obrigado!</h1>' +
              '<p style="color:#555">Logo alguém do nosso time fala com você.</p>' +
              '<p><a href="javascript:history.back()">Voltar</a></p></body>',
          );
      }
      res
        .status(r2.resultado === 'erro' ? 422 : 201)
        .json(
          r2.resultado === 'erro'
            ? { erro: { codigo: 'envio_invalido', mensagem: r2.mensagem ?? 'Envio inválido.' } }
            : { recebido: true },
        );
    }),
  );

  // Experimentar (a documentação): confere o pedido de criar lead sem gravar nada.
  r.options('/experimentar/leads', cors);
  r.post(
    '/experimentar/leads',
    cors,
    json,
    assincrono(async (req, res) => {
      const d = corpo(req, leadApiEntrada);
      res.status(201).json({
        id: 48231,
        duplicado: false,
        empresa: d.empresa,
        etapa: { id: 3, nome: 'A abordar', papel: 'a_abordar' },
        responsavel: { id: 7, nome: 'Diego Martins' },
        contato: {
          nome: d.contato?.nome ?? null,
          cargo: d.contato?.cargo ?? null,
          telefone: d.contato?.telefone ?? null,
          email: d.contato?.email ?? null,
        },
        aviso: 'Teste: o pedido está certo, mas nada foi gravado (é o CRM de demonstração).',
      });
    }),
  );

  /* ───── Com chave ───── */

  r.use(json);
  r.use((req, res, next) => {
    autenticar(pool, req.get('authorization'), ipDe(req)).then((c) => {
      req.chaveApi = c;
      // Erros contam no uso do dia (a tela mostra).
      res.on('finish', () => {
        if (res.statusCode >= 400) void contarUso(pool, c.contaId, 'erros').catch(() => undefined);
      });
      comConta(c.contaId, () => {
        exigirRecurso(pool, 'api').then(() => next(), next);
      });
    }, next);
  });

  // Idempotency-Key: o mesmo pedido repetido devolve a mesma resposta (por 24 h).
  r.use((req: Request, res: Response, next: NextFunction) => {
    const chave = req.get('idempotency-key')?.trim();
    if (req.method !== 'POST' || !chave) return next();
    if (chave.length > 120) return next(AppError.invalido('Idempotency-Key com mais de 120 caracteres.'));
    const rota = `${req.method} ${req.path}`;
    pool
      .query<{ rota: string; status: number; resposta: unknown }>(
        `SELECT rota, status, resposta FROM comercial.api_idempotencia
          WHERE conta_id = ${contaSql()} AND chave = $1 AND criado_em > now() - interval '24 hours'`,
        [chave],
      )
      .then(({ rows }) => {
        const ja = rows[0];
        if (ja) {
          if (ja.rota !== rota)
            return next(AppError.conflito('Esta Idempotency-Key já foi usada em outro pedido.'));
          res.set('Idempotent-Replayed', 'true');
          return void res.status(ja.status).json(ja.resposta);
        }
        const original = res.json.bind(res);
        res.json = (b: unknown) => {
          if (res.statusCode < 500)
            void pool
              .query(
                `INSERT INTO comercial.api_idempotencia (conta_id, chave, rota, status, resposta)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (conta_id, chave) DO UPDATE SET rota = EXCLUDED.rota, status = EXCLUDED.status,
                        resposta = EXCLUDED.resposta, criado_em = now()`,
                [req.chaveApi!.contaId, chave, rota, res.statusCode, JSON.stringify(b)],
              )
              .catch(() => undefined);
          return original(b);
        };
        next();
      }, next);
  });

  r.get(
    '/',
    assincrono(async (req, res) => {
      const { rows } = await pool.query<{ nome: string }>(
        `SELECT nome FROM cadastro.contas WHERE id = ${contaSql()}`,
      );
      res.json({
        conta: { id: req.chaveApi!.contaId, nome: rows[0]?.nome ?? null },
        chave: { nome: req.chaveApi!.nome, permissoes: req.chaveApi!.permissoes },
      });
    }),
  );

  /* ───── Leads ───── */

  r.post(
    '/leads',
    exigir('leads:criar'),
    assincrono(async (req, res) => {
      const d: LeadApiEntrada = corpo(req, leadApiEntrada);
      await conferirDestino(pool, { etapaId: d.etapaId, responsavelId: d.responsavelId });
      const origem = d.origem ? Object.entries(d.origem).map(([k, v]) => `${k}: ${v}`) : [];
      const campos = d.campos
        ? Object.entries(d.campos)
            .filter(([, v]) => v != null && String(v).trim())
            .map(([k, v]) => `${k}: ${v}`)
        : [];
      const observacao = [d.nota, ...campos, origem.length ? `Origem: ${origem.join(' · ')}` : null]
        .filter(Boolean)
        .join('\n');
      const { empresaId, novo } = await criarOuJuntar(
        deps,
        {
          empresa: d.empresa,
          contato: d.contato?.nome,
          cargo: d.contato?.cargo,
          telefone: d.contato?.telefone,
          email: d.contato?.email,
          cnpj: d.cnpj,
          cidade: d.cidade,
          uf: d.uf,
          site: d.site,
          observacao,
        },
        {
          etapaId: d.etapaId,
          responsavelId: d.responsavelId,
          etiquetas: d.etiquetas,
          valorMensal: d.valorMensal,
        },
        autor(req),
        `Chegou de novo pela API (${req.chaveApi!.nome}).`,
      );
      await contarUso(pool, req.chaveApi!.contaId, novo ? 'leads_criados' : 'duplicados');
      if (novo) await auditar(req, `Cadastrou o lead “${d.empresa.slice(0, 80)}” pela API`, empresaId);
      const l = await exigirLeadApi(pool, empresaId);
      res.status(novo ? 201 : 200).json({ ...comLink(req.chaveApi!.contaId, l), duplicado: !novo });
    }),
  );

  r.get(
    '/leads',
    exigir('leads:ler'),
    assincrono(async (req, res) => {
      const f = consulta(
        req,
        z.object({
          etapaId: z.coerce.number().int().positive().optional(),
          responsavelId: z.coerce.number().int().positive().optional(),
          atualizadoDesde: z.string().datetime({ offset: true }).optional(),
          busca: z.string().trim().min(1).max(80).optional(),
          telefone: z.string().trim().max(30).optional(),
          email: z.string().trim().max(160).optional(),
          cnpj: z.string().trim().max(30).optional(),
          limite: z.coerce.number().int().min(1).max(100).default(50),
          depois: z.coerce.number().int().positive().optional(),
        }),
      );
      const where: string[] = [`o.etapa <> 'descartado'`];
      const valores: unknown[] = [];
      const p = (v: unknown) => {
        valores.push(v);
        return `$${valores.length}`;
      };
      if (f.etapaId) where.push(`o.etapa_id = ${p(f.etapaId)}`);
      if (f.responsavelId) where.push(`o.responsavel_id = ${p(f.responsavelId)}`);
      if (f.atualizadoDesde) where.push(`o.atualizado_em >= ${p(f.atualizadoDesde)}`);
      if (f.busca) where.push(`(e.nome ILIKE ${p(`%${f.busca}%`)} OR e.maps_nome ILIKE $${valores.length})`);
      if (f.depois) where.push(`o.empresa_id < ${p(f.depois)}`);
      if (f.cnpj) where.push(`e.cnpj = ${p(cnpjDoTexto(f.cnpj) ?? f.cnpj.replace(/\D/g, ''))}`);
      if (f.telefone) {
        const d = f.telefone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
        where.push(
          `EXISTS (SELECT 1 FROM enriquecimento.contatos c WHERE c.empresa_id = o.empresa_id
                     AND c.canal IN ('whatsapp', 'telefone') AND right(regexp_replace(c.valor, '\\D', '', 'g'), 8) = ${p(d.slice(-8))}
                     AND left(regexp_replace(c.valor, '\\D', '', 'g'), 2) = ${p(d.slice(0, 2))} AND c.conta_id IN (0, ${contaSql()}))`,
        );
      }
      if (f.email)
        where.push(
          `EXISTS (SELECT 1 FROM enriquecimento.contatos c WHERE c.empresa_id = o.empresa_id AND c.canal = 'email'
                     AND lower(c.valor) = ${p(f.email.toLowerCase())} AND c.conta_id IN (0, ${contaSql()}))`,
        );
      const dados = await leadsApi(pool, where, valores, f.limite + 1);
      const mais = dados.length > f.limite;
      const pagina = dados.slice(0, f.limite);
      res.json({
        dados: pagina.map((l) => comLink(req.chaveApi!.contaId, l)),
        proximo: mais ? (pagina[pagina.length - 1]?.id ?? null) : null,
      });
    }),
  );

  r.get(
    '/leads/:id',
    exigir('leads:ler'),
    assincrono(async (req, res) => {
      const id = idDaRota(req);
      const l = await exigirLeadApi(pool, id);
      const C = contaSql();
      const [pessoas, atividades] = await Promise.all([
        pool.query(
          `SELECT id::int, nome, cargo, telefone, email, decisor, status FROM comercial.contatos_lead
            WHERE conta_id = ${C} AND empresa_id = $1 AND status <> 'descartado' ORDER BY decisor DESC, criado_em`,
          [id],
        ),
        pool.query(
          `SELECT id::int, tipo, direcao, texto, autor, criado_em AS "criadoEm" FROM comercial.atividades
            WHERE conta_id = ${C} AND empresa_id = $1 ORDER BY criado_em DESC LIMIT 20`,
          [id],
        ),
      ]);
      res.json({ ...comLink(req.chaveApi!.contaId, l), pessoas: pessoas.rows, atividades: atividades.rows });
    }),
  );

  r.patch(
    '/leads/:id',
    exigir('leads:mover'),
    assincrono(async (req, res) => {
      const id = idDaRota(req);
      const d = corpo(req, leadApiAtualizar);
      await exigirLeadApi(pool, id);
      await conferirDestino(pool, { etapaId: d.etapaId, responsavelId: d.responsavelId ?? null });
      await funil.atualizar(pool, id, d, autor(req));
      const partes = [
        d.etapaId ? 'mudou a etapa' : null,
        d.responsavelId !== undefined ? 'trocou o responsável' : null,
        d.valorMensal !== undefined ? 'alterou o valor' : null,
        d.proximaAcao !== undefined || d.proximaAcaoEm !== undefined ? 'mudou o próximo passo' : null,
        d.etiquetas ? 'mudou as etiquetas' : null,
      ].filter(Boolean);
      await auditar(req, `Pela API: ${partes.join(', ') || 'editou o lead'}`, id);
      res.json(comLink(req.chaveApi!.contaId, (await leadApi(pool, id))!));
    }),
  );

  r.post(
    '/leads/:id/atividades',
    exigir('atividades'),
    assincrono(async (req, res) => {
      const id = idDaRota(req);
      const d = corpo(req, atividadeApiEntrada);
      await exigirLeadApi(pool, id);
      const r2 = await funil.registrarAtividade(
        pool,
        id,
        {
          tipo: d.tipo,
          direcao: d.tipo === 'nota' ? null : (d.direcao ?? 'enviada'),
          texto: d.texto ?? undefined,
          contato: d.contato ?? undefined,
          proximaAcao: d.proximaAcao ?? undefined,
          proximaAcaoEm: d.proximaAcaoEm ?? undefined,
        },
        autor(req),
      );
      await auditar(
        req,
        d.tipo === 'nota' ? 'Escreveu uma nota pela API' : `Registrou ${d.tipo} pela API`,
        id,
      );
      res.status(201).json({ ok: true, etapa: r2.etapa });
    }),
  );

  /* ───── Funil e equipe ───── */

  r.get(
    '/funis',
    exigir('funil:ler'),
    assincrono(async (_req, res) => {
      const ps = (await pipelines.listar(pool)) as {
        id: number;
        nome: string;
        ordem: number;
        etapas: unknown[];
      }[];
      res.json({ dados: ps.map((x) => ({ id: x.id, nome: x.nome, ordem: x.ordem, etapas: x.etapas })) });
    }),
  );

  r.get(
    '/usuarios',
    exigir('funil:ler'),
    assincrono(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT id, nome, email, papel, ativo FROM cadastro.usuarios WHERE conta_id = ${contaSql()}
          ORDER BY ativo DESC, nome`,
      );
      res.json({ dados: rows });
    }),
  );

  /* ───── Avisos (Make/Zapier se inscrevem sozinhos) ───── */

  const opcoesAvisos = () => ({ chave: deps.credenciais.chave });

  r.get(
    '/avisos',
    exigir('avisos'),
    assincrono(async (_req, res) => {
      const lista = (await avisos.listar(pool)) as Record<string, unknown>[];
      res.json({
        dados: lista.map((a) => ({
          id: a.id,
          nome: a.nome,
          url: a.url,
          eventos: a.eventos,
          situacao: a.situacao,
        })),
      });
    }),
  );

  r.post(
    '/avisos',
    exigir('avisos'),
    assincrono(async (req, res) => {
      const d = corpo(req, avisoEntrada.extend({ nome: avisoEntrada.shape.nome.optional() }));
      const nome = d.nome ?? `Pela API (${req.chaveApi!.nome})`;
      const r2 = await avisos.criar(pool, opcoesAvisos(), { ...d, nome }, req.chaveApi!.id);
      await auditar(req, `Criou o aviso “${nome}” pela API`);
      res.status(201).json({ id: r2.id, nome, url: d.url, eventos: d.eventos, segredo: r2.segredo });
    }),
  );

  r.delete(
    '/avisos/:id',
    exigir('avisos'),
    assincrono(async (req, res) => {
      await avisos.apagar(pool, idDaRota(req), req.chaveApi!.id);
      await auditar(req, 'Apagou um aviso pela API');
      res.status(204).end();
    }),
  );

  return r;
}
