import { createServer } from 'node:http';
import { criarPool } from '@prospeccao/db';
import { decidirComGemini } from '@prospeccao/integrations/agente';
import * as ors from '@prospeccao/integrations/ors';
import { baixarMidia, enviarMidia, enviarTexto } from '@prospeccao/integrations/whatsapp';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { criarApp } from './app.js';
import { carregarEnvApi } from './config.js';
import { iniciarLembretes } from './modulos/agenda/lembretes.js';
import { iniciarAgente } from './modulos/agente/motor.js';
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

const app = criarApp({
  whatsapp,
  ia,
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

encerrarAoReceberSinal(log, async () => {
  pararAutomacao();
  pararAgente();
  pararLembretes();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await filas.parar();
  await pool.end();
});
