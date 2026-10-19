/** Utilitários de normalização usados na importação, no cruzamento e na API. */

export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D+/g, '');
}

/**
 * Telefone brasileiro → DDD + número (10 ou 11 dígitos), sem DDI.
 * Retorna null quando não dá para confiar no número.
 */
export function normalizarTelefone(valor: string | null | undefined): string | null {
  let d = soDigitos(valor);
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === '0' || d[1] === '0') return null; // DDD válido nunca tem zero
  if (d.length === 11 && d[2] !== '9') return null; // 11 dígitos só para celular
  return d;
}

/** DDD e telefone vêm em colunas separadas na base da Receita. */
export function telefoneReceita(
  ddd: string | null | undefined,
  numero: string | null | undefined,
): string | null {
  const dddLimpo = soDigitos(ddd).replace(/^0+/, '');
  const numeroLimpo = soDigitos(numero);
  if (!dddLimpo || !numeroLimpo) return null;
  return normalizarTelefone(dddLimpo + numeroLimpo);
}

export function ehCelular(telefoneNormalizado: string): boolean {
  return telefoneNormalizado.length === 11 && telefoneNormalizado[2] === '9';
}

/** "71998124410" → "(71) 99812-4410" */
export function formatarTelefone(telefoneNormalizado: string): string {
  const d = soDigitos(telefoneNormalizado);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefoneNormalizado;
}

export function cnpjCompleto(basico: string, ordem: string, dv: string): string {
  return basico.padStart(8, '0') + ordem.padStart(4, '0') + dv.padStart(2, '0');
}

export function formatarCnpj(cnpj: string): string {
  const d = soDigitos(cnpj).padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string) => {
    const pesos =
      base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + p * Number(base[i]), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = calc(d.slice(0, 12));
  const dv2 = calc(d.slice(0, 12) + dv1);
  return d.endsWith(`${dv1}${dv2}`);
}

/** "4530-7/03" ou "4530703" → "4530703" (7 dígitos, como na base da Receita). */
export function normalizarCnae(cnae: string): string | null {
  const d = soDigitos(cnae);
  return d.length === 7 ? d : null;
}

/** "4530703" → "4530-7/03" */
export function formatarCnae(cnae: string): string {
  const d = soDigitos(cnae);
  if (d.length !== 7) return cnae;
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}`;
}

const SUFIXOS_SOCIETARIOS =
  /\b(ltda|me|epp|eireli|mei|s\/?a|cia|limitada|microempresa|empresa individual|sociedade unipessoal|slu)\b/g;

/**
 * Nome para comparação: minúsculo, sem acento, sem pontuação e sem sufixo
 * societário. "AUTO PEÇAS LADEIRA NOVA LTDA - ME" → "auto pecas ladeira nova"
 */
export function normalizarNome(nome: string | null | undefined): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(SUFIXOS_SOCIETARIOS, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Datas da Receita vêm como AAAAMMDD; "00000000" e vazio significam ausente. */
export function dataReceita(valor: string | null | undefined): string | null {
  const d = soDigitos(valor);
  if (d.length !== 8 || d === '00000000') return null;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Capital social vem como "1000,00". */
export function decimalReceita(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const n = Number(valor.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "Salvador" / "SALVADOR" / "salvadôr" → "SALVADOR" (como a Receita grava). */
export function normalizarCidade(cidade: string): string {
  return cidade
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
