import {
  type EstiloCarrossel,
  type FormatoPeca,
  type IdentidadeCarrossel,
  MAX_SLIDES,
  MODELO,
  MODELOS,
  type ModeloSlide,
  montarSlide,
  type SlideCarrossel,
} from '@prospeccao/shared/carrosseis';
import {
  type AlcanceConversa,
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
  type EstadoCarrossel,
  type EtapaTime,
  limitesParaORedator,
  MAX_VOLTAS_REVISOR,
  type MudancaConversa,
  mudancasEntre,
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
import { MANUAL_REDACAO, MANUAL_REVISAO } from '../saber/index.js';
import { type BlocoSistema, type ClienteClaude, somarUso, USO_ZERO, type UsoClaude } from './claude.js';
import { CARTAO_POSTAL, CENAS_PRODUTO } from './imagens.js';

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
  /** v132: as imagens que o time pode pôr (sem isto, só as fotos da empresa). */
  imagens?: ImagensDoTime | null;
  /** v134: o que o time aprendeu com os números dos posts (uma linha cada, com a evidência). */
  aprendizados?: string[];
  /** v134: o que quem publica sempre muda no editor (vira preferência do redator). */
  preferencias?: string[];
  /** v134: este carrossel é um teste (2 de cada 10): o formato a testar. */
  teste?: string | null;
  /** v144: as fotos que vieram com o pedido (já tratadas): cada uma entra em pelo menos um slide. */
  fotosDoPedido?: { id: number; nome: string }[];
}

/** As imagens do time (v132): quem faz a imagem é a api (gera, confere e guarda nas fotos). */
export interface ImagensDoTime {
  /** O estrategista pode pedir uma imagem gerada quando nenhuma foto combina. */
  gerar: boolean;
  /** A foto do produto: a capa usa o produto num cenário novo. */
  produto: { fotoId: number; nome: string } | null;
  /** O estilo do post de referência (composição, luz, clima), para inspirar. */
  estiloReferencia: string | null;
  /** Faz a imagem e devolve o id da foto guardada (null: não deu ou o revisor visual reprovou). */
  fazer: (p: {
    tipo: 'gerar' | 'cenario';
    descricao: string;
    fotoId: number | null;
  }) => Promise<number | null>;
}

/** Até quantas imagens geradas num carrossel (custo e tempo). */
export const MAX_IMAGENS_GERADAS = 3;

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
- Em cada título, marque entre asteriscos de 1 a 3 palavras seguidas que são o coração da frase (o benefício, o número, a novidade): "Sua loja entrega em *40 minutos*". Elas saem na cor de destaque. Uma marca por título, nunca o título todo, e nem todo slide precisa. Os asteriscos não aparecem na imagem: não são erro de digitação.
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

function blocoDoPedido(
  e: Pick<EntradaTime, 'pedido' | 'divulgar' | 'hoje' | 'estilo' | 'identidade'>,
): string {
  const p = e.pedido;
  const d = e.divulgar;
  const linhas = [
    `HOJE: ${e.hoje}`,
    `OBJETIVO: ${OBJETIVO[p.objetivo].nome} (${OBJETIVO[p.objetivo].dica})`,
    p.assunto
      ? `INSTRUÇÕES DE QUEM CRIOU (siga: o que pede para ter tem que aparecer; o que pede para não ter não aparece; o tom que ela pede vale mais que o objetivo): ${p.assunto}`
      : '',
    p.respostas?.length
      ? `O QUE QUEM CRIOU RESPONDEU ÀS PERGUNTAS DO TIME (vale como fato: pode usar nos slides):\n${p.respostas.map((r) => `- ${r.pergunta} → ${r.resposta}`).join('\n')}`
      : '',
    p.briefing
      ? `O BRIEFING QUE QUEM CRIOU CONFERIU (vale como fato e manda no rumo do carrossel):\n${p.briefing}`
      : '',
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
    e.identidade.jeitoDePostar
      ? `COMO A EMPRESA COSTUMA POSTAR (lido dos posts dela; siga o espírito na escolha de modelos, fotos e palavras marcadas): ${e.identidade.jeitoDePostar}`
      : '',
  ];
  return linhas.filter(Boolean).join('\n');
}

/** O começo do prompt do time (o manual, o saber e a marca), em cache; também o das ideias (v134). */
export function sistemaDoTime(
  e: Pick<EntradaTime, 'dossieTexto' | 'postsQueFuncionaram' | 'anteriores'>,
): BlocoSistema[] {
  return sistema(e as EntradaTime);
}

function sistema(e: EntradaTime): BlocoSistema[] {
  // O manual e a marca são iguais em todos os agentes do carrossel: vão para o cache.
  // O saber de redação e revisão vem antes da marca: o time inteiro escreve e confere pelo mesmo manual.
  return [
    { texto: `${MANUAL}\n\n${MANUAL_REDACAO}\n\n${MANUAL_REVISAO}\n\n${blocoDaMarca(e)}`, cache: true },
  ];
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
          gerar: {
            type: 'string',
            description:
              'Só capa e foto, quando nenhuma foto da empresa combina e a IA de imagem está liberada: a cena para gerar (o que aparece, onde, a luz), sem texto. Vazio se não precisa.',
          },
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
  roteiro: { modelo: ModeloSlide; ideia: string; fotoId: number | null; gerar?: string }[];
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
  const doPedido = new Set((e.fotosDoPedido ?? []).map((f) => f.id));
  let roteiro = (Array.isArray(d.slides) ? d.slides : [])
    .map((s) => s as Record<string, unknown>)
    .filter((s) => (MODELOS as readonly string[]).includes(String(s.modelo)))
    .map((s) => {
      const modelo = s.modelo as ModeloSlide;
      const fotoId = Number(s.fotoId);
      const foto =
        MODELO[modelo].foto && ((e.pedido.usarFotos && fotos.has(fotoId)) || doPedido.has(fotoId))
          ? fotoId
          : null;
      const gerar =
        e.imagens?.gerar && MODELO[modelo].foto && !foto
          ? String(s.gerar ?? '')
              .trim()
              .slice(0, 300)
          : '';
      return {
        modelo,
        ideia: String(s.ideia ?? '').slice(0, 300),
        fotoId: foto,
        ...(gerar.length >= 8 ? { gerar } : {}),
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
  // Só as primeiras imagens pedidas são geradas (custo e tempo).
  let pedidas = 0;
  roteiro = roteiro.map((s) => {
    if (!s.gerar) return s;
    pedidas++;
    if (pedidas <= MAX_IMAGENS_GERADAS) return s;
    const { gerar: _fora, ...resto } = s;
    return resto;
  });
  // v144: as fotos do pedido entram: na capa (se ela não tem foto nem o cenário do produto) e nos
  // slides do meio (um texto vira "foto"), uma foto em cada, até acabarem as vagas.
  for (const f of e.fotosDoPedido ?? []) {
    if (roteiro.some((s) => s.fotoId === f.id)) continue;
    const capa = roteiro[0]!;
    const alvo =
      !capa.fotoId && !capa.gerar && !e.imagens?.produto
        ? capa
        : (roteiro.slice(1, -1).find((s) => s.modelo === 'foto' && !s.fotoId) ??
          roteiro.slice(1, -1).find((s) => s.modelo === 'texto' && !s.fotoId));
    if (!alvo) break;
    if (alvo !== capa && alvo.modelo === 'texto') alvo.modelo = 'foto';
    alvo.fotoId = f.id;
    delete alvo.gerar;
  }
  // "Foto" sem foto (nem imagem para gerar) não funciona: vira texto.
  roteiro = roteiro.map((s) =>
    s.modelo === 'foto' && !s.fotoId && !s.gerar ? { ...s, modelo: 'texto' as const } : s,
  );
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
    e.fotosDoPedido?.length
      ? `FOTOS QUE A EMPRESA MANDOU PARA ESTE CARROSSEL (use cada uma em um slide capa ou foto, onde ela ajuda a mensagem):\n${e.fotosDoPedido.map((f) => `- id ${f.id}: ${f.nome}`).join('\n')}`
      : '',
    e.pedido.usarFotos && e.fotos.length
      ? `FOTOS DA EMPRESA (use só quando a foto combina com o slide; só nos modelos capa e foto):\n${e.fotos.map((f) => `- id ${f.id}: ${f.nome}`).join('\n')}`
      : e.imagens?.gerar
        ? 'FOTOS DA EMPRESA: nenhuma para usar (fotoId sempre null).'
        : 'FOTOS: não use fotos (fotoId sempre null). Não use o modelo "foto".',
    e.imagens?.gerar
      ? `IMAGENS GERADAS: quando nenhuma foto combina com uma capa ou um slide "foto", descreva em "gerar" a cena para a IA de imagem (o que aparece, onde, a luz). No máximo ${MAX_IMAGENS_GERADAS} no carrossel, só onde a imagem ajuda a entender. Nunca o produto que a empresa vende como se fosse real, nunca texto, marca ou rosto em destaque. ${CARTAO_POSTAL}`
      : '',
    e.imagens?.produto
      ? `A CAPA usa a foto do produto (${e.imagens.produto.nome}) num cenário novo, feito pela IA: na capa, fotoId null e "gerar" vazio.`
      : '',
    e.imagens?.estiloReferencia
      ? `ESTILO DE REFERÊNCIA (um post de que a empresa gostou; inspire o clima, não copie): ${e.imagens.estiloReferencia}`
      : '',
    '',
    e.aprendizados?.length
      ? `O QUE O TIME APRENDEU COM OS POSTS DESTA CONTA (use para escolher o formato; o que o time evita, evite):\n${e.aprendizados.map((a) => `- ${a}`).join('\n')}`
      : '',
    e.teste
      ? `ESTE CARROSSEL É UM TESTE (2 de cada 10 testam algo novo, para o time não ficar preso no que já sabe): ${e.teste}`
      : '',
    `FONTES USADAS (escolha das opções): ${OPCOES_FONTES.join(', ')}.`,
    'Se o pedido é para vender, a promoção é o centro e o preço aparece em "numero" ou "comparacao". Se é para ensinar, o conteúdo útil vem antes de qualquer oferta.',
    'Ligue o carrossel ao que os clientes perguntam e ao que funcionou nos posts, quando fizer sentido.',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/* ───────────────────────────── 2. Redator ───────────────────────────── */

export const ESQUEMA_SLIDE = {
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
    ...(e.preferencias?.length
      ? ['', 'O QUE QUEM PUBLICA SEMPRE MUDA NO EDITOR (siga):', ...e.preferencias.map((p) => `- ${p}`)]
      : []),
  ].join('\n');
}

/* ───────────────────────────── 3. Diretor de arte (código) ───────────────────────────── */

export interface ProblemaDoSlide {
  slide: number;
  tipo: TipoAvisoTime;
  texto: string;
}

/** Monta cada slide como no desenho final e devolve o que não coube (e a promoção que não bate). */
export function conferirEncaixe(
  slides: SlideCarrossel[],
  legenda: string,
  e: Pick<EntradaTime, 'identidade' | 'estilo' | 'divulgar'>,
  formato: FormatoPeca = 'feed',
): ProblemaDoSlide[] {
  const problemas: ProblemaDoSlide[] = [];
  slides.forEach((s, i) => {
    const m = montarSlide({
      slide: s,
      indice: i,
      total: slides.length,
      identidade: e.identidade,
      estilo: e.estilo,
      formato,
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

export const ESQUEMA_REVISAO = {
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

export interface Revisao {
  notas: Partial<Record<CriterioRevisor, number>>;
  comentario: string;
  ajustes: Ajuste[];
  aprovado: boolean;
}

/**
 * Os fatos que o revisor listou e que não têm um trecho que esteja mesmo na fonte (o revisor às vezes
 * "cita" o que não leu): esses não valem.
 */
function fatosSemFonte(brutos: unknown, fontes: FonteDoTime[]): { slide: number; frase: string }[] {
  const porRotulo = new Map(fontes.map((f) => [f.rotulo.toLowerCase(), f]));
  const sem: { slide: number; frase: string }[] = [];
  for (const f of (Array.isArray(brutos) ? brutos : []) as Record<string, unknown>[]) {
    const frase = String(f.frase ?? '').trim();
    if (!frase) continue;
    const fonte =
      porRotulo.get(String(f.fonte ?? '').toLowerCase()) ??
      fontes.find((x) => trechoNaFonte(String(f.trecho ?? ''), x.texto));
    if (!(fonte && f.trecho && trechoNaFonte(String(f.trecho), fonte.texto)))
      sem.push({ slide: Math.round(Number(f.slide) || 0), frase });
  }
  return sem;
}

export function lerRevisao(
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
  for (const f of fatosSemFonte(d.fatos, fontes)) {
    const frase = f.frase;
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

export function avisosParaPessoa(slides: SlideCarrossel[], rev: Revisao): AvisoTime[] {
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

/**
 * As imagens do roteiro (v132): a capa com o produto num cenário novo e as cenas que o estrategista
 * pediu. O que não deu (ou o revisor visual reprovou) fica sem: o slide "foto" vira texto.
 */
async function fazerImagens(im: ImagensDoTime, est: Estrategia, aoAvancar: AoAvancar): Promise<void> {
  const capa = est.roteiro[0];
  const tarefas: Promise<void>[] = [];
  let feitas = 0;
  if (im.produto && capa?.modelo === 'capa') {
    capa.fotoId = null;
    delete capa.gerar;
    tarefas.push(
      im
        .fazer({ tipo: 'cenario', descricao: CENAS_PRODUTO[0], fotoId: im.produto.fotoId })
        .catch(() => null)
        .then((id) => {
          // O cenário não passou: a capa usa a foto do produto como foi enviada.
          capa.fotoId = id ?? im.produto!.fotoId;
          if (id) feitas++;
        }),
    );
  }
  for (const s of est.roteiro) {
    if (!s.gerar) continue;
    const descricao = s.gerar;
    tarefas.push(
      im
        .fazer({ tipo: 'gerar', descricao, fotoId: null })
        .catch(() => null)
        .then((id) => {
          delete s.gerar;
          if (id) {
            s.fotoId = id;
            feitas++;
          } else if (s.modelo === 'foto') s.modelo = 'texto';
        }),
    );
  }
  if (!tarefas.length) return;
  await aoAvancar('estrategista', 'Fazendo as imagens');
  await Promise.all(tarefas);
  await aoAvancar(
    'estrategista',
    `${feitas} ${feitas === 1 ? 'imagem conferida' : 'imagens conferidas'} pelo revisor visual`,
  );
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
  if (e.imagens) await fazerImagens(e.imagens, est, aoAvancar);

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
      `${red.slides.length} modelos escolhidos${comFoto ? `, ${comFoto} com foto` : ''}${problemas.length ? ` · ${problemas.length} ponto(s) para ajustar` : ' · todo o texto cabe'}`,
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
      `Nota ${media}: devolveu ${rev.ajustes.length} ajuste(s) à redatora (volta ${voltas})`,
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
    await aoAvancar('redator', `Reescreveu com os ajustes da revisora (volta ${voltas})`);
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

/* ───────────────────────────── A conversa com o time ───────────────────────────── */

export interface EntradaConversa extends Omit<EntradaTime, 'pedido' | 'postsQueFuncionaram' | 'anteriores'> {
  pedido: Pick<PedidoTime, 'objetivo' | 'chamada' | 'palavra'> & { assunto: string };
  /** Como o carrossel está na tela agora. */
  atual: EstadoCarrossel;
  alcance: AlcanceConversa;
  slideId: string | null;
  instrucao: string;
  /** As últimas mensagens (para entender um "agora tira o número"). */
  historico: { autor: 'pessoa' | 'time'; texto: string }[];
}

export interface ResultadoConversa {
  resposta: string;
  depois: EstadoCarrossel;
  mudancas: MudancaConversa[];
  /** O que o diretor de arte e o revisor ainda acharam na proposta. */
  avisos: string[];
  uso: UsoClaude;
  custoUsd: number;
}

const ESQUEMA_CONVERSA = {
  type: 'object',
  properties: {
    resposta: {
      type: 'string',
      description:
        'Para a pessoa, em uma ou duas frases: o que você mudou (ou por que não mudou). Sem repetir os textos.',
    },
    slides: {
      type: 'array',
      description: 'Os slides como devem ficar (veja as regras do alcance).',
      items: {
        type: 'object',
        properties: {
          id: {
            type: ['string', 'null'],
            description: 'O id do slide que já existe; null para um slide novo.',
          },
          igual: { type: 'boolean', description: 'true: o slide fica exatamente como está (só o id basta).' },
          fotoId: { type: ['integer', 'null'], description: 'Só para slide novo com foto.' },
          ...ESQUEMA_SLIDE.properties,
        },
        required: ['id'],
      },
    },
    legenda: {
      type: ['string', 'null'],
      description: 'A legenda inteira como deve ficar (com as hashtags no fim), ou null se não muda.',
    },
  },
  required: ['resposta'],
};

const ESQUEMA_CONFERENCIA = {
  type: 'object',
  properties: {
    problemas: {
      type: 'array',
      description: 'Só o que precisa mudar antes de publicar (no máximo 5). Gosto pessoal não entra.',
      items: {
        type: 'object',
        properties: {
          slide: { type: 'integer', description: 'Número do slide (0 = a legenda).' },
          problema: { type: 'string' },
        },
        required: ['slide', 'problema'],
      },
    },
    fatos: ESQUEMA_REVISAO.properties.fatos,
  },
  required: ['problemas', 'fatos'],
};

const REGRAS_ALCANCE: Record<AlcanceConversa, string> = {
  slide:
    'ALCANCE: SÓ O SLIDE MARCADO. Devolva em "slides" um item só, com o id desse slide. Pode trocar o modelo se o pedido pedir. Não mexa na legenda (legenda null).',
  carrossel:
    'ALCANCE: O CARROSSEL INTEIRO. Devolva em "slides" TODOS os slides na ordem final: os que ficam iguais só com o id e "igual": true; os que mudam com o id e o conteúdo novo; os novos com id null. Slide que não aparece na lista sai. Até 10 slides. Se o pedido mexer no que a legenda diz, devolva a legenda nova; senão, null.',
  legenda: 'ALCANCE: SÓ A LEGENDA. Devolva a legenda inteira em "legenda" e não devolva slides.',
};

function mensagemEditor(e: EntradaConversa, base: EstadoCarrossel, naoCoube: string[]): string {
  const alvo = e.alcance === 'slide' ? base.slides.findIndex((s) => s.id === e.slideId) : -1;
  const comId = JSON.stringify(
    base.slides.map((s, i) => {
      const d = MODELO[s.modelo];
      const o: Record<string, unknown> = { slide: i + 1, id: s.id, modelo: s.modelo };
      for (const c of d.campos) o[c.campo] = s[c.campo];
      if (d.itens) o.itens = s.itens;
      if (d.colunas) o.colunas = s.colunas;
      if (s.fotoId) o.comFoto = true;
      return o;
    }),
    null,
    1,
  );
  const conversa = e.historico
    .slice(-6)
    .map((m) => `${m.autor === 'pessoa' ? 'PESSOA' : 'TIME'}: ${m.texto.slice(0, 300)}`);
  return [
    'Você é o REDATOR, agora conversando com quem vai publicar o carrossel. Faça exatamente o que a pessoa pediu, sem mexer no que ela não pediu. As regras do manual continuam valendo (nada de fato sem fonte).',
    '',
    blocoDoPedido({
      ...e,
      pedido: {
        ...e.pedido,
        divulgarId: null,
        slides: null,
        estilo: null,
        usarFotos: true,
        gerarImagens: false,
        fotoProdutoId: null,
        referenciaId: null,
        ideiaId: null,
        fotos: [],
        respostas: [],
        briefing: '',
      },
    }),
    '',
    REGRAS_ALCANCE[e.alcance],
    alvo >= 0 ? `O SLIDE MARCADO: slide ${alvo + 1} (id ${e.slideId}).` : '',
    '',
    conversa.length ? `A CONVERSA ATÉ AQUI:\n${conversa.join('\n')}` : '',
    `O PEDIDO AGORA: ${e.instrucao}`,
    naoCoube.length ? `\nNA SUA PROPOSTA ANTERIOR NÃO COUBE (encurte):\n${lista(naoCoube)}` : '',
    '',
    'O CARROSSEL COMO ESTÁ:',
    comId,
    '',
    `LEGENDA COMO ESTÁ:\n${base.legenda || '(vazia)'}`,
    '',
    'LIMITES DE CADA MODELO (escreva abaixo do limite):',
    limitesParaORedator(),
    e.alcance === 'carrossel' && e.fotos.length
      ? `\nFOTOS DA EMPRESA (para slide novo com foto, use o id): ${e.fotos.map((f) => `${f.id}: ${f.nome}`).join('; ')}`
      : '',
    '',
    '- Se o pedido não der para fazer sem inventar fato, não invente: explique na resposta o que precisa estar no cérebro da marca.',
    '- Se o pedido pedir algo que já está assim, diga na resposta e devolva sem mudança.',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

function lerProposta(
  d: Record<string, unknown>,
  e: EntradaConversa,
  base: EstadoCarrossel,
  novoId: () => string,
): EstadoCarrossel {
  const porId = new Map(base.slides.map((s) => [s.id, s]));
  const botao = botaoDaChamada(e.pedido.chamada, e.pedido.palavra);
  const fotos = new Set(e.fotos.map((f) => f.id));
  const ler = (b: Record<string, unknown>): SlideCarrossel => {
    const velho = typeof b.id === 'string' ? porId.get(b.id) : undefined;
    if (velho && b.igual === true) return velho;
    const modelo: ModeloSlide = (MODELOS as readonly string[]).includes(String(b.modelo))
      ? (b.modelo as ModeloSlide)
      : (velho?.modelo ?? 'texto');
    const s = slideDoTime(b, modelo, velho?.id ?? novoId());
    const pedida = Number(b.fotoId);
    const fotoId = MODELO[modelo].foto ? (velho ? velho.fotoId : fotos.has(pedida) ? pedida : null) : null;
    const r: SlideCarrossel = { ...s, fotoId, fundo: velho?.fundo ?? 'auto' };
    if (botao && modelo === 'chamada') r.botao = botao;
    return r;
  };
  const brutos = (Array.isArray(d.slides) ? d.slides : []).filter(
    (x): x is Record<string, unknown> => !!x && typeof x === 'object',
  );
  let slides = base.slides;
  if (e.alcance === 'slide' && e.slideId && porId.has(e.slideId)) {
    const b = brutos.find((x) => x.id === e.slideId) ?? brutos[0];
    if (b) slides = base.slides.map((s) => (s.id === e.slideId ? ler({ ...b, id: e.slideId }) : s));
  } else if (e.alcance === 'carrossel' && brutos.length) {
    const vistos = new Set<string>();
    const novos: SlideCarrossel[] = [];
    for (const b of brutos) {
      const s = ler(b);
      if (vistos.has(s.id)) continue;
      vistos.add(s.id);
      novos.push(s);
    }
    if (novos.length) slides = novos.slice(0, MAX_SLIDES);
  }
  let legenda = base.legenda;
  if (e.alcance !== 'slide' && typeof d.legenda === 'string' && d.legenda.trim())
    legenda = d.legenda
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 2200);
  return { slides, legenda };
}

/** Os slides que a proposta mexeu (novos ou alterados). */
const idsMexidos = (m: MudancaConversa[]) =>
  new Set(m.filter((x) => x.tipo === 'mudou' || x.tipo === 'novo').map((x) => x.slideId));

/** O que não coube (só nos slides que mudaram) e a promoção que deixou de bater com esta proposta. */
function encaixeDaProposta(e: EntradaConversa, depois: EstadoCarrossel, mudancas: MudancaConversa[]) {
  const mexidos = idsMexidos(mudancas);
  const antesPromo = new Set(
    conferirEncaixe(e.atual.slides, e.atual.legenda, e)
      .filter((p) => p.tipo === 'promocao')
      .map((p) => p.texto),
  );
  return conferirEncaixe(depois.slides, depois.legenda, e).filter((p) =>
    p.tipo === 'promocao' ? !antesPromo.has(p.texto) : mexidos.has(depois.slides[p.slide - 1]?.id ?? ''),
  );
}

let sequencia = 0;
const idDeSlideNovo = () => `c${Date.now().toString(36)}${(sequencia++).toString(36)}`;

/**
 * Um pedido da pessoa no editor: o redator propõe a mudança (no alcance escolhido), o diretor de
 * arte confere se cabe (uma volta para encurtar) e o revisor confere o que mudou (fatos com fonte,
 * português, tom). Nada é salvo aqui: a proposta volta para a pessoa aplicar ou descartar.
 */
export async function conversarComOTime(
  claude: ClienteClaude,
  e: EntradaConversa,
  novoId: () => string = idDeSlideNovo,
): Promise<ResultadoConversa> {
  const entradaTime: EntradaTime = {
    ...e,
    pedido: {
      ...e.pedido,
      divulgarId: e.divulgar?.id ?? null,
      slides: null,
      estilo: null,
      usarFotos: true,
      gerarImagens: false,
      fotoProdutoId: null,
      referenciaId: null,
      ideiaId: null,
      fotos: [],
      respostas: [],
      briefing: '',
    },
    postsQueFuncionaram: [],
    anteriores: [],
  };
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
      sistema: sistema(entradaTime),
      mensagem,
      ferramenta,
      maxTokens,
      temperatura,
    });
    uso = somarUso(uso, r.uso);
    custo += r.custoUsd;
    return r.dados;
  };
  const ferramenta = { nome: 'proposta', descricao: 'A mudança pedida.', esquema: ESQUEMA_CONVERSA };
  const tokens = e.alcance === 'carrossel' ? 6000 : 2000;

  let d = await pedir('redator', mensagemEditor(e, e.atual, []), ferramenta, tokens, 0.6);
  let resposta = String(d.resposta ?? '')
    .trim()
    .slice(0, 600);
  let depois = lerProposta(d, e, e.atual, novoId);
  let mudancas = mudancasEntre(e.atual, depois);
  const problemas = encaixeDaProposta(e, depois, mudancas).filter((p) => p.tipo === 'tamanho');

  // O diretor de arte: o que não coube volta uma vez para o redator encurtar.
  if (problemas.length) {
    const naoCoube = problemas.map((p) => `slide ${p.slide}: ${p.texto}`);
    d = await pedir('redator', mensagemEditor(e, depois, naoCoube), ferramenta, tokens, 0.4);
    const segunda = lerProposta(d, { ...e, atual: depois }, depois, novoId);
    depois = segunda;
    mudancas = mudancasEntre(e.atual, depois);
    resposta =
      String(d.resposta ?? '')
        .trim()
        .slice(0, 600) || resposta;
  }
  const encaixe = encaixeDaProposta(e, depois, mudancas);
  const avisos = encaixe.map((p) => (p.slide ? `Slide ${p.slide}: ${p.texto}` : p.texto));

  // O revisor confere só o que mudou.
  const mexidos = idsMexidos(mudancas);
  const legendaMudou = mudancas.some((m) => m.tipo === 'legenda');
  if (mexidos.size || legendaMudou) {
    const conferir = depois.slides.map((s, i) => ({ s, i })).filter((x) => mexidos.has(x.s.id));
    const c = await pedir(
      'revisor',
      [
        'Você é o REVISOR. A pessoa pediu uma mudança e o redator propôs o que está abaixo. Confira SÓ o que mudou: erro de português, fato sobre a empresa sem fonte, tom fora da marca, NUNCA DIZER, chamada confusa.',
        '',
        `O PEDIDO: ${e.instrucao}`,
        '',
        conferir.length
          ? `SLIDES QUE MUDARAM (o número é a posição no carrossel):\n${conferir.map((x) => `${x.i + 1}. ${jsonDosSlides([x.s])}`).join('\n')}`
          : '',
        legendaMudou ? `LEGENDA NOVA:\n${depois.legenda}` : '',
        '',
        'FONTES QUE OS FATOS PODEM CITAR:',
        e.fontes.map((f) => `[${f.rotulo}]\n${f.texto.slice(0, 4000)}`).join('\n\n'),
        '',
        '- Em "fatos", liste toda afirmação sobre a empresa no que mudou e copie o trecho exato da fonte. Sem fonte, fonte e trecho ficam null.',
        '- Se o que a pessoa pediu foi exatamente isso, não reclame da escolha dela; só do que está errado.',
      ]
        .filter((x) => x !== '')
        .join('\n'),
      {
        nome: 'conferencia',
        descricao: 'O que ainda precisa mudar e os fatos.',
        esquema: ESQUEMA_CONFERENCIA,
      },
      2000,
      0.2,
    );
    for (const p of (Array.isArray(c.problemas) ? c.problemas : []).slice(0, 5) as Record<
      string,
      unknown
    >[]) {
      const t = String(p.problema ?? '')
        .trim()
        .slice(0, 300);
      const n = Math.round(Number(p.slide) || 0);
      if (t) avisos.push(n ? `Slide ${n}: ${t}` : `Legenda: ${t}`);
    }
    for (const f of fatosSemFonte(c.fatos, e.fontes))
      avisos.push(
        `${f.slide ? `Slide ${f.slide}` : 'Legenda'}: "${f.frase.slice(0, 160)}" não tem fonte no cérebro da marca.`,
      );
  }
  if (!resposta) resposta = mudancas.length ? 'Pronto, veja a proposta.' : 'Não precisei mudar nada.';
  return {
    resposta,
    depois,
    mudancas,
    avisos: [...new Set(avisos)].slice(0, 10),
    uso,
    custoUsd: Math.round(custo * 1e6) / 1e6,
  };
}
