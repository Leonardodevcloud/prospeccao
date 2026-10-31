import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Executor } from '@prospeccao/db';
import {
  AppError,
  type ChaveApiEntrada,
  LIMITES_API,
  type PermissaoApi,
  PREFIXO_CHAVE_API,
} from '@prospeccao/shared';
import { contaSql, usuarioAtual } from '../../contexto.js';

/**
 * Chaves da API: geradas aqui, mostradas uma vez; no banco ficam só o fim (para reconhecer) e o
 * hash SHA-256. Quem chama manda "Authorization: Bearer pt_live_…".
 */

const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function gerarChave(): string {
  const b = randomBytes(32);
  let s = '';
  for (const x of b) s += ALFABETO[x % 62];
  return `${PREFIXO_CHAVE_API}${s}`;
}

export const hashDaChave = (chave: string) => createHash('sha256').update(chave).digest('hex');

export interface ChaveAutenticada {
  id: number;
  contaId: number;
  nome: string;
  permissoes: PermissaoApi[];
}

export async function criar(db: Executor, d: ChaveApiEntrada) {
  const chave = gerarChave();
  const u = usuarioAtual();
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.api_chaves (conta_id, nome, final, hash, permissoes, ips, expira_em, criado_por, criado_por_nome)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5,
             CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(days => $6::int) END, $7, $8)
     RETURNING id::int`,
    [
      d.nome,
      chave.slice(-4),
      hashDaChave(chave),
      d.permissoes,
      d.ips,
      d.validadeDias,
      u?.id ?? null,
      u?.nome ?? null,
    ],
  );
  return { id: rows[0]!.id, chave };
}

export async function listar(db: Executor) {
  const { rows } = await db.query(
    `SELECT id::int, nome, final, permissoes, ips, expira_em AS "expiraEm", criado_por_nome AS "criadoPor",
            criada_em AS "criadaEm", revogada_em AS "revogadaEm", revogada_por AS "revogadaPor",
            ultimo_uso_em AS "ultimoUsoEm", ultimo_ip AS "ultimoIp",
            CASE WHEN usos_dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN usos_hoje ELSE 0 END AS "usosHoje"
       FROM comercial.api_chaves WHERE conta_id = ${contaSql()}
      ORDER BY revogada_em IS NOT NULL, criada_em DESC`,
  );
  return rows;
}

export async function revogar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.api_chaves SET revogada_em = now(), revogada_por = $2
      WHERE id = $1 AND conta_id = ${contaSql()} AND revogada_em IS NULL`,
    [id, usuarioAtual()?.nome ?? null],
  );
  if (!rowCount) throw AppError.naoEncontrado('Chave');
}

/* ───────────────────────────── IP permitido ───────────────────────────── */

function ipv4ParaNumero(ip: string): number {
  return ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
}

function ipv6ParaBigint(ip: string): bigint {
  const [a = '', b = ''] = ip.split('::');
  const pa = a ? a.split(':') : [];
  const pb = b ? b.split(':') : [];
  const meio = ip.includes('::') ? Array(8 - pa.length - pb.length).fill('0') : [];
  return [...pa, ...meio, ...pb].reduce((n, h) => (n << 16n) + BigInt(Number.parseInt(h || '0', 16)), 0n);
}

/** O IP está na lista (IP exato ou faixa CIDR)? */
export function ipPermitido(ip: string, lista: readonly string[]): boolean {
  if (!lista.length) return true;
  const limpo = ip.replace(/^::ffff:/, '');
  const v = isIP(limpo);
  for (const item of lista) {
    const [base = '', bitsTxt] = item.split('/');
    const vb = isIP(base);
    if (!vb || vb !== v) continue;
    if (v === 4) {
      const bits = bitsTxt === undefined ? 32 : Number(bitsTxt);
      const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((ipv4ParaNumero(limpo) & mascara) >>> 0 === (ipv4ParaNumero(base) & mascara) >>> 0) return true;
    } else {
      const bits = BigInt(bitsTxt === undefined ? 128 : Number(bitsTxt));
      const desloc = 128n - bits;
      if (ipv6ParaBigint(limpo) >> desloc === ipv6ParaBigint(base) >> desloc) return true;
    }
  }
  return false;
}

/* ───────────────────────────── Autenticar e contar ───────────────────────────── */

const porMinuto = new Map<number, { minuto: number; n: number }>();

/** Esquece a contagem por minuto (os testes usam). */
export function zerarLimites(): void {
  porMinuto.clear();
}

/** Só para os testes: finge que a chave já fez n chamadas neste minuto. */
export function usoNoMinuto(chaveId: number, n: number): void {
  porMinuto.set(chaveId, { minuto: Math.floor(Date.now() / 60_000), n });
}

/**
 * Confere a chave (existe, não foi revogada nem venceu, IP permitido) e conta o uso. Limites: por
 * minuto, por chave (na memória deste servidor) e por dia, por conta (no banco).
 */
export async function autenticar(
  db: Executor,
  cabecalho: string | undefined,
  ip: string,
): Promise<ChaveAutenticada> {
  const m = /^Bearer\s+(\S+)$/i.exec(cabecalho ?? '');
  if (!m)
    throw new AppError(401, 'sem_chave', 'Mande a chave no cabeçalho "Authorization: Bearer <sua chave>".');
  const { rows } = await db.query<{
    id: number;
    conta_id: number;
    nome: string;
    permissoes: PermissaoApi[];
    ips: string[];
    revogada_em: string | null;
    expira_em: string | null;
    vencida: boolean;
  }>(
    `SELECT id::int, conta_id, nome, permissoes, ips, revogada_em, expira_em, (expira_em < now()) AS vencida
       FROM comercial.api_chaves WHERE hash = $1`,
    [hashDaChave(m[1]!)],
  );
  const c = rows[0];
  if (!c) throw new AppError(401, 'chave_invalida', 'Chave inválida. Confira em Gestão › Integrações.');
  if (c.revogada_em)
    throw new AppError(401, 'chave_revogada', 'Esta chave foi revogada. Crie outra em Gestão › Integrações.');
  if (c.vencida)
    throw new AppError(401, 'chave_vencida', 'Esta chave venceu. Crie outra em Gestão › Integrações.');
  if (!ipPermitido(ip, c.ips))
    throw new AppError(403, 'ip_nao_permitido', `Esta chave não pode ser usada do endereço ${ip}.`);

  const minuto = Math.floor(Date.now() / 60_000);
  const pm = porMinuto.get(c.id);
  if (pm && pm.minuto === minuto && pm.n >= LIMITES_API.porMinuto)
    throw new AppError(
      429,
      'limite_por_minuto',
      `Limite de ${LIMITES_API.porMinuto} chamadas por minuto. Espere um pouco.`,
      {
        detalhes: { tenteEm: 60 - Math.floor((Date.now() / 1000) % 60) },
      },
    );
  porMinuto.set(c.id, pm && pm.minuto === minuto ? { minuto, n: pm.n + 1 } : { minuto, n: 1 });

  const { rows: uso } = await db.query<{ chamadas: number }>(
    `INSERT INTO comercial.api_uso (conta_id, dia, chamadas)
     VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 1)
     ON CONFLICT (conta_id, dia) DO UPDATE SET chamadas = comercial.api_uso.chamadas + 1
     RETURNING chamadas`,
    [c.conta_id],
  );
  if ((uso[0]?.chamadas ?? 0) > LIMITES_API.porDia)
    throw new AppError(
      429,
      'limite_por_dia',
      `A conta passou de ${LIMITES_API.porDia.toLocaleString('pt-BR')} chamadas hoje. O limite volta à meia-noite.`,
    );
  await db.query(
    `UPDATE comercial.api_chaves
        SET ultimo_uso_em = now(), ultimo_ip = $2,
            usos_hoje = CASE WHEN usos_dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN usos_hoje + 1 ELSE 1 END,
            usos_dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      WHERE id = $1`,
    [c.id, ip.slice(0, 60)],
  );
  return { id: c.id, contaId: c.conta_id, nome: c.nome, permissoes: c.permissoes };
}

/** Conta erro, lead criado ou duplicado no uso do dia. */
export async function contarUso(
  db: Executor,
  contaId: number,
  campo: 'erros' | 'leads_criados' | 'duplicados',
): Promise<void> {
  await db.query(
    `INSERT INTO comercial.api_uso (conta_id, dia, ${campo})
     VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 1)
     ON CONFLICT (conta_id, dia) DO UPDATE SET ${campo} = comercial.api_uso.${campo} + 1`,
    [contaId],
  );
}

/** Números da tela: hoje e os últimos 30 dias. */
export async function uso(db: Executor) {
  const { rows } = await db.query<{
    chamadasHoje: number;
    errosHoje: number;
    leads30: number;
    duplicados30: number;
  }>(
    `SELECT coalesce(sum(chamadas) FILTER (WHERE dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date), 0)::int AS "chamadasHoje",
            coalesce(sum(erros) FILTER (WHERE dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date), 0)::int AS "errosHoje",
            coalesce(sum(leads_criados), 0)::int AS "leads30", coalesce(sum(duplicados), 0)::int AS "duplicados30"
       FROM comercial.api_uso
      WHERE conta_id = ${contaSql()} AND dia > (now() AT TIME ZONE 'America/Sao_Paulo')::date - 30`,
  );
  return { ...rows[0]!, limiteDia: LIMITES_API.porDia, limiteMinuto: LIMITES_API.porMinuto };
}
