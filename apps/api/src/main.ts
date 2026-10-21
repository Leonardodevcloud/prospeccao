import { createServer } from 'node:http';
import { criarPool, manterSinalDeVida } from '@prospeccao/db';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { criarApp } from './app.js';
import { carregarEnvApi, credenciaisDoAmbiente } from './config.js';
import { iniciarLembretes } from './modulos/agenda/lembretes.js';
import { iniciarAgente } from './modulos/agente/motor.js';
import { iniciarAlertas } from './modulos/alertas/rotina.js';
import { iniciarEmail } from './modulos/email/motor.js';
import { iniciarAutomacaoFunil } from './modulos/funil/automacao.js';
import { iniciarPush } from './modulos/push/servico.js';
import { criarServicos } from './servicos.js';

const env = carregarEnvApi();
const log = criarLogger('api', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'api', max: 10 });
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'api',
  log,
  // Filas que a API publica: criadas aqui também, para não depender da ordem de subida dos serviços.
  filas: ['campanha.iniciar', 'cnpj.importar', 'enriquecimento.solicitar', 'maps.importar_planilha'],
});

// Credenciais: as de cada conta (painel master, cifradas com CHAVE_CREDENCIAIS) e as do ambiente,
// que valem para a conta principal (e a IA, para todas as contas sem a sua).
const ambiente = credenciaisDoAmbiente(env);
const chave = env.CHAVE_CREDENCIAIS ?? null;
const { servicos, invalidar } = criarServicos(pool, chave, ambiente);
// Notificação no celular: as chaves são geradas e guardadas pelo próprio sistema.
await iniciarPush(pool, log, chave, env.ADMIN_EMAIL);
if (!chave)
  log.warn(
    'CHAVE_CREDENCIAIS não configurada: só a conta principal funciona (pelas variáveis do ambiente); o painel master não guarda chaves de outras contas.',
  );

const app = criarApp({
  pool,
  filas,
  log,
  auth: {
    jwtSegredo: env.JWT_SEGREDO,
    adminEmail: env.ADMIN_EMAIL,
    adminSenhaHash: env.ADMIN_SENHA_HASH,
    sessaoHoras: env.SESSAO_HORAS,
    cookieSeguro: env.NODE_ENV === 'production',
  },
  origens: env.APP_ORIGENS,
  servicos,
  credenciais: { chave, ambiente, invalidar },
});

const servidor = createServer(app);
servidor.listen(env.PORT, () => log.info({ porta: env.PORT }, 'api pronta'));
// Follow-up: encerra sozinho quem esgotou a cadência sem responder (conta por conta).
const pararAutomacao = iniciarAutomacaoFunil(pool, log);
// Agente de abordagem: envia, lê respostas e responde (só faz algo onde estiver ligado na tela).
const pararAgente = iniciarAgente({ pool, log, servicos }, log);
// Agenda: lembrete da reunião para o lead (WhatsApp) e aviso para o vendedor.
const pararLembretes = iniciarLembretes({ pool, log, servicos });
// E-mail de prospecção: envia as campanhas de cada conta pelo Resend dela.
const pararEmail = iniciarEmail({ pool, log, servicos, origens: env.APP_ORIGENS });
// Alertas: confere o que costuma quebrar (e-mail, chips, IA, workers) e avisa quem cuida.
const pararAlertas = iniciarAlertas({ pool, log, servicos });
const pararSinal = manterSinalDeVida(pool, 'api');

encerrarAoReceberSinal(log, async () => {
  pararAutomacao();
  pararAgente();
  pararLembretes();
  pararEmail();
  pararAlertas();
  pararSinal();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await filas.parar();
  await pool.end();
});
