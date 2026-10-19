import { formatarCnae, formatarCnpj, formatarTelefone } from '@prospeccao/shared/normalizar';

export { formatarCnae, formatarCnpj, formatarTelefone };

const numero = new Intl.NumberFormat('pt-BR');
const decimal1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtNumero = (n: number | null | undefined) => (n == null ? '—' : numero.format(n));

const dinheiro2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinheiro3 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
/** "US$ 6,30"; com `fino`, três casas (preço por busca: "US$ 0,035"). */
export const fmtUsd = (n: number | null | undefined, fino = false) =>
  n == null ? '—' : `US$ ${(fino ? dinheiro3 : dinheiro2).format(n)}`;
/** "R$ 90" (aproximado, sem centavos). */
export const fmtBrl = (n: number | null | undefined) =>
  n == null ? '—' : `R$ ${numero.format(Math.round(n))}`;
/** "2026-11-01" → "1º/11"; "2026-11-14" → "14/11". */
export function fmtDiaMes(data: string | null | undefined): string {
  if (!data) return '—';
  const [, m, d] = data.split('-');
  return `${d === '01' ? '1º' : String(Number(d))}/${m}`;
}
/** "2026-10-01" → "outubro". */
export function fmtNomeMes(data: string): string {
  return new Date(`${data}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
}
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

const reais = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});
export const fmtReais = (n: number | null | undefined) => (n == null ? '—' : reais.format(n));

/** "38%" (sem base, "—"). */
export function fmtPct(parte: number, total: number): string {
  if (!total) return '—';
  return `${Math.round((parte / total) * 100)}%`;
}

/** Data no fuso de São Paulo no formato do <input type="date"> (AAAA-MM-DD). */
export function diaDoInput(iso: string | null | undefined): string {
  return iso ? diaSP.format(new Date(iso)) : '';
}

/** Hoje + n dias, para o <input type="date">. */
export function diaDaqui(n: number): string {
  return diaSP.format(new Date(Date.now() + n * 86_400_000));
}

/** Prazo do próximo passo: "atrasado 3 dias", "hoje", "amanhã", "em 4 dias", "12/11". */
export function fmtPrazo(
  iso: string | null | undefined,
): { texto: string; tom: 'atrasado' | 'hoje' | 'futuro' } | null {
  if (!iso) return null;
  const dia = (d: Date) => Date.parse(`${diaSP.format(d)}T00:00:00Z`);
  const diff = Math.round((dia(new Date(iso)) - dia(new Date())) / 86_400_000);
  if (diff < 0) return { texto: diff === -1 ? 'atrasado 1 dia' : `atrasado ${-diff} dias`, tom: 'atrasado' };
  if (diff === 0) return { texto: 'hoje', tom: 'hoje' };
  if (diff === 1) return { texto: 'amanhã', tom: 'futuro' };
  if (diff <= 6) return { texto: `em ${diff} dias`, tom: 'futuro' };
  return { texto: diaMesSP.format(new Date(iso)), tom: 'futuro' };
}

/** Dias desde uma data ("há 3 dias na etapa"). */
export function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

const semanaSP = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short' });

/** Hora no fuso de São Paulo: "14:30". */
export function fmtHoraSo(iso: string | null | undefined): string {
  return iso ? horaSP.format(new Date(iso)) : '';
}

/** Compromisso: "hoje 14:30", "amanhã 10:00", "qua 21/10 09:00". */
export function fmtCompromisso(iso: string | null | undefined): string {
  if (!iso) return '—';
  const data = new Date(iso);
  const dia = diaSP.format(data);
  const hora = horaSP.format(data);
  if (dia === diaSP.format(new Date())) return `hoje ${hora}`;
  if (dia === diaSP.format(new Date(Date.now() + 86_400_000))) return `amanhã ${hora}`;
  if (dia === diaSP.format(new Date(Date.now() - 86_400_000))) return `ontem ${hora}`;
  return `${semanaSP.format(data).replace('.', '')} ${diaMesSP.format(data)} ${hora}`;
}

/** Hora do <input type="time"> no fuso de São Paulo. */
export function horaDoInput(iso: string | null | undefined): string {
  return iso ? horaSP.format(new Date(iso)) : '';
}

/** Dia (AAAA-MM-DD) + hora (HH:MM) de São Paulo → instante ISO (o Brasil não tem horário de verão). */
export function instanteDoInput(dia: string, hora: string): string {
  return new Date(`${dia}T${hora || '09:00'}:00-03:00`).toISOString();
}

/** Iniciais para o avatar: "Ana Souza" → "AS". */
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  return (
    ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?'
  );
}
