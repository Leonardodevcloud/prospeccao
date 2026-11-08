import {
  type EstiloCarrossel,
  type IdentidadeCarrossel,
  MODELO,
  MODELOS,
  type ModeloSlide,
  montarSlide,
  type SlideCarrossel,
} from '@prospeccao/shared/carrosseis';
import {
  type AvisoTime,
  botaoDaChamada,
  CAMPOS_SUGESTAO,
  type CampoSugestao,
  CHAMADA_FINAL,
  CRITERIO,
  CRITERIOS_REVISOR,
  type CriterioRevisor,
  conferirPromocao,
  type DivulgarEntrada,
  type EtapaTime,
  limitesParaORedator,
  MAX_VOLTAS_REVISOR,
  OBJETIVO,
  type PedidoTime,
  type RelatorioTime,
  ROTULO_DIVULGAR,
  revisaoAprovada,
  slideDoTime,
  TIPOS_AVISO_TIME,
  type TipoAvisoTime,
} from '@prospeccao/shared/carrosseis-time';
import { trechoNaFonte } from '../agente/perfil.js';
import { type BlocoSistema, type ClienteClaude, somarUso, USO_ZERO, type UsoClaude } from './claude.js';

/**
 * O time de IA de um carrossel. Cada agente é um pedido ao Claude com um papel e uma régua:
 *  1. estrategista: o ângulo, três ganchos (escolhe um) e o roteiro (o modelo de cada slide);
 *  2. redator: o texto de cada slide dentro do limite do modelo, a legenda e as hashtags;
 *  3. diretor de arte: aqui é código, não IA: monta cada slide com as fontes de verdade e diz o que
 *     não coube, confere a promoção (preço e prazo exatamente como foram digitados) e a chamada;
 *  4. revisor: nota de 1 a 5 em cada critério, os ajustes slide a slide e os fatos com o trecho da
 *     fonte (o trecho é conferido aqui; citação que não está na fonte não vale).
 * Não passou: volta para o redator com os ajustes (até 2 vezes). O que sobrar vira aviso no editor,
 * com a sugestão do revisor para a pessoa usar ou manter.
 */

export interface PostQueFuncionou {
  legenda: string;
  tipo: string;
  alcance: number;
  salvos: number;
  compartilhamentos: number;
  leads: number;
}

export interface FonteDoTime {
  rotulo: string;
  texto: string;
}

export interface EntradaTime {
  empresa: string;
  dossieTexto: string;
  /** Fontes que os fatos podem citar (dossiê, perfil da IA, promoção, o pedido). */
  fontes: FonteDoTime[];
  identidade: IdentidadeCarrossel;
  estilo: EstiloCarrossel;
  pedido: PedidoTime;
  divulgar: (DivulgarEntrada & { id: number }) | null;
  postsQueFuncionaram: PostQueFuncionou[];
  /** Títulos dos últimos carrosséis (para não repetir o assunto do mesmo jeito). */
  anteriores: string[];
  fotos: { id: number; nome: string }[];
  hoje: string;
}

export interface ResultadoTime {
  titulo: string;
  slides: SlideCarrossel[];
  legenda: string;
  relatorio: RelatorioTime;
  uso: UsoClaude;
  custoUsd: number;
}

export type AoAvancar = (etapa: EtapaTime, detalhe?: string) => Promise<void> | void;

/* ───────────────────────────── O manual do time ───────────────────────────── */

const MANUAL = `Você faz parte do time de conteúdo de uma empresa brasileira e cria carrosséis para o Instagram (feed, imagens 1080 × 1350). Quem lê está rolando a tela no celular: cada slide tem um segundo para prender.

O QUE FAZ UM CARROSSEL EXCEPCIONAL
- A capa para o dedo: promessa concreta, número, contradição ou a dor dita do jeito que o cliente fala. Curta (ideal até 9 palavras). Nada de "Você sabia que", "Descubra", "No mundo de hoje", "Desvende", "Confira".
- Uma ideia por slide. Frase curta, palavra simples, verbo forte. Se precisa de "e" duas vezes, são dois slides.
- Específico vence genérico: situação real do nicho, exemplo concreto, número que a empresa pode provar. Nada de "soluções inovadoras", "excelência", "qualidade e compromisso".
- Ritmo: a capa promete, o slide 2 mostra por que importa (ou a dor), o meio entrega o conteúdo, o penúltimo amarra, o último diz o que fazer agora.
- O último slide pede UMA ação clara.
- Português do Brasil natural, como a empresa fala com o cliente. Sem emoji nos slides (as fontes não têm). Sem hashtag nos slides.

REGRAS QUE NUNCA SE QUEBRAM
- Nunca invente fato da empresa: número, porcentagem, prazo, preço, desconto, garantia, resultado de cliente, prêmio, tempo de mercado, quantidade de clientes. Só use o que está nas FONTES (o dossiê, a promoção, o pedido). Sem fonte, escreva de um jeito que não afirme o fato.
- Estatística do mercado sem fonte também não: troque por uma observação do dia a dia ("quem pede orçamento costuma pedir para mais de um fornecedor").
- Preço, validade e condição de promoção saem exatamente como foram digitados.
- Nunca nome, telefone ou caso identificável de cliente.
- Respeite o NUNCA DIZER e o tom de voz da marca.`;

const lista = (l: string[]) => l.map((x) => `- ${x}`).join('\n');

function blocoDaMarca(e: EntradaTime): string {
  const posts = e.postsQueFuncionaram
    .slice(0, 6)
    .map(
      (p, i) =>
        `${i + 1}. [${p.tipo}] alcance ${p.alcance}, ${p.salvos} salvos, ${p.compartilhamentos} compartilhamentos, ${p.leads} leads · "${p.legenda.replace(/\s+/g, ' ').slice(0, 220)}"`,
    );
  return [
    'CÉREBRO DA MARCA (conferido pelo administrador):',
    e.dossieTexto,
    '',
    posts.length
      ? `POSTS DA CONTA QUE MAIS FUNCIONARAM (o que este público responde):\n${posts.join('\n')}`
      : 'POSTS DA CONTA: ainda sem números do Instagram.',
    '',
    e.anteriores.length
      ? `CARROSSÉIS QUE O TIME JÁ FEZ (não repita o mesmo ângulo):\n${lista(e.anteriores.slice(0, 15))}`
      : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

function blocoDoPedido(e: EntradaTime): string {
  const p = e.pedido;
  const d = e.divulgar;
  const linhas = [
    `HOJE: ${e.hoje}`,
    `OBJETIVO: ${OBJETIVO[p.objetivo].nome} (${OBJETIVO[p.objetivo].dica})`,
    p.assunto ? `PEDIDO DE QUEM CRIOU: ${p.assunto}` : '',
    d
      ? [
          `O QUE DIVULGAR (${ROTULO_DIVULGAR[d.tipo]}): ${d.titulo}`,
          d.produto && `Produto: ${d.produto}`,
          d.detalhes && `Detalhes: ${d.detalhes}`,
          d.precoDe && `Preço de (exato): ${d.precoDe}`,
          d.precoPor && `Preço por (exato): ${d.precoPor}`,
          d.validade && `Validade (exata): ${d.validade}`,
          d.condicoes && `Condições: ${d.condicoes}`,
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    `CHAMADA FINAL: ${CHAMADA_FINAL[p.chamada]}${p.chamada === 'comentar' ? ` — a palavra é ${p.palavra.toUpperCase()} (o botão é "Comente ${p.palavra.toUpperCase()}")` : ''}`,
    `ESTILO VISUAL: ${e.estilo}`,
    e.identidade.assinatura ? `ASSINATURA NO RODAPÉ: ${e.identidade.assinatura}` : '',
  ];
  return linhas.filter(Boolean).join('\n');
}

function sistema(e: EntradaTime): BlocoSistema[] {
  // O manual e a marca são iguais em todos os agentes do carrossel: vão para o cache.
  return [{ texto: `${MANUAL}\n\n${blocoDaMarca(e)}`, cache: true }];
}

/* ───────────────────────────── 1. Estrategista ───────────────────────────── */

const ESQUEMA_ESTRATEGIA = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Nome interno do carrossel (até 80 letras).' },
    angulo: { type: 'string', description: 'O ângulo em uma frase: por que este carrossel, para quem.' },
    ganchos: {
      type: 'array',
      description: 'Três ganchos diferentes para a capa (até 90 letras cada).',
      items: { type: 'string' },
    },
    escolhido: { type: 'integer', description: 'Índice (0, 1 ou 2) do gancho mais forte.' },
    porque: {
      type: 'string',
      description: 'Por que esse gancho e esse roteiro, citando de onde veio a ideia.',
    },
    fontes: {
      type: 'array',
      description: 'O que você usou para decidir, das opções em FONTES USADAS.',
      items: { type: 'string' },
    },
    slides: {
      type: 'array',
      description: 'O roteiro: um item por slide, na ordem.',
      items: {
        type: 'object',
        properties: {
          modelo: { type: 'string', enum: [...MODELOS] },
          ideia: { type: 'string', description: 'O que este slide diz, em uma frase.' },
          fotoId: { type: ['integer', 'null'], description: 'Foto da empresa (só capa e foto), ou null.' },
        },
        required: ['modelo', 'ideia'],
      },
    },
  },
  required: ['titulo', 'angulo', 'ganchos', 'escolhido', 'porque', 'slides'],
};

interface Estrategia {
  titulo: string;
  angulo: string;
  ganchos: string[];
  gancho: string;
  porque: string;
  fontes: string[];
  roteiro: { modelo: ModeloSlide; ideia: string; fotoId: number | null }[];
}

const OPCOES_FONTES = [
  'Cérebro da marca',
  'O que divulgar',
  'Perguntas dos clientes',
  'Objeções',
  'Posts que mais funcionaram',
  'Pedido de quem criou',
];

function lerEstrategia(d: Record<string, unknown>, e: EntradaTime): Estrategia {
  const ganchos = (Array.isArray(d.ganchos) ? d.ganchos : [])
    .map((g) =>
      String(g ?? '')
        .trim()
        .slice(0, 140),
    )
    .filter(Boolean)
    .slice(0, 3);
  const idx = Math.max(0, Math.min(ganchos.length - 1, Number(d.escolhido) || 0));
  const fotos = new Set(e.fotos.map((f) => f.id));
  let roteiro = (Array.isArray(d.slides) ? d.slides : [])
    .map((s) => s as Record<string, unknown>)
    .filter((s) => (MODELOS as readonly string[]).includes(String(s.modelo)))
    .map((s) => {
      const modelo = s.modelo as ModeloSlide;
      const fotoId = Number(s.fotoId);
      return {
        modelo,
        ideia: String(s.ideia ?? '').slice(0, 300),
        fotoId: e.pedido.usarFotos && MODELO[modelo].foto && fotos.has(fotoId) ? fotoId : null,
      };
    });
  // O roteiro sempre começa na capa e termina na chamada, no número de slides pedido.
  if (roteiro[0]?.modelo !== 'capa') roteiro.unshift({ modelo: 'capa', ideia: 'O gancho', fotoId: null });
  if (roteiro.at(-1)?.modelo !== 'chamada')
    roteiro.push({ modelo: 'chamada', ideia: 'O que fazer agora', fotoId: null });
  roteiro = [
    roteiro[0]!,
    ...roteiro.slice(1, -1).filter((s) => s.modelo !== 'capa' && s.modelo !== 'chamada'),
    roteiro.at(-1)!,
  ];
  const alvo = e.pedido.slides;
  const max = alvo ?? 10;
  const min = alvo ?? 5;
  while (roteiro.length > max) roteiro.splice(roteiro.length - 2, 1);
  while (roteiro.length < min)
    roteiro.splice(roteiro.length - 1, 0, { modelo: 'texto', ideia: 'Mais um ponto', fotoId: null });
  // "Foto" sem foto não funciona: vira texto.
  roteiro = roteiro.map((s) => (s.modelo === 'foto' && !s.fotoId ? { ...s, modelo: 'texto' as const } : s));
  return {
    titulo:
      String(d.titulo ?? '')
        .trim()
        .slice(0, 120) ||
      ganchos[idx] ||
      'Carrossel',
    angulo: String(d.angulo ?? '')
      .trim()
      .slice(0, 400),
    ganchos,
    gancho: ganchos[idx] ?? '',
    porque: String(d.porque ?? '')
      .trim()
      .slice(0, 800),
    fontes: (Array.isArray(d.fontes) ? d.fontes : [])
      .map((x) => String(x))
      .filter((x) => OPCOES_FONTES.includes(x))
      .slice(0, 6),
    roteiro,
  };
}

function mensagemEstrategista(e: EntradaTime): string {
  const n = e.pedido.slides;
  return [
    'Você é o ESTRATEGISTA. Decida o ângulo, escreva três ganchos bem diferentes para a capa (escolha o mais forte) e monte o roteiro.',
    '',
    blocoDoPedido(e),
    '',
    n
      ? `NÚMERO DE SLIDES: exatamente ${n}.`
      : 'NÚMERO DE SLIDES: você decide, de 5 a 10 (o necessário, nem um a mais).',
    'O primeiro slide é "capa" e o último é "chamada". No meio, escolha o modelo que serve à ideia de cada slide:',
    limitesParaORedator(MODELOS.filter((m) => m !== 'capa' && m !== 'chamada')),
    '',
    e.pedido.usarFotos && e.fotos.length
      ? `FOTOS DA EMPRESA (use só quando a foto combina com o slide; só nos modelos capa e foto):\n${e.fotos.map((f) => `- id ${f.id}: ${f.nome}`).join('\n')}`
      : 'FOTOS: não use fotos (fotoId sempre null). Não use o modelo "foto".',
    '',
    `FONTES USADAS (escolha das opções): ${OPCOES_FONTES.join(', ')}.`,
    'Se o pedido é para vender, a promoção é o centro e o preço aparece em "numero" ou "comparacao". Se é para ensinar, o conteúdo útil vem antes de qualquer oferta.',
    'Ligue o carrossel ao que os clientes perguntam e ao que funcionou nos posts, quando fizer sentido.',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/* ───────────────────────────── 2. Redator ───────────────────────────── */

const ESQUEMA_SLIDE = {
  type: 'object',
  properties: {
    modelo: { type: 'string', enum: [...MODELOS] },
    sobretitulo: { type: 'string' },
    titulo: { type: 'string' },
    texto: { type: 'string' },
    destaque: { type: 'string' },
    botao: { type: 'string' },
    itens: { type: 'array', items: { type: 'string' } },
    colunas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rotulo: { type: 'string' }, texto: { type: 'string' } },
        required: ['rotulo', 'texto'],
      },
    },
  },
  required: ['modelo'],
};

const ESQUEMA_REDACAO = {
  type: 'object',
  properties: {
    slides: { type: 'array', items: ESQUEMA_SLIDE },
    legenda: {
      type: 'string',
      description:
        'A legenda do post, sem hashtags: a primeira linha (até 125 letras) é o gancho; depois 3 a 6 parágrafos curtos; termina com a chamada.',
    },
    hashtags: {
      type: 'array',
      description: '3 a 8 hashtags específicas do nicho e da região (sem o #).',
      items: { type: 'string' },
    },
  },
  required: ['slides', 'legenda', 'hashtags'],
};

interface Redacao {
  slides: SlideCarrossel[];
  legenda: string;
  hashtags: string[];
}

function lerRedacao(d: Record<string, unknown>, roteiro: Estrategia['roteiro'], e: EntradaTime): Redacao {
  const brutos = (Array.isArray(d.slides) ? d.slides : []) as Record<string, unknown>[];
  const slides = roteiro.map((r, i) => {
    const b = brutos[i] ?? {};
    const s = slideDoTime(b, r.modelo, `s${i + 1}`);
    return { ...s, fotoId: r.fotoId };
  });
  // A chamada de "comente" sempre com a palavra certa no botão (é ela que a regra vai procurar).
  const botao = botaoDaChamada(e.pedido.chamada, e.pedido.palavra);
  const ultimo = slides.at(-1);
  if (botao && ultimo?.modelo === 'chamada') ultimo.botao = botao;
  const hashtags = [
    ...new Set(
      (Array.isArray(d.hashtags) ? d.hashtags : [])
        .map((h) =>
          String(h ?? '')
            .replace(/^#+/, '')
            .replace(/[^\p{L}\p{N}_]/gu, '')
            .slice(0, 40),
        )
        .filter((h) => h.length >= 2),
    ),
  ].slice(0, 8);
  return {
    slides,
    legenda: String(d.legenda ?? '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 1900),
    hashtags,
  };
}

const jsonDosSlides = (slides: SlideCarrossel[]) =>
  JSON.stringify(
    slides.map((s, i) => {
      const d = MODELO[s.modelo];
      const o: Record<string, unknown> = { slide: i + 1, modelo: s.modelo };
      for (const c of d.campos) o[c.campo] = s[c.campo];
      if (d.itens) o.itens = s.itens;
      if (d.colunas) o.colunas = s.colunas;
      return o;
    }),
    null,
    1,
  );

function mensagemRedator(e: EntradaTime, est: Estrategia): string {
  return [
    'Você é o REDATOR. Escreva cada slide do roteiro, na mesma ordem e com o mesmo modelo, e a legenda.',
    '',
    blocoDoPedido(e),
    '',
    `ÂNGULO: ${est.angulo}`,
    `GANCHO ESCOLHIDO (é o título da capa; pode ajustar uma palavra para soar natural): ${est.gancho}`,
    '',
    'ROTEIRO:',
    est.roteiro.map((r, i) => `${i + 1}. ${r.modelo}: ${r.ideia}`).join('\n'),
    '',
    'LIMITES DE CADA MODELO (escreva abaixo do limite; o slide tem que ler bem no celular):',
    limitesParaORedator(),
    '',
    '- Preencha só os campos do modelo de cada slide. Item numerado: o "destaque" é o número (1, 2, 3…).',
    '- "texto" pode ter quebra de linha para separar duas frases curtas.',
    '- Na chamada final, o "botao" é a ação em poucas palavras (ex.: "Chame no WhatsApp", "Salve este post").',
    '- A legenda conversa com quem leu os slides: não repita os slides inteiros; termine com a chamada.',
  ].join('\n');
}

/* ───────────────────────────── 3. Diretor de arte (código) ───────────────────────────── */

interface ProblemaDoSlide {
  slide: number;
  tipo: TipoAvisoTime;
  texto: string;
}

/** Monta cada slide como no desenho final e devolve o que não coube (e a promoção que não bate). */
export function conferirEncaixe(
  slides: SlideCarrossel[],
  legenda: string,
  e: Pick<EntradaTime, 'identidade' | 'estilo' | 'divulgar'>,
): ProblemaDoSlide[] {
  const problemas: ProblemaDoSlide[] = [];
  slides.forEach((s, i) => {
    const m = montarSlide({
      slide: s,
      indice: i,
      total: slides.length,
      identidade: e.identidade,
      estilo: e.estilo,
      // O tamanho do texto não depende da foto em si: um marcador basta para medir.
      foto: s.fotoId ? 'data:image/png;base64,' : null,
    });
    for (const a of m.avisos)
      if (!/Emoji/.test(a) && !/Escolha uma foto/.test(a))
        problemas.push({ slide: i + 1, tipo: 'tamanho', texto: a });
  });
  if (e.divulgar)
    for (const p of conferirPromocao(e.divulgar, slides, legenda))
      problemas.push({ slide: 0, tipo: 'promocao', texto: p });
  return problemas;
}

/* ───────────────────────────── 4. Revisor ───────────────────────────── */

const ESQUEMA_REVISAO = {
  type: 'object',
  properties: {
    notas: {
      type: 'object',
      description: 'Nota de 1 a 5 em cada critério (5 = pronto para uma agência publicar).',
      properties: Object.fromEntries(CRITERIOS_REVISOR.map((c) => [c, { type: 'integer' }])),
      required: [...CRITERIOS_REVISOR],
    },
    comentario: { type: 'string', description: 'O que mais pesou na nota, em uma ou duas frases.' },
    ajustes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slide: { type: 'integer', description: 'Número do slide (0 = a legenda).' },
          campo: { type: 'string', enum: [...CAMPOS_SUGESTAO] },
          tipo: { type: 'string', enum: [...TIPOS_AVISO_TIME] },
          problema: { type: 'string' },
          sugestao: {
            type: ['string', 'null'],
            description: 'O texto novo do campo, pronto para usar (dentro do limite), ou null.',
          },
        },
        required: ['slide', 'campo', 'tipo', 'problema'],
      },
    },
    fatos: {
      type: 'array',
      description:
        'Cada afirmação de fato sobre a empresa (número, prazo, preço, garantia, resultado, promessa) nos slides e na legenda.',
      items: {
        type: 'object',
        properties: {
          slide: { type: 'integer' },
          frase: { type: 'string' },
          fonte: { type: ['string', 'null'], description: 'O rótulo da fonte que sustenta.' },
          trecho: { type: ['string', 'null'], description: 'O trecho copiado exatamente da fonte.' },
        },
        required: ['slide', 'frase'],
      },
    },
  },
  required: ['notas', 'ajustes', 'fatos'],
};

interface Ajuste {
  slide: number;
  campo: CampoSugestao;
  tipo: TipoAvisoTime;
  problema: string;
  sugestao: string | null;
}

interface Revisao {
  notas: Partial<Record<CriterioRevisor, number>>;
  comentario: string;
  ajustes: Ajuste[];
  aprovado: boolean;
}

function lerRevisao(
  d: Record<string, unknown>,
  total: number,
  fontes: FonteDoTime[],
  problemas: ProblemaDoSlide[],
): Revisao {
  const brutas = (d.notas && typeof d.notas === 'object' ? d.notas : {}) as Record<string, unknown>;
  const notas: Partial<Record<CriterioRevisor, number>> = {};
  for (const c of CRITERIOS_REVISOR) {
    const n = Math.round(Number(brutas[c]));
    notas[c] = Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
  }
  const ajustes: Ajuste[] = (Array.isArray(d.ajustes) ? d.ajustes : [])
    .map((a) => a as Record<string, unknown>)
    .map((a) => ({
      slide: Math.max(0, Math.min(total, Math.round(Number(a.slide) || 0))),
      campo: (CAMPOS_SUGESTAO as readonly string[]).includes(String(a.campo))
        ? (a.campo as CampoSugestao)
        : 'texto',
      tipo: (TIPOS_AVISO_TIME as readonly string[]).includes(String(a.tipo))
        ? (a.tipo as TipoAvisoTime)
        : 'outro',
      problema: String(a.problema ?? '')
        .trim()
        .slice(0, 400),
      sugestao: a.sugestao ? String(a.sugestao).trim().slice(0, 400) : null,
    }))
    .filter((a) => a.problema)
    .slice(0, 20);
  // Fato que não tem trecho que esteja mesmo na fonte: não vale (o revisor às vezes "cita" o que não leu).
  const porRotulo = new Map(fontes.map((f) => [f.rotulo.toLowerCase(), f]));
  for (const f of (Array.isArray(d.fatos) ? d.fatos : []) as Record<string, unknown>[]) {
    const frase = String(f.frase ?? '').trim();
    if (!frase) continue;
    const fonte =
      porRotulo.get(String(f.fonte ?? '').toLowerCase()) ??
      fontes.find((x) => trechoNaFonte(String(f.trecho ?? ''), x.texto));
    const ok = !!fonte && !!f.trecho && trechoNaFonte(String(f.trecho), fonte.texto);
    if (!ok)
      ajustes.push({
        slide: Math.max(0, Math.min(total, Math.round(Number(f.slide) || 0))),
        campo: Number(f.slide) ? 'texto' : 'legenda',
        tipo: 'fato',
        problema: `"${frase.slice(0, 200)}" é uma afirmação sem fonte no cérebro da marca. Tire ou diga de um jeito que não afirme o fato.`,
        sugestao: null,
      });
  }
  for (const p of problemas)
    ajustes.push({
      slide: p.slide,
      campo: p.slide ? 'texto' : 'legenda',
      tipo: p.tipo,
      problema: p.texto,
      sugestao: null,
    });
  const bloqueia = ajustes.some((a) => a.tipo === 'fato' || a.tipo === 'promocao' || a.tipo === 'tamanho');
  return {
    notas,
    comentario: String(d.comentario ?? '')
      .trim()
      .slice(0, 500),
    ajustes,
    aprovado: revisaoAprovada(notas) && !bloqueia,
  };
}

function mensagemRevisor(e: EntradaTime, r: Redacao, problemas: ProblemaDoSlide[]): string {
  return [
    'Você é o REVISOR. Seja exigente como o diretor de criação de uma agência: este carrossel só sai se estiver pronto para publicar.',
    '',
    blocoDoPedido(e),
    '',
    'CRITÉRIOS (nota de 1 a 5):',
    CRITERIOS_REVISOR.map((c) => `- ${c}: ${CRITERIO[c]}`).join('\n'),
    '',
    'SLIDES:',
    jsonDosSlides(r.slides),
    '',
    `LEGENDA:\n${r.legenda}`,
    '',
    problemas.length
      ? `O DIRETOR DE ARTE JÁ ACHOU (não precisa repetir):\n${problemas.map((p) => `- ${p.slide ? `slide ${p.slide}` : 'legenda/promoção'}: ${p.texto}`).join('\n')}`
      : 'O DIRETOR DE ARTE: todos os textos cabem.',
    '',
    'FONTES QUE OS FATOS PODEM CITAR:',
    e.fontes.map((f) => `[${f.rotulo}]\n${f.texto.slice(0, 4000)}`).join('\n\n'),
    '',
    '- Em "ajustes", diga o problema e, sempre que puder, a sugestão pronta (o texto novo do campo, dentro do limite do modelo).',
    '- Erro de português, clichê, frase genérica, gancho fraco, chamada confusa e tom fora da marca são ajustes.',
    '- Em "fatos", liste toda afirmação sobre a empresa e copie o trecho exato da fonte que sustenta. Sem fonte, fonte e trecho ficam null.',
    '- Conhecimento geral do nicho (sem número, sem promessa) não precisa de fonte.',
  ].join('\n');
}

function mensagemReescrita(e: EntradaTime, est: Estrategia, r: Redacao, rev: Revisao): string {
  const porSlide = rev.ajustes
    .map(
      (a) =>
        `- ${a.slide ? `slide ${a.slide}` : 'legenda'} (${a.campo}, ${a.tipo}): ${a.problema}${a.sugestao ? ` · sugestão: ${a.sugestao}` : ''}`,
    )
    .join('\n');
  return [
    'Você é o REDATOR. O revisor devolveu o carrossel: reescreva resolvendo cada ajuste. Mantenha o número de slides, a ordem e o modelo de cada um.',
    '',
    blocoDoPedido(e),
    '',
    `ÂNGULO: ${est.angulo}`,
    `NOTAS DO REVISOR: ${CRITERIOS_REVISOR.map((c) => `${c} ${rev.notas[c]}`).join(', ')}${rev.comentario ? ` · ${rev.comentario}` : ''}`,
    '',
    'AJUSTES:',
    porSlide || '- (melhore o que puxou a nota para baixo)',
    '',
    'COMO ESTÁ:',
    jsonDosSlides(r.slides),
    '',
    `LEGENDA:\n${r.legenda}`,
    '',
    'LIMITES DE CADA MODELO:',
    limitesParaORedator([...new Set(r.slides.map((s) => s.modelo))]),
    '',
    'Devolva o carrossel inteiro (todos os slides, a legenda e as hashtags).',
  ].join('\n');
}

/* ───────────────────────────── O carrossel inteiro ───────────────────────────── */

function avisosParaPessoa(slides: SlideCarrossel[], rev: Revisao): AvisoTime[] {
  return rev.ajustes.map((a, i) => {
    const slide = a.slide ? slides[a.slide - 1] : null;
    const campo: CampoSugestao = a.slide ? (a.campo === 'legenda' ? 'texto' : a.campo) : 'legenda';
    const usa = slide ? MODELO[slide.modelo].campos.some((c) => c.campo === campo) : campo === 'legenda';
    return {
      id: `a${i + 1}`,
      slideId: slide?.id ?? null,
      tipo: a.tipo,
      texto: a.problema,
      sugestao: a.sugestao && usa ? { campo, valor: a.sugestao } : null,
      resolvido: null,
    };
  });
}

export async function trabalharNoCarrossel(
  claude: ClienteClaude,
  e: EntradaTime,
  aoAvancar: AoAvancar = () => undefined,
): Promise<ResultadoTime> {
  let uso = USO_ZERO;
  let custo = 0;
  const pedir = async (
    agente: string,
    mensagem: string,
    ferramenta: { nome: string; descricao: string; esquema: Record<string, unknown> },
    maxTokens: number,
    temperatura: number,
  ) => {
    const r = await claude.pedir({
      agente,
      sistema: sistema(e),
      mensagem,
      ferramenta,
      maxTokens,
      temperatura,
    });
    uso = somarUso(uso, r.uso);
    custo += r.custoUsd;
    return r.dados;
  };

  await aoAvancar('estrategista');
  const est = lerEstrategia(
    await pedir(
      'estrategista',
      mensagemEstrategista(e),
      {
        nome: 'estrategia',
        descricao: 'O ângulo, os ganchos e o roteiro do carrossel.',
        esquema: ESQUEMA_ESTRATEGIA,
      },
      2500,
      0.8,
    ),
    e,
  );
  await aoAvancar('estrategista', `Gancho escolhido: “${est.gancho}”`);

  await aoAvancar('redator');
  let red = lerRedacao(
    await pedir(
      'redator',
      mensagemRedator(e, est),
      { nome: 'carrossel', descricao: 'Os slides, a legenda e as hashtags.', esquema: ESQUEMA_REDACAO },
      6000,
      0.7,
    ),
    est.roteiro,
    e,
  );
  await aoAvancar('redator', `${red.slides.length} slides, legenda e ${red.hashtags.length} hashtags`);

  let rev: Revisao | null = null;
  let voltas = 0;
  for (;;) {
    await aoAvancar('diretor');
    const problemas = conferirEncaixe(red.slides, red.legenda, e);
    const comFoto = red.slides.filter((s) => s.fotoId).length;
    await aoAvancar(
      'diretor',
      `${red.slides.length} modelos escolhidos${comFoto ? `, ${comFoto} com foto da empresa` : ''}${problemas.length ? ` · ${problemas.length} ponto(s) para ajustar` : ' · todo o texto cabe'}`,
    );
    await aoAvancar('revisor');
    rev = lerRevisao(
      await pedir(
        'revisor',
        mensagemRevisor(e, red, problemas),
        {
          nome: 'revisao',
          descricao: 'As notas, os ajustes e os fatos conferidos.',
          esquema: ESQUEMA_REVISAO,
        },
        4000,
        0.2,
      ),
      red.slides.length,
      e.fontes,
      problemas,
    );
    const media = (
      CRITERIOS_REVISOR.reduce((s, c) => s + (rev!.notas[c] ?? 0), 0) / CRITERIOS_REVISOR.length
    ).toFixed(1);
    if (rev.aprovado || voltas >= MAX_VOLTAS_REVISOR) {
      await aoAvancar(
        'revisor',
        rev.aprovado
          ? `Aprovado com nota ${media}`
          : `Nota ${media}: ${rev.ajustes.length} ponto(s) para você decidir`,
      );
      break;
    }
    voltas++;
    await aoAvancar(
      'revisor',
      `Nota ${media}: devolveu ${rev.ajustes.length} ajuste(s) ao redator (volta ${voltas})`,
    );
    await aoAvancar('redator');
    red = lerRedacao(
      await pedir(
        'redator',
        mensagemReescrita(e, est, red, rev),
        { nome: 'carrossel', descricao: 'O carrossel reescrito.', esquema: ESQUEMA_REDACAO },
        6000,
        0.5,
      ),
      est.roteiro,
      e,
    );
    await aoAvancar('redator', `Reescreveu com os ajustes do revisor (volta ${voltas})`);
  }

  const legenda = [red.legenda, red.hashtags.length ? red.hashtags.map((h) => `#${h}`).join(' ') : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2200);
  const relatorio: RelatorioTime = {
    objetivo: e.pedido.objetivo,
    assunto: e.pedido.assunto || e.divulgar?.titulo || '',
    angulo: est.angulo,
    gancho: est.gancho,
    ganchosAlternativos: est.ganchos.filter((g) => g !== est.gancho),
    porque: est.porque,
    fontes: est.fontes,
    notas: rev.notas,
    voltas,
    aprovado: rev.aprovado,
    hashtags: red.hashtags,
    avisos: avisosParaPessoa(red.slides, rev),
    divulgarId: e.divulgar?.id ?? null,
    chamada: e.pedido.chamada,
    palavra: e.pedido.palavra.toUpperCase(),
    modelo: claude.modelo,
  };
  return {
    titulo: est.titulo,
    slides: red.slides,
    legenda,
    relatorio,
    uso,
    custoUsd: Math.round(custo * 1e6) / 1e6,
  };
}

/* ───────────────────────────── Pedido ao redator num slide ───────────────────────────── */

const ESQUEMA_UM_SLIDE = {
  type: 'object',
  properties: { slide: ESQUEMA_SLIDE, observacao: { type: 'string' } },
  required: ['slide'],
};

export interface EntradaSlide
  extends Omit<EntradaTime, 'pedido' | 'postsQueFuncionaram' | 'anteriores' | 'fotos'> {
  pedido: Pick<PedidoTime, 'objetivo' | 'chamada' | 'palavra'> & { assunto: string };
  slides: SlideCarrossel[];
  indice: number;
  instrucao: string;
}

/** Reescreve um slide com o pedido da pessoa (no mesmo modelo) e confere se cabe; até 2 tentativas. */
export async function refazerSlide(
  claude: ClienteClaude,
  e: EntradaSlide,
): Promise<{ slide: SlideCarrossel; avisos: string[]; uso: UsoClaude; custoUsd: number }> {
  const atual = e.slides[e.indice]!;
  const entradaTime: EntradaTime = {
    ...e,
    pedido: { ...e.pedido, divulgarId: e.divulgar?.id ?? null, slides: null, estilo: null, usarFotos: true },
    postsQueFuncionaram: [],
    anteriores: [],
    fotos: [],
  };
  let uso = USO_ZERO;
  let custo = 0;
  let problemas: string[] = [];
  let slide = atual;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await claude.pedir({
      agente: 'redator',
      sistema: sistema(entradaTime),
      mensagem: [
        `Você é o REDATOR. Reescreva SÓ o slide ${e.indice + 1} de ${e.slides.length}, no mesmo modelo (${atual.modelo}).`,
        '',
        blocoDoPedido(entradaTime),
        '',
        `O PEDIDO: ${e.instrucao}`,
        problemas.length ? `NÃO COUBE NA TENTATIVA ANTERIOR:\n${lista(problemas)}` : '',
        '',
        'O CARROSSEL (para o slide continuar combinando com os outros):',
        jsonDosSlides(e.slides),
        '',
        'LIMITES DO MODELO:',
        limitesParaORedator([atual.modelo]),
      ]
        .filter((x) => x !== '')
        .join('\n'),
      ferramenta: { nome: 'slide', descricao: 'O slide reescrito.', esquema: ESQUEMA_UM_SLIDE },
      maxTokens: 1500,
      temperatura: 0.7,
    });
    uso = somarUso(uso, r.uso);
    custo += r.custoUsd;
    const novo = slideDoTime((r.dados.slide ?? {}) as Record<string, unknown>, atual.modelo, atual.id);
    slide = { ...novo, fotoId: atual.fotoId, fundo: atual.fundo };
    const botao = botaoDaChamada(e.pedido.chamada, e.pedido.palavra);
    if (botao && slide.modelo === 'chamada') slide.botao = botao;
    const outros = e.slides.map((s, i) => (i === e.indice ? slide : s));
    problemas = conferirEncaixe(outros, '', { ...e, divulgar: null })
      .filter((p) => p.slide === e.indice + 1)
      .map((p) => p.texto);
    if (!problemas.length) break;
  }
  return { slide, avisos: problemas, uso, custoUsd: Math.round(custo * 1e6) / 1e6 };
}
