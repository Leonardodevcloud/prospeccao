import type { Executor } from '@prospeccao/db';
import {
  AppError,
  type ConfigCadencia,
  dataDoPasso,
  type EtapaFunil,
  type EventoCadencia,
  MODELOS_MENSAGEM,
  type ModeloMensagem,
  modeloDoPasso,
  montarMensagem,
  proximoPasso,
  totalTentativas,
} from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import { visivel } from '../../visibilidade.js';
import { estaEmSequencia } from '../email/sequencia.js';

/**
 * Cadência de follow-up: depois de cada acontecimento (entrou no funil, mandou mensagem, ele
 * respondeu, mudou de etapa) o sistema marca sozinho o próximo passo e a data.
 */

export async function obterConfig(db: Executor): Promise<ConfigCadencia> {
  const C = contaSql();
  const [cfg, modelos] = await Promise.all([
    db.query<{
      diasFollowup: number[];
      diasEncerrar: number;
      encerrarSemResposta: boolean;
      diasCobrarProposta: number[];
      remetente: string;
    }>(
      `SELECT dias_followup AS "diasFollowup", dias_encerrar AS "diasEncerrar",
              encerrar_sem_resposta AS "encerrarSemResposta", dias_cobrar_proposta AS "diasCobrarProposta",
              remetente
         FROM comercial.config_cadencia WHERE conta_id = ${C}`,
    ),
    db.query<{ chave: ModeloMensagem; texto: string }>(
      `SELECT chave, texto FROM comercial.modelos_mensagem WHERE conta_id = ${C}`,
    ),
  ]);
  const c = cfg.rows[0] ?? {
    diasFollowup: [2, 3, 5],
    diasEncerrar: 4,
    encerrarSemResposta: true,
    diasCobrarProposta: [3, 7],
    remetente: '',
  };
  const textos = Object.fromEntries(modelos.rows.map((m) => [m.chave, m.texto]));
  return {
    ...c,
    modelos: Object.fromEntries(MODELOS_MENSAGEM.map((m) => [m, textos[m] ?? ''])) as Record<
      ModeloMensagem,
      string
    >,
  };
}

export async function salvarConfig(db: Executor, c: ConfigCadencia): Promise<void> {
  const C = contaSql();
  await db.query(
    `UPDATE comercial.config_cadencia
        SET dias_followup = $1, dias_encerrar = $2, encerrar_sem_resposta = $3,
            dias_cobrar_proposta = $4, remetente = $5, atualizado_em = now()
      WHERE conta_id = ${C}`,
    [c.diasFollowup, c.diasEncerrar, c.encerrarSemResposta, c.diasCobrarProposta, c.remetente],
  );
  for (const chave of MODELOS_MENSAGEM)
    await db.query(
      `INSERT INTO comercial.modelos_mensagem (conta_id, chave, texto) VALUES (${C}, $1, $2)
       ON CONFLICT (conta_id, chave) DO UPDATE SET texto = EXCLUDED.texto, atualizado_em = now()`,
      [chave, c.modelos[chave]],
    );
}

/** Marca o próximo passo do lead conforme a cadência (a oportunidade já está na etapa nova). */
export async function aplicarCadencia(
  db: Executor,
  empresaId: number,
  evento: EventoCadencia,
): Promise<void> {
  const { rows } = await db.query<{ etapa: EtapaFunil; tentativas: number }>(
    `SELECT etapa, tentativas FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  const op = rows[0];
  if (!op) return;
  // Na sequência automática, quem decide o próximo toque é ela: o follow-up do funil espera.
  if (evento !== 'recebida' && (await estaEmSequencia(db, empresaId))) {
    await db.query(
      `UPDATE comercial.oportunidades
          SET proxima_acao = $2, proxima_acao_em = NULL, encerrar_em = NULL
        WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [empresaId, NA_SEQUENCIA],
    );
    return;
  }
  const passo = proximoPasso(op.etapa, op.tentativas, evento, await obterConfig(db));
  if (!passo) return;
  await db.query(
    `UPDATE comercial.oportunidades
        SET proxima_acao = $2, proxima_acao_em = $3, tentativas = $4, encerrar_em = $5
      WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [
      empresaId,
      passo.acao,
      dataDoPasso(passo.dias),
      passo.tentativas,
      passo.encerrar ? dataDoPasso(passo.dias) : null,
    ],
  );
}

/** Próximo passo de quem está numa sequência (o funil volta a cuidar quando ela acaba). */
export const NA_SEQUENCIA = 'Na sequência automática';

export interface MensagemPronta {
  modelo: ModeloMensagem | null;
  rotulo: string | null;
  texto: string;
  telefone: string | null;
  tentativa: number;
  totalTentativas: number;
}

/** Dados do lead para montar mensagens: primeiro nome do decisor, empresa, cidade e o melhor WhatsApp. */
export async function dadosDoLead(db: Executor, empresaId: number) {
  const { rows } = await db.query<{
    etapa: EtapaFunil;
    tentativas: number;
    nome: string;
    cidade: string | null;
    decisor: string | null;
    telefone: string | null;
  }>(
    `SELECT o.etapa, o.tentativas, e.nome, e.cidade,
            -- conversando com uma pessoa indicada: o {nome} das mensagens é o dela
            coalesce(
              (SELECT cl.nome FROM comercial.contatos_lead cl
                WHERE cl.conta_id = o.conta_id AND cl.empresa_id = o.empresa_id AND cl.status = 'confirmado'
                  AND o.whatsapp_destino IS NOT NULL AND left(cl.telefone, 2) = left(o.whatsapp_destino, 2)
                  AND right(cl.telefone, 8) = right(o.whatsapp_destino, 8) LIMIT 1),
              (SELECT p.nome FROM enriquecimento.pessoas p
                WHERE p.empresa_id = e.id AND p.decisor AND ${visivel('p')} ORDER BY (p.conta_id <> 0) DESC, p.id LIMIT 1)) AS decisor,
            coalesce(
              -- com quem a conversa segue ("enviar para")
              o.whatsapp_destino,
              (SELECT c.valor FROM enriquecimento.contatos c
                WHERE c.empresa_id = e.id AND c.status <> 'invalido' AND ${visivel('c')}
                  AND (c.canal = 'whatsapp' OR (c.canal = 'telefone' AND c.whatsapp))
                  AND NOT EXISTS (SELECT 1 FROM comercial.feedback f WHERE f.empresa_id = e.id
                                   AND f.tipo = 'numero_errado' AND f.valor = c.valor)
                ORDER BY c.principal DESC, c.confianca DESC LIMIT 1),
              (SELECT c.valor FROM enriquecimento.contatos c
                WHERE c.empresa_id = e.id AND c.principal AND c.canal IN ('telefone', 'whatsapp') AND ${visivel('c')}
                  AND NOT EXISTS (SELECT 1 FROM comercial.feedback f WHERE f.empresa_id = e.id
                                   AND f.tipo = 'numero_errado' AND f.valor = c.valor) LIMIT 1),
              e.maps_telefone) AS telefone
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
      WHERE o.conta_id = ${contaSql()} AND o.empresa_id = $1`,
    [empresaId],
  );
  const l = rows[0];
  if (!l) throw AppError.naoEncontrado('Lead no funil');
  const cfg = await obterConfig(db);
  const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase());
  return {
    etapa: l.etapa,
    tentativas: l.tentativas,
    telefone: l.telefone,
    cfg,
    variaveis: {
      nome: l.decisor ? titulo(l.decisor.trim().split(/\s+/)[0] ?? '') : null,
      empresa: titulo(l.nome),
      cidade: l.cidade ? titulo(l.cidade) : null,
      remetente: cfg.remetente,
    },
  };
}

/** Mensagem do próximo envio, já com nome do decisor, empresa e cidade. */
export async function mensagemDoLead(db: Executor, empresaId: number): Promise<MensagemPronta> {
  const l = await dadosDoLead(db, empresaId);
  const modelo = modeloDoPasso(l.etapa, l.tentativas, l.cfg);
  return {
    modelo,
    rotulo: modelo ? ROTULOS[modelo] : null,
    texto: modelo ? montarMensagem(l.cfg.modelos[modelo], l.variaveis) : '',
    telefone: l.telefone,
    tentativa: l.etapa === 'abordado' ? l.tentativas + 1 : l.etapa === 'a_abordar' ? 1 : 0,
    totalTentativas: totalTentativas(l.cfg),
  };
}

const ROTULOS: Record<ModeloMensagem, string> = {
  primeira: 'Primeira abordagem',
  followup1: '1º follow-up',
  followup2: 'Follow-up',
  ultima: 'Última tentativa',
  marcar_reuniao: 'Marcar reunião',
  cobrar_proposta: 'Cobrar proposta',
};
