import { normalizarTelefone } from '@prospeccao/shared';
import { requisitarJson } from '../http.js';
import type { ResultadoGoogle } from './apify.js';
import { provarPessoa } from './pessoas.js';
import type { ConfigGemini } from './servicos.js';
import { normalizarSite, usuarioInstagram } from './site.js';

/**
 * A IA lê a página de resultados do Google (a busca da razão social) como uma pessoa leria:
 * qual é o Instagram da loja, o site, os telefones e e-mails citados, quem aparece como dono ou
 * comprador. Tudo que ela devolve é conferido contra o texto da busca: o que não está escrito lá
 * é descartado (a IA não pode inventar contato).
 */

export interface LeituraBusca {
  /** Os resultados falam desta empresa (e não de um homônimo em outra cidade)? */
  mesmaEmpresa: boolean;
  instagram: string | null;
  site: string | null;
  telefones: string[];
  emails: string[];
  pessoas: { nome: string; cargo: string; trecho: string; evidencia: string }[];
}

export interface EntradaLeituraBusca {
  empresa: { nome: string; razaoSocial: string | null; cidade: string; uf: string; endereco: string | null };
  resultados: ResultadoGoogle[];
}

/** Sites que listam empresas: não são o site da loja. */
const DIRETORIOS =
  /(^|\.)(econodata|cnpj\.biz|cnpja|casadosdados|serasaexperian|serasa|autoguiabr|lavrale|solutudo|guiamais|apontador|telelistas|empresaqui|consultasocio|cnpj\.info|cnpj\.services|infoplex|guiafacil|encontra[a-z]*|listamais|achei[a-z]*|google|facebook|instagram|linkedin|youtube|tiktok|twitter|x|wa|whatsapp|mercadolivre|olx|reclameaqui|jusbrasil|escavador)\.[a-z.]+$/i;

const ESQUEMA_LEITURA = {
  type: 'OBJECT',
  properties: {
    mesmaEmpresa: { type: 'BOOLEAN' },
    instagram: { type: 'STRING', nullable: true },
    site: { type: 'STRING', nullable: true },
    telefones: { type: 'ARRAY', items: { type: 'STRING' } },
    emails: { type: 'ARRAY', items: { type: 'STRING' } },
    pessoas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { nome: { type: 'STRING' }, cargo: { type: 'STRING' }, trecho: { type: 'STRING' } },
        required: ['nome', 'cargo', 'trecho'],
      },
    },
  },
  required: ['mesmaEmpresa', 'telefones', 'emails', 'pessoas'],
};

export function promptLeituraBusca(e: EntradaLeituraBusca): string {
  const linhas = e.resultados.slice(0, 10).map((r, i) => `[${i + 1}] ${r.titulo}\n${r.url}\n${r.descricao}`);
  return [
    'Você está olhando os resultados de uma busca no Google por uma empresa brasileira, como uma pessoa olharia.',
    `Empresa procurada: ${e.empresa.nome}${e.empresa.razaoSocial ? ` (razão social ${e.empresa.razaoSocial})` : ''}, ${e.empresa.cidade} - ${e.empresa.uf}${e.empresa.endereco ? `, ${e.empresa.endereco}` : ''}.`,
    'Responda em JSON:',
    '- mesmaEmpresa: true se os resultados falam desta empresa (mesmo nome e mesma cidade), false se são de outra;',
    '- instagram: o perfil do Instagram DA EMPRESA (o usuário, ex.: "ceavenortediesel"), se aparecer; senão null;',
    '- site: o site próprio da empresa (não sites de catálogo como Econodata, CNPJ.biz, Serasa, AutoGuia, Lavrale), se aparecer; senão null;',
    '- telefones: telefones DESTA empresa citados nos resultados, copiados como estão;',
    '- emails: e-mails DESTA empresa citados nos resultados (não o e-mail do site de catálogo);',
    '- pessoas: quem aparece como dono, sócio, gerente ou comprador DESTA empresa, com o cargo escrito no resultado; "trecho" é o pedaço copiado que mostra nome e cargo.',
    'Use só o que está escrito abaixo. Não complete nem deduza: na dúvida, deixe de fora.',
    '',
    'RESULTADOS DA BUSCA',
    linhas.join('\n\n'),
  ].join('\n');
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Confere a resposta da IA contra o texto da busca e joga fora o que não está lá. */
export function conferirLeitura(bruto: unknown, resultados: ResultadoGoogle[]): LeituraBusca {
  const j = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const texto = resultados.map((r) => `${r.titulo}\n${r.url}\n${r.descricao}`).join('\n');
  const textoMin = semAcento(texto);
  const digitos = texto.replace(/\D/g, '');
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  const insta = typeof j.instagram === 'string' ? usuarioInstagram(j.instagram.replace(/^@/, '')) : null;
  const instagram =
    insta &&
    (textoMin.includes(`instagram.com/${insta.toLowerCase()}`) ||
      textoMin.includes(`@${insta.toLowerCase()}`))
      ? insta
      : null;

  const siteBruto = typeof j.site === 'string' ? normalizarSite(j.site) : null;
  let site: string | null = null;
  if (siteBruto) {
    try {
      const host = new URL(siteBruto).hostname.replace(/^www\./, '');
      if (!DIRETORIOS.test(host) && textoMin.includes(host.toLowerCase())) site = siteBruto;
    } catch {
      site = null;
    }
  }

  const telefones = [
    ...new Set(
      lista(j.telefones)
        .map((t) => normalizarTelefone(t))
        .filter((t): t is string => !!t && digitos.includes(t.slice(2))),
    ),
  ];
  const emails = [
    ...new Set(
      lista(j.emails)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && textoMin.includes(e)),
    ),
  ];

  const pessoas: LeituraBusca['pessoas'] = [];
  for (const p of Array.isArray(j.pessoas) ? j.pessoas : []) {
    if (!p || typeof p !== 'object') continue;
    const { nome, cargo, trecho } = p as Record<string, unknown>;
    if (typeof nome !== 'string' || typeof cargo !== 'string') continue;
    const prova = provarPessoa(
      { nome, cargo, trecho: typeof trecho === 'string' ? trecho : null },
      resultados.map((r) => `${r.titulo}. ${r.descricao}`),
    );
    if (prova.aceita && prova.evidencia)
      pessoas.push({
        nome: nome.trim(),
        cargo: cargo.trim(),
        trecho: String(trecho ?? ''),
        evidencia: prova.evidencia,
      });
  }

  return {
    mesmaEmpresa: j.mesmaEmpresa !== false,
    instagram,
    site,
    telefones,
    emails,
    pessoas: pessoas.slice(0, 5),
  };
}

export async function lerBuscaComGemini(cfg: ConfigGemini, e: EntradaLeituraBusca): Promise<LeituraBusca> {
  const r = await requisitarJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelo)}:generateContent`,
    {
      servico: 'Gemini',
      method: 'POST',
      headers: { 'x-goog-api-key': cfg.apiKey },
      body: {
        contents: [{ role: 'user', parts: [{ text: promptLeituraBusca(e) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA_LEITURA,
        },
      },
      timeoutMs: 45_000,
    },
  );
  const texto = r.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  let bruto: unknown = {};
  try {
    bruto = JSON.parse(texto);
  } catch {
    bruto = {};
  }
  return conferirLeitura(bruto, e.resultados);
}
