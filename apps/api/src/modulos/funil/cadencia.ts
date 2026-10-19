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

/**
 * Cadência de follow-up: depois de cada acontecimento (entrou no funil, mandou mensagem, ele
 * respondeu, mudou de etapa) o sistema marca sozinho o próximo passo e a data.
 */

export async function obterConfig(db: Executor): Promise<ConfigCadencia> {
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
         FROM comercial.config_cadencia LIMIT 1`,
    ),
    db.query<{ chave: ModeloMensagem; texto: string }>('SELECT chave, texto FROM comercial.modelos_mensagem'),
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
  await db.query(
    `UPDATE comercial.config_cadencia
        SET dias_followup = $1, dias_encerrar = $2, encerrar_sem_resposta = $3,
            dias_cobrar_proposta = $4, remetente = $5, atualizado_em = now()`,
    [c.diasFollowup, c.diasEncerrar, c.encerrarSemResposta, c.diasCobrarProposta, c.remetente],
  );
  for (const chave of MODELOS_MENSAGEM)
    await db.query(
      `INSERT INTO comercial.modelos_mensagem (chave, texto) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET texto = EXCLUDED.texto, atualizado_em = now()`,
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
    'SELECT etapa, tentativas FROM comercial.oportunidades WHERE empresa_id = $1',
    [empresaId],
  );
  const op = rows[0];
  if (!op) return;
  const passo = proximoPasso(op.etapa, op.tentativas, evento, await obterConfig(db));
  if (!passo) return;
  await db.query(
    `UPDATE comercial.oportunidades
        SET proxima_acao = $2, proxima_acao_em = $3, tentativas = $4, encerrar_em = $5
      WHERE empresa_id = $1`,
    [
      empresaId,
      passo.acao,
      dataDoPasso(passo.dias),
      passo.tentativas,
      passo.encerrar ? dataDoPasso(passo.dias) : null,
    ],
  );
}

export interface MensagemPronta {
  modelo: ModeloMensagem | null;
  rotulo: string | null;
  texto: string;
  telefone: string | null;
  tentativa: number;
  totalTentativas: number;
}

/** Mensagem do próximo envio, já com nome do decisor, empresa e cidade. */
export async function mensagemDoLead(db: Executor, empresaId: number): Promise<MensagemPronta> {
  const { rows } = await db.query<{
    etapa: EtapaFunil;
    tentativas: number;
    nome: string;
    cidade: string | null;
    decisor: string | null;
    telefone: string | null;
  }>(
    `SELECT o.etapa, o.tentativas, e.nome, e.cidade,
            (SELECT p.nome FROM enriquecimento.pessoas p
              WHERE p.empresa_id = e.id AND p.decisor ORDER BY p.id LIMIT 1) AS decisor,
            coalesce(
              (SELECT c.valor FROM enriquecimento.contatos c
                WHERE c.empresa_id = e.id AND c.status <> 'invalido'
                  AND (c.canal = 'whatsapp' OR (c.canal = 'telefone' AND c.whatsapp))
                  AND NOT EXISTS (SELECT 1 FROM comercial.feedback f WHERE f.empresa_id = e.id
                                   AND f.tipo = 'numero_errado' AND f.valor = c.valor)
                ORDER BY c.principal DESC, c.confianca DESC LIMIT 1),
              (SELECT c.valor FROM enriquecimento.contatos c
                WHERE c.empresa_id = e.id AND c.principal AND c.canal IN ('telefone', 'whatsapp')
                  AND NOT EXISTS (SELECT 1 FROM comercial.feedback f WHERE f.empresa_id = e.id
                                   AND f.tipo = 'numero_errado' AND f.valor = c.valor) LIMIT 1),
              e.maps_telefone) AS telefone
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
      WHERE o.empresa_id = $1`,
    [empresaId],
  );
  const l = rows[0];
  if (!l) throw AppError.naoEncontrado('Lead no funil');
  const cfg = await obterConfig(db);
  const modelo = modeloDoPasso(l.etapa, l.tentativas, cfg);
  const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase());
  const primeiroNome = l.decisor ? titulo(l.decisor.trim().split(/\s+/)[0] ?? '') : null;
  return {
    modelo,
    rotulo: modelo ? ROTULOS[modelo] : null,
    texto: modelo
      ? montarMensagem(cfg.modelos[modelo], {
          nome: primeiroNome,
          empresa: titulo(l.nome),
          cidade: l.cidade ? titulo(l.cidade) : null,
          remetente: cfg.remetente,
        })
      : '',
    telefone: l.telefone,
    tentativa: l.etapa === 'abordado' ? l.tentativas + 1 : l.etapa === 'a_abordar' ? 1 : 0,
    totalTentativas: totalTentativas(cfg),
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
