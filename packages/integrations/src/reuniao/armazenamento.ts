import { AwsClient } from 'aws4fetch';

/**
 * Armazenamento das gravações (qualquer serviço compatível com S3: Cloudflare R2, AWS S3, Backblaze).
 * O LiveKit grava direto no bucket; o sistema só gera links temporários para assistir e apaga quando
 * o titular pede (LGPD). Nada passa pela memória da api.
 */

export interface ConfigArmazenamento {
  /** Ex.: https://<conta>.r2.cloudflarestorage.com */
  endpoint: string;
  /** "auto" no R2. */
  regiao: string;
  bucket: string;
  chave: string;
  segredo: string;
}

export interface Armazenamento {
  /** Credenciais para o LiveKit gravar direto no bucket. */
  readonly destino: Readonly<ConfigArmazenamento>;
  /** Link temporário para assistir ou baixar (padrão: 1 hora). */
  urlAssinada(chave: string, opcoes?: { segundos?: number; baixarComo?: string }): Promise<string>;
  /** Apaga arquivos (o que já não existe é ignorado). */
  apagar(chaves: string[]): Promise<void>;
  /** "ok (bucket …)" ou lança o erro. */
  testar(): Promise<string>;
}

/** Cada parte do caminho codificada; as barras ficam. */
export function codificarChave(chave: string): string {
  return chave
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/');
}

/** Nome de arquivo seguro para o cabeçalho de download (sem aspas nem quebra de linha). */
function nomeParaDownload(nome: string): string {
  const limpo = nome.replace(/["\r\n\\]/g, '').trim() || 'gravacao';
  return `attachment; filename="${limpo.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(limpo)}`;
}

export function criarArmazenamento(cfg: ConfigArmazenamento): Armazenamento {
  const base = `${cfg.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(cfg.bucket)}`;
  const aws = new AwsClient({
    accessKeyId: cfg.chave,
    secretAccessKey: cfg.segredo,
    service: 's3',
    region: cfg.regiao || 'auto',
  });

  return {
    destino: Object.freeze({ ...cfg }),

    async urlAssinada(chave, opcoes = {}) {
      const url = new URL(`${base}/${codificarChave(chave)}`);
      url.searchParams.set('X-Amz-Expires', String(Math.min(Math.max(opcoes.segundos ?? 3600, 60), 604_800)));
      if (opcoes.baixarComo)
        url.searchParams.set('response-content-disposition', nomeParaDownload(opcoes.baixarComo));
      const assinado = await aws.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
      return assinado.url;
    },

    async apagar(chaves) {
      // Poucos arquivos por reunião: um pedido por arquivo, alguns de cada vez.
      const fila = [...new Set(chaves.filter(Boolean))];
      while (fila.length) {
        const lote = fila.splice(0, 5);
        await Promise.all(
          lote.map(async (k) => {
            const r = await aws.fetch(`${base}/${codificarChave(k)}`, { method: 'DELETE' });
            if (!r.ok && r.status !== 404)
              throw new Error(`Armazenamento: não apagou ${k} (HTTP ${r.status})`);
          }),
        );
      }
    },

    async testar() {
      const r = await aws.fetch(`${base}?list-type=2&max-keys=1`, { method: 'GET' });
      if (!r.ok) {
        const corpo = (await r.text().catch(() => '')).slice(0, 200);
        throw new Error(`Armazenamento: HTTP ${r.status} ${corpo}`.trim());
      }
      return `ok (bucket ${cfg.bucket})`;
    },
  };
}
