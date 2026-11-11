import { AppError } from '@prospeccao/shared';

/**
 * Claude (Anthropic), o modelo do time de IA dos carrosséis. Cada agente pede uma resposta
 * estruturada: a resposta vem como a chamada de uma ferramenta com o esquema do agente (o modelo é
 * obrigado a preencher), então nunca chega texto solto no lugar do JSON.
 *
 * O começo do prompt que é igual para todos os agentes de um carrossel (o cérebro da marca) vai
 * marcado para o cache da Anthropic: do segundo agente em diante ele custa um décimo.
 */

export const URL_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
export const VERSAO_ANTHROPIC = '2023-06-01';
export const MODELO_CARROSSEIS_PADRAO = 'claude-sonnet-5-5';

/** Preço por milhão de tokens (US$). O cache: escrever custa 1,25× a entrada; ler, 0,1×. */
export interface PrecoClaude {
  entradaMilhaoUsd: number;
  saidaMilhaoUsd: number;
}
const PRECOS: { prefixo: string; preco: PrecoClaude }[] = [
  { prefixo: 'claude-opus', preco: { entradaMilhaoUsd: 5, saidaMilhaoUsd: 25 } },
  { prefixo: 'claude-haiku', preco: { entradaMilhaoUsd: 1, saidaMilhaoUsd: 5 } },
  { prefixo: 'claude-sonnet', preco: { entradaMilhaoUsd: 2, saidaMilhaoUsd: 10 } },
];
export function precoDoModelo(modelo: string): PrecoClaude {
  return PRECOS.find((p) => modelo.startsWith(p.prefixo))?.preco ?? PRECOS.at(-1)!.preco;
}

export interface UsoClaude {
  entrada: number;
  saida: number;
  cacheEscrita: number;
  cacheLeitura: number;
}
export const USO_ZERO: UsoClaude = { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0 };
export const somarUso = (a: UsoClaude, b: UsoClaude): UsoClaude => ({
  entrada: a.entrada + b.entrada,
  saida: a.saida + b.saida,
  cacheEscrita: a.cacheEscrita + b.cacheEscrita,
  cacheLeitura: a.cacheLeitura + b.cacheLeitura,
});

/** Quanto custou (US$, 6 casas). */
export function custoUsd(modelo: string, u: UsoClaude): number {
  const p = precoDoModelo(modelo);
  const v =
    ((u.entrada + u.cacheEscrita * 1.25 + u.cacheLeitura * 0.1) / 1e6) * p.entradaMilhaoUsd +
    (u.saida / 1e6) * p.saidaMilhaoUsd;
  return Math.round(v * 1e6) / 1e6;
}

/** Antes de cada pedido (pode recusar) e depois, com o que foi gasto. */
export interface MedidorClaude {
  antes?(): Promise<void>;
  depois(uso: UsoClaude, custoUsd: number, ok: boolean): Promise<void>;
}

export interface ConfigClaude {
  chave: string;
  modelo: string;
  medidor?: MedidorClaude | null;
}

/** Bloco do começo do prompt: os marcados com cache são lidos do cache da Anthropic. */
export interface BlocoSistema {
  texto: string;
  cache?: boolean;
}

export interface PedidoClaude {
  /** O agente (só para o log e as mensagens de erro). */
  agente: string;
  sistema: BlocoSistema[];
  mensagem: string;
  /** Imagens que o modelo olha antes do texto (JPEG, PNG ou WebP em base64). */
  imagens?: { tipo: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; legenda?: string }[];
  ferramenta: { nome: string; descricao: string; esquema: Record<string, unknown> };
  maxTokens?: number;
  temperatura?: number;
  timeoutMs?: number;
}

export interface RespostaClaude {
  dados: Record<string, unknown>;
  uso: UsoClaude;
  custoUsd: number;
}

/** O que o time usa para falar com o Claude (os testes trocam por um de mentira). */
export interface ClienteClaude {
  modelo: string;
  pedir(p: PedidoClaude): Promise<RespostaClaude>;
}

interface RespostaApi {
  content?: { type: string; name?: string; input?: Record<string, unknown>; text?: string }[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Um pedido à API (sem novas tentativas). Erro da API vira AppError com o status. */
async function chamar(cfg: ConfigClaude, p: PedidoClaude): Promise<RespostaApi> {
  let resposta: Response;
  try {
    resposta = await fetch(URL_ANTHROPIC, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': cfg.chave,
        'anthropic-version': VERSAO_ANTHROPIC,
      },
      body: JSON.stringify({
        model: cfg.modelo,
        max_tokens: p.maxTokens ?? 4000,
        temperature: p.temperatura ?? 0.6,
        system: p.sistema
          .filter((b) => b.texto.trim())
          .map((b) => ({
            type: 'text',
            text: b.texto,
            ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}),
          })),
        messages: [
          {
            role: 'user',
            content: p.imagens?.length
              ? [
                  ...p.imagens.flatMap((im) => [
                    ...(im.legenda ? [{ type: 'text', text: im.legenda }] : []),
                    { type: 'image', source: { type: 'base64', media_type: im.tipo, data: im.base64 } },
                  ]),
                  { type: 'text', text: p.mensagem },
                ]
              : p.mensagem,
          },
        ],
        tools: [
          {
            name: p.ferramenta.nome,
            description: p.ferramenta.descricao,
            input_schema: p.ferramenta.esquema,
          },
        ],
        tool_choice: { type: 'tool', name: p.ferramenta.nome },
      }),
      signal: AbortSignal.timeout(p.timeoutMs ?? 120_000),
    });
  } catch (erro) {
    throw new AppError(502, 'falha_externa', `Claude: sem resposta (${(erro as Error).name})`, {
      repetivel: true,
      detalhes: { status: 0 },
    });
  }
  if (!resposta.ok) {
    const corpo = (await resposta.text().catch(() => ''))
      .slice(0, 300)
      .replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '…');
    // 429 (limite), 529 (sobrecarregado) e 5xx: vale tentar de novo.
    const repetivel = resposta.status === 429 || resposta.status >= 500;
    throw new AppError(502, 'falha_externa', `Claude: HTTP ${resposta.status} ${corpo}`.trim(), {
      repetivel,
      detalhes: { status: resposta.status },
    });
  }
  return (await resposta.json()) as RespostaApi;
}

/** O cliente de verdade: até 3 tentativas com espera nos erros passageiros. */
export function criarClaude(cfg: ConfigClaude): ClienteClaude {
  return {
    modelo: cfg.modelo,
    async pedir(p) {
      if (!cfg.chave) throw AppError.invalido('Claude sem chave configurada.');
      await cfg.medidor?.antes?.();
      let uso = USO_ZERO;
      let ok = false;
      try {
        for (let tentativa = 0; ; tentativa++) {
          let r: RespostaApi;
          try {
            r = await chamar(cfg, p);
          } catch (erro) {
            const e = erro as AppError;
            if (e.repetivel && tentativa < 2) {
              await esperar(2000 * 3 ** tentativa);
              continue;
            }
            throw erro;
          }
          const u = r.usage ?? {};
          uso = somarUso(uso, {
            entrada: u.input_tokens ?? 0,
            saida: u.output_tokens ?? 0,
            cacheEscrita: u.cache_creation_input_tokens ?? 0,
            cacheLeitura: u.cache_read_input_tokens ?? 0,
          });
          if (r.stop_reason === 'max_tokens')
            throw AppError.externo(
              'Claude',
              `${p.agente}: a resposta passou do tamanho máximo e veio cortada`,
            );
          const bloco = r.content?.find((c) => c.type === 'tool_use' && c.name === p.ferramenta.nome);
          if (!bloco?.input || typeof bloco.input !== 'object')
            throw AppError.externo('Claude', `${p.agente}: a resposta veio sem o formato pedido`);
          ok = true;
          return { dados: bloco.input, uso, custoUsd: custoUsd(cfg.modelo, uso) };
        }
      } finally {
        // Medir nunca derruba o pedido.
        await cfg.medidor?.depois(uso, custoUsd(cfg.modelo, uso), ok).catch(() => undefined);
      }
    },
  };
}

/** Confere chave e modelo com o pedido mais barato possível (botão "Testar" do painel). */
export async function testarClaude(cfg: ConfigClaude): Promise<string> {
  const c = criarClaude({ ...cfg, medidor: null });
  const r = await c.pedir({
    agente: 'teste',
    sistema: [{ texto: 'Teste de conexão.' }],
    mensagem: 'Responda com ok = true.',
    ferramenta: {
      nome: 'responder',
      descricao: 'Resposta do teste.',
      esquema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    },
    maxTokens: 50,
    temperatura: 0,
    timeoutMs: 30_000,
  });
  if (r.dados.ok !== true) throw new Error('o Claude respondeu algo inesperado');
  return `ok (${cfg.modelo})`;
}
