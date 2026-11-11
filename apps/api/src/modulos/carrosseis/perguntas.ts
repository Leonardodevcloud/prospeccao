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
  perguntasEntrada,
  ROTULO_DIVULGAR,
  type RodadaDoTime,
  textoDoDossie,
} from '@prospeccao/shared/carrosseis-time';
import { conta } from '../../contexto.js';
import * as cerebro from './cerebro.js';
import type { CarrosseisIa } from './time.js';

/**
 * v148/v149: a conversa da estrategista antes de criar (carrossel e cards), uma rodada por chamada. O
 * navegador manda o que já foi respondido e quantas rodadas foram; volta a próxima rodada (perguntas
 * novas) ou o resumo pronto para conferir. Sem a IA, ou se ela falhar, volta "pronto" sem resumo: o
 * pedido segue como antes, sem travar ninguém. Cada rodada é uma chamada curta, medida no consumo.
 */
export async function perguntas(
  db: Executor,
  ia: CarrosseisIa | null,
  bruto: unknown,
): Promise<RodadaDoTime> {
  const p = perguntasEntrada.parse(bruto ?? {});
  const vazio: RodadaDoTime = { pronto: true, entendi: '', perguntas: [], rodada: p.rodada };
  if (!ia) return vazio;
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
      conversa: p.conversa,
      rodada: p.rodada,
    });
    return { pronto: r.pronto, entendi: r.entendi, perguntas: r.perguntas, rodada: r.rodada };
  } catch {
    return vazio;
  }
}
