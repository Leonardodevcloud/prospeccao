import writeExcelFile from 'write-excel-file/node';

/** Uma aba da planilha: títulos das colunas (com largura) e as linhas. */
export interface Aba {
  nome: string;
  colunas: { titulo: string; largura?: number; formato?: string }[];
  linhas: unknown[][];
}

type Celula = { value: unknown; type?: unknown; format?: string; fontWeight?: 'bold' } | null;

function celula(v: unknown, formato?: string): Celula {
  if (v == null || v === '') return null;
  if (v instanceof Date) return { value: v, type: Date, format: formato ?? 'dd/mm/yyyy hh:mm' };
  if (typeof v === 'number') return { value: v, type: Number, ...(formato ? { format: formato } : {}) };
  if (typeof v === 'boolean') return { value: v ? 'sim' : 'não', type: String };
  if (Array.isArray(v)) return { value: v.join(', '), type: String };
  // Data em texto ISO vira data de verdade (o Excel ordena e filtra).
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return { value: d, type: Date, format: formato ?? 'dd/mm/yyyy hh:mm' };
  }
  return { value: String(v), type: String };
}

/** Planilha do Excel (.xlsx) com uma ou várias abas, cabeçalho em negrito e fixo. */
export async function gerarXlsx(abas: Aba[]): Promise<Buffer> {
  const folhas = abas.map((a) => ({
    sheet: a.nome.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '),
    stickyRowsCount: 1,
    columns: a.colunas.map((c) => ({ width: c.largura ?? 18 })),
    data: [
      a.colunas.map((c) => ({ value: c.titulo, type: String, fontWeight: 'bold' as const })),
      ...a.linhas.map((l) => l.map((v, i) => celula(v, a.colunas[i]?.formato))),
    ],
  }));
  // biome-ignore lint/suspicious/noExplicitAny: os tipos da biblioteca não aceitam o construtor como "type"
  return (await (writeExcelFile as any)(folhas).toBuffer()) as Buffer;
}

/** Nome de arquivo com a data de hoje: "leads-2026-10-21.xlsx". */
export function nomeArquivo(base: string): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return `${base}-${hoje}.xlsx`;
}
