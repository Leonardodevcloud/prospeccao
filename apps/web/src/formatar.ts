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

const FUSO = 'America/Sao_Paulo';
const diaSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const horaSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const diaMesSP = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
const completoSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Momento no horário de São Paulo, sempre no mesmo formato: "hoje 23:46", "ontem 18:02" ou
 * "16/10 09:15". Use com `fmtHoraCompleta` no title para o detalhe.
 */
export function fmtHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  const dia = diaSP.format(data);
  const hoje = diaSP.format(new Date());
  const ontem = diaSP.format(new Date(Date.now() - 86_400_000));
  const hora = horaSP.format(data);
  if (dia === hoje) return `hoje ${hora}`;
  if (dia === ontem) return `ontem ${hora}`;
  return `${diaMesSP.format(data)} ${hora}`;
}

/** "18/10/2026 23:46:05" (São Paulo). */
export function fmtHoraCompleta(iso: string | null | undefined): string {
  if (!iso) return '';
  return completoSP.format(new Date(iso)).replace(',', '');
}

/** "agora", "45 s", "3 min", "1 h 05 min". */
export function fmtDuracao(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 5) return 'agora';
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-09" → "set/2026"; "auto" (ainda não resolvido) → "mais recente". */
export function fmtMes(mes: string | null | undefined): string {
  if (!mes || mes === 'auto') return 'mais recente';
  const [a, m] = mes.split('-');
  const nome = MESES.at(Number(m) - 1);
  return nome && a ? `${nome}/${a}` : mes;
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
