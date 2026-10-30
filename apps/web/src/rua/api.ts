import type { ResultadoVisita, SituacaoRua } from '@prospeccao/shared/rua';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { apiAudio } from '../componentes/argos/api';

/** Vendas na rua: o que a api devolve (ver apps/api/src/modulos/rua). */

export type Faixa = 'A' | 'B' | 'C';
export type EtapaLead =
  | 'a_abordar'
  | 'abordado'
  | 'respondeu'
  | 'reuniao'
  | 'proposta'
  | 'ganho'
  | 'perdido'
  | 'descartado';

export interface Ponto {
  lat: number;
  lng: number;
}

export interface Partida extends Ponto {
  rotulo: string;
}

export interface LeadRua extends Ponto {
  empresaId: number;
  nome: string;
  endereco: string | null;
  bairro: string | null;
  cidade: string;
  faixa: Faixa | null;
  score: number | null;
  etapa: EtapaLead | null;
  situacao: SituacaoRua | 'fora';
  ultimaVisita: string | null;
  passoVencido: boolean;
  emOutroRoteiro: string | null;
}

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
  passouDoHorario: boolean;
  paradas: ParadaPlano[];
  tracado: [number, number][];
  candidatos: number;
  foraDoDia: number;
}

export type SituacaoParada = 'pendente' | 'em_visita' | 'feita' | 'pulada';

export interface ParadaRua extends Ponto {
  id: number;
  empresaId: number;
  nome: string;
  endereco: string | null;
  bairro: string | null;
  cidade: string;
  faixa: Faixa | null;
  score: number | null;
  etapa: EtapaLead | null;
  ordem: number;
  chegada: string | null;
  kmTrecho: number | null;
  minutosTrecho: number | null;
  almocoAntes: boolean;
  situacao: SituacaoParada;
  chegouEm: string | null;
  chegouDistanciaM: number | null;
  concluidaEm: string | null;
  resultado: ResultadoVisita | null;
  anotacao: string | null;
  temFoto: boolean;
  proximoPasso: string | null;
  proximoPassoEm: string | null;
  decisor: { nome: string; cargo: string | null } | null;
  telefone: string | null;
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  etapaDesde: string | null;
  historico: { tipo: string; texto: string; quando: string }[];
}

export interface RoteiroRua {
  id: number;
  vendedorId: number;
  vendedorNome: string;
  dia: string;
  campanhaId: number | null;
  campanhaNome: string | null;
  partida: Partida;
  inicio: string;
  fim: string;
  minutosVisita: number;
  almoco: { inicio: string; minutos: number } | null;
  km: number | null;
  minutosRota: number | null;
  calculo: 'ruas' | 'estimado';
  tracado: [number, number][] | null;
  filtros: { faixas?: Faixa[]; situacoes?: SituacaoRua[]; raioKm?: number; maxParadas?: number };
  enviadoEm: string | null;
  paradas: ParadaRua[];
}

export interface EstadoRua {
  rotas: boolean;
  enderecos: boolean;
  fotos: boolean;
  voz: boolean;
  ia: boolean;
}

export interface ConfigRoteiroEntrada {
  vendedorId?: number;
  dia: string;
  campanhaId: number | null;
  faixas: Faixa[];
  situacoes: SituacaoRua[];
  partida: Partida;
  inicio: string;
  fim: string;
  minutosVisita: number;
  almoco: { inicio: string; minutos: number } | null;
  raioKm: number;
  maxParadas?: number;
}

export interface AgoraVendedor {
  tipo: 'em_visita' | 'a_caminho' | 'terminou' | 'nao_comecou';
  ordem: number | null;
  empresa: string | null;
  desde: string | null;
}

export interface EquipeRua {
  numeros: {
    planejadas: number;
    feitas: number;
    comConversa: number;
    propostasReunioes: number;
    fechados: number;
    km: number;
  };
  vendedores: {
    id: number;
    nome: string;
    campanhas: string[];
    feitas: number;
    total: number;
    km: number;
    resultados: Partial<Record<ResultadoVisita, number>>;
    agora: AgoraVendedor | null;
  }[];
  ultimas: {
    paradaId: number;
    empresaId: number;
    empresa: string;
    vendedor: string;
    quando: string;
    resultado: ResultadoVisita;
    anotacao: string | null;
    temFoto: boolean;
  }[];
}

export function useEstadoRua() {
  return useQuery({
    queryKey: ['rua', 'estado'],
    queryFn: () => api<EstadoRua>('/rua/estado'),
    staleTime: 300_000,
  });
}

export function useHoje() {
  return useQuery({
    queryKey: ['rua', 'hoje'],
    queryFn: () => api<RoteiroRua | null>('/rua/hoje'),
    refetchInterval: 60_000,
  });
}

/** Foto (já reduzida) ou áudio: vai como corpo bruto. */
export function enviarArquivo<T>(caminho: string, arquivo: Blob): Promise<T> {
  return apiAudio<T>(caminho, { metodo: 'POST', arquivo });
}

/** Reduz a foto da câmera (fotos de celular passam de 5 MB) para até 1600 px, em JPEG. */
export async function reduzirFoto(arquivo: File, lado = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo).catch(() => null);
  if (!bitmap) return arquivo;
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(bitmap.width * escala);
  tela.height = Math.round(bitmap.height * escala);
  tela.getContext('2d')?.drawImage(bitmap, 0, 0, tela.width, tela.height);
  bitmap.close();
  return new Promise((ok) => tela.toBlob((b) => ok(b ?? arquivo), 'image/jpeg', 0.82));
}

/** Localização do celular agora (null: negou, não tem ou demorou). */
export function localizacaoAgora(
  espera = 12_000,
): Promise<{ lat: number; lng: number; precisao: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((ok) =>
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: espera, maximumAge: 30_000 },
    ),
  );
}

/** "Clínicas" → "Clínicas"; "CLINICA SORRISO" → "Clinica Sorriso". */
export function nomeBonito(nome: string): string {
  return nome === nome.toUpperCase()
    ? nome.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase())
    : nome;
}

/** "SALVADOR" → "Salvador". */
export const cidadeBonita = (c: string) => nomeBonito(c);
