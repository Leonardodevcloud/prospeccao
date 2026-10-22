import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Executor } from './pool.js';

/**
 * Credenciais das APIs de cada conta (Google Places, Resend, WhatsApp/Evolution, IA, ORS).
 *
 * Os segredos ficam cifrados no banco com AES-256-GCM; a chave vem da variável CHAVE_CREDENCIAIS
 * (a mesma na api e nos workers que usam as credenciais). Quem tem só o banco não lê as chaves.
 *
 * Regra de uso: o que a conta cadastrou vale; a conta principal (a da plataforma) usa as
 * variáveis do ambiente quando não cadastrou; a IA cai na da plataforma para todas as contas.
 * Busca no Google (Places) e geolocalização (ORS) são serviços da plataforma: toda conta sem
 * chave própria usa a do ambiente (o uso do Google é contado e limitado por conta).
 * Cada grupo (Resend, Evolution, IA) vem inteiro de um lugar só: nunca a chave de um com o
 * domínio do outro.
 */

export const CAMPOS_SEGREDO = [
  'placesKey',
  'resendKey',
  'resendWebhookSegredo',
  'evolutionKey',
  'iaKey',
  'orsKey',
] as const;
export type CampoSegredo = (typeof CAMPOS_SEGREDO)[number];
export type SegredosConta = Partial<Record<CampoSegredo, string>>;

export interface CredenciaisConta {
  contaId: number;
  principal: boolean;
  /** Sem IA própria, usa a da plataforma (a conta principal sempre usa). */
  usaIaPlataforma: boolean;
  emailRemetente: string | null;
  resendDominioRespostas: string | null;
  evolutionUrl: string | null;
  evolutionInstancia: string | null;
  iaProvedor: string | null;
  iaModelo: string | null;
  iaBaseUrl: string | null;
  segredos: SegredosConta;
  /** Final de cada segredo cadastrado ("…a1b2"), para a tela. */
  dicas: Partial<Record<CampoSegredo, string>>;
  atualizadoEm: string | null;
  /** Segredos cadastrados que não abriram (CHAVE_CREDENCIAIS diferente da usada para gravar). */
  erro: string | null;
  /** Módulos contratados (null: conta sem plano, vale tudo). */
  modulos?: string[] | null;
}

/** O que o serviço tem no ambiente (variáveis do Railway), usado pela conta principal. */
export interface CredenciaisAmbiente {
  placesKey?: string | null;
  orsKey?: string | null;
  resendKey?: string | null;
  emailRemetente?: string | null;
  resendDominioRespostas?: string | null;
  resendWebhookSegredo?: string | null;
  evolutionUrl?: string | null;
  evolutionKey?: string | null;
  evolutionInstancia?: string | null;
  iaProvedor?: string | null;
  iaKey?: string | null;
  iaModelo?: string | null;
  iaBaseUrl?: string | null;
}

export type Origem = 'conta' | 'plataforma' | null;

export interface CredenciaisEfetivas {
  contaId: number;
  places: { apiKey: string } | null;
  ors: { apiKey: string } | null;
  resend: {
    apiKey: string;
    remetente: string;
    dominioRespostas: string | null;
    webhookSegredo: string | null;
  } | null;
  evolution: { url: string; apiKey: string; instancia: string } | null;
  ia: { provedor: string | null; apiKey: string; modelo: string | null; baseUrl: string | null } | null;
  origem: Record<'places' | 'ors' | 'resend' | 'evolution' | 'ia', Origem>;
  erro: string | null;
  /** Módulos contratados (null: conta sem plano, vale tudo). */
  modulos?: string[] | null;
}

/* ───────────── Cifra ───────────── */

const PREFIXO = 'v1:';
const chaveDe = (segredo: string) => createHash('sha256').update(segredo, 'utf8').digest();

export function cifrar(segredo: string, texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveDe(segredo), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return PREFIXO + Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64');
}

export function decifrar(segredo: string, cifrado: string): string {
  if (!cifrado.startsWith(PREFIXO)) throw new Error('formato desconhecido');
  const bruto = Buffer.from(cifrado.slice(PREFIXO.length), 'base64');
  const d = createDecipheriv('aes-256-gcm', chaveDe(segredo), bruto.subarray(0, 12));
  d.setAuthTag(bruto.subarray(12, 28));
  return Buffer.concat([d.update(bruto.subarray(28)), d.final()]).toString('utf8');
}

/** "…a1b2": o suficiente para reconhecer a chave sem mostrá-la. */
export function dicaDoSegredo(v: string): string {
  return v.length <= 8 ? '…' : `…${v.slice(-4)}`;
}

/* ───────────── Leitura e gravação ───────────── */

interface LinhaCredenciais {
  principal: boolean;
  usa_ia_plataforma: boolean;
  email_remetente: string | null;
  resend_dominio_respostas: string | null;
  evolution_url: string | null;
  evolution_instancia: string | null;
  ia_provedor: string | null;
  ia_modelo: string | null;
  ia_base_url: string | null;
  segredos: string | null;
  dicas: Partial<Record<CampoSegredo, string>> | null;
  atualizado_em: string | null;
  modulos: string[] | null;
}

export async function lerCredenciais(
  db: Executor,
  contaId: number,
  chave: string | null | undefined,
): Promise<CredenciaisConta | null> {
  const { rows } = await db.query<LinhaCredenciais>(
    `SELECT c.principal, c.usa_ia_plataforma, k.email_remetente, k.resend_dominio_respostas, k.evolution_url, k.evolution_instancia,
            k.ia_provedor, k.ia_modelo, k.ia_base_url, k.segredos, k.dicas, k.atualizado_em,
            CASE WHEN c.plano IS NULL THEN NULL ELSE c.modulos END AS modulos
       FROM cadastro.contas c LEFT JOIN cadastro.credenciais_conta k ON k.conta_id = c.id
      WHERE c.id = $1`,
    [contaId],
  );
  const r = rows[0];
  if (!r) return null;
  let segredos: SegredosConta = {};
  let erro: string | null = null;
  if (r.segredos) {
    if (!chave)
      erro = 'CHAVE_CREDENCIAIS não configurada neste serviço: as chaves da conta não podem ser lidas.';
    else
      try {
        segredos = JSON.parse(decifrar(chave, r.segredos)) as SegredosConta;
      } catch {
        erro =
          'As chaves da conta não abriram: a CHAVE_CREDENCIAIS deste serviço é diferente da usada para gravar.';
      }
  }
  return {
    contaId,
    principal: r.principal,
    usaIaPlataforma: r.usa_ia_plataforma,
    emailRemetente: r.email_remetente,
    resendDominioRespostas: r.resend_dominio_respostas,
    evolutionUrl: r.evolution_url,
    evolutionInstancia: r.evolution_instancia,
    iaProvedor: r.ia_provedor,
    iaModelo: r.ia_modelo,
    iaBaseUrl: r.ia_base_url,
    segredos,
    dicas: r.dicas ?? {},
    atualizadoEm: r.atualizado_em,
    erro,
    modulos: r.modulos,
  };
}

/** Campos comuns: undefined = não mexe; null ou '' = apaga. */
export interface AlteracaoCredenciais {
  emailRemetente?: string | null;
  resendDominioRespostas?: string | null;
  evolutionUrl?: string | null;
  evolutionInstancia?: string | null;
  iaProvedor?: string | null;
  iaModelo?: string | null;
  iaBaseUrl?: string | null;
  /** Segredos: undefined = mantém o que está; null ou '' = apaga; texto = troca. */
  segredos?: Partial<Record<CampoSegredo, string | null>>;
}

export async function salvarCredenciais(
  db: Executor,
  contaId: number,
  d: AlteracaoCredenciais,
  chave: string | null | undefined,
  usuarioId: number | null,
): Promise<void> {
  const atual = await lerCredenciais(db, contaId, chave);
  if (!atual) throw new Error(`Conta ${contaId} não existe`);
  const mexeEmSegredo = d.segredos && Object.values(d.segredos).some((v) => v !== undefined);
  if (mexeEmSegredo && !chave)
    throw new Error('Configure CHAVE_CREDENCIAIS no ambiente para guardar chaves de API.');
  if (mexeEmSegredo && atual.erro)
    throw new Error(`${atual.erro} Use a mesma CHAVE_CREDENCIAIS em todos os serviços.`);

  const segredos: SegredosConta = { ...atual.segredos };
  const dicas = { ...atual.dicas };
  for (const campo of CAMPOS_SEGREDO) {
    const v = d.segredos?.[campo];
    if (v === undefined) continue;
    const limpo = v?.trim() ?? '';
    if (limpo) {
      segredos[campo] = limpo;
      dicas[campo] = dicaDoSegredo(limpo);
    } else {
      delete segredos[campo];
      delete dicas[campo];
    }
  }
  const texto = (v: string | null | undefined, antes: string | null) =>
    v === undefined ? antes : v?.trim() || null;
  const temSegredo = Object.keys(segredos).length > 0;
  await db.query(
    `INSERT INTO cadastro.credenciais_conta
       (conta_id, email_remetente, resend_dominio_respostas, evolution_url, evolution_instancia,
        ia_provedor, ia_modelo, ia_base_url, segredos, dicas, atualizado_em, atualizado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
     ON CONFLICT (conta_id) DO UPDATE SET
       email_remetente = EXCLUDED.email_remetente, resend_dominio_respostas = EXCLUDED.resend_dominio_respostas,
       evolution_url = EXCLUDED.evolution_url, evolution_instancia = EXCLUDED.evolution_instancia,
       ia_provedor = EXCLUDED.ia_provedor, ia_modelo = EXCLUDED.ia_modelo, ia_base_url = EXCLUDED.ia_base_url,
       segredos = EXCLUDED.segredos, dicas = EXCLUDED.dicas, atualizado_em = now(),
       atualizado_por = EXCLUDED.atualizado_por`,
    [
      contaId,
      texto(d.emailRemetente, atual.emailRemetente)?.toLowerCase() ?? null,
      texto(d.resendDominioRespostas, atual.resendDominioRespostas)?.toLowerCase().replace(/^@/, '') ?? null,
      texto(d.evolutionUrl, atual.evolutionUrl)?.replace(/\/+$/, '') ?? null,
      texto(d.evolutionInstancia, atual.evolutionInstancia),
      texto(d.iaProvedor, atual.iaProvedor),
      texto(d.iaModelo, atual.iaModelo),
      texto(d.iaBaseUrl, atual.iaBaseUrl),
      temSegredo && chave ? cifrar(chave, JSON.stringify(segredos)) : null,
      JSON.stringify(dicas),
      usuarioId,
    ],
  );
}

/* ───────────── O que vale para a conta ───────────── */

const valor = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

/** Junta o que a conta cadastrou com o ambiente, grupo a grupo (ver regra no topo). */
export function resolverCredenciais(
  c: CredenciaisConta | null,
  ambiente: CredenciaisAmbiente,
  contaId: number,
): CredenciaisEfetivas {
  const s = c?.segredos ?? {};
  const usaAmbiente = !!c?.principal;
  const r: CredenciaisEfetivas = {
    contaId,
    places: null,
    ors: null,
    resend: null,
    evolution: null,
    ia: null,
    origem: { places: null, ors: null, resend: null, evolution: null, ia: null },
    erro: c?.erro ?? null,
    modulos: c?.modulos ?? null,
  };

  const simples = (campo: 'placesKey' | 'orsKey', amb: string | null | undefined, nome: 'places' | 'ors') => {
    if (valor(s[campo])) {
      r[nome] = { apiKey: valor(s[campo])! };
      r.origem[nome] = 'conta';
    } else if (valor(amb)) {
      r[nome] = { apiKey: valor(amb)! };
      r.origem[nome] = 'plataforma';
    }
  };
  simples('placesKey', ambiente.placesKey, 'places');
  simples('orsKey', ambiente.orsKey, 'ors');

  if (valor(s.resendKey) && valor(c?.emailRemetente)) {
    r.resend = {
      apiKey: valor(s.resendKey)!,
      remetente: valor(c?.emailRemetente)!,
      dominioRespostas: valor(c?.resendDominioRespostas),
      webhookSegredo: valor(s.resendWebhookSegredo),
    };
    r.origem.resend = 'conta';
  } else if (usaAmbiente && valor(ambiente.resendKey) && valor(ambiente.emailRemetente)) {
    r.resend = {
      apiKey: valor(ambiente.resendKey)!,
      remetente: valor(ambiente.emailRemetente)!,
      dominioRespostas: valor(ambiente.resendDominioRespostas),
      webhookSegredo: valor(ambiente.resendWebhookSegredo),
    };
    r.origem.resend = 'plataforma';
  }

  if (valor(s.evolutionKey) && valor(c?.evolutionUrl) && valor(c?.evolutionInstancia)) {
    r.evolution = {
      url: valor(c?.evolutionUrl)!,
      apiKey: valor(s.evolutionKey)!,
      instancia: valor(c?.evolutionInstancia)!,
    };
    r.origem.evolution = 'conta';
  } else if (
    usaAmbiente &&
    valor(ambiente.evolutionKey) &&
    valor(ambiente.evolutionUrl) &&
    valor(ambiente.evolutionInstancia)
  ) {
    r.evolution = {
      url: valor(ambiente.evolutionUrl)!,
      apiKey: valor(ambiente.evolutionKey)!,
      instancia: valor(ambiente.evolutionInstancia)!,
    };
    r.origem.evolution = 'plataforma';
  }

  if (valor(s.iaKey)) {
    r.ia = {
      provedor: valor(c?.iaProvedor),
      apiKey: valor(s.iaKey)!,
      modelo: valor(c?.iaModelo),
      baseUrl: valor(c?.iaBaseUrl),
    };
    r.origem.ia = 'conta';
  } else if (valor(ambiente.iaKey) && (c?.principal || c?.usaIaPlataforma !== false)) {
    r.ia = {
      provedor: valor(ambiente.iaProvedor),
      apiKey: valor(ambiente.iaKey)!,
      modelo: valor(ambiente.iaModelo),
      baseUrl: valor(ambiente.iaBaseUrl),
    };
    r.origem.ia = 'plataforma';
  }
  return r;
}

export async function credenciaisEfetivas(
  db: Executor,
  contaId: number,
  chave: string | null | undefined,
  ambiente: CredenciaisAmbiente,
): Promise<CredenciaisEfetivas> {
  return resolverCredenciais(await lerCredenciais(db, contaId, chave), ambiente, contaId);
}

/** Lembra as credenciais por um minuto (cada envio, busca ou lead não vai ao banco de novo). */
export function cacheDeCredenciais(
  db: Executor,
  chave: string | null | undefined,
  ambiente: CredenciaisAmbiente,
  ttlMs = 60_000,
) {
  const cache = new Map<number, { em: number; valor: Promise<CredenciaisEfetivas> }>();
  return {
    obter(contaId: number): Promise<CredenciaisEfetivas> {
      const c = cache.get(contaId);
      if (c && Date.now() - c.em < ttlMs) return c.valor;
      const valor = credenciaisEfetivas(db, contaId, chave, ambiente);
      cache.set(contaId, { em: Date.now(), valor });
      valor.catch(() => cache.delete(contaId));
      return valor;
    },
    invalidar(contaId?: number) {
      if (contaId == null) cache.clear();
      else cache.delete(contaId);
    },
  };
}

/* ───────────── Contas ───────────── */

export async function contaDaCampanha(db: Executor, campanhaId: number): Promise<number | null> {
  const { rows } = await db.query<{ conta_id: number }>(
    'SELECT conta_id FROM cadastro.campanhas WHERE id = $1',
    [campanhaId],
  );
  return rows[0]?.conta_id ?? null;
}

export async function contasAtivas(db: Executor): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM cadastro.contas WHERE ativa ORDER BY id');
  return rows.map((r) => r.id);
}

/** Variável CHAVE_CREDENCIAIS (opcional; sem ela, só a conta principal funciona, pelo ambiente). */
export function chaveDoAmbiente(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.CHAVE_CREDENCIAIS?.trim();
  return v && v.length >= 16 ? v : null;
}
