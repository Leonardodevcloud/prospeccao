import type { Executor, Pool } from '@prospeccao/db';
import { AppError, cnpjDoTexto, comNome, normalizarTelefone } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import * as agente from '../agente/repositorio.js';
import { leadPorTelefone } from '../agente/repositorio.js';
import { juncoesEnriq } from '../empresas/repositorio.js';
import { dadosDoLead } from '../funil/cadencia.js';
import { criarLeadManual, LeadExistente } from '../funil/novoLead.js';
import * as funil from '../funil/repositorio.js';
import { notificarDono } from '../notificacoes/repositorio.js';

/**
 * Lead que chega de fora (API e formulários do site): deduplica por telefone, e-mail e CNPJ, cria
 * com o destino escolhido e devolve no formato da API. Roda dentro da conta (comConta).
 */

type Deps = Pick<DepsApi, 'pool' | 'filas'>;

export interface LeadDeFora {
  empresa: string;
  contato?: string | null;
  cargo?: string | null;
  telefone?: string | null;
  email?: string | null;
  cnpj?: string | null;
  cidade?: string | null;
  uf?: string | null;
  site?: string | null;
  observacao?: string | null;
}

export interface DestinoDeFora {
  etapaId?: number | null;
  responsavelId?: number | null;
  etiquetas?: string[] | null;
  valorMensal?: number | null;
}

/** O lead da conta com este e-mail ou CNPJ (o telefone o cadastro já confere). */
async function existente(db: Executor, email: string | null, cnpj: string | null): Promise<number | null> {
  const C = contaSql();
  if (cnpj) {
    const { rows } = await db.query<{ id: number }>(
      `SELECT o.empresa_id::int AS id FROM comercial.oportunidades o JOIN descoberta.empresas e ON e.id = o.empresa_id
        WHERE o.conta_id = ${C} AND e.cnpj = $1 LIMIT 1`,
      [cnpj],
    );
    if (rows[0]) return rows[0].id;
  }
  if (email) {
    const { rows } = await db.query<{ id: number }>(
      `SELECT o.empresa_id::int AS id FROM comercial.oportunidades o
        WHERE o.conta_id = ${C}
          AND (EXISTS (SELECT 1 FROM enriquecimento.contatos c
                        WHERE c.empresa_id = o.empresa_id AND c.canal = 'email' AND lower(c.valor) = $1
                          AND c.conta_id IN (0, ${C}))
               OR EXISTS (SELECT 1 FROM comercial.contatos_lead cl
                           WHERE cl.conta_id = ${C} AND cl.empresa_id = o.empresa_id AND lower(cl.email) = $1))
        LIMIT 1`,
      [email],
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

/** Confere que a etapa e o responsável são desta conta (o que vem de fora não é confiável). */
export async function conferirDestino(db: Executor, d: DestinoDeFora): Promise<void> {
  const C = contaSql();
  if (d.etapaId) {
    const { rows } = await db.query(`SELECT 1 FROM comercial.etapas WHERE id = $1 AND conta_id = ${C}`, [
      d.etapaId,
    ]);
    if (!rows[0])
      throw AppError.invalido(`A etapa ${d.etapaId} não existe nesta conta (veja GET /v1/funis).`);
  }
  if (d.responsavelId) {
    const { rows } = await db.query(
      `SELECT 1 FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${C} AND ativo`,
      [d.responsavelId],
    );
    if (!rows[0])
      throw AppError.invalido(
        `O usuário ${d.responsavelId} não está ativo nesta conta (veja GET /v1/usuarios).`,
      );
  }
}

/**
 * Cria (ou acha) o lead. Já existe (mesmo telefone, e-mail ou CNPJ): junta, registrando o que
 * chegou numa nota, e devolve novo = false.
 */
export async function criarOuJuntar(
  deps: Deps,
  l: LeadDeFora,
  destino: DestinoDeFora,
  autor: string,
  notaSeExistir: string,
): Promise<{ empresaId: number; novo: boolean }> {
  const { pool } = deps;
  const email = l.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email) ? l.email.toLowerCase() : null;
  const cnpj = l.cnpj ? cnpjDoTexto(l.cnpj) : null;
  const telefone = l.telefone ? normalizarTelefone(l.telefone) : null;
  const juntar = async (empresaId: number) => {
    const texto = [notaSeExistir, l.observacao].filter(Boolean).join('\n').trim();
    if (texto) await funil.registrarAtividade(pool, empresaId, { tipo: 'nota', direcao: null, texto }, autor);
    return { empresaId, novo: false };
  };
  const ja =
    (telefone ? (await leadPorTelefone(pool, telefone))?.empresaId : null) ??
    (await existente(pool, email, cnpj));
  if (ja) return juntar(ja);

  const observacao = [
    l.observacao,
    l.telefone && !telefone ? `Telefone informado: ${l.telefone}` : null,
    l.cnpj && !cnpj ? `CNPJ informado: ${l.cnpj}` : null,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  try {
    const r = await criarLeadManual(
      deps,
      {
        empresa: l.empresa.slice(0, 160).padEnd(2, '.'),
        contato: l.contato?.slice(0, 120) ?? null,
        cargo: l.cargo?.slice(0, 80) ?? null,
        telefone,
        whatsapp: true,
        email,
        cnpj,
        cidade: l.cidade?.slice(0, 80) ?? null,
        uf: l.uf ?? null,
        site: l.site?.slice(0, 300) ?? null,
        observacao: observacao || null,
        etapaId: destino.etapaId ?? null,
        responsavelId: destino.responsavelId ?? null,
        agente: false,
        enriquecer: false,
      },
      autor,
    );
    if (r.jaExistia) return juntar(r.empresaId);
    const extras: { etiquetas?: string[]; valorMensal?: number } = {};
    if (destino.etiquetas?.length) extras.etiquetas = destino.etiquetas;
    if (destino.valorMensal != null) extras.valorMensal = destino.valorMensal;
    if (Object.keys(extras).length)
      await funil.atualizar(pool, r.empresaId, extras, autor).catch(() => undefined);
    return { empresaId: r.empresaId, novo: true };
  } catch (e) {
    if (e instanceof LeadExistente) return juntar((e.detalhes as { empresaId: number }).empresaId);
    throw e;
  }
}

/** Boas-vindas no WhatsApp (sai pelo motor, no horário) e o aviso para o dono. */
export async function aposCriar(
  pool: Pool,
  empresaId: number,
  o: {
    novo: boolean;
    boasVindas?: string | null;
    contato?: string | null;
    avisar: boolean;
    titulo: string;
    texto: string;
  },
): Promise<void> {
  if (o.novo && o.boasVindas) {
    const { telefone } = await dadosDoLead(pool, empresaId);
    if (telefone)
      await agente.criarMensagem(pool, {
        empresaId,
        direcao: 'enviada',
        texto: comNome(o.boasVindas, o.contato),
        telefone,
        status: 'aprovada',
        origem: 'automatico',
        nota: 'Boas-vindas do formulário do site',
      });
  }
  if (o.avisar) await notificarDono(pool, empresaId, { tipo: 'atribuido', titulo: o.titulo, texto: o.texto });
}

/* ───────────────────────────── Lead no formato da API ───────────────────────────── */

export interface LeadApi {
  id: number;
  empresa: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  site: string | null;
  etapa: { id: number | null; nome: string; papel: string };
  funil: { id: number; nome: string } | null;
  responsavel: { id: number; nome: string } | null;
  contato: { nome: string | null; cargo: string | null; telefone: string | null; email: string | null };
  valorMensal: number | null;
  etiquetas: string[];
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  ultimoContatoEm: string | null;
  motivo: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

interface LinhaLead {
  id: number;
  empresa: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  site: string | null;
  papel: string;
  etapa_id: number | null;
  etapa_nome: string | null;
  pipeline_id: number | null;
  pipeline_nome: string | null;
  responsavel_id: number | null;
  responsavel_nome: string | null;
  contato_nome: string | null;
  contato_cargo: string | null;
  telefone: string | null;
  email: string | null;
  valor_mensal: number | null;
  etiquetas: string[] | null;
  proxima_acao: string | null;
  proxima_acao_em: string | null;
  ultimo_contato_em: string | null;
  motivo: string | null;
  criado_em: string;
  atualizado_em: string;
}

const NOME_PAPEL: Record<string, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
  descartado: 'Descartado',
};

const paraApi = (r: LinhaLead): LeadApi => ({
  id: r.id,
  empresa: r.empresa,
  cnpj: r.cnpj,
  cidade: r.cidade,
  uf: r.uf,
  site: r.site,
  etapa: { id: r.etapa_id, nome: r.etapa_nome ?? NOME_PAPEL[r.papel] ?? r.papel, papel: r.papel },
  funil: r.pipeline_id ? { id: r.pipeline_id, nome: r.pipeline_nome ?? '' } : null,
  responsavel: r.responsavel_id ? { id: r.responsavel_id, nome: r.responsavel_nome ?? '' } : null,
  contato: { nome: r.contato_nome, cargo: r.contato_cargo, telefone: r.telefone, email: r.email },
  valorMensal: r.valor_mensal,
  etiquetas: r.etiquetas ?? [],
  proximaAcao: r.proxima_acao,
  proximaAcaoEm: r.proxima_acao_em,
  ultimoContatoEm: r.ultimo_contato_em,
  motivo: r.motivo,
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
});

/** Leads da conta no formato da API (filtro e ordem montados por quem chama, com $1… dos valores). */
export async function leadsApi(
  db: Executor,
  where: string[],
  valores: unknown[],
  limite: number,
): Promise<LeadApi[]> {
  const C = contaSql();
  const { rows } = await db.query<LinhaLead>(
    `SELECT o.empresa_id::int AS id, coalesce(e.maps_nome, e.nome) AS empresa, e.cnpj, e.cidade, e.uf,
            e.maps_site AS site, o.etapa AS papel, o.etapa_id, et.nome AS etapa_nome, pi.id AS pipeline_id,
            pi.nome AS pipeline_nome, o.responsavel_id, resp.nome AS responsavel_nome,
            coalesce(cl.nome, dec.nome) AS contato_nome, coalesce(cl.cargo, dec.cargo) AS contato_cargo,
            coalesce(cl.telefone, o.whatsapp_destino,
                     CASE WHEN pc.canal IN ('whatsapp', 'telefone') THEN pc.valor END, e.maps_telefone) AS telefone,
            coalesce(cl.email, (SELECT c.valor FROM enriquecimento.contatos c
                                 WHERE c.empresa_id = o.empresa_id AND c.canal = 'email' AND c.status <> 'invalido'
                                   AND c.conta_id IN (0, ${C})
                                 ORDER BY c.principal DESC, c.confianca DESC LIMIT 1)) AS email,
            o.valor_mensal::float8 AS valor_mensal, o.etiquetas, o.proxima_acao, o.proxima_acao_em,
            o.ultimo_contato_em, o.motivo, o.criado_em, o.atualizado_em
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN comercial.pipelines pi ON pi.id = et.pipeline_id
       LEFT JOIN cadastro.usuarios resp ON resp.id = o.responsavel_id
       LEFT JOIN LATERAL (
         SELECT nome, cargo, telefone, email FROM comercial.contatos_lead x
          WHERE x.conta_id = ${C} AND x.empresa_id = o.empresa_id AND x.status = 'confirmado'
          ORDER BY x.decisor DESC, x.criado_em LIMIT 1
       ) cl ON true
       ${juncoesEnriq()}
      WHERE o.conta_id = ${C} AND ${where.length ? where.join(' AND ') : 'true'}
      ORDER BY o.empresa_id DESC
      LIMIT ${Math.max(1, Math.min(100, Math.trunc(limite)))}`,
    valores,
  );
  return rows.map(paraApi);
}

export async function leadApi(db: Executor, empresaId: number): Promise<LeadApi | null> {
  return (await leadsApi(db, ['o.empresa_id = $1'], [empresaId], 1))[0] ?? null;
}

export async function exigirLeadApi(db: Executor, empresaId: number): Promise<LeadApi> {
  const l = await leadApi(db, empresaId);
  if (!l) throw AppError.naoEncontrado('Lead');
  return l;
}
