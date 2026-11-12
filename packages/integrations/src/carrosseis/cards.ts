import {
  type EstiloCarrossel,
  FORMATO_PECA,
  type FormatoPeca,
  type IdentidadeCarrossel,
  MODELO,
  type ModeloSlide,
  type SlideCarrossel,
} from '@prospeccao/shared/carrosseis';
import {
  botaoDaChamada,
  CHAMADA_FINAL,
  CRITERIO,
  CRITERIOS_REVISOR,
  conferirPromocao,
  type DivulgarEntrada,
  limitesParaORedator,
  MAX_VOLTAS_REVISOR,
  MODELOS_CARD,
  type ModeloCard,
  OBJETIVO_CARD,
  type ObjetivoCard,
  type ObjetivoCarrossel,
  type PedidoCards,
  type RelatorioTime,
  ROTULO_DIVULGAR,
  slideDoTime,
} from '@prospeccao/shared/carrosseis-time';
import { type ClienteClaude, somarUso, USO_ZERO, type UsoClaude } from './claude.js';
import { CARTAO_POSTAL } from './imagens.js';
import {
  type AoAvancar,
  avisosParaPessoa,
  conferirEncaixe,
  ESQUEMA_REVISAO,
  ESQUEMA_SLIDE,
  type FonteDoTime,
  lerRevisao,
  type PostQueFuncionou,
  type ProblemaDoSlide,
  type Revisao,
  sistemaDoTime,
} from './time.js';

/**
 * Os cards avulsos (v144): peças de um slide só (feed 4:5 ou story 9:16), N cards com V variações
 * cada. O mesmo time e a mesma régua do carrossel (o manual, o cérebro da marca, as fontes, o
 * revisor exigente), com o papel de cada agente pensado para uma peça que vive sozinha:
 *  1. estrategista: a ideia de cada card e, para cada variação, um caminho visual e de texto
 *     diferente (modelo, foto, ângulo);
 *  2. redator: o texto de cada peça e uma legenda por card;
 *  3. diretor de arte (código): monta cada peça no formato pedido com as fontes de verdade, diz o
 *     que não coube e confere a promoção;
 *  4. revisor: nota de cada critério para o lote e os ajustes peça a peça; não passou, volta para o
 *     redator (até 2 vezes). O que sobrar vira aviso no editor de cada card.
 */

/** Até quantas imagens geradas num pedido de cards (custo e tempo). */
export const MAX_IMAGENS_CARDS = 6;

export interface ImagensDosCards {
  gerar: boolean;
  estiloReferencia: string | null;
  fazer: (p: { tipo: 'gerar'; descricao: string; fotoId: null }) => Promise<number | null>;
}

export interface EntradaCards {
  empresa: string;
  dossieTexto: string;
  fontes: FonteDoTime[];
  identidade: IdentidadeCarrossel;
  estilo: EstiloCarrossel;
  pedido: PedidoCards;
  divulgar: (DivulgarEntrada & { id: number }) | null;
  postsQueFuncionaram: PostQueFuncionou[];
  anteriores: string[];
  /** As fotos da empresa que o time pode usar. */
  fotos: { id: number; nome: string }[];
  /** As fotos que vieram com o pedido (já tratadas): cada uma entra em pelo menos uma peça. */
  fotosDoPedido: { id: number; nome: string }[];
  hoje: string;
  imagens?: ImagensDosCards | null;
  aprendizados?: string[];
  preferencias?: string[];
  /** "Outra variação" de um card: o que já existe (para sair diferente) e o que mudar. */
  outra?: { existentes: string[]; pedido: string } | null;
}

export interface PecaPronta {
  slide: SlideCarrossel;
  relatorio: RelatorioTime;
}

export interface CardPronto {
  titulo: string;
  legenda: string;
  variacoes: PecaPronta[];
}

export interface ResultadoCards {
  titulo: string;
  cards: CardPronto[];
  uso: UsoClaude;
  custoUsd: number;
}

/** O objetivo do card no relatório (o relatório usa os objetivos do carrossel). */
const OBJETIVO_DO_RELATORIO: Record<ObjetivoCard, ObjetivoCarrossel> = {
  promocao: 'vender',
  lancamento: 'vender',
  produto: 'vender',
  aviso: 'bastidores',
  data: 'bastidores',
  frase: 'ensinar',
  institucional: 'bastidores',
};

/** O modelo de partida de cada objetivo, quando o estrategista não decide. */
const MODELO_PADRAO: Record<ObjetivoCard, ModeloCard> = {
  promocao: 'numero',
  lancamento: 'capa',
  produto: 'capa',
  aviso: 'capa',
  data: 'capa',
  frase: 'citacao',
  institucional: 'capa',
};

const MANUAL_CARDS = `CARDS AVULSOS: cada peça é um post sozinho (não é slide de carrossel). Ela tem um segundo para ser entendida: uma mensagem só, lida de longe no celular.
- O título é a peça: curto, concreto, do jeito que o cliente fala. Nada de "Confira", "Venha conferir", "Imperdível", "Não perca".
- CADA CARD É INDEPENDENTE: quem vê só aquele card no feed (sem os outros) entende a oferta inteira: o que é, o que ganha, a condição e o que fazer. Nunca escreva um card que continua, responde ou completa outro ("ou fique com a moto", "e tem mais", "parte 2"); nunca divida uma oferta em pedaços entre cards. Cards do mesmo pedido são peças diferentes: cada um com o seu gancho e o seu ângulo (o preço, o benefício, a dor que resolve, a prova), todos completos.
- Nada repetido dentro da peça: o número grande não volta no título ("24 meses" grande + "Em 24 meses…" no título é a mesma coisa duas vezes); o título e o texto dizem coisas diferentes.
- Cada card fala de uma coisa. Variações do mesmo card dizem a mesma mensagem por caminhos diferentes (outro modelo, outra foto, outro ângulo de texto), para a empresa escolher a melhor; nunca a mesma peça com uma palavra trocada.
- Todo card leva um SELO ("sobretitulo", até 24 letras: o assunto em 2 a 4 palavras, ex.: "Chegamos a Brasília", "Só esta semana") e um BOTÃO ("botao", até 22 letras: a ação, ex.: "Chame no WhatsApp"), em qualquer modelo. A logo da empresa entra sozinha.
- No título, marque entre asteriscos de 1 a 3 palavras seguidas que são o coração da mensagem (o benefício, o número, a novidade): "Sua loja entrega em *40 minutos*". Elas saem na cor de destaque. Uma marca por título, nunca o título todo. Os asteriscos não aparecem na imagem: não são erro de digitação.
- Promoção, lançamento e produto vendem: o título diz o que o cliente ganha (rapidez, preço, comodidade), não só o que a empresa faz; o texto dá o fato que prova; o botão diz o que fazer agora. Nada de "Salve a data", "Fique ligado", "Aguarde".
- Se as instruções de quem pediu falam de um tom (promocional, divertido, sério), ele vale mais que o objetivo escolhido.
- Story (9:16): a peça ocupa a tela inteira; o texto fica no meio da tela, longe do topo e da base. Feed (4:5): o post do perfil.`;

function blocoDoPedidoCards(e: EntradaCards): string {
  const p = e.pedido;
  const d = e.divulgar;
  return [
    `HOJE: ${e.hoje}`,
    `OBJETIVO DOS CARDS: ${OBJETIVO_CARD[p.objetivo].nome} (${OBJETIVO_CARD[p.objetivo].dica})`,
    `FORMATO: ${FORMATO_PECA[p.formato].nome} (${FORMATO_PECA[p.formato].dica})`,
    p.assunto
      ? `INSTRUÇÕES DE QUEM PEDIU (siga: o que pede para ter tem que aparecer; o que pede para não ter não aparece): ${p.assunto}`
      : '',
    p.respostas?.length
      ? `O QUE QUEM PEDIU RESPONDEU ÀS PERGUNTAS DO TIME (vale como fato: pode usar no card):\n${p.respostas.map((r) => `- ${r.pergunta} → ${r.resposta}`).join('\n')}`
      : '',
    p.briefing
      ? `O BRIEFING QUE QUEM PEDIU CONFERIU (vale como fato e manda no rumo da peça):\n${p.briefing}`
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
    `A AÇÃO QUE A PEÇA PEDE: ${CHAMADA_FINAL[p.chamada]}${p.chamada === 'comentar' ? ` — a palavra é ${p.palavra.toUpperCase()} (o botão é "Comente ${p.palavra.toUpperCase()}")` : ''}`,
    `ESTILO VISUAL: ${e.estilo}`,
    e.identidade.assinatura ? `ASSINATURA NO RODAPÉ: ${e.identidade.assinatura}` : '',
    e.identidade.jeitoDePostar
      ? `COMO A EMPRESA COSTUMA POSTAR (lido dos posts dela; siga o espírito na escolha de modelos, fotos e palavras marcadas): ${e.identidade.jeitoDePostar}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ───────────────────────────── 1. Estrategista ───────────────────────────── */

const ESQUEMA_PLANO = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Nome do pedido (até 80 letras), para a lista.' },
    cards: {
      type: 'array',
      description: 'Um item por card, na ordem.',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Nome interno do card (até 60 letras).' },
          ideia: { type: 'string', description: 'A mensagem do card em uma frase.' },
          variacoes: {
            type: 'array',
            description: 'Uma por variação pedida: caminhos diferentes para a mesma mensagem.',
            items: {
              type: 'object',
              properties: {
                modelo: { type: 'string', enum: [...MODELOS_CARD] },
                abordagem: {
                  type: 'string',
                  description: 'O caminho desta variação (visual e de texto) em uma frase.',
                },
                fotoId: { type: ['integer', 'null'], description: 'Foto da empresa (capa e foto), ou null.' },
                gerar: {
                  type: 'string',
                  description:
                    'Só capa e foto, quando nenhuma foto combina e a IA de imagem está liberada: a cena para gerar, sem texto. Vazio se não precisa.',
                },
              },
              required: ['modelo', 'abordagem'],
            },
          },
        },
        required: ['titulo', 'ideia', 'variacoes'],
      },
    },
  },
  required: ['titulo', 'cards'],
};

interface PlanoVariacao {
  modelo: ModeloCard;
  abordagem: string;
  fotoId: number | null;
  gerar?: string;
}
interface PlanoCard {
  titulo: string;
  ideia: string;
  variacoes: PlanoVariacao[];
}
interface Plano {
  titulo: string;
  cards: PlanoCard[];
}

const usaFoto = (m: ModeloSlide) => !!MODELO[m].foto;

/** Lê o plano e acerta o que o pedido manda: N cards × V variações, fotos do pedido usadas. */
export function lerPlano(d: Record<string, unknown>, e: EntradaCards): Plano {
  const n = e.outra ? 1 : e.pedido.quantidade;
  const v = e.outra ? 1 : e.pedido.variacoes;
  const validas = new Set([...e.fotos, ...e.fotosDoPedido].map((f) => f.id));
  const padrao = MODELO_PADRAO[e.pedido.objetivo];
  const brutos = (Array.isArray(d.cards) ? d.cards : []) as Record<string, unknown>[];
  const cards: PlanoCard[] = [];
  for (let i = 0; i < n; i++) {
    const b = brutos[i] ?? {};
    const vb = (Array.isArray(b.variacoes) ? b.variacoes : []) as Record<string, unknown>[];
    const variacoes: PlanoVariacao[] = [];
    for (let k = 0; k < v; k++) {
      const x = vb[k] ?? vb[0] ?? {};
      const modelo = (MODELOS_CARD as readonly string[]).includes(String(x.modelo))
        ? (x.modelo as ModeloCard)
        : padrao;
      const fotoId = Number(x.fotoId);
      const foto =
        usaFoto(modelo) && (e.pedido.usarFotos || e.fotosDoPedido.length) && validas.has(fotoId)
          ? fotoId
          : null;
      const gerar =
        e.imagens?.gerar && usaFoto(modelo) && !foto
          ? String(x.gerar ?? '')
              .trim()
              .slice(0, 300)
          : '';
      variacoes.push({
        modelo,
        abordagem: String(x.abordagem ?? '')
          .trim()
          .slice(0, 300),
        fotoId: foto,
        ...(gerar.length >= 8 ? { gerar } : {}),
      });
    }
    cards.push({
      titulo:
        String(b.titulo ?? '')
          .trim()
          .slice(0, 80) || `Card ${i + 1}`,
      ideia: String(b.ideia ?? '')
        .trim()
        .slice(0, 300),
      variacoes,
    });
  }
  const todas = cards.flatMap((c) => c.variacoes);
  // As fotos que vieram com o pedido entram: cada uma em pelo menos uma peça (a primeira que ainda
  // não tem foto; se nenhuma serve, a peça vira capa com a foto).
  for (const f of e.fotosDoPedido) {
    if (todas.some((x) => x.fotoId === f.id)) continue;
    const alvo =
      todas.find((x) => usaFoto(x.modelo) && !x.fotoId) ??
      todas.find((x) => !x.fotoId) ??
      todas.find((x) => !e.fotosDoPedido.some((p) => p.id === x.fotoId));
    if (!alvo) break;
    if (!usaFoto(alvo.modelo)) alvo.modelo = 'capa';
    alvo.fotoId = f.id;
    delete alvo.gerar;
  }
  // Só as primeiras imagens pedidas são geradas (custo e tempo).
  let pedidas = 0;
  for (const x of todas) {
    if (!x.gerar) continue;
    pedidas++;
    if (pedidas > MAX_IMAGENS_CARDS) delete x.gerar;
  }
  // "Foto" sem foto (nem imagem para gerar) não funciona: vira capa.
  for (const x of todas) if (x.modelo === 'foto' && !x.fotoId && !x.gerar) x.modelo = 'capa';
  return {
    titulo:
      String(d.titulo ?? '')
        .trim()
        .slice(0, 120) ||
      cards[0]?.titulo ||
      'Cards',
    cards,
  };
}

function mensagemEstrategista(e: EntradaCards): string {
  const n = e.outra ? 1 : e.pedido.quantidade;
  const v = e.outra ? 1 : e.pedido.variacoes;
  return [
    'Você é o ESTRATEGISTA dos cards avulsos. Decida a mensagem de cada card e, para cada variação, um caminho diferente.',
    '',
    MANUAL_CARDS,
    '',
    blocoDoPedidoCards(e),
    '',
    e.outra
      ? [
          'É UMA VARIAÇÃO NOVA de um card que já existe: mesma mensagem, caminho diferente de todas estas:',
          ...e.outra.existentes.map((x) => `- ${x}`),
          e.outra.pedido ? `O QUE MUDAR NESTA VARIAÇÃO: ${e.outra.pedido}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : `QUANTIDADE: exatamente ${n} ${n === 1 ? 'card' : 'cards'}, cada um com ${v} ${v === 1 ? 'variação' : 'variações'}. Se o pedido lista coisas (produtos, datas, avisos), cada card é uma delas, na ordem do pedido; se não lista, cada card é um ângulo diferente e completo da mesma oferta (nunca a continuação do outro).`,
    '',
    'MODELOS QUE FUNCIONAM SOZINHOS (escolha o que serve à mensagem; varie entre as variações):',
    limitesParaORedator(MODELOS_CARD),
    '',
    e.fotosDoPedido.length
      ? `FOTOS QUE A EMPRESA MANDOU PARA ESTE PEDIDO (use cada uma em pelo menos uma peça, nos modelos capa ou foto):\n${e.fotosDoPedido.map((f) => `- id ${f.id}: ${f.nome}`).join('\n')}`
      : '',
    e.pedido.usarFotos && e.fotos.length
      ? `FOTOS DA EMPRESA (use quando a foto combina; só nos modelos capa e foto):\n${e.fotos.map((f) => `- id ${f.id}: ${f.nome}`).join('\n')}`
      : 'FOTOS DA EMPRESA: não use outras (fotoId null, a não ser as do pedido).',
    e.imagens?.gerar
      ? `IMAGENS GERADAS: quando nenhuma foto combina com uma capa ou "foto", descreva em "gerar" a cena (o que aparece, onde, a luz). No máximo ${MAX_IMAGENS_CARDS} no pedido. Nunca o produto que a empresa vende como se fosse real, nunca texto ou marca. Pessoas podem aparecer quando ajudam a mensagem (diga quem são e o que fazem), nunca pessoa real ou famosa nem criança. ${CARTAO_POSTAL}`
      : '',
    e.imagens?.estiloReferencia
      ? `ESTILO DE REFERÊNCIA (um post de que a empresa gostou; inspire o clima, não copie): ${e.imagens.estiloReferencia}`
      : '',
    e.aprendizados?.length
      ? `O QUE O TIME APRENDEU COM OS POSTS DESTA CONTA:\n${e.aprendizados.map((a) => `- ${a}`).join('\n')}`
      : '',
    'Promoção: o preço é o centro (modelo "numero" ou "comparacao"), exatamente como foi digitado.',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/* ───────────────────────────── 2. Redator ───────────────────────────── */

const ESQUEMA_REDACAO_CARDS = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          variacoes: { type: 'array', items: ESQUEMA_SLIDE },
          legenda: {
            type: 'string',
            description:
              'A legenda do post deste card, sem hashtags: a primeira linha (até 125 letras) é o gancho; depois 1 a 3 parágrafos curtos; termina com a ação.',
          },
          hashtags: { type: 'array', items: { type: 'string' }, description: '3 a 8 hashtags sem o #.' },
        },
        required: ['variacoes', 'legenda', 'hashtags'],
      },
    },
  },
  required: ['cards'],
};

interface RedacaoCards {
  cards: { variacoes: SlideCarrossel[]; legenda: string; hashtags: string[] }[];
}

const limparHashtags = (x: unknown) =>
  [
    ...new Set(
      (Array.isArray(x) ? x : [])
        .map((h) =>
          String(h ?? '')
            .replace(/^#+/, '')
            .replace(/[^\p{L}\p{N}_]/gu, '')
            .slice(0, 40),
        )
        .filter((h) => h.length >= 2),
    ),
  ].slice(0, 8);

/** As variações de um card passeiam pelas cores da marca (a 1ª na principal, que é a cara da marca). */
export const FUNDOS_DAS_VARIACOES = ['escuro', 'destaque', 'claro'] as const;

const corteCard = (t: unknown, max: number) =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function lerRedacaoCards(d: Record<string, unknown>, plano: Plano, e: EntradaCards): RedacaoCards {
  const brutos = (Array.isArray(d.cards) ? d.cards : []) as Record<string, unknown>[];
  const botao = botaoDaChamada(e.pedido.chamada, e.pedido.palavra);
  return {
    cards: plano.cards.map((c, i) => {
      const b = brutos[i] ?? {};
      const vb = (Array.isArray(b.variacoes) ? b.variacoes : []) as Record<string, unknown>[];
      return {
        variacoes: c.variacoes.map((p, k) => {
          const bruto = vb[k] ?? {};
          const s = { ...slideDoTime(bruto, p.modelo, `c${i + 1}v${k + 1}`), fotoId: p.fotoId };
          // O card leva o selo e o botão em qualquer modelo (o slideDoTime só guarda os campos do modelo).
          s.sobretitulo = s.sobretitulo || corteCard(bruto.sobretitulo, 40);
          s.botao = botao ?? (corteCard(bruto.botao, 40) || s.botao);
          // Cada variação num fundo da marca: a principal, a de destaque e a clara.
          s.fundo =
            FUNDOS_DAS_VARIACOES[(e.outra ? e.outra.existentes.length : k) % FUNDOS_DAS_VARIACOES.length]!;
          return s;
        }),
        legenda: String(b.legenda ?? '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 1900),
        hashtags: limparHashtags(b.hashtags),
      };
    }),
  };
}

/** As peças em JSON para o redator e o revisor: "peça" é o número corrido (card e variação juntos). */
function jsonDasPecas(r: RedacaoCards): string {
  let n = 0;
  return JSON.stringify(
    r.cards.flatMap((c, i) =>
      c.variacoes.map((s, k) => {
        n++;
        const d = MODELO[s.modelo];
        const o: Record<string, unknown> = { peca: n, card: i + 1, variacao: k + 1, modelo: s.modelo };
        for (const cp of d.campos) o[cp.campo] = s[cp.campo];
        if (d.colunas) o.colunas = s.colunas;
        return o;
      }),
    ),
    null,
    1,
  );
}

function mensagemRedator(e: EntradaCards, plano: Plano): string {
  return [
    'Você é o REDATOR dos cards avulsos. Escreva cada peça do plano, na mesma ordem e com o mesmo modelo, e uma legenda por card.',
    '',
    MANUAL_CARDS,
    '',
    blocoDoPedidoCards(e),
    '',
    'PLANO:',
    plano.cards
      .map(
        (c, i) =>
          `CARD ${i + 1} — ${c.titulo}: ${c.ideia}\n${c.variacoes.map((v, k) => `  variação ${k + 1} (${v.modelo}${v.fotoId ? ', com foto' : ''}): ${v.abordagem}`).join('\n')}`,
      )
      .join('\n'),
    '',
    'LIMITES DE CADA MODELO (escreva abaixo do limite; a peça tem que ler bem no celular):',
    limitesParaORedator([...new Set(plano.cards.flatMap((c) => c.variacoes.map((v) => v.modelo)))]),
    '',
    '- Preencha só os campos do modelo de cada peça.',
    '- As variações de um card dizem a mesma mensagem por caminhos diferentes: títulos diferentes de verdade.',
    '- Em toda peça: "sobretitulo" (o selo) e "botao" (a ação, em poucas palavras), qualquer que seja o modelo.',
    '- Marque no título, entre asteriscos, as 1 a 3 palavras que são o coração da mensagem.',
    '- A legenda é a do post do card (serve para qualquer variação).',
    ...(e.preferencias?.length
      ? ['', 'O QUE QUEM PUBLICA SEMPRE MUDA NO EDITOR (siga):', ...e.preferencias.map((p) => `- ${p}`)]
      : []),
  ].join('\n');
}

/* ───────────────────────────── 3. Diretor de arte (código) ───────────────────────────── */

/** Cada peça montada no formato do pedido: o que não coube e a promoção que não bate. */
export function conferirPecas(r: RedacaoCards, e: EntradaCards): ProblemaDoSlide[] {
  const problemas: ProblemaDoSlide[] = [];
  let n = 0;
  for (const c of r.cards)
    for (const s of c.variacoes) {
      n++;
      for (const p of conferirEncaixe([s], c.legenda, { ...e, divulgar: null }, e.pedido.formato))
        problemas.push({ ...p, slide: n });
    }
  if (e.divulgar)
    r.cards.forEach((c) => {
      for (const p of conferirPromocao(e.divulgar!, c.variacoes, c.legenda))
        problemas.push({ slide: 0, tipo: 'promocao', texto: p });
    });
  // A mesma promoção pode aparecer em vários cards: um aviso de cada.
  return problemas.filter(
    (p, i) => p.slide !== 0 || problemas.findIndex((q) => q.slide === 0 && q.texto === p.texto) === i,
  );
}

/* ───────────────────────────── 4. Revisor ───────────────────────────── */

function mensagemRevisor(e: EntradaCards, r: RedacaoCards, problemas: ProblemaDoSlide[]): string {
  return [
    'Você é o REVISOR. Seja exigente como o diretor de criação de uma agência: estes cards só saem se cada peça estiver pronta para publicar sozinha.',
    '',
    MANUAL_CARDS,
    '',
    blocoDoPedidoCards(e),
    '',
    'CRITÉRIOS (nota de 1 a 5, para o lote inteiro; "gancho" é a força do título de cada peça, "umaIdeia" é uma mensagem por peça):',
    CRITERIOS_REVISOR.map((c) => `- ${c}: ${CRITERIO[c]}`).join('\n'),
    '',
    'PEÇAS (em "ajustes", o número do "slide" é o número da peça; 0 = legenda):',
    jsonDasPecas(r),
    '',
    'LEGENDAS:',
    r.cards.map((c, i) => `CARD ${i + 1}: ${c.legenda}`).join('\n\n'),
    '',
    problemas.length
      ? `O DIRETOR DE ARTE JÁ ACHOU (não precisa repetir):\n${problemas.map((p) => `- ${p.slide ? `peça ${p.slide}` : 'legenda/promoção'}: ${p.texto}`).join('\n')}`
      : 'O DIRETOR DE ARTE: todos os textos cabem.',
    '',
    'FONTES QUE OS FATOS PODEM CITAR:',
    e.fontes.map((f) => `[${f.rotulo}]\n${f.texto.slice(0, 4000)}`).join('\n\n'),
    '',
    '- Variações quase iguais são um ajuste (tipo "outro"): cada uma tem que ser um caminho diferente.',
    '- Erro de português, clichê, título genérico, ação confusa e tom fora da marca são ajustes, com a sugestão pronta.',
    '- Em "fatos", liste toda afirmação sobre a empresa e copie o trecho exato da fonte. Sem fonte, fonte e trecho ficam null.',
  ].join('\n');
}

function mensagemReescrita(e: EntradaCards, plano: Plano, r: RedacaoCards, rev: Revisao): string {
  return [
    'Você é o REDATOR. O revisor devolveu os cards: reescreva resolvendo cada ajuste. Mantenha o número de cards, de variações e o modelo de cada peça.',
    '',
    blocoDoPedidoCards(e),
    '',
    `NOTAS DO REVISOR: ${CRITERIOS_REVISOR.map((c) => `${c} ${rev.notas[c]}`).join(', ')}${rev.comentario ? ` · ${rev.comentario}` : ''}`,
    '',
    'AJUSTES:',
    rev.ajustes
      .map(
        (a) =>
          `- ${a.slide ? `peça ${a.slide}` : 'legenda'} (${a.campo}, ${a.tipo}): ${a.problema}${a.sugestao ? ` · sugestão: ${a.sugestao}` : ''}`,
      )
      .join('\n') || '- (melhore o que puxou a nota para baixo)',
    '',
    'COMO ESTÁ:',
    jsonDasPecas(r),
    '',
    'LEGENDAS:',
    r.cards.map((c, i) => `CARD ${i + 1}: ${c.legenda}`).join('\n\n'),
    '',
    'LIMITES DE CADA MODELO:',
    limitesParaORedator([...new Set(plano.cards.flatMap((c) => c.variacoes.map((v) => v.modelo)))]),
    '',
    'Devolva todos os cards (todas as variações, as legendas e as hashtags).',
  ].join('\n');
}

/* ───────────────────────────── O pedido inteiro ───────────────────────────── */

async function fazerImagens(im: ImagensDosCards, plano: Plano, aoAvancar: AoAvancar): Promise<void> {
  const pedidas = plano.cards.flatMap((c) => c.variacoes).filter((v) => v.gerar);
  if (!pedidas.length) return;
  await aoAvancar('estrategista', 'Fazendo as imagens');
  let feitas = 0;
  await Promise.all(
    pedidas.map((v) =>
      im
        .fazer({ tipo: 'gerar', descricao: v.gerar!, fotoId: null })
        .catch(() => null)
        .then((id) => {
          delete v.gerar;
          if (id) {
            v.fotoId = id;
            feitas++;
          } else if (v.modelo === 'foto') v.modelo = 'capa';
        }),
    ),
  );
  await aoAvancar(
    'estrategista',
    `${feitas} ${feitas === 1 ? 'imagem conferida' : 'imagens conferidas'} pelo revisor visual`,
  );
}

export async function trabalharNosCards(
  claude: ClienteClaude,
  e: EntradaCards,
  aoAvancar: AoAvancar = () => undefined,
): Promise<ResultadoCards> {
  let uso = USO_ZERO;
  let custo = 0;
  const sistema = sistemaDoTime(e);
  const pedir = async (
    agente: string,
    mensagem: string,
    ferramenta: { nome: string; descricao: string; esquema: Record<string, unknown> },
    maxTokens: number,
    temperatura: number,
  ) => {
    const r = await claude.pedir({ agente, sistema, mensagem, ferramenta, maxTokens, temperatura });
    uso = somarUso(uso, r.uso);
    custo += r.custoUsd;
    return r.dados;
  };
  const pecas = (e.outra ? 1 : e.pedido.quantidade * e.pedido.variacoes) || 1;

  await aoAvancar('estrategista');
  const plano = lerPlano(
    await pedir(
      'estrategista',
      mensagemEstrategista(e),
      {
        nome: 'plano_cards',
        descricao: 'A mensagem de cada card e o caminho de cada variação.',
        esquema: ESQUEMA_PLANO,
      },
      Math.min(8000, 1500 + pecas * 250),
      0.8,
    ),
    e,
  );
  await aoAvancar(
    'estrategista',
    `${plano.cards.length} ${plano.cards.length === 1 ? 'card' : 'cards'}: ${plano.cards
      .map((c) => c.titulo)
      .join(', ')
      .slice(0, 160)}`,
  );
  if (e.imagens) await fazerImagens(e.imagens, plano, aoAvancar);

  const tokensRedacao = Math.min(16000, 2500 + pecas * 500);
  await aoAvancar('redator');
  let red = lerRedacaoCards(
    await pedir(
      'redator',
      mensagemRedator(e, plano),
      { nome: 'cards', descricao: 'As peças, as legendas e as hashtags.', esquema: ESQUEMA_REDACAO_CARDS },
      tokensRedacao,
      0.7,
    ),
    plano,
    e,
  );
  await aoAvancar('redator', `${pecas} ${pecas === 1 ? 'peça escrita' : 'peças escritas'}, com as legendas`);

  let rev: Revisao | null = null;
  let voltas = 0;
  for (;;) {
    await aoAvancar('diretor');
    const problemas = conferirPecas(red, e);
    await aoAvancar(
      'diretor',
      `${pecas} ${pecas === 1 ? 'peça montada' : 'peças montadas'} no ${FORMATO_PECA[e.pedido.formato].nome}${problemas.length ? ` · ${problemas.length} ponto(s) para ajustar` : ' · todo o texto cabe'}`,
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
        Math.min(8000, 2500 + pecas * 200),
        0.2,
      ),
      pecas,
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
    red = lerRedacaoCards(
      await pedir(
        'redator',
        mensagemReescrita(e, plano, red, rev),
        { nome: 'cards', descricao: 'Os cards reescritos.', esquema: ESQUEMA_REDACAO_CARDS },
        tokensRedacao,
        0.5,
      ),
      plano,
      e,
    );
    await aoAvancar('redator', `Reescreveu com os ajustes da revisora (volta ${voltas})`);
  }

  // Os ajustes de cada peça vão para o editor daquela peça (o número da peça vira o slide 1).
  let n = 0;
  const cards: CardPronto[] = red.cards.map((c, i) => {
    const legenda = [c.legenda, c.hashtags.length ? c.hashtags.map((h) => `#${h}`).join(' ') : '']
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2200);
    const titulos = c.variacoes.map((s) => s.titulo || s.destaque).filter(Boolean);
    return {
      titulo: plano.cards[i]!.titulo,
      legenda,
      variacoes: c.variacoes.map((slide, k) => {
        n++;
        const peca = n;
        const daPeca: Revisao = {
          ...rev!,
          ajustes: rev!.ajustes
            .filter((a) => a.slide === peca || (a.slide === 0 && k === 0))
            .map((a) => ({ ...a, slide: a.slide ? 1 : 0 })),
        };
        const relatorio: RelatorioTime = {
          objetivo: OBJETIVO_DO_RELATORIO[e.pedido.objetivo],
          assunto: e.pedido.assunto || e.divulgar?.titulo || '',
          angulo: plano.cards[i]!.ideia,
          gancho: slide.titulo || slide.destaque,
          ganchosAlternativos: titulos.filter((t) => t !== (slide.titulo || slide.destaque)),
          porque: plano.cards[i]!.variacoes[k]!.abordagem,
          fontes: [],
          notas: rev!.notas,
          voltas,
          aprovado: rev!.aprovado,
          hashtags: c.hashtags,
          avisos: avisosParaPessoa([slide], daPeca),
          divulgarId: e.divulgar?.id ?? null,
          chamada: e.pedido.chamada,
          palavra: e.pedido.palavra.toUpperCase(),
          modelo: claude.modelo,
        };
        return { slide, relatorio };
      }),
    };
  });
  return { titulo: plano.titulo, cards, uso, custoUsd: Math.round(custo * 1e6) / 1e6 };
}

/** Para a tela e os testes: o formato do pedido em palavras. */
export const rotuloDoFormato = (f: FormatoPeca) => FORMATO_PECA[f].nome;
