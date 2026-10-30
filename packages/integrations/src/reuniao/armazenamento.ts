import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

/**
 * Armazenamento das gravações (qualquer serviço compatível com S3: Cloudflare R2, AWS S3, Backblaze).
 * Recebe os pedaços que o navegador grava, monta o arquivo final em partes (sem segurar tudo na
 * memória), gera links temporários para assistir e apaga quando o titular pede (LGPD).
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
  /** Apaga arquivos (o que já não existe é ignorado). Em lotes de até 1.000. */
  apagar(chaves: string[]): Promise<void>;
  /** Guarda um arquivo pequeno (um pedaço da gravação). */
  enviar(chave: string, corpo: Uint8Array, tipo?: string): Promise<void>;
  /** Lê um arquivo inteiro (só para arquivos pequenos, como os pedaços). */
  ler(chave: string): Promise<Uint8Array>;
  /** Arquivo grande em partes (todas do mesmo tamanho, menos a última; mínimo 5 MB). */
  iniciarEmPartes(chave: string, tipo: string): Promise<string>;
  enviarParte(chave: string, envioId: string, numero: number, corpo: Uint8Array): Promise<string>;
  concluirEmPartes(chave: string, envioId: string, partes: { numero: number; etag: string }[]): Promise<void>;
  cancelarEmPartes(chave: string, envioId: string): Promise<void>;
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

function escaparXml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      const fila = [...new Set(chaves.filter(Boolean))];
      if (fila.length === 1) {
        const r = await aws.fetch(`${base}/${codificarChave(fila[0]!)}`, { method: 'DELETE' });
        if (!r.ok && r.status !== 404)
          throw new Error(`Armazenamento: não apagou ${fila[0]} (HTTP ${r.status})`);
        return;
      }
      // Muitos pedaços: um pedido por lote de até 1.000 (DeleteObjects).
      while (fila.length) {
        const lote = fila.splice(0, 1000);
        const xml = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${lote
          .map((k) => `<Object><Key>${escaparXml(k)}</Key></Object>`)
          .join('')}</Delete>`;
        const r = await aws.fetch(`${base}?delete`, {
          method: 'POST',
          body: xml,
          headers: {
            'Content-Type': 'application/xml',
            'Content-MD5': createHash('md5').update(xml).digest('base64'),
          },
        });
        if (!r.ok) throw new Error(`Armazenamento: não apagou ${lote.length} arquivos (HTTP ${r.status})`);
      }
    },

    async enviar(chave, corpo, tipo = 'application/octet-stream') {
      const r = await aws.fetch(`${base}/${codificarChave(chave)}`, {
        method: 'PUT',
        body: corpo,
        headers: { 'Content-Type': tipo },
      });
      if (!r.ok) throw new Error(`Armazenamento: não guardou ${chave} (HTTP ${r.status})`);
    },

    async ler(chave) {
      const r = await aws.fetch(`${base}/${codificarChave(chave)}`, { method: 'GET' });
      if (!r.ok) throw new Error(`Armazenamento: não leu ${chave} (HTTP ${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    },

    async iniciarEmPartes(chave, tipo) {
      const r = await aws.fetch(`${base}/${codificarChave(chave)}?uploads`, {
        method: 'POST',
        headers: { 'Content-Type': tipo },
      });
      const xml = await r.text();
      const id = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
      if (!r.ok || !id) throw new Error(`Armazenamento: não começou o envio de ${chave} (HTTP ${r.status})`);
      return id;
    },

    async enviarParte(chave, envioId, numero, corpo) {
      const url = `${base}/${codificarChave(chave)}?partNumber=${numero}&uploadId=${encodeURIComponent(envioId)}`;
      const r = await aws.fetch(url, { method: 'PUT', body: corpo });
      const etag = r.headers.get('etag');
      if (!r.ok || !etag)
        throw new Error(`Armazenamento: parte ${numero} de ${chave} falhou (HTTP ${r.status})`);
      return etag;
    },

    async concluirEmPartes(chave, envioId, partes) {
      const xml = `<CompleteMultipartUpload>${partes
        .map((p) => `<Part><PartNumber>${p.numero}</PartNumber><ETag>${escaparXml(p.etag)}</ETag></Part>`)
        .join('')}</CompleteMultipartUpload>`;
      const r = await aws.fetch(`${base}/${codificarChave(chave)}?uploadId=${encodeURIComponent(envioId)}`, {
        method: 'POST',
        body: xml,
        headers: { 'Content-Type': 'application/xml' },
      });
      const resposta = await r.text();
      // O S3 pode responder 200 com <Error> no corpo.
      if (!r.ok || /<Error>/.test(resposta))
        throw new Error(
          `Armazenamento: não concluiu ${chave} (HTTP ${r.status}) ${resposta.slice(0, 200)}`.trim(),
        );
    },

    async cancelarEmPartes(chave, envioId) {
      await aws
        .fetch(`${base}/${codificarChave(chave)}?uploadId=${encodeURIComponent(envioId)}`, {
          method: 'DELETE',
        })
        .catch(() => undefined);
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
