import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import { apagarContas } from '../master/excluir.js';

/**
 * A conta principal é a da plataforma: é nela que ficam os administradores (master), as chaves da
 * plataforma e o webhook do e-mail. Ela não é cliente nem CRM de uso: o master trabalha no painel e
 * apresenta pelo CRM de demonstração. "Zerar" apaga o que sobrou de quando ela era usada como CRM
 * (campanhas, funil, conversas, reuniões, avisos…) e deixa o nome da plataforma.
 */

export const NOME_PLATAFORMA = 'Prospect Team';

/** O que fica ao zerar: chaves, domínio de e-mail, configurações, números, histórico de custo e vendas. */
const MANTER = [
  'cadastro.credenciais_conta',
  'cadastro.dominios_email',
  'cadastro.auditoria',
  'cadastro.consumo_buscas',
  'cadastro.consumo_ia',
  'cadastro.config_places',
  'cadastro.pedidos_site',
  'descoberta.uso_places',
  'enriquecimento.uso_places',
  'comercial.chips',
  'comercial.config_agenda',
  'comercial.config_agente',
  'comercial.config_cadencia',
  'comercial.config_email',
  'comercial.config_equipe',
  'comercial.pipelines',
  'comercial.etapas',
  'comercial.modelos_email',
  'comercial.modelos_mensagem',
  'comercial.respostas_rapidas',
  'comercial.marcas_email',
];

export interface ContaPrincipal {
  id: number;
  nome: string;
  dados: {
    campanhas: number;
    noFunil: number;
    mensagens: number;
    tarefas: number;
    reunioes: number;
    avisos: number;
  };
  /** Sobrou algo do uso como CRM. */
  temDados: boolean;
}

async function idPrincipal(db: Executor): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM cadastro.contas WHERE principal ORDER BY id LIMIT 1',
  );
  if (!rows[0]) throw AppError.naoEncontrado('Conta principal');
  return rows[0].id;
}

export async function resumo(db: Executor): Promise<ContaPrincipal> {
  const id = await idPrincipal(db);
  const { rows } = await db.query<ContaPrincipal['dados'] & { nome: string }>(
    `SELECT c.nome,
            (SELECT count(*) FROM cadastro.campanhas WHERE conta_id = $1)::int AS campanhas,
            (SELECT count(*) FROM comercial.oportunidades WHERE conta_id = $1)::int AS "noFunil",
            (SELECT count(*) FROM comercial.mensagens WHERE conta_id = $1)::int AS mensagens,
            (SELECT count(*) FROM comercial.tarefas WHERE conta_id = $1)::int AS tarefas,
            (SELECT count(*) FROM comercial.salas WHERE conta_id = $1)::int AS reunioes,
            (SELECT count(*) FROM comercial.notificacoes WHERE conta_id = $1)::int AS avisos
       FROM cadastro.contas c WHERE c.id = $1`,
    [id],
  );
  const { nome, ...dados } = rows[0]!;
  return { id, nome, dados, temDados: Object.values(dados).some((n) => n > 0) };
}

/** Apaga o uso antigo como CRM e passa a se chamar como a plataforma. */
export async function zerar(pool: Pool): Promise<ContaPrincipal> {
  await comTransacao(pool, async (tx) => {
    const id = await idPrincipal(tx);
    await apagarContas(tx, [id], { manter: MANTER });
    await tx.query(`UPDATE cadastro.contas SET nome = $2 WHERE id = $1`, [id, NOME_PLATAFORMA]);
    await tx.query(
      `UPDATE cadastro.organizacoes SET nome = $2 WHERE id = (SELECT organizacao_id FROM cadastro.contas WHERE id = $1)`,
      [id, NOME_PLATAFORMA],
    );
  });
  return resumo(pool);
}
