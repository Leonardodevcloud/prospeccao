/** Nomes de coluna e valores-código do banco em português de gente (tabela e gráfico do Argos). */

export const ROTULOS: Record<string, string> = {
  situacao: 'Etapa',
  negociacoes: 'Negociações',
  valor_mensal: 'Valor mensal',
  potencial: 'Potencial (R$/mês)',
  em_andamento: 'Em andamento',
  ganhos_no_mes: 'Ganhos no mês',
  reunioes_no_mes: 'Reuniões no mês',
  leads_no_mes: 'Leads no mês',
  reunioes: 'Reuniões',
  valor_ganho: 'Valor ganho',
  no_funil: 'No funil',
  faixa_a: 'Faixa A',
  faixa_b: 'Faixa B',
  proxima_acao: 'Próximo passo',
  para_quando: 'Para quando',
  dias_de_atraso: 'Dias de atraso',
  responsavel: 'Responsável',
  organizacao: 'Organização',
  regiao: 'Região',
  usuario_id: 'Pessoa (id)',
  unidade_id: 'Unidade (id)',
  empresa_id: 'Empresa (id)',
};

export function rotularColuna(coluna: string): string {
  if (ROTULOS[coluna]) return ROTULOS[coluna];
  const t = coluna
    .replace(/_/g, ' ')
    .replace(/\bpct\b/i, '%')
    .replace(/\bmin\b/i, '(min)')
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const VALORES: Record<string, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
  descartado: 'Descartado',
  sdr: 'SDR',
  closer: 'Closer',
  admin: 'Administrador',
  gestor: 'Gestor',
  leitura: 'Diretoria',
  enviada: 'Enviada',
  recebida: 'Recebida',
  ligacao: 'Ligação',
  visita: 'Visita',
  tarefa: 'Tarefa',
};

/** "reuniao" → "Reunião"; outros códigos (minúsculas com _) viram texto legível. */
export function textoDoCodigo(valor: string): string {
  if (VALORES[valor]) return VALORES[valor];
  if (!/^[a-z_]+$/.test(valor)) return valor;
  const t = valor.replace(/_/g, ' ').replace(/\bnao\b/g, 'não');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
