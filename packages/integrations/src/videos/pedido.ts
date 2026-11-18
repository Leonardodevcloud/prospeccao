import {
  type AnimacoesVideo,
  type AreaDaProposta,
  type CorteVideo,
  type EstiloLegenda,
  ITENS_DO_MOMENTO,
  MAX_LETRAS_NOME,
  MOMENTOS_COM_ITENS,
  momentosDe,
  type PalavraVideo,
  type PedidoEditora,
  type PropostaDaEditora,
  type RespostaDaEditora,
  ROTULO_MOMENTO,
  type SomVideo,
  type TipoMomento,
  tempoNoEditado,
} from '@prospeccao/shared/videos';
import type { BlocoSistema, ClienteClaude } from '../carrosseis/claude.js';
import { noEditado } from './enfeites.js';

/**
 * Peça à editora (v161): na revisão, a pessoa escreve o que quer cortar, refazer ou mudar e a IA
 * devolve as mudanças propostas, cada uma no formato da própria revisão (o mesmo do PUT /revisao).
 * Nada muda no vídeo até a pessoa marcar e aplicar; o código confere cada proposta (índices dentro
 * da fala, ids que existem, textos no tamanho) e descarta a que não fecha.
 */

type Trecho = { inicio: number; fim: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const curto = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const inteiro = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

export interface ContextoDoPedido {
  palavras: PalavraVideo[];
  cortes: CorteVideo[];
  /** Os trechos do original que ficam no vídeo (pelos cortes de agora). */
  ficam: Trecho[];
  animacoes: AnimacoesVideo | null;
  som: SomVideo | null;
  estilo: string;
  /** As cores só deste vídeo (null: as da marca). */
  cores?: { primaria: string; destaque: string } | null;
  musicaLiberada: boolean;
}

const ACOES = [
  'cortar',
  'devolver',
  'nova_animacao',
  'editar_animacao',
  'tirar_animacao',
  'titulo',
  'chamada',
  'musica',
  'legenda',
  'estilo_legenda',
  'tirar_pausa',
  'cores',
] as const;
type Acao = (typeof ACOES)[number];
type TipoNovo = Exclude<TipoMomento, 'oferta'>;
const TIPOS_NOVOS: TipoNovo[] = ['lista', 'nomes', 'compara', 'troca', 'selo', 'numero', 'destaque'];

const ESQUEMA_PEDIDO = {
  type: 'object',
  properties: {
    resposta: {
      type: 'string',
      description:
        'O que você diz à pessoa, em 1 a 3 frases curtas, em português simples. Se há mudanças: diga o que achou. Se não dá para fazer: diga por quê e o que dá para fazer no lugar. Se ficou dúvida: pergunte.',
    },
    opcoes: {
      type: 'array',
      description:
        'Só quando você pergunta: até 3 respostas prontas, curtas ("Corta o trecho", "Põe o selo").',
      items: { type: 'string' },
    },
    mudancas: {
      type: 'array',
      description: 'As mudanças que você propõe, uma por coisa pedida. Vazio se só respondeu ou perguntou.',
      items: {
        type: 'object',
        properties: {
          acao: { type: 'string', enum: [...ACOES] },
          resumo: {
            type: 'string',
            description: 'O que muda, em até 8 palavras, para a pessoa ler ("Tirar “a gente vai… a gente”").',
          },
          detalhe: {
            type: 'string',
            description: 'Uma frase com o efeito ("Fica só “a gente entrega no mesmo dia”.").',
          },
          de: {
            type: 'integer',
            description:
              'cortar e devolver: índice da primeira palavra do trecho; nova_animacao: primeira palavra do momento; legenda: a palavra a corrigir; tirar_pausa: a palavra logo antes da pausa.',
          },
          ate: {
            type: 'integer',
            description: 'cortar, devolver e nova_animacao: índice da última palavra.',
          },
          animacao_id: { type: 'string', description: 'editar_animacao e tirar_animacao: o id da animação.' },
          tipo: { type: 'string', enum: TIPOS_NOVOS, description: 'Só em nova_animacao.' },
          titulo: {
            type: 'string',
            description:
              'nova_animacao e editar_animacao: título da lista ou dos nomes, texto do selo, linha embaixo do número.',
          },
          numero: { type: 'string', description: 'Só em numero: o número como foi dito ("2×", "50%").' },
          itens: {
            type: 'array',
            description:
              'lista (2 a 5), nomes (2 a 6, até 20 letras), compara e troca (exatamente 2). Em nova_animacao cada item leva o índice da palavra em que é falado; em editar_animacao, os textos na mesma ordem de antes.',
            items: {
              type: 'object',
              properties: { texto: { type: 'string' }, palavra: { type: 'integer' } },
              required: ['texto'],
            },
          },
          usar: { type: 'boolean', description: 'titulo, chamada e musica: ligar ou desligar.' },
          texto: {
            type: 'string',
            description:
              'titulo: o título de abertura; chamada: a frase da tela final; legenda: a palavra certa.',
          },
          volume: { type: 'integer', description: 'musica: de 0 a 100.' },
          clima: { type: 'string', enum: ['animada', 'confiante', 'calma', 'corporativa'] },
          outra: { type: 'boolean', description: 'musica: compor outra música no próximo gerar.' },
          estilo: {
            type: 'string',
            enum: ['acesa', 'simples', 'balao', 'pilula', 'impacto'],
            description:
              'Só em estilo_legenda (acesa: palavra acesa; simples; balao; pilula: karaokê numa faixa escura; impacto: palavras gigantes uma a uma).',
          },
        },
        required: ['acao', 'resumo'],
      },
    },
  },
  required: ['resposta', 'mudancas'],
} as const;

const SISTEMA_PEDIDO = `Você é a editora de vídeos curtos (Reels, TikTok) de uma empresa brasileira. O vídeo já foi editado; a pessoa assistiu e está pedindo ajustes com as palavras dela. Você recebe a fala palavra por palavra (índice, palavra, o segundo em que aparece no vídeo editado, ou CORTADA), os cortes, as animações, o título, a chamada e a música de agora.

Transforme o pedido em mudanças. Cada coisa pedida é uma mudança separada, para a pessoa aceitar ou recusar uma a uma.

O que você pode fazer:
- cortar: tirar um trecho da fala (de/ate nos índices das palavras que saem). Ache o trecho pelo que a pessoa citou ou pelo momento que ela apontou. Nunca corte no meio de uma palavra, número ou preço; o que sobra tem que fazer sentido lido em voz alta.
- devolver: trazer de volta palavras que estão CORTADAS (de/ate nos índices delas).
- nova_animacao: lista (enumeração), nomes (nomes curtos que aparecem um a um), compara (dois lados), troca (risca um, entra o outro), selo (rótulo curto), numero (número grande), destaque (aproximação do rosto). O texto com as palavras da própria pessoa, curto, sem inventar dado. Cada item com a palavra em que é falado. Se já há uma animação naquele ponto, a nova fica no lugar dela: avise no detalhe.
- editar_animacao e tirar_animacao: pelo id.
- tirar_pausa: fechar a pausa (o silêncio, a respirada, a travada) entre duas palavras, sem tirar palavra nenhuma: de = índice da palavra logo antes da pausa. As pausas que ainda estão no vídeo vêm marcadas na fala ("[pausa de 0,4 s depois]"). Quando a pessoa cita as palavras em volta ("quando eu falo Tutts… motos"), ache o par de palavras; se o par aparece mais de uma vez, escolha o que tem a pausa marcada (o maior, se houver mais de um) e diga qual escolheu. É o "corte milimétrico", "corte seco", "tira a travada".
- cores: mudar as cores dos elementos e da legenda só deste vídeo (cor_principal e cor_destaque em #rrggbb), ou voltar às da marca (padrao = true). "Apagado", "sem vida", "fraco" → cores mais vivas e saturadas, no mesmo tom das de agora quando elas são conhecidas; "mais escuro", "amarelo", "cor da marca" → siga o pedido. Sempre proponha as duas.
- titulo (abertura), chamada (frase da tela final), musica (ligar, desligar, volume, clima, pedir outra), legenda (corrigir uma palavra escrita errado), estilo_legenda.

Como a pessoa fala: "botões", "caixinhas", "plaquinhas", "etiquetas", "balõezinhos", "textos que aparecem", "elementos", "efeitos" são as animações (selo, lista, nomes, número, comparação, troca) e a legenda que acompanha a fala; "letrinha" e "texto embaixo" são a legenda. Ela não conhece os nomes técnicos: entenda pelo sentido e, se a mensagem traz dois pedidos, responda aos dois.
- "Mais elementos na tela": proponha de 2 a 4 animações novas onde hoje não há nenhuma, começando pelas enumerações e comparações da fala. "Refazer as animações": tire as de agora e proponha um conjunto novo.

O que você não pode fazer, e o que dizer:
- Trocar o que a pessoa falou por outra frase, mudar a voz, regravar: o vídeo só tem o que foi gravado. Ofereça cortar o trecho ou pôr um selo com a frase certa, e pergunte qual (use opcoes).
- Preço e condição de promoção: nunca escreva número que a pessoa não falou.
- Imagens, vídeos de apoio (os trechos que entram por cima da fala), efeitos sonoros e publicação: diga em qual aba da revisão ela ajusta (Imagens, Som, Publicação).

Regras:
- Pedido vago ("melhora aí") ou trecho que você não achou na fala: não chute. Pergunte o que exatamente, em uma frase.
- Não proponha nada além do que foi pedido.
- resumo e detalhe são para um leigo: sem índice de palavra, sem termo técnico. Cite o trecho entre aspas.
- Tudo em português do Brasil.`;

export const SISTEMA_DA_EDITORA: BlocoSistema[] = [{ texto: SISTEMA_PEDIDO, cache: true }];

/** O estado do vídeo, do jeito que a editora lê. */
export function contextoParaAEditora(c: ContextoDoPedido, pedido: PedidoEditora): string {
  // v163: a pausa que ainda está no vídeo depois de cada palavra (para o "corte milimétrico").
  const noVideo = (t: number) => tempoNoEditado(t, c.ficam);
  const fala = c.palavras
    .map((p, k) => {
      const t = noVideo(p.i + Math.min(0.05, (p.f - p.i) / 2));
      if (t == null) return `${k}: ${p.t}  (CORTADA)`;
      const prox = c.palavras[k + 1];
      const fimDesta = noVideo(p.f - Math.min(0.03, (p.f - p.i) / 2));
      const comecoDaProxima = prox ? noVideo(prox.i + Math.min(0.03, (prox.f - prox.i) / 2)) : null;
      const pausa = fimDesta != null && comecoDaProxima != null ? comecoDaProxima - fimDesta - 0.06 : 0;
      return `${k}: ${p.t}  (${t.toFixed(1)} s)${pausa >= 0.15 ? `  [pausa de ${pausa.toFixed(1).replace('.', ',')} s depois]` : ''}`;
    })
    .join('\n');
  const momentos = c.animacoes ? momentosDe(c.animacoes) : [];
  const animacoes = momentos
    .map((m) => {
      const t = noEditado(m.inicio, c.ficam);
      const texto = [m.titulo, m.numero, m.itens.map((i) => i.texto).join(' · ')].filter(Boolean).join(' | ');
      return `- id ${m.id}: ${ROTULO_MOMENTO[m.tipo]}${t == null ? '' : ` em ${t.toFixed(1)} s`}${texto ? ` · ${texto}` : ''}${m.usar ? '' : ' (desligada)'}`;
    })
    .join('\n');
  const a = c.animacoes;
  const mu = c.som?.musica;
  return [
    `A fala:\n${fala}`,
    animacoes ? `Animações de agora:\n${animacoes}` : 'Nenhuma animação no vídeo.',
    a
      ? `Título de abertura: ${a.titulo.usar ? `"${a.titulo.texto}"` : 'desligado'}. Chamada no fim: ${a.chamada.usar ? `"${a.chamada.texto || a.chamada.tipo}"` : 'desligada'}.`
      : '',
    mu
      ? `Música: ${mu.usar ? `ligada, clima ${mu.clima}, volume ${mu.volume} de 100` : 'desligada'}${c.musicaLiberada ? '' : ' (a música não está liberada nesta conta: não proponha ligar)'}.`
      : '',
    `Estilo da legenda: ${c.estilo}. Cores dos elementos e da legenda: ${c.cores ? `principal ${c.cores.primaria}, destaque ${c.cores.destaque} (só deste vídeo)` : 'as da marca da empresa (o padrão)'}.`,
    pedido.historico.length
      ? `A conversa até aqui:\n${pedido.historico.map((h) => `${h.de === 'voce' ? 'Pessoa' : 'Você'}: ${h.texto}`).join('\n')}`
      : '',
    pedido.em != null ? `A pessoa parou o vídeo em ${pedido.em.toFixed(1)} s para falar deste momento.` : '',
    `O pedido de agora: ${pedido.texto}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const AREA: Record<Acao, AreaDaProposta> = {
  cortar: 'corte',
  devolver: 'corte',
  nova_animacao: 'animacao',
  editar_animacao: 'animacao',
  tirar_animacao: 'animacao',
  titulo: 'texto',
  chamada: 'texto',
  musica: 'som',
  legenda: 'texto',
  estilo_legenda: 'texto',
  tirar_pausa: 'corte',
  cores: 'animacao',
};

/**
 * Confere o que a IA mandou e monta as propostas no formato da revisão. O que não fecha (índice
 * fora da fala, id que não existe, lista sem itens, música sem estar liberada) fica de fora.
 */
export function lerPedido(dados: Record<string, unknown>, c: ContextoDoPedido): RespostaDaEditora {
  const { palavras, ficam } = c;
  const total = palavras.length;
  const dentro = (n: number | null): n is number => n != null && n >= 0 && n < total;
  const viva = (k: number) => tempoNoEditado(palavras[k]!.i + 0.02, ficam) != null;
  const ed = (t: number) => noEditado(t, ficam);
  const momentos = c.animacoes ? momentosDe(c.animacoes) : [];
  const propostas: PropostaDaEditora[] = [];
  const lista = Array.isArray(dados.mudancas) ? (dados.mudancas as Record<string, unknown>[]) : [];
  for (const m of lista.slice(0, 20)) {
    const acao = String(m.acao) as Acao;
    if (!ACOES.includes(acao)) continue;
    const de = inteiro(m.de);
    const ate = inteiro(m.ate) ?? de;
    const base = {
      id: `p${propostas.length + 1}`,
      area: AREA[acao],
      titulo: curto(m.resumo, 90),
      detalhe: curto(m.detalhe, 220),
    };
    if (!base.titulo) continue;
    if (acao === 'cortar' || acao === 'devolver') {
      if (!dentro(de) || !dentro(ate) || de > ate) continue;
      const cortando = acao === 'cortar';
      // Cortar o que já saiu ou devolver o que já está no vídeo não muda nada.
      const alvo: number[] = [];
      for (let k = de; k <= ate; k++) if (viva(k) === cortando) alvo.push(k);
      if (!alvo.length) continue;
      const a = alvo[0]!;
      const b = alvo.at(-1)!;
      // As bordas pelas palavras vizinhas, sem comer a fala de antes nem a de depois.
      const ant = palavras[a - 1];
      const prox = palavras[b + 1];
      const inicio = ant ? Math.min(palavras[a]!.i, ant.f + 0.06) : Math.max(0, palavras[a]!.i - 0.05);
      const fim = prox ? Math.max(palavras[b]!.f, prox.i - 0.04) : palavras[b]!.f + 0.1;
      if (fim - inicio < 0.06) continue;
      propostas.push({
        ...base,
        quando: ed(palavras[a]!.i),
        ate: null,
        revisao: { trechos: [{ acao, inicio: r2(Math.max(0, inicio)), fim: r2(fim) }] },
      });
      continue;
    }
    if (acao === 'nova_animacao') {
      let tipo = String(m.tipo) as TipoNovo;
      if (!TIPOS_NOVOS.includes(tipo) || !dentro(de) || !dentro(ate) || de > ate) continue;
      const ini = ed(palavras[de]!.i);
      let fim = ed(palavras[ate]!.f);
      if (ini == null || fim == null) continue;
      const titulo = curto(m.titulo, 40);
      const numero = curto(m.numero, 8);
      let itens: { texto: string; em: number }[] = [];
      if (MOMENTOS_COM_ITENS.includes(tipo)) {
        const brutos = (Array.isArray(m.itens) ? (m.itens as Record<string, unknown>[]) : [])
          .map((i) => ({ texto: curto(i.texto, 32), palavra: inteiro(i.palavra) }))
          .filter(
            (i): i is { texto: string; palavra: number } => !!i.texto && dentro(i.palavra) && viva(i.palavra),
          );
        if (tipo === 'nomes' && brutos.some((i) => i.texto.length > MAX_LETRAS_NOME)) tipo = 'lista';
        const [min, max] = ITENS_DO_MOMENTO[tipo]!;
        itens = brutos
          .map((i) => ({ texto: i.texto, em: r2(ed(palavras[i.palavra]!.i)!) }))
          .sort((x, y) => x.em - y.em)
          .slice(0, max);
        if (itens.length < min) continue;
        fim = Math.max(fim, itens.at(-1)!.em + 1.2);
      }
      if (tipo === 'selo' && !titulo) continue;
      if (tipo === 'numero' && !numero) continue;
      propostas.push({
        ...base,
        quando: r2(ini),
        ate: r2(fim),
        revisao: { novosMomentos: [{ tipo, em: r2(ini), ate: r2(fim), titulo, numero, itens }] },
      });
      continue;
    }
    if (acao === 'editar_animacao' || acao === 'tirar_animacao') {
      const atual = momentos.find((x) => x.id === String(m.animacao_id ?? ''));
      if (!atual) continue;
      const quando = ed(atual.inicio);
      if (acao === 'tirar_animacao') {
        if (!atual.usar) continue;
        propostas.push({
          ...base,
          quando,
          ate: null,
          revisao: { momentos: [{ id: atual.id, usar: false }] },
        });
        continue;
      }
      const titulo = curto(m.titulo, 40);
      const numero = curto(m.numero, 8);
      const textos = (Array.isArray(m.itens) ? (m.itens as Record<string, unknown>[]) : [])
        .map((i) => curto(i.texto, 32))
        .filter(Boolean);
      const mudanca: { id: string; usar: boolean; titulo?: string; numero?: string; itens?: string[] } = {
        id: atual.id,
        usar: true,
      };
      if (titulo && atual.tipo !== 'destaque' && atual.tipo !== 'oferta') mudanca.titulo = titulo;
      if (numero && atual.tipo === 'numero') mudanca.numero = numero;
      // Os itens só mudam de texto: a quantidade e o momento de cada um ficam.
      if (textos.length === atual.itens.length && textos.length) mudanca.itens = textos;
      if (!mudanca.titulo && !mudanca.numero && !mudanca.itens && atual.usar) continue;
      propostas.push({ ...base, quando, ate: null, revisao: { momentos: [mudanca] } });
      continue;
    }
    if (acao === 'titulo') {
      if (!c.animacoes) continue;
      const texto = curto(m.texto, 60) || c.animacoes.titulo.texto;
      const usar = typeof m.usar === 'boolean' ? m.usar : true;
      if (usar && !texto) continue;
      propostas.push({ ...base, quando: usar ? 0 : null, ate: null, revisao: { titulo: { usar, texto } } });
      continue;
    }
    if (acao === 'chamada') {
      if (!c.animacoes) continue;
      const atual = c.animacoes.chamada;
      const usar = typeof m.usar === 'boolean' ? m.usar : true;
      const texto = curto(m.texto, 80);
      propostas.push({
        ...base,
        quando: null,
        ate: null,
        revisao: {
          chamada: {
            usar,
            tipo: atual.tipo === 'nenhuma' && usar ? 'texto' : atual.tipo,
            palavra: atual.palavra,
            texto: texto || atual.texto,
          },
        },
      });
      continue;
    }
    if (acao === 'musica') {
      if (!c.som) continue;
      const musica: NonNullable<PropostaDaEditora['revisao']['musica']> = {};
      if (typeof m.usar === 'boolean') {
        if (m.usar && !c.musicaLiberada) continue;
        musica.usar = m.usar;
      }
      const volume = inteiro(m.volume);
      if (volume != null) musica.volume = Math.max(0, Math.min(100, volume));
      if (['animada', 'confiante', 'calma', 'corporativa'].includes(String(m.clima)))
        musica.clima = m.clima as 'animada' | 'confiante' | 'calma' | 'corporativa';
      if (m.outra === true) musica.outra = true;
      if (!Object.keys(musica).length) continue;
      propostas.push({ ...base, quando: null, ate: null, revisao: { musica } });
      continue;
    }
    if (acao === 'legenda') {
      const texto = curto(m.texto, 40);
      if (!dentro(de) || !texto || /\s/.test(texto) || texto === palavras[de]!.t) continue;
      propostas.push({
        ...base,
        quando: ed(palavras[de]!.i),
        ate: null,
        revisao: { palavras: [{ indice: de, texto }] },
      });
      continue;
    }
    if (acao === 'tirar_pausa') {
      if (!dentro(de) || !viva(de)) continue;
      const prox = palavras[de + 1];
      if (!prox) continue;
      // Fica um respiro de 0,06 s: as palavras encostam sem comer o fim de uma nem o começo da outra.
      const inicio = palavras[de]!.f + 0.03;
      const fim = prox.i - 0.03;
      if (fim - inicio < 0.06) continue;
      propostas.push({
        ...base,
        quando: ed(palavras[de]!.i),
        ate: null,
        revisao: { trechos: [{ acao: 'cortar', inicio: r2(inicio), fim: r2(fim) }] },
      });
      continue;
    }
    if (acao === 'cores') {
      if (m.padrao === true) {
        if (!c.cores) continue;
        propostas.push({ ...base, quando: null, ate: null, revisao: { cores: null } });
        continue;
      }
      const hex = (v: unknown) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v).toLowerCase() : null);
      const primaria = hex(m.cor_principal);
      const destaque = hex(m.cor_destaque);
      if (!primaria || !destaque) continue;
      if (c.cores && c.cores.primaria === primaria && c.cores.destaque === destaque) continue;
      propostas.push({ ...base, quando: null, ate: null, revisao: { cores: { primaria, destaque } } });
      continue;
    }
    if (acao === 'estilo_legenda') {
      const estilo = String(m.estilo);
      if (!['acesa', 'simples', 'balao', 'pilula', 'impacto'].includes(estilo) || estilo === c.estilo)
        continue;
      propostas.push({
        ...base,
        quando: null,
        ate: null,
        revisao: { estilo: estilo as EstiloLegenda },
      });
    }
  }
  const pediu = lista.length;
  let resposta = curto(dados.resposta, 600);
  if (!resposta)
    resposta = propostas.length
      ? 'Achei o que você pediu. Marque o que quer e aplique:'
      : 'Não entendi o que mudar. Pode dizer de outro jeito, citando o trecho da fala?';
  // A IA propôs, mas nada fechou com o vídeo: a pessoa precisa saber, em vez de ver uma lista vazia.
  if (pediu && !propostas.length)
    resposta =
      'Não consegui montar essa mudança com segurança neste vídeo. Diga o trecho da fala entre aspas ou pare o vídeo no ponto e toque em "Falar deste momento".';
  const opcoes = (Array.isArray(dados.opcoes) ? dados.opcoes : [])
    .map((o) => curto(o, 40))
    .filter(Boolean)
    .slice(0, 3);
  return { resposta, propostas, opcoes: propostas.length ? [] : opcoes };
}

/** Um pedido à editora: uma chamada ao modelo principal (o manual vai para o cache). */
export async function pedirAEditora(
  claude: ClienteClaude,
  contexto: ContextoDoPedido,
  pedido: PedidoEditora,
): Promise<RespostaDaEditora> {
  const r = await claude.pedir({
    agente: 'editora de vídeo',
    sistema: SISTEMA_DA_EDITORA,
    mensagem: contextoParaAEditora(contexto, pedido),
    ferramenta: {
      nome: 'responder_pedido',
      descricao: 'A resposta à pessoa e as mudanças propostas no vídeo.',
      esquema: ESQUEMA_PEDIDO,
    },
    maxTokens: 3000,
    temperatura: 0.2,
    timeoutMs: 90_000,
  });
  return lerPedido(r.dados, contexto);
}
