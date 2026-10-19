import {
  cnpjCompleto,
  dataReceita,
  decimalReceita,
  normalizarCnae,
  telefoneReceita,
} from '@prospeccao/shared';

/**
 * Layout dos CSVs da Receita (dicionário de dados do CNPJ). As colunas vêm por
 * posição, sem cabeçalho. Se a Receita mudar o layout, só este arquivo muda.
 */

export const PORTE_RECEITA: Record<string, 'me' | 'epp' | 'demais' | 'nao_informado'> = {
  '00': 'nao_informado',
  '01': 'me',
  '03': 'epp',
  '05': 'demais',
};

export const TIPO_SOCIO: Record<string, 'pj' | 'pf' | 'estrangeiro'> = {
  '1': 'pj',
  '2': 'pf',
  '3': 'estrangeiro',
};

export const SITUACAO_ATIVA = '02';

const limpo = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export interface Estabelecimento {
  cnpj: string;
  cnpjBasico: string;
  matriz: boolean;
  nomeFantasia: string | null;
  situacao: string;
  dataSituacao: string | null;
  dataInicio: string | null;
  cnaePrincipal: string;
  cnaesSecundarios: string[];
  tipoLogradouro: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  uf: string;
  municipioCodigo: string;
  telefones: string[];
  email: string | null;
}

/**
 * Estabelecimentos: 0 cnpj_basico, 1 ordem, 2 dv, 3 matriz/filial, 4 nome fantasia,
 * 5 situação, 6 data situação, 7 motivo, 8 cidade exterior, 9 país, 10 início atividade,
 * 11 CNAE principal, 12 CNAEs secundários, 13 tipo logradouro, 14 logradouro, 15 número,
 * 16 complemento, 17 bairro, 18 CEP, 19 UF, 20 município, 21 DDD1, 22 tel1, 23 DDD2,
 * 24 tel2, 25 DDD fax, 26 fax, 27 e-mail, 28 situação especial, 29 data situação especial.
 */
export function lerEstabelecimento(c: string[]): Estabelecimento | null {
  const basico = limpo(c[0]);
  const cnaePrincipal = normalizarCnae(c[11] ?? '');
  const uf = limpo(c[19]);
  const municipio = limpo(c[20]);
  if (!basico || !cnaePrincipal || !uf || !municipio) return null;
  const telefones = [telefoneReceita(c[21], c[22]), telefoneReceita(c[23], c[24])].filter(
    (t): t is string => t !== null,
  );
  const email = limpo(c[27])?.toLowerCase() ?? null;
  return {
    cnpj: cnpjCompleto(basico, c[1] ?? '', c[2] ?? ''),
    cnpjBasico: basico.padStart(8, '0'),
    matriz: c[3] === '1',
    nomeFantasia: limpo(c[4]),
    situacao: (c[5] ?? '').padStart(2, '0'),
    dataSituacao: dataReceita(c[6]),
    dataInicio: dataReceita(c[10]),
    cnaePrincipal,
    cnaesSecundarios: (c[12] ?? '')
      .split(',')
      .map((x) => normalizarCnae(x))
      .filter((x): x is string => x !== null),
    tipoLogradouro: limpo(c[13]),
    logradouro: limpo(c[14]),
    numero: limpo(c[15]),
    complemento: limpo(c[16]),
    bairro: limpo(c[17]),
    cep: limpo(c[18]),
    uf: uf.toUpperCase(),
    municipioCodigo: municipio.padStart(4, '0'),
    telefones: [...new Set(telefones)],
    email: email?.includes('@') ? email : null,
  };
}

export interface Empresa {
  cnpjBasico: string;
  razaoSocial: string;
  naturezaJuridica: string | null;
  capitalSocial: number | null;
  porte: 'me' | 'epp' | 'demais' | 'nao_informado';
}

/** Empresas: 0 cnpj_basico, 1 razão social, 2 natureza jurídica, 3 qualificação do responsável, 4 capital social, 5 porte, 6 ente federativo. */
export function lerEmpresa(c: string[]): Empresa | null {
  const basico = limpo(c[0]);
  const razao = limpo(c[1]);
  if (!basico || !razao) return null;
  return {
    cnpjBasico: basico.padStart(8, '0'),
    razaoSocial: razao,
    naturezaJuridica: limpo(c[2]),
    capitalSocial: decimalReceita(c[4]),
    porte: PORTE_RECEITA[(c[5] ?? '').padStart(2, '0')] ?? 'nao_informado',
  };
}

export interface Socio {
  cnpjBasico: string;
  tipo: 'pj' | 'pf' | 'estrangeiro';
  nome: string;
  documento: string | null;
  qualificacaoCodigo: string | null;
  dataEntrada: string | null;
  faixaEtaria: string | null;
}

/**
 * Sócios: 0 cnpj_basico, 1 tipo, 2 nome, 3 CPF/CNPJ, 4 qualificação, 5 data de entrada,
 * 6 país, 7 representante legal, 8 nome do representante, 9 qualificação do representante,
 * 10 faixa etária.
 */
export function lerSocio(c: string[]): Socio | null {
  const basico = limpo(c[0]);
  const nome = limpo(c[2]);
  const tipo = TIPO_SOCIO[(c[1] ?? '').trim()];
  if (!basico || !nome || !tipo) return null;
  return {
    cnpjBasico: basico.padStart(8, '0'),
    tipo,
    nome,
    documento: limpo(c[3]),
    qualificacaoCodigo: limpo(c[4])?.padStart(2, '0') ?? null,
    dataEntrada: dataReceita(c[5]),
    faixaEtaria: limpo(c[10]),
  };
}

/** Tabelas de domínio (municípios, qualificações, CNAEs): 0 código, 1 descrição. */
export function lerCodigoDescricao(c: string[]): { codigo: string; descricao: string } | null {
  const codigo = limpo(c[0]);
  const descricao = limpo(c[1]);
  if (!codigo || !descricao) return null;
  return { codigo, descricao };
}

export interface OpcaoSimples {
  cnpjBasico: string;
  simples: boolean;
  mei: boolean;
}

/**
 * Simples Nacional: 0 cnpj_basico, 1 opção pelo Simples (S/N), 2 data da opção, 3 data de exclusão,
 * 4 opção pelo MEI (S/N), 5 data da opção pelo MEI, 6 data de exclusão do MEI.
 */
export function lerSimples(c: string[]): OpcaoSimples | null {
  const basico = (c[0] ?? '').replace(/\D/g, '');
  if (!basico) return null;
  return {
    cnpjBasico: basico.padStart(8, '0'),
    simples: (c[1] ?? '').trim().toUpperCase() === 'S',
    mei: (c[4] ?? '').trim().toUpperCase() === 'S',
  };
}

/**
 * MEI pelo cadastro, quando o Simples ainda não foi lido: empresário individual (213-5) com a razão
 * social no formato do MEI: "NOME 12345678901" (CPF no fim) ou "12.345.678 NOME" (raiz do CNPJ no começo).
 */
export function pareceMei(naturezaJuridica: string | null, razaoSocial: string): boolean {
  return (
    naturezaJuridica === '2135' &&
    (/\d{11}\s*$/.test(razaoSocial) || /^\d{2}\.\d{3}\.\d{3}\s/.test(razaoSocial))
  );
}
