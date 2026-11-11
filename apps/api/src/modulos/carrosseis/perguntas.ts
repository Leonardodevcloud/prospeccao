import type { Executor } from '@prospeccao/db';
import { perguntarAntes } from '@prospeccao/integrations/carrosseis';
import { FORMATO_PECA, type FormatoPeca } from '@prospeccao/shared/carrosseis';
import {
  CHAMADA_FINAL,
  type ChamadaFinal,
  OBJETIVO,
  OBJETIVO_CARD,
  type ObjetivoCard,
  type ObjetivoCarrossel,
  type PerguntaDoTime,
  perguntasEntrada,
  ROTULO_DIVULGAR,
  textoDoDossie,
} from '@prospeccao/shared/carrosseis-time';
import { conta } from '../../contexto.js';
import * as cerebro from './cerebro.js';
import type { CarrosseisIa } from './time.js';

/**
 * v148: as perguntas da estrategista antes de criar (carrossel e cards). Sem a IA, ou se ela falhar,
 * volta a lista vazia: o pedido segue como antes, sem travar ninguém. Custa uma chamada curta, medida
 * no consumo da conta como as outras.
 */
export async function perguntas(
  db: Executor,
  ia: CarrosseisIa | null,
  bruto: unknown,
): Promise<{ perguntas: PerguntaDoTime[] }> {
  const p = perguntasEntrada.parse(bruto ?? {});
  if (!ia) return { perguntas: [] };
  const [empresa, c, d] = await Promise.all([
    cerebro.nomeDaEmpresa(db),
    cerebro.cerebro(db),
    p.divulgarId ? cerebro.divulgar(db, p.divulgarId).catch(() => null) : Promise.resolve(null),
  ]);
  const objetivo =
    p.tipo === 'cards'
      ? OBJETIVO_CARD[p.objetivo as ObjetivoCard]?.nome
      : OBJETIVO[p.objetivo as ObjetivoCarrossel]?.nome;
  try {
    const r = await perguntarAntes(ia.cliente(db, conta()), {
      tipo: p.tipo,
      empresa,
      dossieTexto: textoDoDossie(c.dossie, empresa),
      assunto: p.assunto,
      objetivo: objetivo ?? '',
      chamada: CHAMADA_FINAL[p.chamada as ChamadaFinal] ?? '',
      formato: FORMATO_PECA[p.formato as FormatoPeca]?.nome ?? 'Feed',
      divulgar: d
        ? [
            `${ROTULO_DIVULGAR[d.tipo]}: ${d.titulo}`,
            d.produto,
            d.detalhes,
            d.precoPor && `por ${d.precoPor}`,
            d.validade && `validade ${d.validade}`,
            d.condicoes,
          ]
            .filter(Boolean)
            .join('\n')
        : null,
      fotos: p.fotos,
    });
    return { perguntas: r.perguntas };
  } catch {
    return { perguntas: [] };
  }
}
