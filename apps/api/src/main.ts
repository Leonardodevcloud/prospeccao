import { createServer } from 'node:http';
import { criarPool } from '@prospeccao/db';
import * as ors from '@prospeccao/integrations/ors';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { criarApp } from './app.js';
import { carregarEnvApi } from './config.js';
import { iniciarAutomacaoFunil } from './modulos/funil/automacao.js';

const env = carregarEnvApi();
const log = criarLogger('api', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'api', max: 10 });
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'api',
  log,
  // Filas que a API publica: criadas aqui também, para não depender da ordem de subida dos serviços.
  filas: ['campanha.iniciar', 'cnpj.importar', 'enriquecimento.solicitar'],
});

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

encerrarAoReceberSinal(log, async () => {
  pararAutomacao();
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await filas.parar();
  await pool.end();
});
