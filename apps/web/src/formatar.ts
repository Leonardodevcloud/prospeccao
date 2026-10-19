import { formatarCnae, formatarCnpj, formatarTelefone } from '@prospeccao/shared/normalizar';

export { formatarCnae, formatarCnpj, formatarTelefone };

const numero = new Intl.NumberFormat('pt-BR');
const decimal1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtNumero = (n: number | null | undefined) => (n == null ? '—' : numero.format(n));
export const fmtKm = (n: number | null | undefined) => (n == null ? '—' : `${decimal1.format(n)} km`);
export const fmtNota = (n: number | null | undefined) => (n == null ? null : decimal1.format(n));

/** "SALVADOR" → "Salvador"; "LAURO DE FREITAS" → "Lauro de Freitas". */
export function fmtCidade(cidade: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return cidade
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** "há 2 h", "ontem", "12 out". */
export function fmtQuando(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  const minutos = Math.round((Date.now() - data.getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  if (horas < 48) return 'ontem';
  return data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export const ROTULO_ORIGEM: Record<string, string> = {
  ambos: 'CNPJ + Maps',
  cnpj: 'Só CNPJ',
  maps: 'Só Maps',
};

export const ROTULO_STATUS_CAMPANHA: Record<string, string> = {
  rascunho: 'Rascunho',
  ativa: 'Ativa',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
};

export const TOM_STATUS_CAMPANHA: Record<string, 'brand' | 'warning' | 'neutral' | 'outline'> = {
  ativa: 'brand',
  pausada: 'warning',
  rascunho: 'neutral',
  encerrada: 'outline',
};

export const ROTULO_CRUZAMENTO: Record<string, string> = {
  place_id: 'mesmo lugar do Maps',
  telefone: 'mesmo telefone da Receita',
  nome_cep: 'nome parecido no mesmo CEP',
  nome_cidade: 'nome muito parecido na mesma cidade',
  novo: 'não existe na base de CNPJ',
  descartado: 'descartado por palavra negativa',
};

/** Nome todo em maiúsculas (padrão da Receita) vira "Título"; nomes com caixa mista ficam como estão. */
export function fmtNome(nome: string): string {
  if (nome !== nome.toUpperCase()) return nome;
  return fmtCidade(nome);
}
