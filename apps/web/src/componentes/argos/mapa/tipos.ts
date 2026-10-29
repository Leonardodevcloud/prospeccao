import type { LigacaoMapaDTO, NoMapaDTO } from '@prospeccao/shared/assistente';
import { COR_AREA } from './cores';

/** Nó e ligação do mapa (os mesmos que a api manda). */
export type No = NoMapaDTO;
export type Ligacao = Omit<LigacaoMapaDTO, 'origem' | 'destino'> & {
  origem: string | No;
  destino: string | No;
};

export const idDe = (p: string | No) => (typeof p === 'string' ? p : p.id);

/** Cor do aglomerado: a da etapa; as pessoas da equipe têm a sua. */
export function corDoNo(no: No) {
  if (no.categoria === 'cliente') return COR_CLIENTE;
  if (no.area) return COR_AREA[no.area] ?? '#94A3B8';
  return '#94A3B8';
}

export const COR_CLIENTE = '#2DD4BF';
