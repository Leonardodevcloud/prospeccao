import { ErroApi } from '../../api';

export { api, ErroApi } from '../../api';

/**
 * Pedido do Argos que manda ou recebe áudio (o api() comum só fala JSON): áudio gravado vai como
 * corpo bruto; a voz volta como arquivo. Também aceita cancelar (AbortSignal).
 */
export async function apiAudio<T>(
  caminho: string,
  op: { metodo?: string; corpo?: unknown; arquivo?: Blob; sinal?: AbortSignal; bruto?: boolean } = {},
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${caminho}`, {
      method: op.metodo ?? 'GET',
      credentials: 'same-origin',
      headers: op.arquivo
        ? { 'content-type': op.arquivo.type || 'audio/webm' }
        : op.corpo !== undefined
          ? { 'content-type': 'application/json' }
          : undefined,
      body: op.arquivo ?? (op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined),
      signal: op.sinal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErroApi(0, 'sem_conexao', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  if (!r.ok) {
    const dados = (await r.json().catch(() => null)) as {
      erro?: { codigo?: string; mensagem?: string };
    } | null;
    throw new ErroApi(r.status, dados?.erro?.codigo ?? 'erro', dados?.erro?.mensagem ?? `Erro ${r.status}.`);
  }
  if (op.bruto) return (await r.blob()) as T;
  return (await r.json()) as T;
}
