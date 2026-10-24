import {
  CAMPOS_SEGREDO,
  type CredenciaisAmbiente,
  comTransacao,
  type Executor,
  lerCredenciais,
  type Pool,
  resolverCredenciais,
} from '@prospeccao/db';
import { configIa, ROTULO_PROVEDOR_IA } from '@prospeccao/integrations/ia';
import { AppError, type ContaAtualizar, type ContaNova } from '@prospeccao/shared';
import { comConta } from '../../contexto.js';
import * as equipe from '../equipe/repositorio.js';

/**
 * Painel master: as contas (empresas) que usam o sistema. Aqui as consultas atravessam as contas
 * de propósito (só o master chega neste módulo).
 */

export async function listar(db: Executor) {
  const { rows } = await db.query(
    `SELECT c.id, c.nome, c.ativa, c.principal, c.observacoes, c.criado_em AS "criadoEm",
            c.limite_ia_mes AS "limiteIaMes", c.usa_ia_plataforma AS "usaIaPlataforma",
            (SELECT count(*)::int FROM cadastro.usuarios u WHERE u.conta_id = c.id AND u.ativo) AS usuarios,
            (SELECT max(u.ultimo_acesso) FROM cadastro.usuarios u WHERE u.conta_id = c.id) AS "ultimoAcesso",
            (SELECT count(*)::int FROM cadastro.campanhas cp WHERE cp.conta_id = c.id AND cp.status = 'ativa')
              AS "campanhasAtivas",
            (SELECT count(*)::int FROM comercial.oportunidades o
              WHERE o.conta_id = c.id AND o.etapa NOT IN ('ganho', 'perdido', 'descartado')) AS "leadsNoFunil",
            (SELECT count(*)::int FROM comercial.envios_email en
              WHERE en.conta_id = c.id AND en.status = 'enviado' AND en.enviado_em > now() - interval '30 days')
              AS "emails30d",
            (SELECT count(*)::int FROM comercial.mensagens m
              WHERE m.conta_id = c.id AND m.direcao = 'enviada' AND m.criado_em > now() - interval '30 days')
              AS "whatsapp30d"
       FROM cadastro.contas c
      ORDER BY c.principal DESC, c.ativa DESC, c.nome`,
  );
  return rows;
}

export async function obter(db: Executor, id: number) {
  const { rows } = await db.query<{
    id: number;
    nome: string;
    ativa: boolean;
    principal: boolean;
    observacoes: string | null;
    criadoEm: string;
    webhookToken: string;
    webhookWhatsapp: string | null;
  }>(
    `SELECT c.id, c.nome, c.ativa, c.principal, c.observacoes, c.criado_em AS "criadoEm",
            c.webhook_token AS "webhookToken",
            (SELECT a.webhook_token FROM comercial.config_agente a WHERE a.conta_id = c.id) AS "webhookWhatsapp"
       FROM cadastro.contas c WHERE c.id = $1`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Conta');
  return rows[0];
}

export async function usuarios(db: Executor, contaId: number) {
  const { rows } = await db.query(
    `SELECT id, nome, email, papel, ativo, master, (senha_hash IS NULL) AS "convitePendente",
            ultimo_acesso AS "ultimoAcesso"
       FROM cadastro.usuarios WHERE conta_id = $1
      ORDER BY ativo DESC, CASE papel WHEN 'admin' THEN 0 WHEN 'sdr' THEN 1 ELSE 2 END, nome`,
    [contaId],
  );
  return rows;
}

/** Cria a conta com tudo que ela precisa (pipelines, modelos, configurações) e o 1º administrador. */
export async function criar(pool: Pool, d: ContaNova): Promise<{ id: number; token: string }> {
  return comTransacao(pool, async (tx) => {
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO cadastro.contas (nome, observacoes) VALUES ($1, $2)
       ON CONFLICT ((lower(nome))) DO NOTHING RETURNING id`,
      [d.nome, d.observacoes ?? null],
    );
    const id = rows[0]?.id;
    if (!id) throw AppError.conflito('Já existe uma conta com esse nome.');
    await tx.query('SELECT cadastro.preparar_conta($1)', [id]);
    const convite = await comConta(id, () =>
      equipe.criar(tx, { nome: d.admin.nome, email: d.admin.email, papel: 'admin' }),
    );
    return { id, token: convite.token };
  });
}

export async function atualizar(db: Executor, id: number, d: ContaAtualizar): Promise<void> {
  const atual = await obter(db, id);
  if (d.ativa === false && atual.principal)
    throw AppError.invalido('A conta principal não pode ser desativada.');
  try {
    await db.query(
      `UPDATE cadastro.contas
          SET nome = coalesce($2, nome), ativa = coalesce($3, ativa),
              observacoes = CASE WHEN $4 THEN $5 ELSE observacoes END
        WHERE id = $1`,
      [id, d.nome ?? null, d.ativa ?? null, d.observacoes !== undefined, d.observacoes ?? null],
    );
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505')
      throw AppError.conflito('Já existe uma conta com esse nome.');
    throw erro;
  }
}

/** Credenciais para a tela: só o que não é segredo, o final de cada segredo e o que vale na prática. */
export async function credenciais(
  db: Executor,
  contaId: number,
  chave: string | null,
  ambiente: CredenciaisAmbiente,
) {
  const c = await lerCredenciais(db, contaId, chave);
  if (!c) throw AppError.naoEncontrado('Conta');
  const efetivas = resolverCredenciais(c, ambiente, contaId);
  return {
    emailRemetente: c.emailRemetente,
    resendDominioRespostas: c.resendDominioRespostas,
    evolutionUrl: c.evolutionUrl,
    evolutionInstancia: c.evolutionInstancia,
    iaProvedor: c.iaProvedor,
    iaModelo: c.iaModelo,
    iaBaseUrl: c.iaBaseUrl,
    // Quais segredos estão guardados (e o final deles).
    segredos: Object.fromEntries(CAMPOS_SEGREDO.map((k) => [k, c.dicas[k] ?? null])),
    atualizadoEm: c.atualizadoEm,
    erro: c.erro,
    podeGuardar: !!chave,
    // O que a conta usa de verdade agora: da conta, da plataforma (variáveis do ambiente) ou nada.
    emUso: {
      places: efetivas.origem.places,
      ors: efetivas.origem.ors,
      resend: efetivas.origem.resend,
      whatsapp: efetivas.origem.whatsapp,
      ia: efetivas.origem.ia,
      remetente: efetivas.resend?.remetente ?? null,
      iaModelo: (() => {
        const cfg = efetivas.ia ? configIa(efetivas.ia) : null;
        return cfg ? `${ROTULO_PROVEDOR_IA[cfg.provedor]} · ${cfg.modelo}` : null;
      })(),
    },
  };
}
