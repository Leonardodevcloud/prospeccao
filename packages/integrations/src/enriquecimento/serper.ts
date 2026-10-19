import { requisitarJson } from '../http.js';
import type { ResultadoGoogle } from './apify.js';

/**
 * Busca no Google pelo Serper (serper.dev): alternativa ao ator do Apify para achar perfis do
 * LinkedIn e do Instagram. Cada consulta custa 1 crédito (2.500 grátis na conta nova, depois
 * a partir de ~US$ 1 por mil), mais barato e mais rápido que o Apify.
 */

export interface ConfigSerper {
  apiKey: string;
}

interface RespostaSerper {
  searchParameters?: { q?: string };
  organic?: { title?: string; link?: string; snippet?: string }[];
}

/** Converte a resposta do Serper no mesmo formato da busca do Apify. */
export function resultadosSerper(r: RespostaSerper): ResultadoGoogle[] {
  return (r.organic ?? [])
    .filter((o) => o.link)
    .map((o) => ({ titulo: o.title ?? '', url: o.link ?? '', descricao: o.snippet ?? '' }));
}

/** Várias consultas em paralelo; devolve consulta → resultados (como buscarNoGoogle do Apify). */
export async function buscarNoGoogleSerper(
  cfg: ConfigSerper,
  consultas: string[],
): Promise<Map<string, ResultadoGoogle[]>> {
  const respostas = await Promise.all(
    consultas.map((q) =>
      requisitarJson<RespostaSerper>('https://google.serper.dev/search', {
        servico: 'Serper',
        method: 'POST',
        headers: { 'X-API-KEY': cfg.apiKey },
        body: { q, gl: 'br', hl: 'pt-br', num: 10 },
        timeoutMs: 20_000,
      }),
    ),
  );
  return new Map(consultas.map((q, i) => [q, resultadosSerper(respostas[i] ?? {})]));
}
