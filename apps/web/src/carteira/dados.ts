import type {
  ClienteDoAtendimento,
  ConfigAtendimento,
  ContagemFilas,
  CorEtiqueta,
  Etiqueta,
  FilaAtendimento,
  PainelAtendimentoCarteira,
  PessoaAtendimento,
  ResumoCarteira,
  SituacaoAtendimento,
} from '@prospeccao/shared/carteira';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useRecurso, useSessao } from '../componentes/Sessao';

/** Atendimento com carteira (plano Escala): os dados das filas, do cliente e das regras. */

export interface ItemAtendimento {
  id: number;
  empresaId: number;
  protocolo: string;
  situacao: SituacaoAtendimento;
  canal: 'whatsapp' | 'instagram';
  origem: 'carteira' | 'geral';
  reaberto: boolean;
  abertoEm: string;
  ultimaClienteEm: string | null;
  encerradoEm: string | null;
  motivo: string | null;
  etiquetas: string[];
  atendenteId: number | null;
  atendenteNome: string | null;
  grupoNome: string | null;
  nome: string;
  cidade: string | null;
  donoId: number | null;
  donoNome: string | null;
  etiquetasCliente: string[];
  ultima: string | null;
  ultimaDirecao: 'enviada' | 'recebida' | null;
  ultimaEm: string | null;
  ultimaMidia: string | null;
  naoLidas: number;
  notaCliente: number | null;
  semRespostaDoDono: boolean;
}

export interface ConfigCompleta {
  config: ConfigAtendimento;
  etiquetas: Etiqueta[];
  carteira: ResumoCarteira;
}

/** O atendimento com carteira está ligado nesta conta (e o plano tem o recurso). */
export function useAtendimentoLigado(): boolean {
  const s = useSessao().data;
  const recurso = useRecurso('carteira');
  return recurso && !!s?.atendimento?.ativo;
}

export const useConfigAtendimento = (ligado = true) =>
  useQuery({
    queryKey: ['carteira', 'config'],
    queryFn: () => api<ConfigCompleta>('/carteira/config'),
    enabled: ligado,
    staleTime: 60_000,
  });

export const useFilas = (ligado: boolean) =>
  useQuery({
    queryKey: ['carteira', 'filas'],
    queryFn: () => api<ContagemFilas>('/carteira/filas'),
    enabled: ligado,
    refetchInterval: 10_000,
  });

export const useAtendimentos = (
  ligado: boolean,
  f: { fila: FilaAtendimento; etiqueta: string | null; busca: string },
) =>
  useQuery({
    queryKey: ['carteira', 'atendimentos', f.fila, f.etiqueta, f.busca],
    queryFn: () =>
      api<ItemAtendimento[]>(
        `/carteira/atendimentos${qs({ fila: f.fila, etiqueta: f.etiqueta, busca: f.busca || null })}`,
      ),
    enabled: ligado,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

export const useClienteAtendimento = (empresaId: number, ligado: boolean) =>
  useQuery({
    queryKey: ['carteira', 'cliente', empresaId],
    queryFn: () => api<ClienteDoAtendimento>(`/carteira/cliente/${empresaId}`),
    enabled: ligado,
    refetchInterval: 10_000,
  });

export const usePessoasAtendimento = (ligado = true) =>
  useQuery({
    queryKey: ['carteira', 'pessoas'],
    queryFn: () =>
      api<{ pessoas: PessoaAtendimento[]; grupos: { id: number; nome: string; membros: number }[] }>(
        '/carteira/pessoas',
      ),
    enabled: ligado,
    staleTime: 15_000,
  });

export const usePainelCarteira = (periodo: 'hoje' | 'semana' | 'mes', grupo: number | null, ligado = true) =>
  useQuery({
    queryKey: ['carteira', 'painel', periodo, grupo],
    queryFn: () => api<PainelAtendimentoCarteira>(`/carteira/painel${qs({ periodo, grupo })}`),
    enabled: ligado,
    refetchInterval: 30_000,
  });

/** Depois de uma ação no atendimento: filas, lista, cliente e a conversa. */
export function useAtualizarAtendimento() {
  const cliente = useQueryClient();
  return (empresaId?: number, dados?: ClienteDoAtendimento) => {
    if (empresaId && dados) cliente.setQueryData(['carteira', 'cliente', empresaId], dados);
    cliente.invalidateQueries({ queryKey: ['carteira', 'filas'] });
    cliente.invalidateQueries({ queryKey: ['carteira', 'atendimentos'] });
    if (empresaId) cliente.invalidateQueries({ queryKey: ['conversa', empresaId] });
  };
}

export const COR_ETIQUETA: Record<CorEtiqueta, { fundo: string; texto: string }> = {
  cinza: { fundo: 'var(--pp-cinza-100, #f1f5f9)', texto: 'var(--pp-cinza-700, #334155)' },
  azul: { fundo: '#e0f2fe', texto: '#075985' },
  verde: { fundo: '#dcfce7', texto: '#166534' },
  laranja: { fundo: '#ffedd5', texto: '#9a3412' },
  vermelho: { fundo: '#fee2e2', texto: '#991b1b' },
  roxo: { fundo: '#ede9fe', texto: '#5b21b6' },
};

/** A cor de uma etiqueta pelo nome (a que não está no catálogo fica cinza). */
export function corDaEtiqueta(nome: string, catalogo: Etiqueta[] | undefined): CorEtiqueta {
  return catalogo?.find((e) => e.nome.toLowerCase() === nome.toLowerCase())?.cor ?? 'cinza';
}

/** "há 6 min", "há 2 h". */
export function haQuanto(iso: string | null | undefined): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

/** 4.3 → "4 min"; 75 → "1 h 15". */
export function fmtMinutos(min: number | null | undefined): string {
  if (min == null) return '–';
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

const DIA_MES = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'America/Sao_Paulo',
});
const MES_ANO = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/** "18 nov" (data e hora com fuso, no dia de Brasília). */
export function diaMes(iso: string | null | undefined): string {
  if (!iso) return '—';
  return DIA_MES.format(new Date(iso)).replace(/\./g, '').replace(' de ', ' ');
}

/** "mar 2025". */
export function mesAno(iso: string | null | undefined): string {
  if (!iso) return '—';
  return MES_ANO.format(new Date(iso)).replace(/\./g, '').replace(' de ', ' ');
}
