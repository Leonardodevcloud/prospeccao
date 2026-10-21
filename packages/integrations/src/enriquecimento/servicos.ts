import { requisitarJson } from '../http.js';
import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

export { acharLugar, type EmpresaParaAchar, type LugarAchado, mesmoLugar } from '../places/index.js';

/* ---------------- WhatsApp (Evolution API) ---------------- */

export interface ConfigEvolution {
  url: string;
  apiKey: string;
  instancia: string;
}

/**
 * Confere quais números têm WhatsApp, pelo chip conectado na Evolution API. Só consulta:
 * não envia mensagem. Devolve um mapa número (DDD + número) → tem WhatsApp.
 */
export async function verificarWhatsapp(
  cfg: ConfigEvolution,
  numeros: string[],
): Promise<Map<string, boolean>> {
  const saida = new Map<string, boolean>();
  if (!numeros.length) return saida;
  const resposta = await requisitarJson<{ exists?: boolean; number?: string; jid?: string }[]>(
    `${cfg.url.replace(/\/$/, '')}/chat/whatsappNumbers/${encodeURIComponent(cfg.instancia)}`,
    {
      servico: 'Evolution API',
      method: 'POST',
      headers: { apikey: cfg.apiKey },
      body: { numbers: numeros.map((n) => `55${n}`) },
      timeoutMs: 30_000,
    },
  );
  for (const r of resposta) {
    const digitos = (r.number ?? r.jid ?? '').replace(/\D/g, '').replace(/^55/, '');
    const original = numeros.find((n) => digitos.endsWith(n.slice(-8)) && digitos.startsWith(n.slice(0, 2)));
    if (original) saida.set(original, r.exists === true);
  }
  return saida;
}

export interface PerfilWhatsapp {
  descricao: string | null;
  email: string | null;
  site: string | null;
  categoria: string | null;
  endereco: string | null;
}

/**
 * Perfil comercial (WhatsApp Business) de um número: descrição, e-mail e site que a própria loja
 * cadastrou. Só consulta. null quando o número não é comercial ou não tem nada preenchido.
 */
export async function perfilComercialWhatsapp(
  cfg: ConfigEvolution,
  numero: string,
): Promise<PerfilWhatsapp | null> {
  const r = await requisitarJson<Record<string, unknown> | Record<string, unknown>[]>(
    `${cfg.url.replace(/\/$/, '')}/chat/fetchBusinessProfile/${encodeURIComponent(cfg.instancia)}`,
    {
      servico: 'Evolution API',
      method: 'POST',
      headers: { apikey: cfg.apiKey },
      body: { number: `55${numero}` },
      timeoutMs: 20_000,
    },
  );
  return converterPerfilWhatsapp(Array.isArray(r) ? r[0] : r);
}

/** A Evolution muda o formato entre versões: aceita os nomes de campo conhecidos. */
export function converterPerfilWhatsapp(bruto: unknown): PerfilWhatsapp | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const o = bruto as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const site = Array.isArray(o.website) ? texto(o.website[0]) : texto(o.website ?? o.websites);
  const categoria = Array.isArray(o.categories)
    ? texto((o.categories[0] as { localized_display_name?: string } | undefined)?.localized_display_name)
    : texto(o.category);
  const perfil = {
    descricao: texto(o.description),
    email: texto(o.email)?.toLowerCase() ?? null,
    site,
    categoria,
    endereco: texto(o.address),
  };
  return Object.values(perfil).some(Boolean) ? perfil : null;
}

/* ---------------- Google Places (validação) ---------------- */

export interface ConfigPlaces {
  apiKey: string;
}

export interface DetalhesPlaces {
  aberto: boolean | null;
  telefone: string | null;
  site: string | null;
  nota: number | null;
  avaliacoes: number | null;
}

export async function detalhesDoLugar(cfg: ConfigPlaces, placeId: string): Promise<DetalhesPlaces> {
  const r = await requisitarJson<{
    businessStatus?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
  }>(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    servico: 'Google Places',
    headers: {
      'X-Goog-Api-Key': cfg.apiKey,
      'X-Goog-FieldMask': 'businessStatus,nationalPhoneNumber,websiteUri,rating,userRatingCount',
    },
  });
  return {
    aberto: r.businessStatus ? r.businessStatus === 'OPERATIONAL' : null,
    telefone: r.nationalPhoneNumber ?? null,
    site: r.websiteUri ?? null,
    nota: r.rating ?? null,
    avaliacoes: r.userRatingCount ?? null,
  };
}

/* ---------------- IA: nota do lead ---------------- */

export interface EntradaAvaliacao {
  nicho: string;
  /** Quem está prospectando (a conta) e o que ela vende, para a nota olhar o cliente ideal dela. */
  vendedor?: { nome: string; oferta: string | null };
  empresa: {
    nome: string;
    razaoSocial: string | null;
    cidade: string;
    uf: string;
    porte: string | null;
    abertaHaAnos: number | null;
    categoriaMaps: string | null;
    notaMaps: number | null;
    avaliacoesMaps: number | null;
    sinalEntregaMaps: boolean | null;
    temSite: boolean;
    temInstagram: boolean;
    seguidoresInstagram: number | null;
  };
  socios: { nome: string; qualificacao: string }[];
  cargosAlvo: string[];
  textoSite: string | null;
  bioInstagram: string | null;
}

export interface AvaliacaoIa {
  faixa: 'A' | 'B' | 'C';
  score: number;
  motivo: string;
  resumo: string;
  entrega: boolean | null;
  pessoas: {
    nome: string;
    cargo: string | null;
    papel: 'socio' | 'compras' | 'gestao' | 'outro';
    /** Trecho literal do texto com o nome e o cargo (conferido depois em provarPessoa). */
    trecho: string | null;
  }[];
}

const ESQUEMA: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    faixa: { type: 'STRING', enum: ['A', 'B', 'C'] },
    score: { type: 'INTEGER' },
    motivo: { type: 'STRING' },
    resumo: { type: 'STRING' },
    entrega: { type: 'BOOLEAN', nullable: true },
    pessoas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' },
          cargo: { type: 'STRING' },
          papel: { type: 'STRING', enum: ['socio', 'compras', 'gestao', 'outro'] },
          trecho: { type: 'STRING' },
        },
        required: ['nome', 'cargo', 'papel', 'trecho'],
      },
    },
  },
  required: ['faixa', 'score', 'motivo', 'resumo', 'pessoas'],
};

export function montarPrompt(e: EntradaAvaliacao): string {
  return [
    `Você qualifica empresas como possíveis clientes B2B${e.vendedor?.nome ? ` da ${e.vendedor.nome}` : ''}.`,
    e.vendedor?.oferta ? `O que ela vende: ${e.vendedor.oferta.slice(0, 1200)}` : '',
    `Nicho da campanha: ${e.nicho}. Cliente ideal: combina com o que é vendido, tem movimento (avaliações no Google, Instagram ativo), porte pequeno a médio, já estabelecida.`,
    'Responda em português, em JSON, com:',
    '- faixa: A (prioridade alta, abordar já), B (vale abordar), C (baixa prioridade ou fora do perfil);',
    '- score: 0 a 100, coerente com a faixa (A ≥ 70, B 40–69, C < 40);',
    '- motivo: uma frase objetiva com os sinais que pesaram (ex.: "vende pelo WhatsApp, 380 avaliações, 12 anos");',
    '- resumo: uma frase dizendo o que a empresa faz;',
    '- entrega: true se o site/Instagram indicar que entrega, false se indicar que não, null se não der para saber;',
    '- pessoas: SOMENTE quem o texto apresenta como da equipe da empresa, com o cargo escrito no texto (ex.: "Carlos Lima – gerente de compras", "fundada por Ana Souza"). Para cada uma, "trecho" é a frase copiada do texto que mostra nome e cargo juntos.',
    '  NÃO inclua: clientes, autores de depoimentos ou avaliações ("o que dizem nossos clientes", estrelas, "recomendo"), quem comentou ou marcou o perfil, fornecedores, marcas, nomes sem cargo no texto. Na dúvida, deixe de fora: lista vazia é melhor que nome errado. Não repita os sócios.',
    `Cargos que mais interessam: ${e.cargosAlvo.join(', ') || 'dono, sócio, gerente, comprador'}.`,
    '',
    'DADOS DA EMPRESA',
    JSON.stringify(e.empresa),
    `Sócios (Receita): ${e.socios.map((s) => `${s.nome} (${s.qualificacao})`).join('; ') || 'não informado'}`,
    '',
    `BIO DO INSTAGRAM: ${e.bioInstagram ?? 'sem Instagram'}`,
    '',
    'TEXTO DO SITE (pode estar cortado):',
    e.textoSite ?? 'sem site',
  ].join('\n');
}

export async function avaliarComIa(cfg: ConfigIa, entrada: EntradaAvaliacao): Promise<AvaliacaoIa> {
  const texto = await gerarJson(cfg, {
    prompt: montarPrompt(entrada),
    esquema: ESQUEMA,
    temperatura: 0.2,
    timeoutMs: 60_000,
    maxTokens: 1500,
  });
  return lerAvaliacao(texto);
}

/** Valida a resposta da IA: nota fora da faixa ou campos faltando não passam adiante. */
export function lerAvaliacao(texto: string): AvaliacaoIa {
  const j = JSON.parse(texto) as Partial<AvaliacaoIa>;
  const faixa = j.faixa === 'A' || j.faixa === 'B' || j.faixa === 'C' ? j.faixa : 'C';
  const score = Math.max(0, Math.min(100, Math.round(Number(j.score) || 0)));
  const papeis = new Set(['socio', 'compras', 'gestao', 'outro']);
  return {
    faixa,
    score,
    motivo: String(j.motivo ?? '').slice(0, 300),
    resumo: String(j.resumo ?? '').slice(0, 300),
    entrega: typeof j.entrega === 'boolean' ? j.entrega : null,
    pessoas: (Array.isArray(j.pessoas) ? j.pessoas : [])
      .filter((p) => p && typeof p.nome === 'string' && p.nome.trim().split(' ').length >= 2)
      .slice(0, 10)
      .map((p) => ({
        nome: p.nome.trim(),
        cargo: p.cargo?.trim() || null,
        papel: papeis.has(p.papel) ? p.papel : 'outro',
        trecho: typeof p.trecho === 'string' ? p.trecho.trim() || null : null,
      })),
  };
}

/* ---------------- Base paga: Direct Data (Cadastro Pessoa Jurídica) ---------------- */

export interface ConfigDirectData {
  token: string;
}

export interface TelefoneBasePaga {
  numero: string;
  tipo: 'celular' | 'fixo' | null;
  operadora: string | null;
  whatsapp: boolean | null;
  /** No cadastro de "não perturbe" (telemarketing bloqueado). */
  bloqueado: boolean;
}

export interface ConsultaBasePaga {
  telefones: TelefoneBasePaga[];
  emails: string[];
}

const simNao = (v: unknown): boolean | null =>
  v === true || /^(sim|s|true|1)$/i.test(String(v ?? ''))
    ? true
    : v === false || /^(n[aã]o|n|false|0)$/i.test(String(v ?? ''))
      ? false
      : null;

/** Converte a resposta da Direct Data (aceita variações de maiúsculas nos nomes). */
export function converterDirectData(
  bruto: unknown,
  normalizar: (t: string) => string | null,
): ConsultaBasePaga {
  const r = (bruto as { retorno?: Record<string, unknown> } | null)?.retorno ?? {};
  const campo = (o: Record<string, unknown>, nome: string) =>
    o[nome] ?? o[nome[0]?.toUpperCase() + nome.slice(1)];
  const lista = (nome: string) => {
    const v = campo(r, nome);
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  };
  const telefones: TelefoneBasePaga[] = [];
  for (const t of lista('telefones')) {
    const numero = normalizar(String(campo(t, 'telefoneComDDD') ?? ''));
    if (!numero || telefones.some((x) => x.numero === numero)) continue;
    const tipo = String(campo(t, 'tipoTelefone') ?? '').toLowerCase();
    telefones.push({
      numero,
      tipo: /cel|m[oó]vel/.test(tipo) ? 'celular' : /fixo/.test(tipo) ? 'fixo' : null,
      operadora: (campo(t, 'operadora') as string) || null,
      whatsapp: simNao(campo(t, 'whatsApp') ?? campo(t, 'whatsapp')),
      bloqueado: simNao(campo(t, 'telemarketingBloqueado')) === true,
    });
  }
  const emails = [
    ...new Set(
      lista('emails')
        .map((e) =>
          String(campo(e, 'enderecoEmail') ?? '')
            .trim()
            .toLowerCase(),
        )
        .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)),
    ),
  ];
  return { telefones, emails };
}

export async function consultarDirectData(
  cfg: ConfigDirectData,
  cnpj: string,
  normalizar: (t: string) => string | null,
): Promise<ConsultaBasePaga> {
  const url = `https://apiv3.directd.com.br/api/CadastroPessoaJuridica?CNPJ=${encodeURIComponent(cnpj)}&TOKEN=${encodeURIComponent(cfg.token)}`;
  const r = await requisitarJson<unknown>(url, { servico: 'Direct Data', timeoutMs: 40_000 });
  return converterDirectData(r, normalizar);
}
