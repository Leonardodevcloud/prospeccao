import { AppError } from '@prospeccao/shared';

export interface OpcoesRequisicao {
  servico: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * fetch com timeout e erros padronizados. 429 e 5xx viram AppError repetível
 * (o worker tenta de novo com espera); demais 4xx não são repetíveis.
 */
export async function requisitarJson<T>(url: string, opcoes: OpcoesRequisicao): Promise<T> {
  const { servico, method = 'GET', headers = {}, body, timeoutMs = 30_000 } = opcoes;
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (erro) {
    throw AppError.externo(servico, `sem resposta (${(erro as Error).name})`, erro);
  }

  if (!resposta.ok) {
    const texto = (await resposta.text().catch(() => '')).slice(0, 300);
    const repetivel = resposta.status === 429 || resposta.status >= 500;
    throw new AppError(502, 'falha_externa', `${servico}: HTTP ${resposta.status} ${texto}`.trim(), {
      repetivel,
      detalhes: { status: resposta.status },
    });
  }
  return (await resposta.json()) as T;
}
