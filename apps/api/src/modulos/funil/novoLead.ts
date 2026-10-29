import { comTransacao, gravarLead, listaDeLeadsManuais, type Pool } from '@prospeccao/db';
import {
  AppError,
  cnpjDoTexto,
  formatarTelefone,
  instagramDoTexto,
  type LeadImportado,
  type LeadManualEntrada,
  normalizarTelefone,
  normalizarUf,
  siteDoTexto,
  ufDoTelefone,
} from '@prospeccao/shared';
import { conta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { leadPorTelefone } from '../agente/repositorio.js';
import * as contatos from '../contatos/repositorio.js';
import { pararSequencia, RESPONDEU_WHATSAPP } from '../email/sequencia.js';
import { definirResponsavel } from '../equipe/repositorio.js';
import { adicionar, atualizar, deOutraUnidade, registrarAtividade } from './repositorio.js';

/**
 * Lead cadastrado à mão: no quadro do funil, a partir de uma conversa de um número que não é lead,
 * ou sozinho quando a conta escolheu "conversa nova no WhatsApp vira lead". Entra na lista
 * "Cadastrados à mão e do WhatsApp" da conta e direto no funil.
 */

type Deps = Pick<DepsApi, 'pool' | 'filas'>;

export class LeadExistente extends AppError {
  constructor(nome: string, empresaId: number) {
    super(409, 'lead_existente', `Este telefone já é do lead "${nome}".`, { detalhes: { empresaId } });
  }
}

export async function criarLeadManual(
  deps: Deps,
  d: LeadManualEntrada,
  autor: string,
): Promise<{ empresaId: number; jaExistia: boolean }> {
  const { pool } = deps;
  const telefone = d.telefone ? normalizarTelefone(d.telefone) : null;
  if (d.telefone && !telefone)
    throw AppError.invalido('Telefone inválido: use DDD + número (ex.: 71 99999-1234).');
  const cnpj = d.cnpj ? cnpjDoTexto(d.cnpj) : null;
  if (d.cnpj && !cnpj) throw AppError.invalido('CNPJ inválido: confira os números.');

  // O mesmo telefone já é de um lead do funil: não cria outro, abre o que existe.
  if (telefone) {
    const ja = await leadPorTelefone(pool, telefone);
    if (ja) {
      const { rows } = await pool.query<{ nome: string }>(
        'SELECT nome FROM descoberta.empresas WHERE id = $1',
        [ja.empresaId],
      );
      throw new LeadExistente(rows[0]?.nome ?? 'sem nome', ja.empresaId);
    }
  }

  let campanhaId: number;
  try {
    campanhaId = await listaDeLeadsManuais(pool, conta());
  } catch (erro) {
    if ((erro as Error).message === 'SEM_NICHO')
      throw AppError.invalido('Crie um nicho em Nichos antes de cadastrar leads (ele guia a nota e a IA).');
    throw erro;
  }
  const lead: LeadImportado = {
    empresa: d.empresa,
    contato: d.contato?.trim() || null,
    cargo: d.cargo?.trim() || null,
    telefones: telefone ? [{ numero: telefone, whatsapp: d.whatsapp }] : [],
    emails: d.email ? [d.email] : [],
    cnpj,
    cidade: d.cidade?.trim() || '',
    // Sem UF: a do DDD do telefone.
    uf: normalizarUf(d.uf) ?? ufDoTelefone(telefone) ?? '',
    endereco: null,
    cep: null,
    site: d.site ? siteDoTexto(d.site) : null,
    instagram: d.instagram ? instagramDoTexto(d.instagram) : null,
    observacao: d.observacao?.trim() || null,
    semEmpresa: false,
    linhas: [],
  };
  const { empresaId } = await comTransacao(pool, async (db) => {
    const g = await gravarLead(db, conta(), campanhaId, lead, 'manual');
    if (g.suprimida)
      throw AppError.conflito(
        'Este contato pediu para ser esquecido (LGPD) e não pode ser cadastrado de novo nesta organização.',
      );
    // A mesma empresa já é trabalhada por outra unidade da organização: desfaz e avisa.
    const [dona] = await deOutraUnidade(db, [g.empresaId]);
    if (dona)
      throw AppError.conflito(
        `${dona.nome} já é trabalhada pela unidade ${dona.unidade}. Peça ao gestor se precisar transferir.`,
      );
    return g;
  });

  const r = await adicionar(pool, { empresaIds: [empresaId], etapa: 'a_abordar', forcar: true }, autor);
  const jaExistia = r.jaNoFunil > 0;
  if (!jaExistia) {
    if (d.etapaId) await atualizar(pool, empresaId, { etapaId: d.etapaId }, autor);
    if (d.responsavelId) await definirResponsavel(pool, empresaId, d.responsavelId, 'cadastro manual');
    if (d.agente) await atualizar(pool, empresaId, { agente: true }, autor);
  }
  if (lead.observacao)
    await registrarAtividade(pool, empresaId, { tipo: 'nota', direcao: null, texto: lead.observacao }, autor);
  if (d.enriquecer) {
    const { rows } = await pool.query(
      `UPDATE descoberta.campanha_empresas SET enriquecimento_solicitado_em = now(), dentro_do_raio = true
        WHERE campanha_id = $1 AND empresa_id = $2 AND enriquecimento_solicitado_em IS NULL
        RETURNING 1`,
      [campanhaId, empresaId],
    );
    if (rows.length) await deps.filas.publicar('enriquecimento.solicitar', { empresaId, campanhaId });
  }
  if (d.telefoneConversa)
    await trazerConversa(pool, d.telefoneConversa, {
      empresaId,
      nome: lead.contato ?? lead.empresa,
      cargo: lead.cargo,
      autor,
    });
  return { empresaId, jaExistia };
}

/**
 * As mensagens de um número de "Não identificados" vão para a conversa do lead: o número vira
 * contato da negociação e, se ele já tinha escrito, a etapa anda e a sequência automática para.
 */
export async function trazerConversa(
  pool: Pool,
  telefone: string,
  d: {
    empresaId: number;
    nome: string;
    cargo?: string | null;
    indicadoPorId?: number | null;
    indicadoPorTexto?: string | null;
    autor: string;
  },
) {
  const v = await contatos.vincular(pool, telefone, {
    empresaId: d.empresaId,
    nome: d.nome,
    cargo: d.cargo ?? null,
    indicadoPorId: d.indicadoPorId ?? null,
    indicadoPorTexto: d.indicadoPorTexto ?? null,
    conversarCom: true,
  });
  if (v.recebidas) {
    await pararSequencia(pool, d.empresaId, RESPONDEU_WHATSAPP);
    await registrarAtividade(
      pool,
      d.empresaId,
      { tipo: 'whatsapp', direcao: 'recebida', texto: undefined, contato: telefone },
      d.nome,
    );
  }
  await registrarAtividade(
    pool,
    d.empresaId,
    {
      tipo: 'nota',
      direcao: null,
      texto: `${d.nome}${d.cargo ? ` (${d.cargo})` : ''} entrou na negociação: as mensagens do número ${formatarTelefone(telefone.replace(/\D/g, ''))} vieram para esta conversa.`,
    },
    d.autor,
  );
  return v;
}

/** Nome para o lead que chegou por uma conversa nova (o nome do WhatsApp ou o número). */
export function nomeDaConversa(nome: string | null | undefined, telefone: string): string {
  const n = nome?.trim();
  return n && /\p{L}/u.test(n) ? n.slice(0, 120) : formatarTelefone(telefone);
}
