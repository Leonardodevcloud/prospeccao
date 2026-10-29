import cookieParser from 'cookie-parser';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { DepsApi } from './dependencias.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';
import {
  adminParaAlterar,
  exigirDuasEtapas,
  exigirEscrita,
  exigirMaster,
  exigirOrigemConhecida,
  exigirSessao,
} from './middlewares/seguranca.js';
import { rotasAgenda, rotasCalendario } from './modulos/agenda/rotas.js';
import { rotasAgente, rotasWebhook } from './modulos/agente/rotas.js';
import { rotasAlertas } from './modulos/alertas/rotas.js';
import { rotasAssistente } from './modulos/assistente/rotas.js';
import { rotasAtividade } from './modulos/atividade/rotas.js';
import { auditar } from './modulos/auditoria/middleware.js';
import { rotasAuditoria } from './modulos/auditoria/rotas.js';
import { rotasAuth } from './modulos/auth/rotas.js';
import { rotasBases } from './modulos/bases/rotas.js';
import { rotasCampanhas } from './modulos/campanhas/rotas.js';
import { rotasConversas } from './modulos/conversas/rotas.js';
import { rotasDominioEmail } from './modulos/email/dominio.js';
import { rotasEmailPublico, rotasWebhookResend } from './modulos/email/publico.js';
import { rotasEmail } from './modulos/email/rotas.js';
import { rotasEmpresas } from './modulos/empresas/rotas.js';
import { rotasEquipe } from './modulos/equipe/rotas.js';
import { rotasExportar } from './modulos/exportar/rotas.js';
import { rotasFunil } from './modulos/funil/rotas.js';
import { rotasImportacaoLeads } from './modulos/importacao-leads/rotas.js';
import { rotasImportacoes } from './modulos/importacoes/rotas.js';
import { rotasInicio } from './modulos/inicio/rotas.js';
import { rotasLgpd } from './modulos/lgpd/rotas.js';
import { rotasMaster } from './modulos/master/rotas.js';
import { rotasNichos } from './modulos/nichos/rotas.js';
import { rotasNotificacoes } from './modulos/notificacoes/rotas.js';
import { rotasOrganizacao } from './modulos/organizacao/rotas.js';
import { rotasPlaces } from './modulos/places/rotas.js';
import { rotasPlataforma } from './modulos/plataforma/rotas.js';
import { rotasRelatorios } from './modulos/relatorios/rotas.js';
import { rotasSaudeDetalhes, rotasSaudePublica } from './modulos/saude/rotas.js';
import { rotasSiteMaster, rotasSitePublico } from './modulos/site/rotas.js';

/** Monta a aplicação a partir das dependências (os testes passam as suas). */
export function criarApp(deps: DepsApi): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do proxy do Railway/Vercel: IP real para o rate limit

  app.use(helmet());
  // Webhook do WhatsApp: vem da Evolution (sem origem do navegador, sem sessão); protegido por token.
  // Antes do limite de 200 kb: mensagem com mídia chega grande.
  app.use('/webhooks', express.json({ limit: '10mb' }), rotasWebhook(deps));
  // Webhook do Resend: corpo cru (a assinatura é conferida sobre os bytes exatos).
  app.use('/e/resend', rotasWebhookResend(deps));
  // Anexo da conversa e do e-mail (até 10 MB em base64) e imagem da marca são os corpos grandes;
  // o resto fica em 200 kb.
  const jsonGrande = express.json({ limit: '15mb' });
  const jsonPequeno = express.json({ limit: '200kb' });
  // Lista de leads para importar (até 15 MB em base64).
  const jsonPlanilha = express.json({ limit: '21mb' });
  app.use((req, res, next) =>
    req.path === '/importacoes-leads/analisar'
      ? jsonPlanilha(req, res, next)
      : /^\/conversas\/\d+\/midia$|^\/email\/(anexos|imagens)$|^\/agente\/conhecimento\/arquivo$/.test(
            req.path,
          )
        ? jsonGrande(req, res, next)
        : jsonPequeno(req, res, next),
  );
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
  // Agenda por link secreto, para o Google Agenda assinar (sem login).
  app.use('/calendario', rotasCalendario(deps));
  // Abertura, clique e "sair da lista" dos e-mails (o leitor do lead não tem login nem origem).
  app.use('/e', rotasEmailPublico(deps));
  // Formulário do site institucional (outro domínio, sem login): limite por IP e campo-isca.
  app.use('/site', rotasSitePublico(deps));
  app.use(exigirOrigemConhecida(deps.origens));
  app.use('/auth', rotasAuth(deps));

  const protegidas = Router();
  protegidas.use(exigirSessao(deps.auth.jwtSegredo, deps.pool));
  // Organização que exige duas etapas: sem configurar, só a conta da pessoa funciona (em /auth).
  protegidas.use(exigirDuasEtapas);
  // Acesso só de leitura (diretoria): vê tudo, não altera nada.
  protegidas.use(exigirEscrita);
  // Quem fez o quê: toda alteração que deu certo fica registrada (depois da resposta).
  protegidas.use(auditar(deps.pool, deps.log));
  // Configuração que gasta dinheiro ou muda a operação: todos veem, só o administrador altera.
  protegidas.use('/nichos', adminParaAlterar, rotasNichos(deps));
  protegidas.use('/campanhas', adminParaAlterar, rotasCampanhas(deps));
  protegidas.use('/bases', adminParaAlterar, rotasBases(deps));
  protegidas.use('/empresas', rotasEmpresas(deps));
  protegidas.use('/funil', rotasFunil(deps));
  protegidas.use('/agente', rotasAgente(deps));
  protegidas.use('/relatorios', rotasRelatorios(deps));
  protegidas.use('/importacoes', adminParaAlterar, rotasImportacoes(deps));
  protegidas.use('/importacoes-leads', rotasImportacaoLeads(deps));
  protegidas.use('/equipe', rotasEquipe(deps));
  protegidas.use('/inicio', rotasInicio(deps));
  protegidas.use('/organizacao', rotasOrganizacao(deps));
  protegidas.use('/lgpd', rotasLgpd(deps));
  protegidas.use('/notificacoes', rotasNotificacoes(deps));
  protegidas.use('/conversas', rotasConversas(deps));
  protegidas.use('/agenda', rotasAgenda(deps));
  protegidas.use('/email/dominio', rotasDominioEmail(deps));
  protegidas.use('/email', rotasEmail(deps));
  protegidas.use('/atividade', rotasAtividade(deps));
  protegidas.use('/places', rotasPlaces(deps));
  protegidas.use('/auditoria', rotasAuditoria(deps));
  protegidas.use('/exportar', rotasExportar(deps));
  protegidas.use('/alertas', rotasAlertas(deps));
  protegidas.use('/saude/detalhes', rotasSaudeDetalhes(deps));
  // Argos: o assistente (segundo cérebro), só leitura e só no escopo de quem pergunta.
  protegidas.use('/assistente', rotasAssistente(deps));
  // Painel master: contas, credenciais e acesso a qualquer conta.
  protegidas.use('/master/site', exigirMaster, rotasSiteMaster(deps));
  protegidas.use('/master/plataforma', exigirMaster, rotasPlataforma(deps));
  protegidas.use('/master', exigirMaster, rotasMaster(deps));
  app.use(protegidas);

  app.use(rotaNaoEncontrada);
  app.use(tratarErros(deps.log));
  return app;
}
