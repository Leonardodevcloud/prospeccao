import type { NotaAtendimento, PainelAtendimento, ResumoVendedor } from '@prospeccao/shared/atendimento';
import { situacaoDaNota } from '@prospeccao/shared/atendimento';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../api';

/** Os dados da Qualidade do atendimento (painel do gestor, resumo de uma pessoa, notas de um lead). */

export interface ResumoDaSemana {
  semana: string;
  resumo: ResumoVendedor;
  semanas: { semana: string; nota: number | null }[];
}

export const usePainelAtendimento = (semana: string | null, grupo: number | null) =>
  useQuery({
    queryKey: ['atendimento', 'painel', semana, grupo],
    queryFn: () => api<PainelAtendimento>(`/atendimento/painel${qs({ semana, grupo })}`),
  });

/** O resumo de uma pessoa (o gestor vê de todos; "eu": o da própria pessoa). */
export const useResumoAtendimento = (quem: number | 'eu' | null, semana: string | null, ligado = true) =>
  useQuery({
    queryKey: ['atendimento', 'resumo', quem, semana],
    queryFn: () =>
      api<ResumoDaSemana>(
        quem === 'eu' ? `/atendimento/eu${qs({ semana })}` : `/atendimento/vendedor/${quem}${qs({ semana })}`,
      ),
    enabled: ligado && quem != null,
  });

export const useNotasDoLead = (empresaId: number, ligado = true) =>
  useQuery({
    queryKey: ['atendimento', 'lead', empresaId],
    queryFn: () => api<{ notas: NotaAtendimento[] }>(`/atendimento/lead/${empresaId}`),
    enabled: ligado,
  });

/** 7.5 → "7,5". */
export const fmtNota = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(1).replace('.', ','));

/** +0,6 / −0,5 / igual (a diferença para a semana anterior). */
export function fmtDiferenca(
  agora: number | null,
  antes: number | null,
): { texto: string; sinal: number } | null {
  if (agora == null || antes == null) return null;
  const d = Math.round((agora - antes) * 10) / 10;
  if (d === 0) return { texto: 'igual', sinal: 0 };
  return { texto: `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')}`, sinal: Math.sign(d) };
}

export const tomDaNota = (n: number) => situacaoDaNota(n);

/** As últimas semanas para o filtro (a atual primeiro), a partir das segundas-feiras. */
export function semanasRecentes(atual: string, quantas = 8): { valor: string; rotulo: string }[] {
  const dia = (d: Date) => d.getUTCDate();
  const mes = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
  const lista: { valor: string; rotulo: string }[] = [];
  const base = new Date(`${atual}T00:00:00Z`);
  for (let i = 0; i < quantas; i++) {
    const de = new Date(base.getTime() - i * 7 * 86_400_000);
    const ate = new Date(de.getTime() + 6 * 86_400_000);
    lista.push({
      valor: de.toISOString().slice(0, 10),
      rotulo: `${i === 0 ? 'Esta semana · ' : ''}${
        mes(de) === mes(ate)
          ? `${dia(de)} a ${dia(ate)} ${mes(ate)}`
          : `${dia(de)} ${mes(de)} a ${dia(ate)} ${mes(ate)}`
      }`,
    });
  }
  return lista;
}

export const rotuloSemana = (segunda: string) =>
  semanasRecentes(segunda, 1)[0]!.rotulo.replace('Esta semana · ', '');
