import {
  CAMPOS_IMPORTACAO,
  type CampoImportacao,
  type MapaImportacao,
  unicos,
} from '@prospeccao/shared/importacao';
import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

/**
 * IA na importação de leads: confirma o que é cada coluna de uma planilha de formato desconhecido e
 * tira os leads do texto de um PDF. Só vê o cabeçalho e algumas linhas (a planilha inteira não sai).
 */

const corta = (v: string, n: number) => (v.length > n ? `${v.slice(0, n)}…` : v);

const DESCRICAO_CAMPOS = `empresa (nome da empresa/loja/cliente), contato (nome da pessoa), cargo, telefone, whatsapp
(coluna que diz WhatsApp), email, cnpj, cidade, uf, endereco (rua, número, bairro), cep, site, instagram,
observacao (qualquer outra informação útil, como segmento ou anotações) e ignorar (datas, códigos internos,
valores, status e colunas vazias).`;

const ESQUEMA_MAPA: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    cabecalho: { type: 'INTEGER', nullable: true, description: 'índice da linha de cabeçalho, ou null' },
    colunas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          indice: { type: 'INTEGER' },
          campo: { type: 'STRING', enum: [...CAMPOS_IMPORTACAO] },
        },
        required: ['indice', 'campo'],
      },
    },
  },
  required: ['colunas'],
};

/**
 * Confirma o que é cada coluna. Recebe as primeiras linhas como vieram (inclusive título e
 * cabeçalho) e o palpite das regras; devolve um campo por coluna e onde está o cabeçalho.
 */
export async function mapearColunasComIa(
  cfg: ConfigIa,
  e: { linhas: string[][]; palpite: MapaImportacao; cabecalho: number | null },
): Promise<{ mapa: MapaImportacao; cabecalho: number | null } | null> {
  const largura = Math.max(e.palpite.length, ...e.linhas.map((l) => l.length));
  const tabela = e.linhas
    .slice(0, 14)
    .map(
      (l, i) =>
        `${i}: ${Array.from({ length: largura }, (_, j) => `[${j}] ${corta((l[j] ?? '').trim(), 50)}`).join(' | ')}`,
    )
    .join('\n');
  const prompt = `Você organiza planilhas de leads (empresas brasileiras para prospecção comercial).
Abaixo estão as primeiras linhas de uma planilha, como vieram (pode ter título e linhas vazias antes do
cabeçalho). Cada célula aparece como [índice da coluna] valor.

${tabela}

Diga o que é cada coluna (índices 0 a ${largura - 1}) usando só estes campos: ${DESCRICAO_CAMPOS}
Regras: só uma coluna é "empresa", uma "contato", uma "cnpj", uma "cidade" e uma "uf"; telefone, whatsapp,
email e observacao podem se repetir. Coluna com nome de pessoa é "contato"; com nome de empresa é "empresa".
Se a planilha só tem nome de pessoas, use "contato". Diga também o índice da linha de cabeçalho (null se não houver).
Palpite das regras automáticas (corrija se estiver errado): ${e.palpite.map((c, i) => `${i}=${c}`).join(', ')}.`;
  const texto = await gerarJson(cfg, { prompt, esquema: ESQUEMA_MAPA, temperatura: 0, maxTokens: 1500 });
  if (!texto) return null;
  let r: { cabecalho?: number | null; colunas?: { indice?: number; campo?: string }[] };
  try {
    r = JSON.parse(texto);
  } catch {
    return null;
  }
  const mapa: MapaImportacao = [...e.palpite];
  while (mapa.length < largura) mapa.push('ignorar');
  for (const c of r.colunas ?? []) {
    if (typeof c.indice !== 'number' || c.indice < 0 || c.indice >= largura) continue;
    if (CAMPOS_IMPORTACAO.includes(c.campo as CampoImportacao)) mapa[c.indice] = c.campo as CampoImportacao;
  }
  const cab =
    typeof r.cabecalho === 'number' && r.cabecalho >= 0 && r.cabecalho < 14 ? r.cabecalho : e.cabecalho;
  return { mapa: unicos(mapa), cabecalho: r.cabecalho === null ? null : cab };
}

/** Colunas da tabela que sai de um PDF (o mapa já vem pronto). */
export const COLUNAS_PDF: CampoImportacao[] = [
  'empresa',
  'contato',
  'cargo',
  'telefone',
  'whatsapp',
  'email',
  'cnpj',
  'cidade',
  'uf',
  'endereco',
  'site',
  'instagram',
  'observacao',
];

const ESQUEMA_PDF: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    leads: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: Object.fromEntries(COLUNAS_PDF.map((c) => [c, { type: 'STRING', nullable: true }])),
      },
    },
  },
  required: ['leads'],
};

/**
 * Leads de um pedaço de texto de PDF (tabela, lista ou cartões). Cada lead vira uma linha com as
 * colunas de COLUNAS_PDF, como se fosse uma planilha.
 */
export async function extrairLeadsDoTexto(cfg: ConfigIa, texto: string): Promise<string[][]> {
  const prompt = `O texto abaixo saiu de um PDF com uma lista de contatos comerciais (empresas e/ou pessoas).
Tire TODOS os leads que aparecem, um por empresa ou pessoa, copiando os dados exatamente como estão
(não invente nada; campo que não aparece fica null). Campos: ${COLUNAS_PDF.join(', ')}.
"empresa" é o nome da empresa/loja; "contato" é o nome da pessoa; vários telefones vão juntos separados por " / ".
Ignore cabeçalhos de página, rodapés, numeração e textos que não são contato.

TEXTO:
${texto}`;
  const r = await gerarJson(cfg, {
    prompt,
    esquema: ESQUEMA_PDF,
    temperatura: 0,
    maxTokens: 8000,
    timeoutMs: 90_000,
  });
  if (!r) return [];
  try {
    const j = JSON.parse(r) as { leads?: Record<string, unknown>[] };
    return (j.leads ?? [])
      .map((l) => COLUNAS_PDF.map((c) => (l[c] == null ? '' : String(l[c]).trim())))
      .filter((l) => l.some(Boolean));
  } catch {
    return [];
  }
}
