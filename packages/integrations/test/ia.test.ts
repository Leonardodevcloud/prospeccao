import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerAbertura, promptAbertura } from '../src/agente/index.js';
import { configIa, exemploDoEsquema, extrairJson, gerarJson } from '../src/ia/index.js';

const esquema = {
  type: 'OBJECT' as const,
  properties: {
    faixa: { type: 'STRING' as const, enum: ['A', 'B', 'C'] },
    score: { type: 'INTEGER' as const },
    entrega: { type: 'BOOLEAN' as const, nullable: true },
    pessoas: {
      type: 'ARRAY' as const,
      items: { type: 'OBJECT' as const, properties: { nome: { type: 'STRING' as const } } },
    },
  },
};

function respostaFetch(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('IA com provedor escolhível', () => {
  it('monta o exemplo do formato a partir do esquema', () => {
    expect(exemploDoEsquema(esquema)).toEqual({
      faixa: 'A | B | C',
      score: 0,
      entrega: 'true | false | null',
      pessoas: [{ nome: 'texto' }],
    });
  });

  it('tira o JSON de respostas com texto ou bloco de código em volta', () => {
    expect(extrairJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extrairJson('Claro! {"a":1} Espero ter ajudado')).toBe('{"a":1}');
    expect(extrairJson('  {"a":1}')).toBe('{"a":1}');
  });

  it('escolhe DeepSeek por padrão e o modelo padrão do provedor', () => {
    expect(configIa({ apiKey: 'sk-1' })).toEqual({
      provedor: 'deepseek',
      apiKey: 'sk-1',
      modelo: 'deepseek-flash',
      baseUrl: null,
    });
    expect(configIa({ provedor: 'gemini', apiKey: 'k' })?.modelo).toBe('gemini-3.5-flash-lite');
    // Compatível com OpenAI não tem modelo padrão: sem modelo, fica desligada.
    expect(configIa({ provedor: 'openai', apiKey: 'k' })).toBeNull();
    expect(configIa({ apiKey: '' })).toBeNull();
  });

  it('DeepSeek: chat no formato OpenAI com modo JSON e o formato no texto; repete resposta vazia', async () => {
    const pedidos: { url: string; corpo: Record<string, unknown>; auth: string | null }[] = [];
    let n = 0;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      pedidos.push({
        url,
        corpo: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get('authorization'),
      });
      n++;
      return respostaFetch({
        choices: [{ message: { content: n === 1 ? '' : '{"faixa":"A","score":80}' } }],
      });
    });
    const t = await gerarJson(
      { provedor: 'deepseek', apiKey: 'sk-x', modelo: 'deepseek-flash' },
      { prompt: 'Avalie a empresa', esquema },
    );
    expect(JSON.parse(t)).toEqual({ faixa: 'A', score: 80 });
    expect(pedidos).toHaveLength(2);
    expect(pedidos[0]?.url).toBe('https://api.deepseek.com/chat/completions');
    expect(pedidos[0]?.auth).toBe('Bearer sk-x');
    expect(pedidos[0]?.corpo).toMatchObject({
      model: 'deepseek-flash',
      response_format: { type: 'json_object' },
    });
    const usuario = (pedidos[0]!.corpo.messages as { content: string }[])[1]!.content;
    expect(usuario).toContain('Formato da resposta (JSON)');
    expect(usuario).toContain('"faixa": "A | B | C"');
  });

  it('mede cada pedido (tokens somados nas tentativas) e o teto bloqueia antes de pedir', async () => {
    let chamadas = 0;
    vi.stubGlobal('fetch', async () => {
      chamadas++;
      return respostaFetch({
        choices: [{ message: { content: chamadas === 1 ? '' : '{"ok":true}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      });
    });
    const usos: { uso: unknown; ok: boolean }[] = [];
    let bloquear = false;
    const medidor = {
      async antes() {
        if (bloquear) throw new Error('teto do mês');
      },
      async depois(uso: unknown, ok: boolean) {
        usos.push({ uso, ok });
      },
    };
    const cfg = configIa({ apiKey: 'sk-1' }, medidor)!;
    const pedido = {
      prompt: 'x',
      esquema: { type: 'OBJECT' as const, properties: { ok: { type: 'BOOLEAN' as const } } },
    };
    expect(await gerarJson(cfg, pedido)).toBe('{"ok":true}');
    expect(usos).toEqual([{ uso: { tokensEntrada: 200, tokensSaida: 20 }, ok: true }]);
    bloquear = true;
    await expect(gerarJson(cfg, pedido)).rejects.toThrow('teto do mês');
    expect(chamadas).toBe(2);
  });

  it('compatível com OpenAI: usa a URL base e tenta sem response_format quando o serviço recusa', async () => {
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
      corpos.push(corpo);
      if (corpo.response_format) return respostaFetch({ error: 'response_format não suportado' }, 400);
      return respostaFetch({ choices: [{ message: { content: 'Aqui está: {"ok":true}' } }] });
    });
    const t = await gerarJson(
      { provedor: 'openai', apiKey: 'k', modelo: 'meta/llama', baseUrl: 'https://openrouter.ai/api/v1/' },
      { prompt: 'x', esquema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } } },
    );
    expect(t).toBe('{"ok":true}');
    expect(corpos).toHaveLength(2);
  });

  it('Gemini: manda o esquema como responseSchema', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toContain('/models/gemini-3.5-flash-lite:generateContent');
      const corpo = JSON.parse(String(init.body)) as { generationConfig: { responseSchema: unknown } };
      expect(corpo.generationConfig.responseSchema).toEqual(esquema);
      return respostaFetch({ candidates: [{ content: { parts: [{ text: '{"faixa":"B"}' }] } }] });
    });
    const t = await gerarJson(
      { provedor: 'gemini', apiKey: 'g', modelo: 'gemini-3.5-flash-lite' },
      { prompt: 'x', esquema },
    );
    expect(t).toBe('{"faixa":"B"}');
  });
});

describe('Abertura do e-mail pela IA', () => {
  it('o pedido leva os fatos do lead e as instruções da campanha', () => {
    const p = promptAbertura({
      sobreEmpresa: 'Entregas por motoboy para autopeças.',
      instrucoes: 'Fale de venda perdida por demora na entrega.',
      corpo: 'Sou Ana, da Tutts.',
      lead: {
        empresa: 'Auto Peças Silva',
        cidade: 'Salvador',
        contato: 'Marcos',
        categoria: 'Loja de autopeças',
        resumo: 'Vende peças para carros populares e entrega no bairro.',
        notaGoogle: 4.7,
        avaliacoesGoogle: 312,
        site: null,
        instagram: 'autopecassilva',
        anosDeEmpresa: 12,
      },
    });
    expect(p).toContain('Auto Peças Silva (Salvador)');
    expect(p).toContain('Nota no Google: 4.7 (312 avaliações)');
    expect(p).toContain('Fale de venda perdida');
    expect(p).not.toContain('Site:');
  });

  it('limpa saudação que a IA tenha posto e recusa resposta vazia', () => {
    expect(lerAbertura('{"abertura":"Olá, Marcos! Vi que a Silva tem 312 avaliações no Google."}')).toBe(
      'Vi que a Silva tem 312 avaliações no Google.',
    );
    expect(lerAbertura('{"abertura":"  "}')).toBeNull();
    expect(lerAbertura('não é json')).toBeNull();
  });
});
