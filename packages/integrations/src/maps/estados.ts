const ESTADOS: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

const UFS = new Set(Object.values(ESTADOS));

/** "Bahia", "State of Bahia", "Estado da Bahia" ou "BA" → "BA". */
export function ufDoEstado(estado: string | null | undefined): string | null {
  if (!estado) return null;
  const limpo = estado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(state of|estado d[eoa])\s+/, '')
    .trim();
  if (limpo.length === 2 && UFS.has(limpo.toUpperCase())) return limpo.toUpperCase();
  return ESTADOS[limpo] ?? null;
}
