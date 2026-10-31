import type { Modulo, Recurso } from './planos.js';

/**
 * Tour do sistema: a volta guiada que o Argos narra no primeiro acesso (e que fica em Ajuda). Cada
 * cena é uma tela real (imagem em apps/web/public/tour) com a fala do Argos e os destaques, que
 * trocam quando a fala chega na palavra marcada. Só entram as cenas do que a conta contratou.
 */

export interface FocoTour {
  /** A palavra da fala em que o destaque muda para cá. */
  em: string;
  /** Área em % da imagem: [x, y, largura, altura]. */
  r: [number, number, number, number];
  rotulo: string;
  /** Rótulo embaixo da área (padrão: em cima, menos perto do topo). */
  embaixo?: boolean;
}

export interface CenaTour {
  id: string;
  capitulo: string;
  /** Imagem em /tour/<img>.webp; sem imagem, a cena é a esfera do Argos com o título. */
  img?: string;
  titulo?: string;
  /** Precisa disso na conta para aparecer. */
  requer?: { modulo?: Modulo; recurso?: Recurso };
  fala: string;
  focos?: FocoTour[];
}

/** O que muda a fala de uma cena (a conta tem ou não tem). */
export interface ContextoTour {
  modulos: readonly string[];
  recursos: readonly string[];
}

const tem = (c: ContextoTour, r: CenaTour['requer']) =>
  !r || ((!r.modulo || c.modulos.includes(r.modulo)) && (!r.recurso || c.recursos.includes(r.recurso)));

/** As falas que dependem do que a conta tem (o resto é fixo). */
const variantes = (c: ContextoTour) => {
  const argos = c.recursos.includes('argos');
  const ia = c.modulos.includes('agente_ia');
  return {
    abertura: argos
      ? 'Oi! Eu sou o Argos, o seu assistente aqui no Prospect Team. Em poucos minutos, vou te mostrar o principal do sistema e onde fica cada coisa. Vamos lá?'
      : 'Oi! Em poucos minutos, vou te mostrar o principal do Prospect Team e onde fica cada coisa. Vamos lá?',
    conversas: ia
      ? 'Em Conversas fica o WhatsApp de toda a equipe, num lugar só. E, se você quiser, o Agente de IA atende por você: responde o lead, tira dúvidas, entende se ele tem interesse e já marca a reunião.'
      : 'Em Conversas fica o WhatsApp de toda a equipe, num lugar só. Cada lead com o histórico completo, e ninguém perde uma mensagem.',
    fim: argos
      ? 'Esse tour fica no menu Ajuda, pra você rever quando quiser. E, se ficar qualquer dúvida, é só me chamar. Bom trabalho!'
      : 'Esse tour fica no menu Ajuda, pra você rever quando quiser, junto com o passo a passo de cada tela. Bom trabalho!',
  };
};

const CENAS: CenaTour[] = [
  { id: 'abertura', capitulo: 'Abertura', titulo: 'Boas-vindas ao Prospect Team', fala: '' },
  {
    id: 'meu-dia',
    capitulo: 'Meu dia',
    img: 'hoje',
    fala: 'Começando pelo Meu dia, a sua tela inicial. Aqui ficam as tarefas, as ligações e as reuniões de hoje, e o que vem nos próximos dias. Abriu o sistema, já sabe por onde começar.',
  },
  {
    id: 'campanhas',
    capitulo: 'Campanhas',
    img: 'leads',
    fala: 'Agora, as Campanhas. Você escolhe o tipo de empresa que quer encontrar e a cidade, e o sistema busca essas empresas no Google Maps pra você. Elas chegam aqui, na tela de Leads, cada uma com uma nota: A, B ou C. Assim você começa pelas que mais combinam com o seu negócio.',
  },
  {
    id: 'enriquecimento',
    capitulo: 'Enriquecimento',
    img: 'ficha',
    fala: 'Depois vem o enriquecimento. Pra cada empresa, o sistema procura sozinho o site, o Instagram e o WhatsApp, e confirma se o número existe. Também traz os possíveis decisores do negócio, pelo quadro de sócios. E você vê de onde veio cada informação, pra saber em que confiar.',
  },
  {
    id: 'conversas',
    capitulo: 'WhatsApp',
    img: 'conversa-ia',
    requer: { modulo: 'whatsapp' },
    fala: '',
  },
  {
    id: 'ligacao',
    capitulo: 'Ligações',
    img: 'ligacao-em-curso',
    requer: { modulo: 'ligacoes' },
    fala: 'Com o módulo de Ligações, você liga pro lead de dentro do sistema, pelo computador mesmo. A ligação é gravada e transcrita, e o lead é avisado da gravação logo no começo.',
  },
  {
    id: 'ligacao-resumo',
    capitulo: 'Ligações',
    img: 'ligacao-resumo',
    requer: { modulo: 'ligacoes' },
    fala: 'Quando você desliga, a IA resume a conversa e já sugere o próximo passo no funil. É só conferir e salvar.',
  },
  {
    id: 'reunioes',
    capitulo: 'Reuniões',
    img: 'reuniao-resumo',
    requer: { recurso: 'reunioes' },
    fala: 'Nas Reuniões, você manda um link e o lead entra pelo navegador, sem instalar nada. A reunião é gravada, transcrita, e no final vira um resumo com os próximos passos.',
  },
  {
    id: 'email',
    capitulo: 'E-mail',
    img: 'sequencia',
    requer: { modulo: 'email' },
    fala: 'No E-mail, você monta sequências de contato que misturam e-mail, WhatsApp e ligação. Quando o lead responde, em qualquer canal, a sequência para sozinha. Nada de mensagem repetida pra quem já respondeu.',
  },
  {
    id: 'instagram',
    capitulo: 'Instagram e Meta',
    img: 'meta-vendas',
    requer: { recurso: 'instagram' },
    fala: 'No Instagram, quem comenta nos seus posts, manda direct ou preenche o formulário dos seus anúncios vira lead no funil, automaticamente. E o sistema devolve as vendas pra Meta, que aprende quem realmente compra e mostra o anúncio pra pessoas parecidas.',
  },
  {
    id: 'instagram-conteudo',
    capitulo: 'Instagram e Meta',
    img: 'instagram-conteudo',
    requer: { recurso: 'instagram' },
    fala: 'E na análise de conteúdo você vê quais posts trazem alcance, quais trazem leads e quais viram venda de verdade.',
  },
  {
    id: 'argos',
    capitulo: 'Argos',
    img: 'argos',
    requer: { recurso: 'argos' },
    fala: 'E eu fico aqui, no menu Argos. Pode contar comigo no dia a dia, como um assistente mesmo. Eu tiro as suas dúvidas sobre o sistema, mostro como está o seu funil e a sua equipe, crio tarefas, marco reuniões na sua agenda e abro as telas pra você. É só pedir, falando ou escrevendo. Por exemplo: marca uma reunião com o Dr. Renato amanhã às dez.',
  },
  { id: 'fim', capitulo: 'Fim', titulo: 'Bom trabalho!', fala: '' },
];

/** Os destaques de cada tela (posições medidas nas imagens de apps/web/public/tour). */
const FOCOS: Record<string, FocoTour[]> = {
  'meu-dia': [
    { em: 'Meu dia', r: [0.5, 8.3, 12, 3.4], rotulo: 'Menu › Meu dia', embaixo: true },
    { em: 'Aqui ficam', r: [14.5, 9.5, 64.5, 88], rotulo: 'O que fazer hoje' },
    { em: 'próximos dias', r: [80, 11, 18.5, 20.5], rotulo: 'Próximos 7 dias', embaixo: true },
  ],
  campanhas: [
    { em: 'Campanhas', r: [1, 19, 11, 3.8], rotulo: 'Menu › Campanhas' },
    { em: 'na tela de Leads', r: [12, 20.5, 87.5, 79], rotulo: 'Leads encontrados' },
    { em: 'uma nota', r: [44.5, 21, 5, 78], rotulo: 'Nota A, B ou C' },
  ],
  enriquecimento: [
    { em: 'enriquecimento', r: [1.5, 2.5, 31.5, 22], rotulo: 'Ficha do lead', embaixo: true },
    { em: 'o site', r: [34.5, 24.5, 30.5, 13.5], rotulo: 'Contatos encontrados', embaixo: true },
    { em: 'possíveis decisores', r: [34.5, 2.5, 30.5, 21], rotulo: 'Possíveis decisores', embaixo: true },
    { em: 'de onde veio', r: [67.5, 39.5, 29.5, 54.5], rotulo: 'Como encontramos' },
  ],
  conversas: [
    { em: 'Conversas', r: [1, 22.8, 11, 3.8], rotulo: 'Menu › Conversas' },
    { em: 'num lugar só', r: [12, 14, 22.5, 85], rotulo: 'As conversas da equipe' },
    { em: 'Agente de IA', r: [35, 12, 63, 3.8], rotulo: 'A IA conduzindo a conversa', embaixo: true },
    { em: 'marca a reunião', r: [73.5, 5, 8.5, 3.6], rotulo: 'Marcar reunião', embaixo: true },
    { em: 'histórico', r: [35, 16.5, 63, 75], rotulo: 'Histórico completo' },
  ],
  ligacao: [
    { em: 'Ligações', r: [36, 48, 26, 50], rotulo: 'Ligação em andamento' },
    { em: 'gravada', r: [52, 51.5, 9.5, 3.5], rotulo: 'Gravando', embaixo: true },
    { em: 'avisado', r: [37, 70, 24, 5.5], rotulo: 'Aviso de gravação' },
  ],
  'ligacao-resumo': [
    { em: 'resume', r: [36.5, 36.5, 25.5, 19], rotulo: 'Resumo da IA' },
    { em: 'próximo passo', r: [36.5, 58.5, 25.5, 19], rotulo: 'Próximo passo sugerido' },
    { em: 'conferir e salvar', r: [55.5, 93, 6.5, 4.5], rotulo: 'Salvar' },
  ],
  reunioes: [
    { em: 'Reuniões', r: [0.5, 42, 12, 4], rotulo: 'Menu › Reuniões' },
    { em: 'gravada', r: [15, 11, 61, 57], rotulo: 'Gravação da reunião', embaixo: true },
    { em: 'resumo', r: [15, 76, 61, 24], rotulo: 'Resumo da reunião' },
    { em: 'próximos passos', r: [77.5, 12, 21, 19.5], rotulo: 'Próximos passos', embaixo: true },
  ],
  email: [
    { em: 'E-mail', r: [3.5, 2.5, 94.5, 18.5], rotulo: '1º passo: e-mail', embaixo: true },
    { em: 'WhatsApp e ligação', r: [3.5, 21.5, 94.5, 49], rotulo: 'Depois: WhatsApp e ligação' },
    { em: 'Quando o lead responde', r: [3, 78.5, 94.5, 7.5], rotulo: 'Respondeu, a sequência para' },
  ],
  instagram: [
    { em: 'Instagram', r: [1, 32.8, 13, 4], rotulo: 'Menu › Instagram' },
    { em: 'formulário', r: [17, 45.5, 26.5, 30], rotulo: 'Cadastros dos anúncios' },
    { em: 'devolve', r: [16.5, 22.5, 82, 21.5], rotulo: 'Devolver as vendas para a Meta' },
  ],
  'instagram-conteudo': [
    { em: 'análise', r: [16.5, 23, 82, 13.5], rotulo: 'Alcance, leads e vendas' },
    { em: 'quais posts', r: [16.5, 56, 82, 41], rotulo: 'Post a post' },
    { em: 'viram venda', r: [16.5, 37.5, 82, 16], rotulo: 'O que funciona' },
  ],
  argos: [
    { em: 'menu Argos', r: [0.5, 61, 12.5, 3.6], rotulo: 'Menu › Argos' },
    { em: 'tiro as suas dúvidas', r: [76, 10.5, 16.5, 5], rotulo: 'A sua pergunta', embaixo: true },
    { em: 'seu funil', r: [38, 22, 55, 53], rotulo: 'A resposta com os seus números' },
    { em: 'falando ou escrevendo', r: [41.5, 85, 47.5, 8], rotulo: 'Por voz ou por texto' },
  ],
};

/** As cenas do tour para esta conta: só o que ela contratou, com as falas certas. */
export function cenasDoTour(c: ContextoTour): CenaTour[] {
  const v = variantes(c);
  return CENAS.filter((cena) => tem(c, cena.requer)).map((cena) => ({
    ...cena,
    fala:
      cena.id === 'abertura'
        ? v.abertura
        : cena.id === 'conversas'
          ? v.conversas
          : cena.id === 'fim'
            ? v.fim
            : cena.fala,
    focos: FOCOS[cena.id] ?? [],
  }));
}

/** A fala de uma cena para gerar o áudio (o servidor só fala o que está aqui). */
export function falaDaCena(id: string, variante: string): string | null {
  const [argos, ia] = [variante.includes('a'), variante.includes('i')];
  const ctx: ContextoTour = {
    modulos: ['whatsapp', 'email', 'ligacoes', ...(ia ? ['agente_ia'] : [])],
    recursos: ['reunioes', 'instagram', ...(argos ? ['argos'] : [])],
  };
  return cenasDoTour(ctx).find((c) => c.id === id)?.fala ?? null;
}

/** "a" = tem o Argos, "i" = tem o Agente de IA (o que muda as falas). */
export const varianteDoTour = (c: ContextoTour) =>
  `${c.recursos.includes('argos') ? 'a' : ''}${c.modulos.includes('agente_ia') ? 'i' : ''}` || '-';

/** As frases da fala, com a posição de cada uma (a legenda mostra a que está sendo falada). */
export function frasesDaFala(texto: string): { inicio: number; texto: string }[] {
  const saida: { inicio: number; texto: string }[] = [];
  let pos = 0;
  for (const f of texto.match(/[^.!?]+[.!?]*\s*/g) ?? [texto]) {
    saida.push({ inicio: pos, texto: f.trim() });
    pos += f.length;
  }
  return saida.filter((f) => f.texto);
}

/**
 * Para a voz do navegador (reserva, quando a voz do servidor não está ligada): as palavras em
 * inglês e as siglas escritas como se falam, senão a voz embola.
 */
export function paraFalarNoNavegador(texto: string): string {
  return texto
    .replace(/WhatsApp/gi, 'uótzap')
    .replace(/Instagram/g, 'instagrã')
    .replace(/LinkedIn/gi, 'línquedin')
    .replace(/Google Maps/g, 'gúgou méps')
    .replace(/\bGoogle\b/g, 'gúgou')
    .replace(/\bleads\b/gi, 'lídis')
    .replace(/\blead\b/gi, 'lídi')
    .replace(/\be-mails?\b/gi, (m) => (m.toLowerCase().endsWith('s') ? 'imêious' : 'imêiou'))
    .replace(/\bIA\b/g, 'i á')
    .replace(/\bCRM\b/g, 'cê erre ême')
    .replace(/\bonline\b/gi, 'onláine')
    .replace(/\bMeta\b/g, 'Méta');
}
