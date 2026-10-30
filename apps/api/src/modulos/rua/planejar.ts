import {
  type Candidato,
  type ConfigDia,
  type ConfigRoteiro,
  escolherDoDia,
  haversineKm,
  horaDoDia,
  horarios,
  type Logger,
  type Matriz,
  matrizEstimada,
  minutosDoDia,
  ordenar,
  type PartidaRua,
} from '@prospeccao/shared';
import type { ServicosConta } from '../../servicos.js';
import type { LeadRua } from './repositorio.js';

/**
 * Monta o dia: escolhe os leads (ou usa a lista montada à mão), põe na ordem que anda menos e
 * calcula a hora de chegada em cada um. Com o serviço de rotas (ORS), tempo e caminho são pelas
 * ruas; sem ele (ou se ele falhar), pela estimativa em linha reta.
 */

/** Leads mandados para o serviço de rotas de uma vez (o limite grátis é 59 pontos com a partida). */
const MAX_CANDIDATOS = 45;

export interface ParadaPlano extends LeadRua {
  ordem: number;
  chegada: string;
  saida: string;
  kmTrecho: number;
  minutosTrecho: number;
  almocoAntes: boolean;
}

export interface PlanoRua {
  calculo: 'ruas' | 'estimado';
  km: number;
  minutosRota: number;
  inicio: string;
  termino: string;
  /** O dia passou do horário escolhido (lista montada à mão com visitas demais). */
  passouDoHorario: boolean;
  paradas: ParadaPlano[];
  tracado: [number, number][];
  /** Quantos leads atendiam aos filtros (dentro do raio) e quantos ficaram de fora do dia. */
  candidatos: number;
  foraDoDia: number;
}

export function configDoDia(c: ConfigRoteiro): ConfigDia {
  return {
    inicio: minutosDoDia(c.inicio),
    fim: minutosDoDia(c.fim),
    minutosVisita: c.minutosVisita,
    almoco: c.almoco ? { inicio: minutosDoDia(c.almoco.inicio), minutos: c.almoco.minutos } : null,
  };
}

/** Quanto antes o lead deve entrar no dia: a nota, quem já está em conversa e quem está perto. */
export function prioridade(l: LeadRua, partida: PartidaRua): number {
  const km = haversineKm(partida, l);
  return (
    (l.score ?? 35) +
    (l.situacao === 'negociacao' ? 12 : 0) +
    (l.passoVencido ? 8 : 0) +
    (l.situacao === 'clientes' ? 4 : 0) -
    km * 0.6
  );
}

/** Leads que atendem aos filtros do planejamento (nota, situação, raio, sem visita recente). */
export function filtrarCandidatos(leads: LeadRua[], c: ConfigRoteiro, agora = new Date()): LeadRua[] {
  const faixas = new Set(c.faixas);
  const situacoes = new Set<string>(c.situacoes);
  const semana = agora.getTime() - 6 * 86_400_000;
  return leads.filter(
    (l) =>
      l.situacao !== 'fora' &&
      situacoes.has(l.situacao) &&
      faixas.has(l.faixa ?? 'C') &&
      !l.emOutroRoteiro &&
      !(l.ultimaVisita && new Date(l.ultimaVisita).getTime() > semana) &&
      haversineKm(c.partida, l) <= c.raioKm,
  );
}

async function matrizDe(
  servicos: Pick<ServicosConta, 'rotas'>,
  pontos: { lat: number; lng: number }[],
  log: Logger,
): Promise<{ m: Matriz; calculo: 'ruas' | 'estimado' }> {
  const estimada = matrizEstimada(pontos);
  if (!servicos.rotas || pontos.length < 2 || pontos.length > 59) return { m: estimada, calculo: 'estimado' };
  try {
    const r = await servicos.rotas.matriz(pontos);
    // Par sem caminho pelas ruas: fica a estimativa.
    const minutos = r.minutos.map((l, a) => l.map((v, b) => v ?? estimada.minutos[a]![b]!));
    const km = r.km.map((l, a) => l.map((v, b) => v ?? estimada.km[a]![b]!));
    return { m: { minutos, km }, calculo: 'ruas' };
  } catch (erro) {
    log.warn({ err: erro }, 'rua: serviço de rotas falhou, usando a estimativa');
    return { m: estimada, calculo: 'estimado' };
  }
}

export async function planejar(
  servicos: Pick<ServicosConta, 'rotas'>,
  log: Logger,
  c: ConfigRoteiro,
  leads: LeadRua[],
  modo: { tipo: 'sugerir' } | { tipo: 'montado'; otimizar: boolean },
): Promise<PlanoRua> {
  const cfg = configDoDia(c);
  const pool =
    modo.tipo === 'sugerir'
      ? [...leads]
          .sort((a, b) => prioridade(b, c.partida) - prioridade(a, c.partida))
          .slice(0, MAX_CANDIDATOS)
      : leads.slice(0, 58);
  const pontos = [c.partida, ...pool];
  const { m, calculo } = await matrizDe(servicos, pontos, log);

  let ordem: number[];
  if (modo.tipo === 'sugerir') {
    const candidatos: Candidato[] = pool.map((l, i) => ({
      indice: i + 1,
      prioridade: prioridade(l, c.partida),
    }));
    ordem = escolherDoDia(candidatos, m, cfg, c.maxParadas);
  } else {
    const todos = pool.map((_, i) => i + 1);
    ordem = modo.otimizar ? ordenar(todos, m) : todos;
  }

  const h = horarios(ordem, m, cfg);
  const paradas: ParadaPlano[] = h.paradas.map((p, i) => ({
    ...pool[p.indice - 1]!,
    ordem: i + 1,
    chegada: horaDoDia(p.chegada),
    saida: horaDoDia(p.saida),
    kmTrecho: Math.round(p.kmTrecho * 10) / 10,
    minutosTrecho: Math.round(p.minutosTrecho),
    almocoAntes: h.almocoAntesDe === i,
  }));

  // Linha do mapa: pelas ruas quando dá; senão, reta de ponto a ponto.
  const caminho = [c.partida, ...paradas];
  let tracado: [number, number][] = caminho.map((p) => [p.lat, p.lng]);
  if (calculo === 'ruas' && servicos.rotas && paradas.length)
    try {
      tracado = (await servicos.rotas.tracado(caminho)).linha;
    } catch (erro) {
      log.warn({ err: erro }, 'rua: traçado pelas ruas falhou, usando linhas retas');
    }

  return {
    calculo,
    km: Math.round(h.km * 10) / 10,
    minutosRota: Math.round(h.minutosRota),
    inicio: c.inicio,
    termino: horaDoDia(h.termino),
    passouDoHorario: h.termino > cfg.fim,
    paradas,
    tracado,
    candidatos: leads.length,
    foraDoDia: leads.length - paradas.length,
  };
}
