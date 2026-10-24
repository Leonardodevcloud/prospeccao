import { AppError, telefonesDoTexto } from '@prospeccao/shared';

/**
 * O arquivo que o cliente mandou → linhas de texto. Excel (.xlsx), CSV/TXT e PDF. Do Excel, a aba
 * com mais linhas; o PDF sai como texto (a IA tira os leads dele; sem IA, linha a linha).
 */

export type Formato = 'xlsx' | 'csv' | 'pdf';

/** Até quantas linhas por importação (o resto fica de fora, com aviso). */
export const MAX_LINHAS = 5000;

export function formatoDoArquivo(nome: string, mime: string): Formato {
  const n = nome.toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xlsm') || mime.includes('spreadsheetml')) return 'xlsx';
  if (n.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (/\.(csv|txt|tsv)$/.test(n) || mime.startsWith('text/')) return 'csv';
  if (n.endsWith('.xls') || n.endsWith('.ods') || n.endsWith('.numbers'))
    throw AppError.invalido(
      'Este formato de planilha é antigo. Abra no Excel ou Google Planilhas e salve como .xlsx (ou .csv).',
    );
  throw AppError.invalido('Envie a lista em Excel (.xlsx), CSV ou PDF.');
}

/** Célula do Excel → texto (número sem notação científica, data no formato brasileiro). */
function celula(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? '' : v.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  if (typeof v === 'number')
    return Number.isInteger(v) ? BigInt(Math.round(v)).toString() : String(v).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return String(v).replace(/\s+/g, ' ').trim();
}

const vazia = (l: string[]) => !l.some((c) => c.trim());

export async function lerPlanilhaExcel(dados: Buffer): Promise<{ linhas: string[][]; aba: string | null }> {
  const { default: lerXlsx, readSheetNames } = await import('read-excel-file/node');
  let nomes: string[];
  try {
    nomes = await readSheetNames(dados);
  } catch {
    throw AppError.invalido('Não consegui abrir esta planilha. Confira se é um arquivo .xlsx válido.');
  }
  // A aba com mais linhas preenchidas é a da lista (as outras costumam ser resumo ou instruções).
  let melhor: { linhas: string[][]; aba: string | null } = { linhas: [], aba: null };
  for (const aba of nomes.slice(0, 8)) {
    const bruto = await lerXlsx(dados, { sheet: aba }).catch(() => []);
    const linhas = bruto.map((l) => l.map(celula)).filter((l) => !vazia(l));
    if (linhas.length > melhor.linhas.length) melhor = { linhas, aba };
  }
  return melhor;
}

/** CSV de Excel brasileiro costuma vir em Windows-1252: sem UTF-8 válido, lê assim. */
export function textoDoCsv(dados: Buffer): string {
  const utf8 = dados.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(dados);
}

export async function textoDoPdf(dados: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  let paginas: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(dados));
    const { text } = await extractText(pdf, { mergePages: false });
    paginas = Array.isArray(text) ? text : [text];
  } catch {
    throw AppError.invalido(
      'Não consegui abrir este PDF. Confira se o arquivo não está protegido por senha.',
    );
  }
  const t = paginas.join('\n').trim();
  if (!t)
    throw AppError.invalido(
      'Este PDF não tem texto (parece uma imagem escaneada). Envie a lista em Excel ou CSV, ou um PDF gerado pelo sistema.',
    );
  return t;
}

/** Pedaços do texto do PDF para a IA (sem cortar linha no meio). */
export function pedacosDoTexto(texto: string, tamanho = 9000): string[] {
  const pedacos: string[] = [];
  let atual = '';
  for (const linha of texto.split('\n')) {
    if (atual.length + linha.length + 1 > tamanho && atual) {
      pedacos.push(atual);
      atual = '';
    }
    atual += `${linha}\n`;
  }
  if (atual.trim()) pedacos.push(atual);
  return pedacos;
}

/**
 * PDF sem IA: cada linha com telefone ou e-mail vira um lead (o texto que sobra é o nome).
 * Colunas: empresa, telefone, e-mail.
 */
export function linhasDoPdfSemIa(texto: string): string[][] {
  const linhas: string[][] = [];
  for (const bruta of texto.split('\n')) {
    const l = bruta.replace(/\s+/g, ' ').trim();
    if (!l) continue;
    const emails = l.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    const tels = telefonesDoTexto(l.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' '));
    if (!emails.length && !tels.length) continue;
    const nome = l
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
      .replace(/\+?\(?\d[\d\s().-]{7,}\d/g, ' ')
      .replace(/\b(tel|fone|telefone|whatsapp|e-?mail|cel)\b\.?:?/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/(\s*[|;,:–-])+\s*$/, '')
      .replace(/^\s*([|;,:–-]\s*)+/, '')
      .trim();
    linhas.push([nome, tels.join(' / '), emails.join(' ')]);
  }
  return linhas;
}
