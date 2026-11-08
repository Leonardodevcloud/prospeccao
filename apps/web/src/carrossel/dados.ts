import type {
  Carrossel,
  FotoCarrossel,
  IdentidadeCarrossel,
  LogoSlide,
  ResumoCarrossel,
} from '@prospeccao/shared/carrosseis';
import { useQuery } from '@tanstack/react-query';
import { api, ErroApi } from '../api';

/** O que a api devolve sobre os carrosséis (tipos da tela). */

export interface SituacaoCarrosseis {
  modulo: boolean;
  armazenamento: boolean;
  franquia: { usados: number; limite: number | null };
}

export interface LogoDaIdentidade {
  origem: 'propria' | 'marca';
  largura: number;
  altura: number;
}

export interface IdentidadeDaConta {
  identidade: IdentidadeCarrossel;
  salva: boolean;
  logos: { claro: LogoDaIdentidade | null; escuro: LogoDaIdentidade | null };
  versao: string;
  marca: { nome: string; cores: { principal: string | null; destaque: string | null; claro: string | null } };
  ajustes: string[];
  atualizadaEm: string | null;
}

export interface ListaCarrosseis {
  carrosseis: ResumoCarrossel[];
  franquia: SituacaoCarrosseis['franquia'];
}

export const useSituacaoCarrosseis = () =>
  useQuery({
    queryKey: ['carrosseis', 'situacao'],
    queryFn: () => api<SituacaoCarrosseis>('/carrosseis/situacao'),
  });

export const useIdentidade = (ligado = true) =>
  useQuery({
    queryKey: ['carrosseis', 'identidade'],
    queryFn: () => api<IdentidadeDaConta>('/carrosseis/identidade'),
    enabled: ligado,
  });

export const useFotos = (ligado = true) =>
  useQuery({
    queryKey: ['carrosseis', 'fotos'],
    queryFn: () => api<{ fotos: FotoCarrossel[]; max: number }>('/carrosseis/fotos'),
    enabled: ligado,
  });

export const useCarrossel = (id: number) =>
  useQuery({ queryKey: ['carrosseis', 'um', id], queryFn: () => api<Carrossel>(`/carrosseis/${id}`) });

/** Endereço da foto da empresa (a api reduz para a largura pedida). */
export const urlFoto = (id: number, largura = 1080) =>
  `/api/carrosseis/fotos/${id}/imagem?largura=${largura}`;

/** Logos que entram nos slides (a de Marca e domínio só se a identidade usa). */
export function logosDaIdentidade(d: IdentidadeDaConta, identidade: IdentidadeCarrossel) {
  const logo = (tipo: 'claro' | 'escuro'): LogoSlide | null => {
    const l = d.logos[tipo];
    if (!l || (l.origem === 'marca' && !identidade.usarLogoDaMarca)) return null;
    return {
      src: `/api/carrosseis/identidade/logo/${tipo}?v=${d.versao}`,
      largura: l.largura,
      altura: l.altura,
    };
  };
  return { logoClaro: logo('claro'), logoEscuro: logo('escuro') };
}

/** Manda uma imagem crua para a api (foto ou logo). */
export async function enviarImagem<T>(caminho: string, arquivo: File): Promise<T> {
  const r = await fetch(`/api${caminho}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': arquivo.type || 'image/jpeg' },
    body: arquivo,
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok)
    throw new ErroApi(
      r.status,
      dados?.erro?.codigo ?? 'erro',
      dados?.erro?.mensagem ?? `Não deu para enviar (erro ${r.status}).`,
    );
  return dados as T;
}
