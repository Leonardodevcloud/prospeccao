/**
 * Base de conhecimento do agente: o texto da empresa é guardado em trechos curtos, e cada resposta
 * da IA recebe só os trechos que falam do que o lead perguntou (busca por palavras, em português,
 * sem acento). Assim a base pode ter catálogo, tabela de cidades, FAQ e políticas inteiras sem
 * estourar o pedido à IA nem misturar assuntos.
 */

/** Trecho alvo (caracteres) e quanto um trecho repete do anterior (para não cortar uma ideia ao meio). */
export const TAMANHO_TRECHO = 900;
export const SOBREPOSICAO_TRECHO = 150;

/**
 * Divide um texto em trechos de até ~900 caracteres, cortando em parágrafo, depois em frase, e só
 * em último caso no meio. Cada trecho repete o final do anterior (~150 caracteres).
 */
export function dividirEmTrechos(
  texto: string,
  tamanho = TAMANHO_TRECHO,
  sobreposicao = SOBREPOSICAO_TRECHO,
): string[] {
  const limpo = texto
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!limpo) return [];
  if (limpo.length <= tamanho) return [limpo];

  // Unidades: parágrafos; parágrafo grande vira frases; frase enorme vira pedaços fixos.
  const unidades: string[] = [];
  for (const par of limpo.split(/\n\s*\n/)) {
    if (par.length <= tamanho) {
      unidades.push(par.trim());
      continue;
    }
    for (const frase of par.split(/(?<=[.!?;])\s+/)) {
      if (frase.length <= tamanho) unidades.push(frase.trim());
      else for (let i = 0; i < frase.length; i += tamanho) unidades.push(frase.slice(i, i + tamanho));
    }
  }

  const trechos: string[] = [];
  let atual = '';
  for (const u of unidades.filter(Boolean)) {
    if (atual && atual.length + u.length + 2 > tamanho) {
      trechos.push(atual);
      // Começa o próximo com o fim do anterior (cortado num espaço, para não partir palavra).
      const cauda = atual.slice(-sobreposicao);
      const espaco = cauda.indexOf(' ');
      atual = `${espaco >= 0 ? cauda.slice(espaco + 1) : cauda}\n${u}`;
    } else {
      atual = atual ? `${atual}\n\n${u}` : u;
    }
  }
  if (atual) trechos.push(atual);
  return trechos;
}

/** Palavras que não ajudam a achar o trecho certo (a busca do Postgres já ignora as mais comuns). */
const VAZIAS = new Set(
  'oi ola bom dia boa tarde noite tudo bem obrigado obrigada ok certo sim nao entao blz beleza vcs voces voce pode poderia gostaria queria quero saber'.split(
    ' ',
  ),
);

/**
 * Assuntos que o lead pergunta com outras palavras: "quanto fica?" é preço, "chega em quanto
 * tempo?" é prazo. A pergunta ganha as palavras que a base costuma usar para o assunto.
 */
const ASSUNTOS: { gatilho: RegExp; termos: string[] }[] = [
  {
    gatilho:
      /^(quanto|custa|custo|preco|precos|valor|valores|mensalidade|investimento|cobram|cobra|tabela|orcamento|caro|barato)$/,
    termos: ['preco', 'valor', 'plano', 'custa'],
  },
  {
    gatilho:
      /^(atende|atendem|atendimento|entregam|entrega|regiao|cidade|cidades|bairro|bairros|cobertura|chegam)$/,
    termos: ['atendemos', 'cidades', 'regiao', 'entrega'],
  },
  {
    gatilho: /^(pagamento|pagar|pago|boleto|pix|cartao|parcela|parcelar|parcelas|faturamento|fatura)$/,
    termos: ['pagamento', 'boleto', 'pix', 'prazo'],
  },
  { gatilho: /^(demora|rapido|tempo|prazo|horas|quando|urgente)$/, termos: ['prazo', 'tempo', 'horas'] },
  {
    gatilho: /^(contrato|fidelidade|multa|cancelar|cancelamento)$/,
    termos: ['contrato', 'fidelidade', 'cancelamento'],
  },
];

/** Termos do assunto que a pergunta toca (preço, região, pagamento, prazo, contrato). */
export function termosDoAssunto(termos: string[]): string[] {
  return ASSUNTOS.filter((a) => termos.some((t) => a.gatilho.test(t))).flatMap((a) => a.termos);
}

/** Termos da pergunta do lead para a busca (sem acento, sem saudação, até 12 palavras mais as do assunto). */
export function termosDaBusca(texto: string): string[] {
  const palavras = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !VAZIAS.has(p));
  const termos = [...new Set(palavras)].slice(0, 12);
  return [...new Set([...termos, ...termosDoAssunto(termos)])];
}
