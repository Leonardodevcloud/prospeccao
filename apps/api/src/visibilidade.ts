import { contaSql } from './contexto.js';

/**
 * Contato ou pessoa que a conta atual pode ver: o público (achado pelo enriquecimento, conta_id 0) e o
 * que veio do arquivo que ela mesma importou. O que outra conta importou nunca aparece.
 */
export function visivel(alias: string): string {
  return `${alias}.conta_id IN (0, ${contaSql()})`;
}
