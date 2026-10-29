import type { Pool } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import { criarPoolLeitura, lerChave, senhaLeitura, sincronizarAcesso } from './acesso.js';
import type { DepsAssistente } from './rotas.js';
import { FalaCompativelOpenAI, TranscricaoCompativelOpenAI } from './voz.js';

/**
 * Liga o Argos ao subir a api: papel só leitura (senha derivada do JWT_SEGREDO, nada novo para
 * configurar), a chave que assina o escopo, e a voz (ouvir/falar) se as chaves existirem.
 * Qualquer parte que falhar desliga só ela; o resto do sistema segue normal.
 */
export async function prepararAssistente(
  dono: Pool,
  log: Logger,
  env: {
    DATABASE_URL: string;
    JWT_SEGREDO: string;
    GROQ_CHAVE?: string | null;
    VOZ_BASE_URL: string;
    VOZ_MODELO: string;
    OPENAI_CHAVE?: string | null;
    FALA_BASE_URL: string;
    FALA_MODELO: string;
    ARGOS_RACIOCINIO: 'desligado' | 'baixo' | 'alto';
  },
): Promise<DepsAssistente> {
  let leitura: Pool | null = null;
  let chave: string | null = null;
  let erro: string | null = null;
  try {
    const senha = senhaLeitura(env.JWT_SEGREDO);
    await sincronizarAcesso(dono, senha);
    chave = await lerChave(dono);
    leitura = criarPoolLeitura(env.DATABASE_URL, senha);
    await leitura.query('SELECT 1');
  } catch (e) {
    erro = (e as Error).message;
    log.warn({ erro }, 'argos: acesso aos dados desligado (o assistente responde sem consultar)');
    await leitura?.end().catch(() => undefined);
    leitura = null;
  }
  const voz = env.GROQ_CHAVE
    ? new TranscricaoCompativelOpenAI({
        baseUrl: env.VOZ_BASE_URL,
        chave: env.GROQ_CHAVE,
        modelo: env.VOZ_MODELO,
      })
    : null;
  const fala = env.OPENAI_CHAVE
    ? new FalaCompativelOpenAI({
        baseUrl: env.FALA_BASE_URL,
        chave: env.OPENAI_CHAVE,
        modelo: env.FALA_MODELO,
      })
    : null;
  log.info({ dados: !!leitura, ouvir: !!voz, falar: !!fala }, 'argos pronto');
  return { leitura, chave, voz, fala, raciocinio: env.ARGOS_RACIOCINIO, erro };
}
