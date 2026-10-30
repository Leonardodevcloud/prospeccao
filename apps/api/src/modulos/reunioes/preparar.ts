import { criarArmazenamento, criarServicoVideo } from '@prospeccao/integrations/reuniao';
import type { Logger } from '@prospeccao/shared';
import type { EnvApi } from '../../config.js';
import type { DepsReunioes } from './servico.js';

/**
 * Reuniões por vídeo a partir das variáveis do ambiente. Cada parte é opcional: sem LiveKit não há
 * sala; sem armazenamento, a sala funciona sem gravar; sem a chave da Groq, grava sem transcrever.
 */
export function prepararReunioes(env: EnvApi, log: Logger): DepsReunioes {
  const armazenamento =
    env.GRAVACOES_S3_ENDPOINT && env.GRAVACOES_S3_BUCKET && env.GRAVACOES_S3_CHAVE && env.GRAVACOES_S3_SEGREDO
      ? criarArmazenamento({
          endpoint: env.GRAVACOES_S3_ENDPOINT,
          regiao: env.GRAVACOES_S3_REGIAO,
          bucket: env.GRAVACOES_S3_BUCKET,
          chave: env.GRAVACOES_S3_CHAVE,
          segredo: env.GRAVACOES_S3_SEGREDO,
        })
      : null;
  const video =
    env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
      ? criarServicoVideo({
          url: env.LIVEKIT_URL,
          apiKey: env.LIVEKIT_API_KEY,
          apiSecret: env.LIVEKIT_API_SECRET,
          armazenamento: armazenamento?.destino ?? null,
          // A gravação filma a página /gravacao do front (a mesma visão de quem conduz a reunião).
          modeloGravacao: env.GRAVACOES_MODELO_URL ?? `${env.APP_ORIGENS[0]?.replace(/\/+$/, '')}/gravacao`,
        })
      : null;
  const transcricao = env.GROQ_CHAVE
    ? { baseUrl: env.VOZ_BASE_URL, chave: env.GROQ_CHAVE, modelo: env.VOZ_MODELO }
    : null;
  if (!video)
    log.info('reuniões por vídeo desligadas (falta LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET)');
  else
    log.info(
      {
        gravacao: armazenamento ? (env.GRAVACAO_NA_NUVEM ? 'nuvem (LiveKit)' : 'pelo navegador') : false,
        transcricao: !!(armazenamento && transcricao),
      },
      'reuniões por vídeo ligadas',
    );
  return { video, armazenamento, transcricao, gravacaoNaNuvem: env.GRAVACAO_NA_NUVEM };
}
