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

/**
 * Preço por milhão de tokens (US$). O cache: escrever custa 1,25× a entrada; ler, 0,1× (v152: no
 * Sonnet 5.5 a leitura do cache custa US$ 0,10 por milhão, 0,05× a entrada).
 */
export interface PrecoClaude {
  entradaMilhaoUsd: number;
  saidaMilhaoUsd: number;
  /** Quanto custa ler do cache, em vezes a entrada (padrão 0,1). */
  cacheLeitura?: number;
}
const PRECOS: { prefixo: string; preco: PrecoClaude }[] = [
  { prefixo: 'claude-sonnet-5-5', preco: { entradaMilhaoUsd: 2, saidaMilhaoUsd: 10, cacheLeitura: 0.05 } },
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
    ((u.entrada + u.cacheEscrita * 1.25 + u.cacheLeitura * (p.cacheLeitura ?? 0.1)) / 1e6) *
      p.entradaMilhaoUsd +
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
  /**
   * v152: quanto o modelo pensa antes de responder (modelos novos). "alto" para quem cria (direção de
   * arte, estratégia); "baixo" para conferências mecânicas; sem valor, "medio".
   */
  esforco?: EsforcoClaude;
}
export type EsforcoClaude = 'baixo' | 'medio' | 'alto';
const EFFORT: Record<EsforcoClaude, string> = { baixo: 'low', medio: 'medium', alto: 'high' };

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

/**
 * Como cada geração de modelo aceita o pedido. Do Claude 5 em diante (Sonnet 5.5, Opus 5.5, Fable,
 * Mythos): sem `temperature` (dá erro), sem forçar a ferramenta (`tool_choice` "tool" dá erro: vai
 * "auto" com a instrução no prompt) e com o pensamento no mínimo, para o custo e o tempo ficarem
 * como antes. Os modelos 3 e 4 seguem o jeito antigo (ferramenta forçada e temperatura).
 */
export type EstiloDoModelo = 'antigo' | 'novo';
export function estiloDoModelo(modelo: string): EstiloDoModelo {
  return /^claude-(3|instant|(opus|sonnet|haiku)-[34])/.test(modelo) ? 'antigo' : 'novo';
}

/** O pensamento no mínimo: o Sonnet 5.5 aceita "between_tools"; o Sonnet 5, "disabled"; os outros, o padrão. */
export function pensamentoDo(modelo: string, esforco: EsforcoClaude = 'medio'): Record<string, unknown> {
  if (/sonnet-5-5/.test(modelo))
    return { thinking: { type: 'between_tools' }, output_config: { effort: EFFORT[esforco] } };
  if (/sonnet-5($|-\d{8})/.test(modelo)) return { thinking: { type: 'disabled' } };
  return { output_config: { effort: esforco === 'alto' ? 'medium' : 'low' } };
}

/**
 * v152: o esquema no formato da ferramenta estrita (`strict: true`): todo objeto fecha as propriedades
 * (`additionalProperties: false`). Com ela, a resposta sai sempre no esquema; a Anthropic indica isso no
 * lugar da ferramenta forçada, que os modelos novos não aceitam.
 */
export function esquemaEstrito(e: unknown): unknown {
  if (Array.isArray(e)) return e.map(esquemaEstrito);
  if (!e || typeof e !== 'object') return e;
  const o = Object.fromEntries(
    Object.entries(e as Record<string, unknown>).map(([k, v]) => [k, esquemaEstrito(v)]),
  );
  if (o.type === 'object' && o.properties && o.additionalProperties === undefined)
    o.additionalProperties = false;
  return o;
}
/** Ferramentas cujo esquema a API recusou no modo estrito: seguem do jeito antigo (instrução no prompt). */
const semEstrito = new Set<string>();

/** A instrução que substitui a ferramenta forçada (vai no fim do prompt do sistema). */
export const instrucaoDaFerramenta = (nome: string) =>
  `Responda SEMPRE chamando a ferramenta \`${nome}\` uma única vez, com todos os campos pedidos. Não escreva texto fora da ferramenta.`;

/** Um pedido à API (sem novas tentativas). Erro da API vira AppError com o status. */
async function chamar(cfg: ConfigClaude, p: PedidoClaude, lembrete = false): Promise<RespostaApi> {
  const novo = estiloDoModelo(cfg.modelo) === 'novo';
  const estrito = novo && !semEstrito.has(p.ferramenta.nome);
  const sistema = p.sistema.filter((b) => b.texto.trim());
  const mensagem = lembrete
    ? `${p.mensagem}\n\n(${instrucaoDaFerramenta(p.ferramenta.nome)} Na tentativa anterior a resposta veio sem a ferramenta.)`
    : p.mensagem;
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
        // Nos modelos novos o pensamento curto entre ferramentas também conta no máximo: uma folga.
        max_tokens: (p.maxTokens ?? 4000) + (novo ? 2000 : 0),
        ...(novo ? pensamentoDo(cfg.modelo, p.esforco) : { temperature: p.temperatura ?? 0.6 }),
        system: [
          ...sistema.map((b) => ({
            type: 'text',
            text: b.texto,
            ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}),
          })),
          // Depois dos blocos em cache, para não mexer no cache.
          ...(novo ? [{ type: 'text', text: instrucaoDaFerramenta(p.ferramenta.nome) }] : []),
        ],
        messages: [
          {
            role: 'user',
            content: p.imagens?.length
              ? [
                  ...p.imagens.flatMap((im) => [
                    ...(im.legenda ? [{ type: 'text', text: im.legenda }] : []),
                    { type: 'image', source: { type: 'base64', media_type: im.tipo, data: im.base64 } },
                  ]),
                  { type: 'text', text: mensagem },
                ]
              : mensagem,
          },
        ],
        tools: [
          {
            name: p.ferramenta.nome,
            description: p.ferramenta.descricao,
            ...(estrito
              ? { strict: true, input_schema: esquemaEstrito(p.ferramenta.esquema) }
              : { input_schema: p.ferramenta.esquema }),
          },
        ],
        tool_choice: novo ? { type: 'auto' } : { type: 'tool', name: p.ferramenta.nome },
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
      detalhes: { status: resposta.status, estrito },
    });
  }
  return (await resposta.json()) as RespostaApi;
}

/** Se o modelo respondeu em texto um JSON (sem a ferramenta), aproveita o objeto. */
export function jsonDoTexto(content: { type: string; text?: string }[]): Record<string, unknown> | null {
  const texto = content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
  const i = texto.indexOf('{');
  const j = texto.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    const v = JSON.parse(texto.slice(i, j + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
      let lembrar = false;
      try {
        for (let tentativa = 0; ; tentativa++) {
          let r: RespostaApi;
          try {
            r = await chamar(cfg, p, lembrar);
          } catch (erro) {
            const e = erro as AppError;
            // O esquema não passou no modo estrito (400): esta ferramenta volta ao jeito antigo.
            const d = e.detalhes as { status?: number; estrito?: boolean } | undefined;
            if (d?.status === 400 && d.estrito && !semEstrito.has(p.ferramenta.nome)) {
              semEstrito.add(p.ferramenta.nome);
              continue;
            }
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
          const dados =
            bloco?.input && typeof bloco.input === 'object' ? bloco.input : jsonDoTexto(r.content ?? []);
          if (!dados) {
            // Nos modelos novos a ferramenta não pode ser forçada: uma volta com o lembrete.
            if (!lembrar && estiloDoModelo(cfg.modelo) === 'novo') {
              lembrar = true;
              continue;
            }
            throw AppError.externo('Claude', `${p.agente}: a resposta veio sem o formato pedido`);
          }
          ok = true;
          return { dados, uso, custoUsd: custoUsd(cfg.modelo, uso) };
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
