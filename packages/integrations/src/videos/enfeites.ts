import {
  type ClimaMusica,
  type EncaixeImagem,
  IMAGEM_MAX_SEGUNDOS,
  IMAGEM_MIN_SEGUNDOS,
  IMAGEM_SEM_NO_COMECO,
  IMAGENS_FRACAO_MAXIMA,
  type ImagemVideo,
  type ItemDaLista,
  MAX_IMAGENS_VIDEO,
  type ModoImagens,
  type MomentoVideo,
  type OfertaDoVideo,
  type OpcoesVideo,
  type PalavraVideo,
  type TipoMomento,
  type TrechoSemImagem,
  tempoNoEditado,
  tempoNoOriginal,
} from '@prospeccao/shared/videos';
import type { ClienteClaude } from '../carrosseis/claude.js';

/**
 * Os enfeites do vídeo (v129): as animações que acompanham a fala, as imagens e o clima da música.
 * A IA lê a fala que ficou depois dos cortes e propõe; o código confere as regras (nada nos 2
 * primeiros segundos, no máximo 30% do vídeo com imagem, cada imagem entre 1,5 e 4 s, nada em cima
 * do título, da lista ou da chamada, preço só o da promoção cadastrada) e descarta o que não cabe.
 * Tempos guardados no original, como os cortes; o editado é calculado na hora de montar.
 */

type Trecho = { inicio: number; fim: number };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const curto = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const inteiro = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

/** Fim do título de abertura no editado (as animações e imagens acima da cabeça esperam ele sair). */
export const FIM_DO_TITULO = 2.3;
/** Antes da tela final nada novo entra. */
const FOLGA_DO_FIM = 0.6;

export interface FotoParaIa {
  id: number;
  nome: string;
  descricao: string;
}
export interface PromocaoParaIa extends OfertaDoVideo {
  id: number;
  titulo: string;
}

/** Um instante do original no editado; caiu num corte, vai para o começo do trecho seguinte. */
export function noEditado(t: number, ficam: Trecho[]): number | null {
  const direto = tempoNoEditado(t, ficam);
  if (direto != null) return direto;
  let acc = 0;
  for (const s of ficam) {
    if (t < s.inicio) return r3(acc);
    acc += s.fim - s.inicio;
  }
  return null;
}

/* ───────────────────────────── O pedido à IA ───────────────────────────── */

/** A fala que ficou no vídeo, numerada pelo índice do original, com o tempo do editado. */
export function falaDoEditado(palavras: PalavraVideo[], ficam: Trecho[]): string {
  const linhas: string[] = [];
  palavras.forEach((p, k) => {
    const t = tempoNoEditado(p.i + Math.min(0.05, (p.f - p.i) / 2), ficam);
    if (t == null) return;
    linhas.push(`${k}: ${p.t}  (${t.toFixed(1)} s)`);
  });
  return linhas.join('\n');
}

const ESQUEMA_ENFEITES = {
  type: 'object',
  properties: {
    momentos: {
      type: 'array',
      description: 'Animações que acompanham a fala. Poucas e certeiras: 0 a 5 num vídeo de 30 s.',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['lista', 'numero', 'selo', 'destaque', 'oferta'] },
          de: { type: 'integer', description: 'Índice da primeira palavra do momento.' },
          ate: { type: 'integer', description: 'Índice da última palavra do momento.' },
          titulo: {
            type: 'string',
            description:
              'lista: título curto em maiúsculas ("3 SINAIS DE TROCA"); numero: a linha embaixo do número ("MAIS DURABILIDADE"); selo: 1 a 3 palavras ("DICA", "SÓ ATÉ SÁBADO"). Vazio em destaque e oferta.',
          },
          numero: {
            type: 'string',
            description: 'Só em numero: o número como a pessoa disse ("2×", "50%", "3").',
          },
          itens: {
            type: 'array',
            description:
              'Só em lista: 2 a 5 itens, cada um com o índice da palavra em que a pessoa fala dele.',
            items: {
              type: 'object',
              properties: { texto: { type: 'string' }, palavra: { type: 'integer' } },
              required: ['texto', 'palavra'],
            },
          },
          divulgar_id: {
            type: 'integer',
            description: 'Só em oferta: o id da promoção cadastrada de que a pessoa está falando.',
          },
        },
        required: ['tipo', 'de', 'ate'],
      },
    },
    imagens: {
      type: 'array',
      description:
        'Imagens que ajudam a entender. Só onde a fala cita um produto, um número, uma comparação, um lugar ou uma situação concreta.',
      items: {
        type: 'object',
        properties: {
          de: { type: 'integer' },
          ate: { type: 'integer' },
          motivo: {
            type: 'string',
            description: 'O que a pessoa falou que pede a imagem, em uma frase curta.',
          },
          foto_id: { type: 'integer', description: 'A foto da empresa que mostra isso (se houver).' },
          gerar: {
            type: 'string',
            description:
              'Se nenhuma foto da empresa serve: a cena a gerar, em português, genérica (sem produto de marca, sem texto, sem rosto em destaque). Vazio se usar foto.',
          },
          encaixe: {
            type: 'string',
            enum: ['acima', 'cheia'],
            description: 'acima: num cartão acima da cabeça; cheia: tela cheia por poucos segundos.',
          },
        },
        required: ['de', 'ate', 'motivo', 'encaixe'],
      },
    },
    sem_imagem: {
      type: 'array',
      description:
        'Até 3 frases em que uma imagem atrapalharia (frase para olhar nos olhos, emoção, chamada).',
      items: {
        type: 'object',
        properties: { de: { type: 'integer' }, ate: { type: 'integer' }, motivo: { type: 'string' } },
        required: ['de', 'ate', 'motivo'],
      },
    },
    musica: {
      type: 'object',
      properties: {
        clima: { type: 'string', enum: ['animada', 'confiante', 'calma', 'corporativa'] },
        estilo: {
          type: 'string',
          description:
            'O estilo da trilha em inglês, sem nome de artista ou música (ex.: "warm acoustic guitar with light percussion").',
        },
      },
      required: ['clima', 'estilo'],
    },
  },
  required: ['momentos', 'imagens', 'sem_imagem', 'musica'],
} as const;

const SISTEMA_ENFEITES = `Você é o editor de motion de vídeos curtos (Reels, TikTok) de uma empresa brasileira. Recebe a fala que ficou no vídeo, palavra por palavra (índice, palavra e o segundo em que ela aparece no vídeo editado), as fotos que a empresa tem e as promoções cadastradas.

Proponha o que entra em cima da fala para o vídeo prender e explicar melhor, sem poluir:
- lista: quando a pessoa enumera ("três sinais", "primeiro… segundo…"). Cada item marca quando ela fala dele.
- numero: um número que impressiona ("dura o dobro" → "2×", "50% mais barato").
- selo: um rótulo curto num momento-chave ("DICA", "SÓ ATÉ SÁBADO").
- destaque: aproximação do rosto na frase mais forte do vídeo (1 ou 2 por vídeo, nunca mais de 3).
- oferta: só quando a pessoa fala de uma promoção que está cadastrada; o sistema escreve o produto e os preços exatamente como foram digitados. Nunca invente preço.

Imagens:
- Só onde a fala cita algo concreto que a imagem mostra (produto, número, comparação, lugar, situação). Frase de opinião, emoção ou conversa direta com quem assiste fica sem imagem: o rosto é o que convence.
- Use primeiro as fotos da empresa (foto_id) quando a descrição bate com a fala. Gere (gerar) só cenas genéricas que a empresa não tem: estrada, oficina, carro na chuva, mãos trabalhando. Nunca gere o produto que a empresa vende como se fosse real, nem marca, embalagem, texto ou rosto em destaque.
- Nada nos 2 primeiros segundos. Cada imagem de 1,5 a 4 segundos, no total no máximo 30% do vídeo.
- encaixe "cheia" para cenas (tela cheia por pouco tempo, a voz continua); "acima" para produto e detalhe.
- Animações e imagens não se sobrepõem.

Música: o clima pelo assunto (promoção → animada ou confiante; explicação → calma; institucional → corporativa) e o estilo em inglês, sempre instrumental, sem citar artista.`;

export interface EntradaEnfeites {
  palavras: PalavraVideo[];
  ficam: Trecho[];
  opcoes: OpcoesVideo;
  fotos: FotoParaIa[];
  promocoes: PromocaoParaIa[];
  /** Título de abertura em uso (as animações esperam ele sair). */
  comTitulo: boolean;
}

export interface DecisaoEnfeites {
  momentos: {
    tipo: TipoMomento;
    de: number;
    ate: number;
    titulo: string;
    numero: string;
    itens: { texto: string; palavra: number }[];
    divulgarId: number | null;
  }[];
  imagens: {
    de: number;
    ate: number;
    motivo: string;
    fotoId: number | null;
    gerar: string;
    encaixe: EncaixeImagem;
  }[];
  semImagem: { de: number; ate: number; motivo: string }[];
  musica: { clima: ClimaMusica; estilo: string };
}

const TIPOS: TipoMomento[] = ['lista', 'numero', 'selo', 'destaque', 'oferta'];
const CLIMAS: ClimaMusica[] = ['animada', 'confiante', 'calma', 'corporativa'];

/** Confere o que a IA mandou (índices dentro da fala, tipos conhecidos). */
export function lerEnfeites(dados: Record<string, unknown>, total: number): DecisaoEnfeites {
  const dentro = (n: number | null) => n != null && n >= 0 && n < total;
  const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const momentos: DecisaoEnfeites['momentos'] = [];
  for (const m of lista(dados.momentos)) {
    const de = inteiro(m.de);
    const ate = inteiro(m.ate);
    const tipo = String(m.tipo) as TipoMomento;
    if (!TIPOS.includes(tipo) || !dentro(de) || !dentro(ate) || de! > ate!) continue;
    momentos.push({
      tipo,
      de: de!,
      ate: ate!,
      titulo: curto(m.titulo, 40),
      numero: curto(m.numero, 8),
      itens: lista(m.itens)
        .map((i) => ({ texto: curto(i.texto, 32), palavra: inteiro(i.palavra) ?? -1 }))
        .filter((i) => i.texto && dentro(i.palavra)),
      divulgarId: inteiro(m.divulgar_id),
    });
  }
  const imagens: DecisaoEnfeites['imagens'] = [];
  for (const m of lista(dados.imagens)) {
    const de = inteiro(m.de);
    const ate = inteiro(m.ate);
    if (!dentro(de) || !dentro(ate) || de! > ate!) continue;
    imagens.push({
      de: de!,
      ate: ate!,
      motivo: curto(m.motivo, 160),
      fotoId: inteiro(m.foto_id),
      gerar: curto(m.gerar, 300),
      encaixe: m.encaixe === 'cheia' ? 'cheia' : 'acima',
    });
  }
  const semImagem: DecisaoEnfeites['semImagem'] = [];
  for (const m of lista(dados.sem_imagem).slice(0, 3)) {
    const de = inteiro(m.de);
    const ate = inteiro(m.ate);
    if (!dentro(de) || !dentro(ate) || de! > ate!) continue;
    semImagem.push({ de: de!, ate: ate!, motivo: curto(m.motivo, 160) });
  }
  const mu = (dados.musica ?? {}) as Record<string, unknown>;
  return {
    momentos,
    imagens,
    semImagem,
    musica: {
      clima: CLIMAS.includes(mu.clima as ClimaMusica) ? (mu.clima as ClimaMusica) : 'confiante',
      estilo: curto(mu.estilo, 160),
    },
  };
}

export async function pedirEnfeites(claude: ClienteClaude, e: EntradaEnfeites): Promise<DecisaoEnfeites> {
  const { opcoes } = e;
  const modo: Record<ModoImagens, string> = {
    ia: 'Imagens: fotos da empresa primeiro; pode gerar o que faltar.',
    fotos: 'Imagens: só fotos da empresa (não gere nenhuma).',
    nenhuma: 'Imagens: nenhuma (deixe "imagens" vazio).',
  };
  const mensagem = [
    opcoes.assunto ? `Assunto do vídeo: ${opcoes.assunto}` : '',
    opcoes.instrucoes ? `Pedido da empresa (siga se não contrariar as regras): ${opcoes.instrucoes}` : '',
    modo[opcoes.imagens],
    e.comTitulo
      ? `O título de abertura fica na tela até ${FIM_DO_TITULO} s: nenhuma animação ou imagem antes disso.`
      : '',
    e.fotos.length && opcoes.imagens !== 'nenhuma'
      ? `Fotos da empresa:\n${e.fotos.map((f) => `- foto_id ${f.id}: ${f.descricao || f.nome}`).join('\n')}`
      : 'A empresa não tem fotos cadastradas.',
    e.promocoes.length
      ? `Promoções cadastradas:\n${e.promocoes
          .map(
            (p) =>
              `- divulgar_id ${p.id}: ${p.titulo}${p.produto ? ` · ${p.produto}` : ''}${p.precoPor ? ` · por ${p.precoPor}` : ''}${p.validade ? ` · ${p.validade}` : ''}`,
          )
          .join('\n')}`
      : 'Nenhuma promoção cadastrada (não use oferta).',
    `A fala do vídeo editado:\n${falaDoEditado(e.palavras, e.ficam)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const r = await claude.pedir({
    agente: 'editor de motion',
    sistema: [{ texto: SISTEMA_ENFEITES }],
    mensagem,
    ferramenta: {
      nome: 'propor_enfeites',
      descricao: 'As animações, as imagens e o clima da música do vídeo.',
      esquema: ESQUEMA_ENFEITES,
    },
    maxTokens: 4000,
    temperatura: 0.4,
    timeoutMs: 180_000,
  });
  return lerEnfeites(r.dados, e.palavras.length);
}

/** Sem a IA: nenhuma animação nem imagem; a música no clima escolhido (ou confiante). */
export function enfeitesPelasRegras(opcoes: OpcoesVideo): DecisaoEnfeites {
  const clima = opcoes.musica !== 'ia' && opcoes.musica !== 'nenhuma' ? opcoes.musica : 'confiante';
  return { momentos: [], imagens: [], semImagem: [], musica: { clima, estilo: '' } };
}

/* ───────────────────────────── As regras ───────────────────────────── */

interface Janela {
  ini: number;
  fim: number;
}
const encosta = (a: Janela, b: Janela, folga = 0) => a.ini < b.fim + folga && b.ini < a.fim + folga;

const DURACAO_MOMENTO: Record<TipoMomento, [number, number]> = {
  lista: [2.5, 12],
  numero: [1.8, 3.5],
  selo: [1.5, 3],
  destaque: [0.8, 3],
  oferta: [2.5, 4.5],
};
const MAX_DESTAQUES = 3;
const MAX_MOMENTOS = 8;

export interface ResultadoEnfeites {
  momentos: MomentoVideo[];
  imagens: ImagemVideo[];
  semImagem: TrechoSemImagem[];
}

/**
 * Aplica as regras ao que a IA propôs. As animações têm preferência sobre as imagens (quando se
 * encostam, a imagem sai); entre duas do mesmo tipo, fica a que vem antes.
 */
export function aplicarRegras(
  d: DecisaoEnfeites,
  c: {
    palavras: PalavraVideo[];
    ficam: Trecho[];
    duracaoEditado: number;
    comTitulo: boolean;
    modo: ModoImagens;
    fotos: FotoParaIa[];
    promocoes: PromocaoParaIa[];
  },
): ResultadoEnfeites {
  const { palavras, ficam } = c;
  const fimLivre = c.duracaoEditado - FOLGA_DO_FIM;
  const ed = (t: number) => noEditado(t, ficam);
  const orig = (t: number) => tempoNoOriginal(Math.max(0, Math.min(c.duracaoEditado, t)), ficam);
  const fala = (de: number, ate: number) =>
    palavras
      .slice(de, ate + 1)
      .filter((p) => tempoNoEditado(p.i + 0.02, ficam) != null)
      .map((p) => p.t)
      .join(' ')
      .slice(0, 200);
  const titulo: Janela | null = c.comTitulo ? { ini: 0, fim: FIM_DO_TITULO } : null;

  // 1. Animações.
  const graficos: Janela[] = titulo ? [titulo] : [];
  const momentos: MomentoVideo[] = [];
  let destaques = 0;
  for (const m of [...d.momentos].sort((a, b) => a.de - b.de)) {
    if (momentos.length >= MAX_MOMENTOS) break;
    const p0 = palavras[m.de]!;
    const p1 = palavras[m.ate]!;
    let ini = ed(p0.i);
    let fim = ed(p1.f);
    if (ini == null || fim == null) continue;
    let itens: ItemDaLista[] = [];
    let oferta: OfertaDoVideo | null = null;
    if (m.tipo === 'lista') {
      itens = m.itens
        .slice(0, 5)
        .map((i) => ({ texto: i.texto.toUpperCase(), em: palavras[i.palavra]!.i }))
        .filter((i) => tempoNoEditado(i.em + 0.02, ficam) != null)
        .sort((a, b) => a.em - b.em);
      if (itens.length < 2) continue;
      ini = Math.min(ini, ed(itens[0]!.em)! - 0.4);
      fim = Math.max(fim, ed(itens.at(-1)!.em)! + 1.2);
    }
    if (m.tipo === 'numero' && !m.numero) continue;
    if (m.tipo === 'selo' && !m.titulo) continue;
    if (m.tipo === 'oferta') {
      const p = c.promocoes.find((x) => x.id === m.divulgarId);
      if (!p || !(p.precoPor || p.precoDe)) continue;
      oferta = {
        produto: p.produto || p.titulo,
        precoDe: p.precoDe,
        precoPor: p.precoPor,
        validade: p.validade,
      };
    }
    if (m.tipo === 'destaque' && destaques >= MAX_DESTAQUES) continue;
    const [min, max] = DURACAO_MOMENTO[m.tipo];
    ini = Math.max(0, ini);
    fim = Math.min(Math.max(fim, ini + min), ini + max, fimLivre);
    if (fim - ini < min * 0.8) continue;
    const janela = { ini, fim };
    if (m.tipo !== 'destaque') {
      if (graficos.some((g) => encosta(g, janela, 0.3))) continue;
      graficos.push(janela);
    } else destaques++;
    const oi = orig(ini);
    const of = orig(fim);
    if (oi == null || of == null) continue;
    momentos.push({
      id: `m${momentos.length + 1}`,
      tipo: m.tipo,
      inicio: oi,
      fim: of,
      fala: fala(m.de, m.ate),
      usar: true,
      titulo: m.tipo === 'destaque' || m.tipo === 'oferta' ? '' : m.titulo.toUpperCase().slice(0, 30),
      numero: m.tipo === 'numero' ? m.numero.slice(0, 7) : '',
      itens,
      divulgarId: m.tipo === 'oferta' ? m.divulgarId : null,
      oferta,
      manual: false,
    });
  }

  // 2. Imagens.
  const imagens: ImagemVideo[] = [];
  const semImagem: TrechoSemImagem[] = [];
  const usadas: Janela[] = [];
  let tempoComImagem = 0;
  const orcamento = c.duracaoEditado * IMAGENS_FRACAO_MAXIMA;
  if (c.modo !== 'nenhuma')
    for (const m of [...d.imagens].sort((a, b) => a.de - b.de)) {
      if (imagens.length >= MAX_IMAGENS_VIDEO) break;
      const foto = m.fotoId != null ? c.fotos.find((f) => f.id === m.fotoId) : undefined;
      const gerar = c.modo === 'ia' && !foto ? m.gerar : '';
      if (!foto && !gerar) continue;
      let ini = ed(palavras[m.de]!.i);
      let fim = ed(palavras[m.ate]!.f);
      if (ini == null || fim == null) continue;
      ini = Math.max(ini, IMAGEM_SEM_NO_COMECO, titulo ? titulo.fim + 0.25 : 0);
      fim = Math.min(Math.max(fim, ini + IMAGEM_MIN_SEGUNDOS), ini + IMAGEM_MAX_SEGUNDOS, fimLivre);
      if (fim - ini < IMAGEM_MIN_SEGUNDOS - 0.05) continue;
      const janela = { ini, fim };
      // "acima" disputa o espaço acima da cabeça com as animações; "cheia" cobre tudo, inclusive elas.
      if (graficos.some((g) => encosta(g, janela, 0.2))) continue;
      if (usadas.some((u) => encosta(u, janela, 0.5))) continue;
      if (tempoComImagem + (fim - ini) > orcamento + 0.01) continue;
      const oi = orig(ini);
      const of = orig(fim);
      if (oi == null || of == null) continue;
      usadas.push(janela);
      tempoComImagem += fim - ini;
      imagens.push({
        id: `i${imagens.length + 1}`,
        inicio: oi,
        fim: of,
        fala: fala(m.de, m.ate),
        motivo: m.motivo,
        origem: foto ? 'empresa' : 'gerada',
        fotoId: foto?.id ?? null,
        chave: null,
        descricao: foto ? foto.descricao || foto.nome : gerar,
        encaixe: m.encaixe,
        usar: true,
        pedido: null,
        conferencia: null,
        posta: null,
        manual: false,
      });
    }
  if (c.duracaoEditado > IMAGEM_SEM_NO_COMECO)
    semImagem.push({
      inicio: orig(0) ?? 0,
      fim: orig(IMAGEM_SEM_NO_COMECO) ?? 0,
      fala: fala(0, Math.min(palavras.length - 1, 4)),
      motivo: 'O começo é o seu rosto: é o que segura quem está rolando a tela.',
    });
  for (const s of d.semImagem) {
    const ini = ed(palavras[s.de]!.i);
    if (ini == null || ini < IMAGEM_SEM_NO_COMECO) continue;
    semImagem.push({
      inicio: palavras[s.de]!.i,
      fim: palavras[s.ate]!.f,
      fala: fala(s.de, s.ate),
      motivo: s.motivo,
    });
  }
  return { momentos, imagens, semImagem };
}

/** Duração com imagem no editado (para conferir a regra dos 30% na revisão). */
export function tempoComImagens(imagens: Pick<ImagemVideo, 'inicio' | 'fim' | 'usar'>[], ficam: Trecho[]) {
  let total = 0;
  for (const im of imagens) {
    if (!im.usar) continue;
    const a = noEditado(im.inicio, ficam);
    const b = noEditado(im.fim, ficam);
    if (a != null && b != null && b > a) total += b - a;
  }
  return r3(total);
}

/* ───────────────────────────── Uma imagem posta à mão ───────────────────────────── */

const ESQUEMA_UMA_IMAGEM = {
  type: 'object',
  properties: {
    foto_id: {
      type: 'integer',
      description: 'A foto da empresa que mostra o que a pessoa fala (se houver).',
    },
    gerar: {
      type: 'string',
      description:
        'Se nenhuma foto serve: a cena a gerar, em português, genérica (sem marca, texto ou rosto em destaque).',
    },
    encaixe: { type: 'string', enum: ['acima', 'cheia'] },
    motivo: { type: 'string', description: 'Por que esta imagem, em uma frase curta.' },
  },
  required: ['encaixe', 'motivo'],
} as const;

/** A pessoa pôs uma imagem num momento sem escolher a foto: a IA escolhe a foto ou a cena. */
export async function pedirImagemPara(
  claude: ClienteClaude,
  e: { fala: string; assunto: string; fotos: FotoParaIa[]; modo: ModoImagens },
): Promise<{ fotoId: number | null; gerar: string; encaixe: EncaixeImagem; motivo: string }> {
  const r = await claude.pedir({
    agente: 'editor de motion',
    sistema: [{ texto: SISTEMA_ENFEITES }],
    mensagem: [
      e.assunto ? `Assunto do vídeo: ${e.assunto}` : '',
      e.modo === 'fotos' ? 'Use só uma foto da empresa (não gere).' : '',
      e.fotos.length
        ? `Fotos da empresa:\n${e.fotos.map((f) => `- foto_id ${f.id}: ${f.descricao || f.nome}`).join('\n')}`
        : 'A empresa não tem fotos cadastradas.',
      `A pessoa quer uma imagem enquanto fala: "${e.fala}". Escolha a imagem.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    ferramenta: {
      nome: 'escolher_imagem',
      descricao: 'A imagem para o momento.',
      esquema: ESQUEMA_UMA_IMAGEM,
    },
    maxTokens: 600,
    temperatura: 0.3,
    timeoutMs: 90_000,
  });
  const d = r.dados;
  const fotoId = inteiro(d.foto_id);
  const foto = fotoId != null && e.fotos.some((f) => f.id === fotoId) ? fotoId : null;
  return {
    fotoId: foto,
    gerar: foto || e.modo === 'fotos' ? '' : curto(d.gerar, 300),
    encaixe: d.encaixe === 'cheia' ? 'cheia' : 'acima',
    motivo: curto(d.motivo, 160),
  };
}
