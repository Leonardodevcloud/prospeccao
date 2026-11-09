import { createServer } from 'node:http';
import { criarPool, iniciarMedidor, manterSinalDeVida } from '@prospeccao/db';
import { criarServicoCobranca } from '@prospeccao/integrations/cobranca';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { criarApp } from './app.js';
import { carregarEnvApi, credenciaisDoAmbiente } from './config.js';
import { manterDominios } from './dominios.js';
import { iniciarLembretes } from './modulos/agenda/lembretes.js';
import { iniciarAgente } from './modulos/agente/motor.js';
import { iniciarAlertas } from './modulos/alertas/rotina.js';
import { iniciarAssinaturas } from './modulos/assinatura/servico.js';
import { prepararAssistente } from './modulos/assistente/preparar.js';
import { iniciarAtendimento } from './modulos/atendimento/avaliacao.js';
import { iniciarTimeCarrosseis, prepararCarrosseisIa } from './modulos/carrosseis/time.js';
import { iniciarEmail } from './modulos/email/motor.js';
import { iniciarAutomacaoFunil } from './modulos/funil/automacao.js';
import { iniciarImportacaoLeads } from './modulos/importacao-leads/rotina.js';
import { iniciarConteudo } from './modulos/instagram/conteudo.js';
import { iniciarConversoes } from './modulos/instagram/conversoes.js';
import { iniciarAvisos } from './modulos/integracoes/avisos.js';
import { prepararTelefonia } from './modulos/ligacoes/preparar.js';
import { iniciarLigacoes } from './modulos/ligacoes/processar.js';
import { iniciarDominios } from './modulos/marca/rotina.js';
import { dominiosDoAmbiente } from './modulos/marca/vercel.js';
import { iniciarPlanos } from './modulos/plano/rotina.js';
import { iniciarPorteiro } from './modulos/porteiro/risco.js';
import { iniciarPush } from './modulos/push/servico.js';
import { iniciarQuadros } from './modulos/quadros/leitura.js';
import { prepararReunioes } from './modulos/reunioes/preparar.js';
import { iniciarProcessamento } from './modulos/reunioes/processar.js';
import { criarServicos } from './servicos.js';

const env = carregarEnvApi();
const log = criarLogger('api', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'api', max: 10 });
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'api',
  log,
  // Filas que a API publica: criadas aqui também, para não depender da ordem de subida dos serviços.
  filas: [
    'campanha.iniciar',
    'cnpj.importar',
    'enriquecimento.solicitar',
    'maps.importar_planilha',
    'leads.importar',
  ],
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

// Argos (assistente): papel só leitura no banco e voz. Falhar aqui não derruba a api.
const assistente = await prepararAssistente(pool, log, env);

// Reuniões por vídeo: LiveKit, gravações e transcrição; o processamento roda depois de cada reunião.
const reunioes = prepararReunioes(env, log);
const processamento = iniciarProcessamento({
  pool,
  log,
  servicos,
  reunioes,
  jwtSegredo: env.JWT_SEGREDO,
});

// Ligações pelo CRM: o mesmo LiveKit, com o tronco SIP do provedor de telefonia.
const telefonia = prepararTelefonia(env, reunioes, assistente, log);

// Assinatura pelo sistema: cobrança no Asaas e o captcha do cadastro do teste grátis.
const cobranca = env.ASAAS_CHAVE
  ? criarServicoCobranca({ chave: env.ASAAS_CHAVE, sandbox: env.ASAAS_SANDBOX })
  : null;
if (!cobranca) log.info('ASAAS_CHAVE não configurada: a assinatura pelo sistema fica desligada.');
const captcha =
  env.TURNSTILE_SITE && env.TURNSTILE_SEGREDO
    ? { site: env.TURNSTILE_SITE, segredo: env.TURNSTILE_SEGREDO }
    : null;

// Carrosséis com IA: o time escreve com o Claude (chave da plataforma); sem ela, só à mão.
const carrosseisIa = prepararCarrosseisIa(env);
if (!carrosseisIa) log.info('ANTHROPIC_CHAVE não configurada: o time de IA dos carrosséis fica desligado.');

const app = criarApp({
  pool,
  filas,
  log,
  auth: {
    jwtSegredo: env.JWT_SEGREDO,
    adminEmail: env.ADMIN_EMAIL,
    adminSenhaHash: env.ADMIN_SENHA_HASH,
    sessaoHoras: env.SESSAO_HORAS,
    // Cookie só por https: em produção, ou sempre que o sistema é aberto por https (mesmo que o
    // NODE_ENV tenha ficado de fora da configuração).
    cookieSeguro:
      env.NODE_ENV === 'production' || env.APP_ORIGENS.every((o: string) => o.startsWith('https://')),
  },
  origens: env.APP_ORIGENS,
  servicos,
  credenciais: { chave, ambiente, invalidar },
  assistente,
  reunioes: { ...reunioes, aoEncerrar: processamento.aoEncerrar },
  telefonia,
  cobranca,
  asaasTokenWebhook: env.ASAAS_TOKEN_WEBHOOK ?? null,
  captcha,
  carrosseisIa,
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
// Planos: leads que esperaram o limite voltam para a fila quando há vaga; avisa perto do limite.
const pararPlanos = iniciarPlanos({ pool, log, filas });
// Importação de leads: põe no funil o que o worker terminou de gravar (quando o cliente pediu).
const pararImportacao = iniciarImportacaoLeads(pool, log);
const pararSinal = manterSinalDeVida(pool, 'api');
// Medidor das chamadas para fora (Saúde e consumo, no painel da plataforma).
const pararMedidor = iniciarMedidor(pool);
// Instagram: números das publicações de cada conta conectada, de 6 em 6 horas.
const pararConteudo = iniciarConteudo({ pool, log });
// Devolver as vendas para a Meta: as etapas dos leads de anúncio, a cada minuto.
const pararConversoes = iniciarConversoes({ pool, log });
// Ligações: transcrição e resumo depois de cada uma; fecha as esquecidas abertas.
const pararLigacoes = iniciarLigacoes({ pool, log, servicos, telefonia });
// Quadros: a IA lê as conversas que pararam e põe os leads nas colunas pelos gatilhos.
const pararQuadros = iniciarQuadros({ pool, log, servicos });
// Qualidade do atendimento: a nota das conversas paradas e das ligações transcritas.
const pararAtendimento = iniciarAtendimento({ pool, log, servicos });
// Carrosséis: a fila do time de IA (até 2 pedidos ao mesmo tempo).
const pararCarrosseis = iniciarTimeCarrosseis({ pool, log, ia: carrosseisIa });
// Porteiro do WhatsApp: sinais de risco do número (pedidos para parar, ninguém respondendo).
const pararPorteiro = iniciarPorteiro({ pool, log });
// API aberta: entrega os avisos (webhooks) aos sistemas dos clientes, com novas tentativas.
const pararAvisos = iniciarAvisos({ pool, log, chave });
// Teste grátis e assinatura: avisos do fim do teste, só leitura, arquivar e conferir os pagamentos.
const pararAssinaturas = iniciarAssinaturas({ pool, log, servicos, cobranca }, env.APP_ORIGENS[0] ?? '');
// Marca própria: domínios ativos dos clientes (links e origens) e conferência dos que esperam o DNS.
const pararListaDominios = manterDominios(pool, (erro) =>
  log.warn({ err: erro }, 'marca: lista de domínios falhou'),
);
const pararDominios = iniciarDominios({ pool, log, site: () => dominiosDoAmbiente(ambiente) });

encerrarAoReceberSinal(log, async () => {
  pararAvisos();
  pararAssinaturas();
  pararAutomacao();
  pararAgente();
  pararPlanos();
  pararImportacao();
  pararLembretes();
  pararEmail();
  pararAlertas();
  pararSinal();
  await pararMedidor();
  pararConteudo();
  pararConversoes();
  pararLigacoes();
  pararQuadros();
  pararAtendimento();
  pararCarrosseis();
  pararPorteiro();
  pararListaDominios();
  pararDominios();
  processamento.parar();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await filas.parar();
  await assistente.leitura?.end().catch(() => undefined);
  await pool.end();
});
