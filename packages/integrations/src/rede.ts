import { type LookupAddress, lookup as lookupDns } from 'node:dns';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/*
 * Buscas que o servidor faz em endereços que vêm de fora (site de lead importado, link da bio,
 * aviso para o sistema do cliente, arquivo do WhatsApp). Nada de rede interna: o endereço é
 * conferido depois de resolvido, na hora de conectar (um DNS que muda de resposta não engana),
 * a cada redirecionamento, e a leitura para no limite de bytes (inclusive depois de descompactar).
 */

const INTERNOS = new BlockList();
for (const [rede, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  INTERNOS.addSubnet(rede, bits, 'ipv4');
for (const [rede, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  INTERNOS.addSubnet(rede, bits, 'ipv6');

/** Endereço privado, da própria máquina, reservado ou de metadados da nuvem. */
export function enderecoInterno(ip: string): boolean {
  const limpo = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const v = isIP(limpo);
  if (v === 0) return true;
  if (v === 6) {
    // IPv4 escrito como IPv6 (::ffff:10.0.0.1 ou ::ffff:a00:1): vale a regra do IPv4.
    const mapeado = limpo.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapeado) return enderecoInterno(mapeado);
    const hex = limpo.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const n = (Number.parseInt(hex[1]!, 16) << 16) | Number.parseInt(hex[2]!, 16);
      return enderecoInterno([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return INTERNOS.check(limpo, 'ipv6');
  }
  return INTERNOS.check(limpo, 'ipv4');
}

const NOME_INTERNO =
  /^(localhost|metadata(\.google\.internal)?)$|\.(local|localhost|internal|lan|home|corp|intranet)$/i;

export class EnderecoRecusado extends Error {
  constructor(mensagem = 'Endereço interno não é permitido.') {
    super(mensagem);
    this.name = 'EnderecoRecusado';
  }
}

/** Resolve o nome e recusa se qualquer endereço for interno (chamado na hora de conectar). */
const lookupSeguro: LookupFunction = (hostname, opcoes, cb) => {
  lookupDns(hostname, { ...opcoes, all: true }, (erro, enderecos) => {
    if (erro) return cb(erro, '', 0);
    const lista = (enderecos as unknown as LookupAddress[]) ?? [];
    if (!lista.length) return cb(new Error(`Não achei ${hostname}.`), '', 0);
    if (lista.some((e) => enderecoInterno(e.address))) return cb(new EnderecoRecusado(), '', 0);
    if ((opcoes as { all?: boolean }).all) return (cb as (e: null, l: LookupAddress[]) => void)(null, lista);
    cb(null, lista[0]!.address, lista[0]!.family);
  });
};

export interface OpcoesBusca {
  metodo?: 'GET' | 'POST' | 'HEAD';
  cabecalhos?: Record<string, string>;
  corpo?: string | Buffer;
  timeoutMs?: number;
  /** Para de ler depois de tantos bytes (já descompactados). Padrão: 2 MB. */
  limiteBytes?: number;
  /** Quantos redirecionamentos segue (cada um conferido de novo). 0: não segue. */
  redirecionamentos?: number;
  /** Só https (avisos para o sistema do cliente). */
  soHttps?: boolean;
  /** Só para os testes (servidor de mentira na própria máquina). */
  redeLocal?: boolean;
}

export interface RespostaBusca {
  status: number;
  cabecalhos: IncomingHttpHeaders;
  /** Endereço final (depois dos redirecionamentos). */
  url: string;
  corpo: Buffer;
  /** Passou do limite: o corpo veio cortado. */
  cortado: boolean;
}

function conferirUrl(url: URL, o: OpcoesBusca): void {
  if (url.protocol !== 'https:' && (o.soHttps || url.protocol !== 'http:'))
    throw new EnderecoRecusado(o.soHttps ? 'Use um endereço https://' : 'Use um endereço http ou https.');
  if (o.redeLocal) return;
  if (url.username || url.password) throw new EnderecoRecusado('Endereço com usuário e senha não é aceito.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (NOME_INTERNO.test(host) || (isIP(host) && enderecoInterno(host))) throw new EnderecoRecusado();
}

function umaBusca(url: URL, o: OpcoesBusca, limite: number, prazo: number): Promise<RespostaBusca> {
  return new Promise((ok, falha) => {
    const modulo = url.protocol === 'https:' ? https : http;
    const restante = prazo - Date.now();
    if (restante <= 0) return falha(Object.assign(new Error('Demorou demais.'), { name: 'TimeoutError' }));
    const pedido = modulo.request(
      url,
      {
        method: o.metodo ?? 'GET',
        headers: {
          'accept-encoding': 'gzip, deflate, br',
          ...(o.corpo !== undefined ? { 'content-length': String(Buffer.byteLength(o.corpo)) } : {}),
          ...o.cabecalhos,
        },
        ...(o.redeLocal ? {} : { lookup: lookupSeguro }),
      },
      (r: IncomingMessage) => {
        const codificacao = String(r.headers['content-encoding'] ?? '').toLowerCase();
        const fluxo =
          codificacao === 'gzip' || codificacao === 'x-gzip'
            ? r.pipe(createGunzip())
            : codificacao === 'deflate'
              ? r.pipe(createInflate())
              : codificacao === 'br'
                ? r.pipe(createBrotliDecompress())
                : r;
        const pedacos: Buffer[] = [];
        let total = 0;
        let cortado = false;
        const fim = () =>
          ok({
            status: r.statusCode ?? 0,
            cabecalhos: r.headers,
            url: url.href,
            corpo: Buffer.concat(pedacos),
            cortado,
          });
        fluxo.on('data', (p: Buffer) => {
          if (cortado) return;
          const cabe = limite - total;
          if (p.length >= cabe) {
            pedacos.push(p.subarray(0, Math.max(0, cabe)));
            total = limite;
            cortado = true;
            r.destroy();
            fim();
            return;
          }
          pedacos.push(p);
          total += p.length;
        });
        fluxo.on('end', () => !cortado && fim());
        fluxo.on('error', (e) => !cortado && falha(e));
        r.on('error', (e) => !cortado && falha(e));
      },
    );
    // Prazo do pedido inteiro (não só de silêncio na conexão): quem manda devagar não segura a busca.
    const relogio = setTimeout(
      () => pedido.destroy(Object.assign(new Error('Demorou demais.'), { name: 'TimeoutError' })),
      restante,
    );
    pedido.on('close', () => clearTimeout(relogio));
    pedido.on('error', falha);
    if (o.corpo !== undefined) pedido.write(o.corpo);
    pedido.end();
  });
}

/**
 * Busca um endereço de fora com as travas acima. Redirecionamento é seguido à mão (cada destino
 * conferido); a resposta vem mesmo quando o status não é 2xx.
 */
export async function buscarNaInternet(endereco: string, o: OpcoesBusca = {}): Promise<RespostaBusca> {
  const limite = o.limiteBytes ?? 2 * 1024 * 1024;
  const prazo = Date.now() + (o.timeoutMs ?? 15_000);
  let url = new URL(endereco);
  let saltos = o.redirecionamentos ?? 5;
  let metodo = o.metodo ?? 'GET';
  let corpo = o.corpo;
  for (;;) {
    conferirUrl(url, o);
    const r = await umaBusca(url, { ...o, metodo, corpo }, limite, prazo);
    const destino = r.cabecalhos.location;
    if (r.status >= 300 && r.status < 400 && destino && saltos > 0) {
      saltos -= 1;
      url = new URL(destino, url);
      // 303 (e 301/302 de POST, como os navegadores) viram GET sem corpo.
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && metodo === 'POST')) {
        metodo = 'GET';
        corpo = undefined;
      }
      continue;
    }
    return r;
  }
}
