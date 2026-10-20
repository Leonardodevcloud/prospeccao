import { createServer } from 'node:http';
import { criarPool } from '@prospeccao/db';
import { classificarRespostaEmail, decidirComGemini } from '@prospeccao/integrations/agente';
import { criarEnvioSmtp, lerNovos } from '@prospeccao/integrations/email';
import * as ors from '@prospeccao/integrations/ors';
import { baixarMidia, enviarMidia, enviarTexto } from '@prospeccao/integrations/whatsapp';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { criarApp } from './app.js';
import { carregarEnvApi } from './config.js';
import { iniciarLembretes } from './modulos/agenda/lembretes.js';
import { iniciarAgente } from './modulos/agente/motor.js';
import { iniciarEmail } from './modulos/email/motor.js';
import { iniciarAutomacaoFunil } from './modulos/funil/automacao.js';

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

const evolution =
  env.EVOLUTION_URL && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCIA
    ? { url: env.EVOLUTION_URL, apiKey: env.EVOLUTION_API_KEY, instancia: env.EVOLUTION_INSTANCIA }
    : null;
const whatsapp = evolution
  ? {
      enviar: (tel: string, texto: string) => enviarTexto(evolution, tel, texto),
      enviarMidia: (tel: string, m: Parameters<typeof enviarMidia>[2]) => enviarMidia(evolution, tel, m),
      baixarMidia: (id: string) => baixarMidia(evolution, id),
    }
  : null;
const ia = env.GEMINI_API_KEY
  ? {
      decidir: (c: Parameters<typeof decidirComGemini>[1]) =>
        decidirComGemini({ apiKey: env.GEMINI_API_KEY!, modelo: env.GEMINI_MODELO }, c),
    }
  : null;

const smtp =
  env.EMAIL_SMTP_HOST && env.EMAIL_USUARIO && env.EMAIL_SENHA
    ? criarEnvioSmtp({
        host: env.EMAIL_SMTP_HOST,
        porta: env.EMAIL_SMTP_PORTA,
        usuario: env.EMAIL_USUARIO,
        senha: env.EMAIL_SENHA,
      })
    : null;
const email = smtp
  ? {
      remetente: env.EMAIL_REMETENTE ?? env.EMAIL_USUARIO!,
      enviar: smtp.enviar,
      verificar: smtp.verificar,
      lerNovos: env.EMAIL_IMAP_HOST
        ? (desde: number | null) =>
            lerNovos(
              {
                host: env.EMAIL_IMAP_HOST!,
                porta: env.EMAIL_IMAP_PORTA,
                usuario: env.EMAIL_USUARIO!,
                senha: env.EMAIL_SENHA!,
              },
              desde,
            )
        : undefined,
    }
  : null;
const classificarEmail = env.GEMINI_API_KEY
  ? (c: Parameters<typeof classificarRespostaEmail>[1]) =>
      classificarRespostaEmail({ apiKey: env.GEMINI_API_KEY!, modelo: env.GEMINI_MODELO }, c)
  : null;

const app = criarApp({
  whatsapp,
  ia,
  email,
  classificarEmail,
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
  geocodificar: env.ORS_API_KEY
    ? async (endereco) => {
        const r = await ors.geocodificar({ apiKey: env.ORS_API_KEY! }, endereco);
        return r && r.confianca >= 0.6 ? { lat: r.lat, lng: r.lng } : null;
      }
    : undefined,
});

const servidor = createServer(app);
servidor.listen(env.PORT, () => log.info({ porta: env.PORT }, 'api pronta'));
// Follow-up: encerra sozinho quem esgotou a cadência sem responder.
const pararAutomacao = iniciarAutomacaoFunil(pool, log);
// Agente de abordagem: envia, lê respostas e responde (só faz algo se estiver ligado na tela).
const pararAgente = iniciarAgente({ pool, log, whatsapp, ia }, log);
// Agenda: lembrete da reunião para o lead (WhatsApp) e aviso para o vendedor.
const pararLembretes = iniciarLembretes({ pool, log, whatsapp });
// E-mail de prospecção: envia as campanhas e lê as respostas (só envia se estiver ligado na tela).
const pararEmail = iniciarEmail({ pool, log, email, classificarEmail, origens: env.APP_ORIGENS });

encerrarAoReceberSinal(log, async () => {
  pararAutomacao();
  pararAgente();
  pararLembretes();
  pararEmail();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await filas.parar();
  await pool.end();
});
