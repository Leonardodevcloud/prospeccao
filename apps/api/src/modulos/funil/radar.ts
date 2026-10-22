import type { Executor } from '@prospeccao/db';
import { contaSql } from '../../contexto.js';

/**
 * Radar dos negócios parados: cada negócio aberto ganha um nível pelo tempo sem movimento (o
 * relógio só anda com conversa, ligação, reunião ou nota; mudar de etapa sozinho não conta) e
 * pelos sinais que mais perdem venda: o lead escreveu e ninguém respondeu, a reunião passou sem
 * registro, o próximo passo venceu.
 */

export type NivelRisco = 'critico' | 'risco' | 'andamento' | 'em_dia';

/** Horas sem movimento para ficar "em risco" em cada etapa; crítico é 3x isso. */
export const HORAS_RISCO: Record<string, number> = {
  abordado: 72,
  respondeu: 24,
  reuniao: 48,
  proposta: 72,
};

export interface SinaisNegocio {
  etapa: string;
  /** Horas desde o último movimento de verdade. */
  horasParado: number;
  /** A última mensagem foi do lead (e ninguém respondeu). */
  leadEsperando: boolean;
  /** Horas desde a mensagem do lead sem resposta. */
  horasEsperando: number;
  /** Reunião marcada no futuro. */
  reuniaoFutura: boolean;
  /** Reunião que já passou e nada foi registrado depois. */
  reuniaoSemRegistro: boolean;
  /** Próximo passo com data: horas até ele (negativo = atrasado). */
  horasAteProximoPasso: number | null;
  /** A IA está cuidando do lead (ligada e sem pausa). */
  iaAtiva: boolean;
  /** Na sequência automática (e-mail/WhatsApp). */
  emSequencia: boolean;
}

export interface Risco {
  nivel: NivelRisco;
  motivo: string;
}

const horas = (h: number) => (h < 48 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} dias`);

export function classificarRisco(s: SinaisNegocio): Risco {
  // O lead escreveu e ninguém respondeu: é o que mais perde negócio (a IA responde em segundos).
  if (s.leadEsperando && !s.iaAtiva) {
    if (s.horasEsperando >= 24)
      return {
        nivel: 'critico',
        motivo: `O lead escreveu há ${horas(s.horasEsperando)} e ninguém respondeu`,
      };
    if (s.horasEsperando >= 4)
      return { nivel: 'risco', motivo: `O lead escreveu há ${horas(s.horasEsperando)} e está sem resposta` };
  }
  if (s.reuniaoSemRegistro)
    return { nivel: 'critico', motivo: 'A reunião já passou e ninguém registrou como foi' };
  if (s.reuniaoFutura) return { nivel: 'andamento', motivo: 'Reunião marcada' };

  const limite = HORAS_RISCO[s.etapa] ?? 48;
  if (s.horasParado < limite) return { nivel: 'em_dia', motivo: '' };
  // Tem algo agendado (follow-up da cadência, tarefa, sequência, IA cuidando): está andando.
  if (s.horasAteProximoPasso != null && s.horasAteProximoPasso > 0)
    return { nivel: 'andamento', motivo: 'Próximo passo agendado' };
  if (s.emSequencia) return { nivel: 'andamento', motivo: 'Na sequência automática' };
  if (s.iaAtiva && s.etapa !== 'proposta') return { nivel: 'andamento', motivo: 'A IA está cuidando' };

  const atrasado =
    s.horasAteProximoPasso != null && s.horasAteProximoPasso < 0
      ? ` (próximo passo atrasado há ${horas(-s.horasAteProximoPasso)})`
      : s.horasAteProximoPasso == null
        ? ' e sem próximo passo'
        : '';
  const nivel = s.horasParado >= limite * 3 ? 'critico' : 'risco';
  return { nivel, motivo: `Parado há ${horas(s.horasParado)}${atrasado}` };
}

export interface ItemRadar extends Risco {
  empresaId: number;
  nome: string;
  cidade: string | null;
  etapa: string;
  etapaNome: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  valorMensal: number | null;
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  ultimoMovimento: string | null;
  horasParado: number;
}

export async function radar(db: Executor, f: { responsavelId?: number | null } = {}, limite = 200) {
  const C = contaSql();
  const { rows } = await db.query<
    Omit<ItemRadar, 'nivel' | 'motivo'> & {
      ultimaDirecao: string | null;
      ultimaRecebida: string | null;
      reuniaoFutura: boolean;
      reuniaoSemRegistro: boolean;
      iaAtiva: boolean;
      emSequencia: boolean;
    }
  >(
    `SELECT o.empresa_id::int AS "empresaId", e.nome, e.cidade, o.etapa, et.nome AS "etapaNome",
            o.responsavel_id AS "responsavelId", u.nome AS "responsavelNome",
            o.valor_mensal::float8 AS "valorMensal", o.proxima_acao AS "proximaAcao",
            o.proxima_acao_em AS "proximaAcaoEm", mov.em AS "ultimoMovimento",
            extract(epoch FROM now() - coalesce(mov.em, o.etapa_desde, o.criado_em))::float8 / 3600 AS "horasParado",
            ult.direcao AS "ultimaDirecao", ult.criado_em AS "ultimaRecebida",
            EXISTS (SELECT 1 FROM comercial.tarefas t
                     WHERE t.conta_id = ${C} AND t.empresa_id = o.empresa_id AND t.tipo IN ('reuniao', 'visita')
                       AND t.concluida_em IS NULL AND t.inicio > now()) AS "reuniaoFutura",
            EXISTS (SELECT 1 FROM comercial.tarefas t
                     WHERE t.conta_id = ${C} AND t.empresa_id = o.empresa_id AND t.tipo IN ('reuniao', 'visita')
                       AND t.concluida_em IS NULL AND t.inicio < now() - interval '3 hours'
                       AND t.inicio > now() - interval '30 days'
                       AND NOT EXISTS (SELECT 1 FROM comercial.atividades a
                                        WHERE a.conta_id = ${C} AND a.empresa_id = o.empresa_id
                                          AND a.tipo <> 'etapa' AND a.criado_em > t.inicio)) AS "reuniaoSemRegistro",
            (o.agente AND o.agente_pausa IS NULL) AS "iaAtiva",
            (o.proxima_acao = 'Na sequência automática') AS "emSequencia"
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
       -- último movimento de verdade (mudar de etapa sozinho não conta)
       LEFT JOIN LATERAL (SELECT max(a.criado_em) AS em FROM comercial.atividades a
                           WHERE a.conta_id = ${C} AND a.empresa_id = o.empresa_id AND a.tipo <> 'etapa') mov ON true
       -- última mensagem (para saber se o lead está esperando resposta)
       LEFT JOIN LATERAL (SELECT a.direcao, a.criado_em FROM comercial.atividades a
                           WHERE a.conta_id = ${C} AND a.empresa_id = o.empresa_id AND a.direcao IS NOT NULL
                           ORDER BY a.criado_em DESC, a.id DESC LIMIT 1) ult ON true
      WHERE o.conta_id = ${C} AND o.etapa IN ('abordado', 'respondeu', 'reuniao', 'proposta')
        AND ($1::int IS NULL OR o.responsavel_id = $1)
      LIMIT 2000`,
    [f.responsavelId ?? null],
  );
  const agora = Date.now();
  const itens: ItemRadar[] = [];
  const contagem = { critico: 0, risco: 0, andamento: 0 };
  for (const r of rows) {
    // O lead está esperando: a última mensagem é dele e nada foi feito depois (ligação, nota, reunião).
    const leadEsperando =
      r.ultimaDirecao === 'recebida' &&
      !!r.ultimaRecebida &&
      (!r.ultimoMovimento ||
        new Date(r.ultimoMovimento).getTime() <= new Date(r.ultimaRecebida).getTime() + 1000);
    const risco = classificarRisco({
      etapa: r.etapa,
      horasParado: r.horasParado,
      leadEsperando,
      horasEsperando:
        leadEsperando && r.ultimaRecebida ? (agora - new Date(r.ultimaRecebida).getTime()) / 3.6e6 : 0,
      reuniaoFutura: r.reuniaoFutura,
      reuniaoSemRegistro: r.reuniaoSemRegistro,
      horasAteProximoPasso: r.proximaAcaoEm ? (new Date(r.proximaAcaoEm).getTime() - agora) / 3.6e6 : null,
      iaAtiva: r.iaAtiva,
      emSequencia: r.emSequencia,
    });
    if (risco.nivel === 'em_dia') continue;
    contagem[risco.nivel]++;
    if (risco.nivel === 'andamento') continue;
    const {
      ultimaDirecao: _d,
      ultimaRecebida: _r,
      reuniaoFutura: _f,
      reuniaoSemRegistro: _s,
      iaAtiva: _i,
      emSequencia: _e,
      ...item
    } = r;
    itens.push({ ...item, ...risco, horasParado: Math.round(r.horasParado) });
  }
  // Crítico primeiro; dentro do nível, o mais valioso e depois o mais parado.
  itens.sort(
    (a, b) =>
      (a.nivel === b.nivel ? 0 : a.nivel === 'critico' ? -1 : 1) ||
      (b.valorMensal ?? 0) - (a.valorMensal ?? 0) ||
      b.horasParado - a.horasParado,
  );
  return { itens: itens.slice(0, limite), contagem };
}
