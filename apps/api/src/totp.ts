import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Verificação em duas etapas por app autenticador (Google Authenticator, Microsoft Authenticator,
 * 1Password…): TOTP de 6 dígitos a cada 30 segundos (RFC 6238), sem dependência externa.
 */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(txt: string): Buffer {
  const limpo = txt.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('Segredo inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

export function novoSegredo(): string {
  return base32(randomBytes(20));
}

/** Código do instante (passo de 30 s). */
export function codigo(segredo: string, quando = Date.now(), passo = 0): string {
  const contador = Math.floor(quando / 1000 / 30) + passo;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac('sha1', deBase32(segredo)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Confere o código aceitando um passo antes e um depois (relógio do celular adiantado/atrasado). */
export function conferir(segredo: string, digitado: string, quando = Date.now()): boolean {
  const d = digitado.replace(/\D/g, '');
  if (d.length !== 6) return false;
  return [-1, 0, 1].some((p) => {
    const c = Buffer.from(codigo(segredo, quando, p));
    return timingSafeEqual(c, Buffer.from(d));
  });
}

export function enderecoOtp(segredo: string, conta: string, emissor = 'Prospect Team'): string {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&digits=6&period=30`;
}

/* ───────────── Códigos de recuperação (celular perdido) ───────────── */

export const hashRecuperacao = (c: string) =>
  createHash('sha256')
    .update(c.replace(/[^a-z0-9]/gi, '').toLowerCase())
    .digest('hex');

export function novosCodigosRecuperacao(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const s = base32(randomBytes(5)).toLowerCase().slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

/* ───────────── Segredo guardado cifrado (chave derivada do segredo da sessão) ───────────── */

function chave(segredoApi: string) {
  return createHash('sha256').update(`${segredoApi}|totp`).digest();
}

export function cifrarSegredo(segredoApi: string, totp: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(segredoApi), iv);
  const dado = Buffer.concat([c.update(totp, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${dado.toString('base64url')}`;
}

export function decifrarSegredo(segredoApi: string, guardado: string): string {
  const [v, iv, tag, dado] = guardado.split('.');
  if (v !== 'v1' || !iv || !tag || !dado) throw new Error('Segredo de duas etapas ilegível');
  const d = createDecipheriv('aes-256-gcm', chave(segredoApi), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(dado, 'base64url')), d.final()]).toString('utf8');
}
