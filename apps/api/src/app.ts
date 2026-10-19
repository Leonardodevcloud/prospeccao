import cookieParser from 'cookie-parser';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { DepsApi } from './dependencias.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';
import { exigirOrigemConhecida, exigirSessao } from './middlewares/seguranca.js';
import { rotasAtividade } from './modulos/atividade/rotas.js';
import { rotasAuth } from './modulos/auth/rotas.js';
import { rotasBases } from './modulos/bases/rotas.js';
import { rotasCampanhas } from './modulos/campanhas/rotas.js';
import { rotasEmpresas } from './modulos/empresas/rotas.js';
import { rotasFunil } from './modulos/funil/rotas.js';
import { rotasImportacoes } from './modulos/importacoes/rotas.js';
import { rotasNichos } from './modulos/nichos/rotas.js';
import { rotasPlaces } from './modulos/places/rotas.js';
import { rotasRelatorios } from './modulos/relatorios/rotas.js';
import { rotasSaudeDetalhes, rotasSaudePublica } from './modulos/saude/rotas.js';

/** Monta a aplicação a partir das dependências (os testes passam as suas). */
export function criarApp(deps: DepsApi): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do proxy do Railway/Vercel: IP real para o rate limit

  app.use(helmet());
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger: deps.log,
      autoLogging: { ignore: (req) => req.url === '/saude' },
      // Uma linha curta por requisição: "GET /campanhas → 200 (12 ms)", sem os cabeçalhos todos.
      serializers: {
        req: (req: { method: string; url: string }) => ({ metodo: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ status: res.statusCode }),
      },
      customSuccessMessage: (req, res, ms) =>
        `${req.method} ${req.url} → ${res.statusCode} (${Math.round(ms)} ms)`,
      customErrorMessage: (req, res, erro) => `${req.method} ${req.url} → ${res.statusCode}: ${erro.message}`,
      customLogLevel: (_req, res, erro) =>
        erro || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.use('/saude', rotasSaudePublica(deps));
  app.use(exigirOrigemConhecida(deps.origens));
  app.use('/auth', rotasAuth(deps));

  const protegidas = Router();
  protegidas.use(exigirSessao(deps.auth.jwtSegredo));
  protegidas.use('/nichos', rotasNichos(deps));
  protegidas.use('/campanhas', rotasCampanhas(deps));
  protegidas.use('/bases', rotasBases(deps));
  protegidas.use('/empresas', rotasEmpresas(deps));
  protegidas.use('/funil', rotasFunil(deps));
  protegidas.use('/relatorios', rotasRelatorios(deps));
  protegidas.use('/importacoes', rotasImportacoes(deps));
  protegidas.use('/atividade', rotasAtividade(deps));
  protegidas.use('/places', rotasPlaces(deps));
  protegidas.use('/saude/detalhes', rotasSaudeDetalhes(deps));
  app.use(protegidas);

  app.use(rotaNaoEncontrada);
  app.use(tratarErros(deps.log));
  return app;
}
