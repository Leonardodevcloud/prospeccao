import type {
  ClimaLigacao,
  ResultadoLigacao,
  ResumoLigacao,
  TelefoneParaLigar,
  TelefoniaConfigEntrada,
} from '@prospeccao/shared/ligacoes';
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api } from '../api';
import { useSessao } from '../componentes/Sessao';
import { telefone } from './ligacao';

export interface LigacaoResumida {
  id: number;
  empresaId: number | null;
  leadNome: string | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  direcao: 'saida' | 'entrada';
  telefone: string;
  numeroEmpresa: string | null;
  situacao: string;
  iniciadaEm: string;
  atendidaEm: string | null;
  duracaoSegundos: number | null;
  resultado: ResultadoLigacao | null;
  processamento: 'sem_gravacao' | 'aguardando' | 'processando' | 'pronto' | 'erro';
  resumo: string | null;
  clima: ClimaLigacao | null;
  sentimento: string | null;
  nota: string | null;
  gravada: boolean;
}

export interface LigacaoDetalhe extends LigacaoResumida {
  encerradaEm: string | null;
  motivoFim: string | null;
  transcricao: 'pronta' | 'sem_audio' | 'desligada' | 'erro' | null;
  resumoCompleto: ResumoLigacao | null;
  erro: string | null;
  falas: { quem: 'voce' | 'lead'; nome: string; inicioMs: number; fimMs: number; texto: string }[];
  audio: string | null;
}

export interface LigacoesDoLeadResposta {
  telefones: TelefoneParaLigar[];
  ligacoes: LigacaoResumida[];
  naoLigar: string | null;
}

export interface SituacaoTelefonia {
  modulo: boolean;
  disponivel: boolean;
  motivo: 'fora_do_plano' | 'sem_telefonia' | 'sem_numero' | null;
  numeros: { id: number; numero: string; rotulo: string | null; principal: boolean }[];
  config: TelefoniaConfigEntrada;
  minutos: { usados: number; franquia: number | null };
  gravacao: boolean;
  transcricao: boolean;
  avisoFalado: boolean;
}

/** A ligação em curso (o painel e os botões acompanham). */
export function useTelefone() {
  return useSyncExternalStore(telefone.assinar, telefone.ler);
}

/** A conta tem o módulo Ligações? (Sem plano: tem.) */
export function useModuloLigacoes(): boolean {
  const s = useSessao().data;
  return !s?.conta.modulos || s.conta.modulos.includes('ligacoes');
}

export function useSituacaoTelefonia(ligado = true) {
  return useQuery({
    queryKey: ['telefonia'],
    queryFn: () => api<SituacaoTelefonia>('/ligacoes/situacao'),
    staleTime: 60_000,
    enabled: ligado,
  });
}

export const MOTIVO_INDISPONIVEL: Record<NonNullable<SituacaoTelefonia['motivo']>, string> = {
  fora_do_plano: 'Ligações é um módulo à parte. Fale com a gente para liberar.',
  sem_telefonia: 'A telefonia ainda não foi ligada na plataforma.',
  sem_numero: 'A conta ainda não tem número para ligar. Peça ao suporte do Prospect Team.',
};
