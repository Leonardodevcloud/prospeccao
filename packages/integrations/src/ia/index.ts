import { AppError } from '@prospeccao/shared';
import { requisitarJson } from '../http.js';

/**
 * IA do sistema (nota do lead, leitura das buscas, agente do WhatsApp, respostas e abertura dos
 * e-mails). Toda chamada é "texto entra, JSON sai", então qualquer provedor serve:
 *  - deepseek: API da DeepSeek (formato OpenAI, modo JSON) — o mais barato;
 *  - gemini: Google AI Studio (resposta com esquema);
 *  - openai: qualquer API no formato da OpenAI (OpenAI, OpenRouter, Groq…), com a URL base.
 */

export const PROVEDORES_IA = ['deepseek', 'gemini', 'openai'] as const;
export type ProvedorIa = (typeof PROVEDORES_IA)[number];

export const ROTULO_PROVEDOR_IA: Record<ProvedorIa, string> = {
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  openai: 'Compatível com OpenAI',
};

/** Modelo usado quando a conta não escolhe outro (openai não tem padrão: depende do serviço). */
export const MODELO_PADRAO_IA: Record<ProvedorIa, string | null> = {
  deepseek: 'deepseek-flash',
  gemini: 'gemini-3.5-flash-lite',
  openai: null,
};

const URL_PADRAO: Record<'deepseek' | 'openai', string> = {
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com/v1',
};

/** Tokens de um pedido (o que a IA cobra). */
export interface UsoIa {
  tokensEntrada: number;
  tokensSaida: number;
}

/**
 * Quem paga e quanto: antes de cada pedido confere o teto do mês (lança erro para bloquear) e
 * depois registra as chamadas e os tokens. Fica de fora quando não há medição (testes).
 */
export interface MedidorIa {
  antes(): Promise<void>;
  depois(uso: UsoIa | null, ok: boolean): Promise<void>;
}

export interface ConfigIa {
  provedor: ProvedorIa;
  apiKey: string;
  modelo: string;
  /** Só para "openai": endereço da API (ex.: https://openrouter.ai/api/v1). */
  baseUrl?: string | null;
  medidor?: MedidorIa | null;
}

/** Esquema no formato do Gemini (OBJECT/STRING/…): vira o responseSchema ou um exemplo no texto. */
export interface EsquemaIa {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN';
  properties?: Record<string, EsquemaIa>;
  items?: EsquemaIa;
  enum?: string[];
  nullable?: boolean;
  required?: string[];
  description?: string;
}

export interface PedidoJson {
  prompt: string;
  esquema: EsquemaIa;
  temperatura?: number;
  timeoutMs?: number;
  /** Teto de tokens da resposta (o JSON cortado no meio não serve). */
  maxTokens?: number;
  /**
   * "desligado": a DeepSeek responde sem a etapa de raciocínio (ligada por padrão). O raciocínio
   * gasta o mesmo teto de tokens: num texto longo (reunião de meia hora), ele comia o teto e o JSON
   * saía vazio ou cortado.
   */
  raciocinio?: 'desligado';
}

/** Exemplo do formato pedido, para os provedores sem esquema (o modo JSON só garante JSON). */
export function exemploDoEsquema(e: EsquemaIa): unknown {
  switch (e.type) {
    case 'OBJECT':
      return Object.fromEntries(Object.entries(e.properties ?? {}).map(([k, v]) => [k, exemploDoEsquema(v)]));
    case 'ARRAY':
      return e.items ? [exemploDoEsquema(e.items)] : [];
    case 'STRING': {
      const base = e.enum ? e.enum.join(' | ') : (e.description ?? 'texto');
      return e.nullable ? `${base} (ou null)` : base;
    }
    case 'INTEGER':
      return 0;
    case 'NUMBER':
      return 0.0;
    case 'BOOLEAN':
      return e.nullable ? 'true | false | null' : true;
    default:
      return null;
  }
}

/** Tira o JSON de uma resposta que veio com texto ou ```json em volta. */
export function extrairJson(texto: string): string {
  const t = texto.trim();
  if (!t) return t;
  if (t.startsWith('{') || t.startsWith('[')) return t;
  const bloco = t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (bloco) return bloco.trim();
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  return ini >= 0 && fim > ini ? t.slice(ini, fim + 1) : t;
}

const nomeServico = (cfg: ConfigIa) => ROTULO_PROVEDOR_IA[cfg.provedor] ?? 'IA';

interface Resposta {
  texto: string;
  uso: UsoIa | null;
}

async function gemini(cfg: ConfigIa, p: PedidoJson, comRaciocinioLimitado = true): Promise<Resposta> {
  // Os modelos 2.5 pensam antes de responder e o pensamento gasta o mesmo teto de tokens: com
  // raciocínio desligado, o Flash não pensa e o Pro (que não desliga) pensa o mínimo.
  const limitar = comRaciocinioLimitado && p.raciocinio === 'desligado';
  const r = await requisitarJson<{
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelo)}:generateContent`,
    {
      servico: 'Gemini',
      method: 'POST',
      headers: { 'x-goog-api-key': cfg.apiKey },
      body: {
        contents: [{ role: 'user', parts: [{ text: p.prompt }] }],
        generationConfig: {
          temperature: p.temperatura ?? 0.2,
          responseMimeType: 'application/json',
          responseSchema: p.esquema,
          ...(p.maxTokens ? { maxOutputTokens: p.maxTokens } : {}),
          ...(limitar ? { thinkingConfig: { thinkingBudget: /pro/i.test(cfg.modelo) ? 128 : 0 } } : {}),
        },
      },
      timeoutMs: p.timeoutMs ?? 45_000,
    },
  );
  if (r.candidates?.[0]?.finishReason === 'MAX_TOKENS')
    throw AppError.externo('Gemini', 'a resposta passou do tamanho máximo e veio cortada');
  return {
    texto: r.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    uso: r.usageMetadata
      ? {
          tokensEntrada: r.usageMetadata.promptTokenCount ?? 0,
          tokensSaida: r.usageMetadata.candidatesTokenCount ?? 0,
        }
      : null,
  };
}

async function chat(
  cfg: ConfigIa,
  p: PedidoJson,
  comModoJson: boolean,
  semRaciocinio: boolean,
): Promise<Resposta> {
  const base = (
    cfg.baseUrl?.trim() || URL_PADRAO[cfg.provedor === 'deepseek' ? 'deepseek' : 'openai']
  ).replace(/\/+$/, '');
  const formato = JSON.stringify(exemploDoEsquema(p.esquema), null, 1);
  const r = await requisitarJson<{
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>(`${base}/chat/completions`, {
    servico: nomeServico(cfg),
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: {
      model: cfg.modelo,
      messages: [
        {
          role: 'system',
          content:
            'Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, sem ```. Use exatamente as chaves do formato pedido.',
        },
        { role: 'user', content: `${p.prompt}\n\nFormato da resposta (JSON):\n${formato}` },
      ],
      temperature: p.temperatura ?? 0.2,
      max_tokens: p.maxTokens ?? 2000,
      ...(comModoJson ? { response_format: { type: 'json_object' } } : {}),
      ...(semRaciocinio ? { thinking: { type: 'disabled' } } : {}),
      stream: false,
    },
    timeoutMs: p.timeoutMs ?? 45_000,
  });
  // Resposta cortada no teto de tokens: o JSON fica pela metade e não serve.
  if (r.choices?.[0]?.finish_reason === 'length')
    throw AppError.externo(nomeServico(cfg), 'a resposta passou do tamanho máximo e veio cortada');
  return {
    texto: r.choices?.[0]?.message?.content ?? '',
    uso: r.usage
      ? { tokensEntrada: r.usage.prompt_tokens ?? 0, tokensSaida: r.usage.completion_tokens ?? 0 }
      : null,
  };
}

const somar = (a: UsoIa | null, b: UsoIa | null): UsoIa | null =>
  a || b
    ? {
        tokensEntrada: (a?.tokensEntrada ?? 0) + (b?.tokensEntrada ?? 0),
        tokensSaida: (a?.tokensSaida ?? 0) + (b?.tokensSaida ?? 0),
      }
    : null;

/**
 * Pede um JSON à IA e devolve o texto do JSON (quem chama valida o conteúdo). Resposta vazia
 * (acontece de vez em quando na DeepSeek) é tentada mais uma vez.
 */
export async function gerarJson(cfg: ConfigIa, p: PedidoJson): Promise<string> {
  if (!cfg.apiKey) throw AppError.invalido('IA sem chave configurada.');
  // Teto do mês: o medidor lança erro e nada é pedido (nem cobrado).
  await cfg.medidor?.antes();
  let uso: UsoIa | null = null;
  let ok = false;
  try {
    if (cfg.provedor === 'gemini') {
      let r: Resposta;
      try {
        r = await gemini(cfg, p);
      } catch (erro) {
        // Modelo que não aceita o controle do pensamento: pede do jeito simples.
        const status = ((erro as AppError).detalhes as { status?: number } | undefined)?.status;
        if (p.raciocinio !== 'desligado' || status !== 400) throw erro;
        r = await gemini(cfg, p, false);
      }
      uso = r.uso;
      ok = true;
      return r.texto;
    }
    let modoJson = true;
    const base = cfg.baseUrl?.trim() ?? '';
    let semRaciocinio =
      p.raciocinio === 'desligado' && (cfg.provedor === 'deepseek' || /deepseek/i.test(base));
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      let r: Resposta;
      try {
        r = await chat(cfg, p, modoJson, semRaciocinio);
      } catch (erro) {
        const status = (erro as AppError).detalhes as { status?: number } | undefined;
        // Modelo que não conhece o campo de raciocínio: tenta sem ele.
        if (semRaciocinio && status?.status === 400) {
          semRaciocinio = false;
          continue;
        }
        // Serviço compatível que não conhece response_format: tenta sem (o prompt já pede JSON).
        if (modoJson && cfg.provedor === 'openai' && status?.status === 400) {
          modoJson = false;
          continue;
        }
        throw erro;
      }
      uso = somar(uso, r.uso);
      const json = extrairJson(r.texto);
      if (json) {
        ok = true;
        return json;
      }
    }
    return '';
  } finally {
    // Medição nunca derruba o pedido.
    await cfg.medidor?.depois(uso, ok).catch(() => undefined);
  }
}

/** Confere chave e modelo com um pedido mínimo (botão "Testar" do painel). */
export async function testarIa(cfg: ConfigIa): Promise<string> {
  const t = await gerarJson(cfg, {
    prompt: 'Teste de conexão. Responda em JSON com ok = true.',
    esquema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
    temperatura: 0,
    maxTokens: 30,
    timeoutMs: 20_000,
  });
  const j = JSON.parse(t || '{}') as { ok?: unknown };
  if (j.ok !== true) throw new Error(`a IA respondeu algo inesperado: ${t.slice(0, 80)}`);
  return `ok (${ROTULO_PROVEDOR_IA[cfg.provedor]} · ${cfg.modelo})`;
}

/**
 * Monta a configuração da IA a partir do que foi cadastrado. Sem chave, devolve null (as
 * funções de IA ficam desligadas e o sistema usa as regras).
 */
export function configIa(
  d: {
    provedor?: string | null;
    apiKey?: string | null;
    modelo?: string | null;
    baseUrl?: string | null;
  },
  medidor?: MedidorIa | null,
): ConfigIa | null {
  if (!d.apiKey) return null;
  const provedor = (PROVEDORES_IA as readonly string[]).includes(d.provedor ?? '')
    ? (d.provedor as ProvedorIa)
    : 'deepseek';
  const modelo = d.modelo?.trim() || MODELO_PADRAO_IA[provedor];
  if (!modelo) return null;
  return {
    provedor,
    apiKey: d.apiKey,
    modelo,
    baseUrl: d.baseUrl?.trim() || null,
    ...(medidor ? { medidor } : {}),
  };
}

/* ───────────────────────────── Conversa em etapas (Argos) ───────────────────────────── */

export interface MensagemIa {
  papel: 'user' | 'assistant';
  conteudo: string;
}

export interface PedidoConversa {
  sistema: string;
  mensagens: MensagemIa[];
  temperatura?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Raciocínio antes de responder. A DeepSeek liga por padrão (e isso custa segundos): o Argos
   * desliga para responder rápido; "baixo"/"alto" para quem pode esperar.
   */
  raciocinio?: 'desligado' | 'baixo' | 'alto';
}

const URL_GEMINI_COMPATIVEL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * Conversa com várias mensagens e resposta em JSON (o laço do Argos). Funciona com os três
 * provedores: DeepSeek e OpenAI pelo /chat/completions; Gemini pela API compatível do Google.
 * Passa pelo mesmo medidor (teto do mês e consumo da conta) que as outras chamadas.
 */
export async function conversarJson(cfg: ConfigIa, p: PedidoConversa): Promise<string> {
  if (!cfg.apiKey) throw AppError.invalido('IA sem chave configurada.');
  await cfg.medidor?.antes();
  let uso: UsoIa | null = null;
  let ok = false;
  try {
    const base = (
      cfg.provedor === 'gemini'
        ? URL_GEMINI_COMPATIVEL
        : cfg.baseUrl?.trim() || URL_PADRAO[cfg.provedor === 'deepseek' ? 'deepseek' : 'openai']
    ).replace(/\/+$/, '');
    const corpo: Record<string, unknown> = {
      model: cfg.modelo,
      messages: [
        { role: 'system', content: p.sistema },
        ...p.mensagens.map((m) => ({ role: m.papel, content: m.conteudo })),
      ],
      temperature: p.temperatura ?? 0.1,
      max_tokens: p.maxTokens ?? 1200,
      response_format: { type: 'json_object' },
      stream: false,
    };
    const deepseek = cfg.provedor === 'deepseek' || /deepseek/i.test(base);
    if (deepseek && p.raciocinio === 'desligado') corpo.thinking = { type: 'disabled' };
    else if (deepseek && p.raciocinio)
      Object.assign(corpo, {
        thinking: { type: 'enabled' },
        reasoning_effort: p.raciocinio === 'baixo' ? 'low' : 'high',
      });

    const pedir = () =>
      requisitarJson<{
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>(`${base}/chat/completions`, {
        servico: nomeServico(cfg),
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}` },
        body: corpo,
        timeoutMs: p.timeoutMs ?? 60_000,
      });

    let r: Awaited<ReturnType<typeof pedir>>;
    try {
      r = await pedir();
    } catch (erro) {
      // Modelo ou serviço que não conhece esses campos: tenta do jeito mais simples.
      const status = ((erro as AppError).detalhes as { status?: number } | undefined)?.status;
      if (status !== 400) throw erro;
      delete corpo.thinking;
      delete corpo.reasoning_effort;
      delete corpo.response_format;
      r = await pedir();
    }
    uso = r.usage
      ? { tokensEntrada: r.usage.prompt_tokens ?? 0, tokensSaida: r.usage.completion_tokens ?? 0 }
      : null;
    const texto = extrairJson(r.choices?.[0]?.message?.content ?? '');
    if (!texto) throw AppError.externo(nomeServico(cfg), 'resposta vazia');
    ok = true;
    return texto;
  } finally {
    await cfg.medidor?.depois(uso, ok).catch(() => undefined);
  }
}
