import { criarServicoTelefonia } from '@prospeccao/integrations/telefonia';
import type { Logger } from '@prospeccao/shared';
import type { EnvApi } from '../../config.js';
import type { DepsAssistente } from '../assistente/rotas.js';
import type { DepsReunioes } from '../reunioes/servico.js';
import type { DepsTelefonia } from './servico.js';

/**
 * Ligações a partir do ambiente: o LiveKit das reuniões com o tronco SIP do provedor. Grava no
 * mesmo armazenamento das reuniões, transcreve com a mesma chave e o aviso de gravação usa a voz
 * do Argos. O que faltar fica desligado (a tela explica).
 */
export function prepararTelefonia(
  env: EnvApi,
  reunioes: DepsReunioes,
  assistente: DepsAssistente | null,
  log: Logger,
): DepsTelefonia {
  const servico =
    env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.TELEFONIA_TRONCO_SAIDA
      ? criarServicoTelefonia({
          url: env.LIVEKIT_URL,
          apiKey: env.LIVEKIT_API_KEY,
          apiSecret: env.LIVEKIT_API_SECRET,
          troncoSaida: env.TELEFONIA_TRONCO_SAIDA,
        })
      : null;
  if (!servico) log.info('ligações desligadas (falta LIVEKIT_* e TELEFONIA_TRONCO_SAIDA)');
  else
    log.info(
      { gravacao: !!reunioes.armazenamento, transcricao: !!reunioes.transcricao, aviso: !!assistente?.fala },
      'ligações ligadas',
    );
  return {
    servico,
    armazenamento: reunioes.armazenamento,
    transcricao: reunioes.transcricao,
    fala: assistente?.fala ?? null,
  };
}
