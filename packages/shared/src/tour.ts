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
    fala: 'Depois vem o enriquecimento. Pra cada empresa, o sistema busca sozinho nos sites, no Instagram, no WhatsApp e também no LinkedIn, e confirma se o número existe. Também traz os possíveis decisores do negócio, pelo quadro de sócios. E você vê de onde veio cada informação, pra saber em que confiar.',
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
    { em: 'Meu dia', r: [0.4, 7.4, 12.7, 4.8], rotulo: 'Menu › Meu dia' },
    { em: 'Aqui ficam', r: [14.6, 9, 64, 91], rotulo: 'O que fazer hoje' },
    { em: 'próximos dias', r: [79.4, 9, 19.5, 25], rotulo: 'Próximos 7 dias' },
  ],
  campanhas: [
    { em: 'Campanhas', r: [1.9, 18.3, 11.2, 4.4], rotulo: 'Menu › Campanhas' },
    { em: 'na tela de Leads', r: [14.6, 19.9, 84.3, 80.1], rotulo: 'Leads encontrados' },
    { em: 'uma nota', r: [44.7, 20, 4.7, 80], rotulo: 'Nota A, B ou C' },
  ],
  enriquecimento: [
    { em: 'enriquecimento', r: [1.4, 2.2, 32, 25.3], rotulo: 'Ficha do lead' },
    { em: 'nos sites', r: [35.3, 23.6, 29.4, 19.5], rotulo: 'Contatos encontrados' },
    { em: 'LinkedIn', r: [68.8, 72.7, 27.7, 5.9], rotulo: 'Busca no LinkedIn' },
    { em: 'possíveis decisores', r: [35.3, 3.9, 29.4, 19.0], rotulo: 'Possíveis decisores' },
    { em: 'de onde veio', r: [67.9, 39.4, 29.4, 51.3], rotulo: 'Como encontramos' },
  ],
  conversas: [
    { em: 'Conversas', r: [1.9, 22.1, 11.2, 4.4], rotulo: 'Menu › Conversas' },
    { em: 'num lugar só', r: [14.7, 1.9, 22, 96.2], rotulo: 'As conversas da equipe' },
    { em: 'Agente de IA', r: [35.9, 11.2, 62.9, 4.5], rotulo: 'A IA conduzindo a conversa' },
    { em: 'marca a reunião', r: [74.5, 5.1, 8.7, 4], rotulo: 'Marcar reunião' },
    { em: 'histórico', r: [36.2, 14, 62.7, 75.3], rotulo: 'Histórico completo' },
  ],
  ligacao: [
    { em: 'Ligações', r: [36.1, 48.3, 25.8, 50.6], rotulo: 'Ligação em andamento' },
    { em: 'gravada', r: [55.7, 49.8, 6.2, 5.0], rotulo: 'Gravando' },
    { em: 'avisado', r: [37.2, 69.6, 23.6, 6.1], rotulo: 'Aviso de gravação' },
  ],
  'ligacao-resumo': [
    { em: 'resume', r: [37.1, 35.4, 23.8, 23.4], rotulo: 'Resumo da IA' },
    { em: 'próximo passo', r: [37.1, 58.6, 23.8, 22.0], rotulo: 'Próximo passo sugerido' },
    { em: 'conferir e salvar', r: [55.9, 92.9, 4.9, 4.7], rotulo: 'Salvar' },
  ],
  reunioes: [
    { em: 'Reuniões', r: [0.3, 41.6, 12.7, 5.1], rotulo: 'Menu › Reuniões' },
    { em: 'gravada', r: [14.7, 11.5, 61.4, 55.8], rotulo: 'Gravação da reunião' },
    { em: 'resumo', r: [14.7, 74.6, 61.4, 25.4], rotulo: 'Resumo da reunião' },
    { em: 'próximos passos', r: [77.1, 11.5, 21.8, 22.1], rotulo: 'Próximos passos' },
  ],
  email: [
    { em: 'E-mail', r: [3.8, 3.1, 93.9, 17.8], rotulo: '1º passo: e-mail' },
    { em: 'WhatsApp e ligação', r: [3.8, 19.7, 93.9, 52.9], rotulo: 'Depois: WhatsApp e ligação' },
    { em: 'Quando o lead responde', r: [2.3, 76.0, 95.4, 10.9], rotulo: 'Respondeu, a sequência para' },
  ],
  instagram: [
    { em: 'Instagram', r: [2.1, 32.5, 12.4, 4.7], rotulo: 'Menu › Instagram' },
    { em: 'formulário', r: [16.4, 45.9, 27.1, 30.9], rotulo: 'Cadastros dos anúncios' },
    { em: 'devolve', r: [16.4, 21.8, 82.2, 21.7], rotulo: 'Devolver as vendas para a Meta' },
  ],
  'instagram-conteudo': [
    { em: 'análise', r: [16.4, 22.0, 82.2, 15.2], rotulo: 'Alcance, leads e vendas' },
    { em: 'quais posts', r: [16.4, 54.4, 82.2, 45.2], rotulo: 'Post a post' },
    { em: 'viram venda', r: [16.4, 36.0, 82.2, 19.6], rotulo: 'O que funciona' },
  ],
  argos: [
    { em: 'menu Argos', r: [0.3, 60.6, 12.6, 4.8], rotulo: 'Menu › Argos' },
    { em: 'tiro as suas dúvidas', r: [76.2, 12.4, 16.4, 5.4], rotulo: 'A sua pergunta' },
    { em: 'seu funil', r: [38.2, 23.2, 54.2, 52.4], rotulo: 'A resposta com os seus números' },
    { em: 'falando ou escrevendo', r: [41.4, 86.2, 48.0, 7.0], rotulo: 'Por voz ou por texto' },
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
    const anterior = saida.at(-1);
    // "Dr. Renato" não termina a frase.
    if (anterior && /\b(Dr|Dra|Sr|Sra|Srta)\.$/.test(anterior.texto)) anterior.texto += ` ${f.trim()}`;
    else saida.push({ inicio: pos, texto: f.trim() });
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
