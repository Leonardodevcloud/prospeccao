import {
  GATILHOS_PASSAGEM,
  type PerfilIa,
  ROTULO_META,
  ROTULO_SECAO_IA,
  type SecaoIa,
} from '@prospeccao/shared';
import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

/**
 * O perfil da IA (as seções que o gestor preenche e confere) vira: o texto que a IA lê em toda
 * conversa, as fontes que a conferência usa para checar cada frase e a base para as sugestões.
 */

export interface FonteConferencia {
  /** Nome que aparece para quem confere (ex.: "O que vende"). */
  rotulo: string;
  texto: string;
}

const linha = (rotulo: string, valor: string | null | undefined) =>
  valor?.trim() ? `${rotulo}: ${valor.trim()}` : null;
const itens = (l: string[]) => l.filter((x) => x.trim()).map((x) => `- ${x.trim()}`);

const TOM: Record<string, string> = {
  formal: 'formal e respeitoso',
  proximo: 'próximo e profissional',
  descontraido: 'descontraído, como alguém da equipe falando no WhatsApp',
};

/** Cada seção em texto (para o prompt e para a conferência). Seção vazia não entra. */
export function blocosDoPerfil(
  p: PerfilIa,
  empresa: string,
): { secao: SecaoIa; titulo: string; texto: string }[] {
  const b: { secao: SecaoIa; titulo: string; texto: string }[] = [];
  const add = (secao: SecaoIa, titulo: string, partes: (string | null | false | undefined)[]) => {
    const t = partes.filter((x): x is string => !!x && !!x.trim()).join('\n');
    if (t.trim()) b.push({ secao, titulo, texto: t });
  };
  const q = p.quem;
  add('quem', 'QUEM VOCÊ É', [
    q.nome && `Seu nome: ${q.nome}, da ${empresa}.`,
    linha('Como se apresenta', q.apresentacao),
    q.tom && `Tom: ${TOM[q.tom] ?? q.tom}.`,
    q.tratamento && `Trate o cliente por ${q.tratamento === 'voce' ? '"você"' : '"o senhor / a senhora"'}.`,
    q.emojis && (q.emojis === 'nunca' ? 'Não use emojis.' : 'No máximo 1 emoji, e só quando combinar.'),
    q.exemplos.length > 0 &&
      [
        'Jeito de escrever da equipe (imite o ESTILO; o conteúdo destas mensagens não é fonte):',
        ...itens(q.exemplos),
      ].join('\n'),
  ]);
  const e = p.empresa;
  add('empresa', 'A EMPRESA', [
    linha('O que faz', e.oQueFaz),
    linha('Para quem vende', e.paraQuem),
    linha('Desde', e.desde),
    e.diferenciais.length > 0 &&
      [
        'Diferenciais:',
        ...e.diferenciais.map((d) => `- ${d.texto}${d.prova ? ` (prova: ${d.prova})` : ''}`),
      ].join('\n'),
    linha('Funcionamento', e.funcionamento),
  ]);
  const r = p.regiao;
  add('regiao', 'ONDE ATENDE', [
    r.todoBrasil
      ? 'Atende o Brasil todo.'
      : [
          r.ufs.length ? `Estados: ${r.ufs.join(', ')}.` : '',
          r.cidades.length ? `Cidades: ${r.cidades.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
    linha('Observação', r.observacao),
    !r.todoBrasil &&
      (r.ufs.length > 0 || r.cidades.length > 0) &&
      'Lugar que não está nesta lista: não diga que atende nem que não atende; passe para o time.',
  ]);
  const o = p.oferta;
  add('oferta', 'O QUE VENDE', [
    o.linhas.length > 0 &&
      ['Linhas:', ...o.linhas.map((l) => `- ${l.nome}${l.descricao ? `: ${l.descricao}` : ''}`)].join('\n'),
    o.naoFazemos.length > 0 &&
      ['O que NÃO fazemos (diga que não faz, sem rodeio):', ...itens(o.naoFazemos)].join('\n'),
    o.precoPolitica === 'nunca' && 'Preço: nunca fale valores. Qualquer pergunta de preço passa para o time.',
    o.precoPolitica === 'so_o_escrito' &&
      `Preço: só pode dizer isto, e nada além: ${o.precoTexto || '(nada)'}. Preço de item, desconto e condição especial: passe para o time.`,
    o.precoPolitica === 'tabela' &&
      `Preço: use só os valores da tabela que estiverem nas informações abaixo, dizendo que são da tabela.${o.precoTexto ? ` ${o.precoTexto}` : ''} Desconto e condição especial: passe para o time.`,
    linha('Pagamento', o.pagamento),
    linha('Prazos', o.prazos),
  ]);
  const ob = p.objetivo;
  add('objetivo', 'OBJETIVO DA CONVERSA', [
    ob.meta && `Objetivo: ${ROTULO_META[ob.meta].toLowerCase()}${ob.metaTexto ? ` (${ob.metaTexto})` : ''}.`,
    ob.perguntas.length > 0 &&
      [
        'Antes de avançar, descubra (uma pergunta por mensagem, sem interrogatório):',
        ...itens(ob.perguntas),
      ].join('\n'),
    ob.desqualifica.length > 0 &&
      ['Não vale seguir quando (encerre com educação):', ...itens(ob.desqualifica)].join('\n'),
  ]);
  add('objecoes', 'OBJEÇÕES (respostas aprovadas pela empresa: use a ideia, adapte as palavras à conversa)', [
    ...p.objecoes.itens.map((i) => `- Quando dizem "${i.diz}": ${i.resposta}`),
  ]);
  const li = p.limites;
  const gatilhos = [...li.gatilhos.map((g) => GATILHOS_PASSAGEM[g]), ...li.outrosGatilhos];
  add('limites', 'LIMITES', [
    [...li.nunca, ...li.daProva].length > 0 &&
      ['Nunca diga nem prometa:', ...itens([...li.nunca, ...li.daProva])].join('\n'),
    gatilhos.length > 0 &&
      ['Chame alguém do time (acao "passar_para_humano") quando:', ...itens(gatilhos)].join('\n'),
    li.fraseDePassagem &&
      `Ao passar, diga algo como: "${li.fraseDePassagem}" (adapte; não prometa prazo que não está aqui).`,
  ]);
  const re = p.reuniao;
  add('reuniao', 'REUNIÃO', [
    re.formato &&
      `Formato: ${re.formato === 'video' ? 'videochamada' : re.formato === 'presencial' ? 'presencial' : 'ligação'}${re.duracaoMin ? `, ${re.duracaoMin} minutos` : ''}.`,
    linha('Horários livres', re.horarios),
    linha('Quem participa', re.quemParticipa),
    linha('Link', re.link),
  ]);
  return b;
}

/** O texto do perfil para o prompt do agente (no lugar do "sobre a empresa" e das "regras"). */
export function textoDoPerfil(p: PerfilIa, empresa: string): string {
  return blocosDoPerfil(p, empresa)
    .map((x) => `${x.titulo}:\n${x.texto}`)
    .join('\n\n');
}

/** Fontes para a conferência: cada seção com o rótulo que a tela mostra. */
export function fontesDoPerfil(p: PerfilIa, empresa: string): FonteConferencia[] {
  return blocosDoPerfil(p, empresa)
    .filter((x) => x.secao !== 'quem')
    .map((x) => ({ rotulo: ROTULO_SECAO_IA[x.secao], texto: x.texto }));
}

/** Resumo em um parágrafo (o "sobre a empresa" que o e-mail e o resumo para o time usam). */
export function resumoDoPerfil(p: PerfilIa): string {
  const e = p.empresa;
  return [
    e.oQueFaz,
    e.paraQuem && `Para: ${e.paraQuem}.`,
    e.diferenciais.length ? `Diferenciais: ${e.diferenciais.map((d) => d.texto).join('; ')}.` : '',
    p.regiao.todoBrasil
      ? 'Atende o Brasil todo.'
      : p.regiao.ufs.length
        ? `Atende: ${p.regiao.ufs.join(', ')}.`
        : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2000);
}

/* ───────────── Conferência frase a frase ───────────── */

export interface FraseConferidaIa {
  frase: string;
  tipo: 'fato' | 'cordialidade' | 'pergunta';
  fonte: string | null;
  trecho: string | null;
}

const ESQUEMA_CONFERENCIA: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    frases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          frase: { type: 'STRING' },
          tipo: { type: 'STRING', enum: ['fato', 'cordialidade', 'pergunta'] },
          fonte: { type: 'STRING', nullable: true },
          trecho: { type: 'STRING', nullable: true },
        },
        required: ['frase', 'tipo'],
      },
    },
  },
  required: ['frases'],
};

export function promptConferencia(resposta: string, fontes: FonteConferencia[]): string {
  return [
    'Você confere uma mensagem de WhatsApp de uma empresa ANTES de ela ser enviada a um cliente. Seu trabalho é achar afirmações sem base.',
    'Divida a mensagem em frases (ou partes de frase com uma afirmação cada) e classifique cada uma:',
    '- "cordialidade": saudação, agradecimento, empatia, sem nenhuma informação ("Que bom!", "Entendo").',
    '- "pergunta": pergunta ao cliente que não afirma nada sobre a empresa.',
    '- "fato": qualquer afirmação sobre a empresa, produtos, marcas, preços, descontos, prazos, pagamento, região, horários, pessoas, clientes, ou qualquer promessa/compromisso ("te mando hoje", "consigo 10%").',
    'Para cada "fato", procure nas FONTES o trecho que diz A MESMA COISA. Copie o trecho exatamente como está na fonte (até 200 caracteres) e o rótulo da fonte.',
    'Seja rigoroso: parecido não vale, números precisam bater, "sob encomenda" não é "em estoque". Promessa de retorno do time ("vou confirmar com o time") é cordialidade.',
    'Se nenhuma fonte sustenta o fato, "fonte" e "trecho" ficam null.',
    'Responda só o JSON pedido.',
    '',
    'FONTES:',
    ...fontes.map((f, i) => `[${i + 1}] ${f.rotulo}:\n${f.texto.slice(0, 6000)}`),
    '',
    'MENSAGEM A CONFERIR:',
    resposta,
  ].join('\n');
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** O trecho citado está mesmo na fonte? (a IA às vezes "cita" o que não está escrito). */
export function trechoNaFonte(trecho: string, fonte: string): boolean {
  const t = normalizar(trecho);
  if (t.length < 4) return false;
  const f = normalizar(fonte);
  if (f.includes(t)) return true;
  // Citação um pouco reescrita: todo número precisa estar na fonte, e 80% das palavras (de 3+ letras).
  const tokensFonte = new Set(f.split(' '));
  const numeros = t.split(' ').filter((p) => /\d/.test(p));
  if (numeros.some((n) => !tokensFonte.has(n))) return false;
  const palavras = t.split(' ').filter((p) => p.length >= 3 && !/\d/.test(p));
  if (palavras.length < 3) return false;
  const achadas = palavras.filter((p) => tokensFonte.has(p)).length;
  return achadas / palavras.length >= 0.8;
}

export function lerConferencia(bruto: string, fontes: FonteConferencia[]): FraseConferidaIa[] | null {
  let j: { frases?: unknown };
  try {
    j = JSON.parse(bruto) as { frases?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(j.frases)) return null;
  const porRotulo = new Map(fontes.map((f) => [normalizar(f.rotulo), f]));
  return j.frases.slice(0, 30).map((x: Record<string, unknown>) => {
    const tipo = (['fato', 'cordialidade', 'pergunta'] as const).includes(x.tipo as 'fato')
      ? (x.tipo as FraseConferidaIa['tipo'])
      : 'fato';
    const frase = String(x.frase ?? '').slice(0, 400);
    let fonte = x.fonte ? String(x.fonte) : null;
    let trecho = x.trecho ? String(x.trecho).slice(0, 300) : null;
    if (tipo === 'fato') {
      // Rótulo pode vir como "[2] O que vende" ou só o número.
      const alvo =
        (fonte &&
          (porRotulo.get(normalizar(fonte.replace(/^\[?\d+\]?\s*/, ''))) ??
            fontes[Number(/\d+/.exec(fonte)?.[0]) - 1])) ||
        null;
      if (!alvo || !trecho || !trechoNaFonte(trecho, alvo.texto)) {
        fonte = null;
        trecho = null;
      } else fonte = alvo.rotulo;
    }
    return { frase, tipo, fonte, trecho };
  });
}

/** Confere cada frase da resposta contra as fontes. null: a conferência falhou (quem chama decide). */
export async function conferirFatos(
  cfg: ConfigIa,
  e: { resposta: string; fontes: FonteConferencia[] },
): Promise<FraseConferidaIa[] | null> {
  const texto = await gerarJson(cfg, {
    prompt: promptConferencia(e.resposta, e.fontes),
    esquema: ESQUEMA_CONFERENCIA,
    temperatura: 0,
    timeoutMs: 30_000,
    maxTokens: 1200,
  });
  return lerConferencia(texto, e.fontes);
}

/** Frases de fato sem fonte, como problema para a reescrita. */
export function semFonte(frases: FraseConferidaIa[]): string[] {
  return frases.filter((f) => f.tipo === 'fato' && !f.fonte).map((f) => f.frase);
}

/* ───────────── Sugestões para o perfil ───────────── */

/** Campos que a IA pode sugerir, por seção (os de lista viram um item por sugestão). */
export const CAMPOS_SUGERIVEIS: Record<SecaoIa, Record<string, 'texto' | 'lista' | 'par'>> = {
  quem: { apresentacao: 'texto', exemplos: 'lista' },
  empresa: {
    oQueFaz: 'texto',
    paraQuem: 'texto',
    desde: 'texto',
    diferenciais: 'par',
    funcionamento: 'texto',
  },
  regiao: { ufs: 'lista', cidades: 'lista', observacao: 'texto' },
  oferta: { linhas: 'par', naoFazemos: 'lista', precoTexto: 'texto', pagamento: 'texto', prazos: 'texto' },
  objetivo: { perguntas: 'lista', desqualifica: 'lista' },
  objecoes: { itens: 'par' },
  limites: { nunca: 'lista' },
  reuniao: { horarios: 'texto', quemParticipa: 'texto', link: 'texto' },
};

export interface SugestaoPerfil {
  secao: SecaoIa;
  campo: string;
  valor: string | { a: string; b: string };
  trecho: string;
}

const ESQUEMA_SUGESTOES: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    sugestoes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          secao: { type: 'STRING' },
          campo: { type: 'STRING' },
          valor: { type: 'STRING' },
          complemento: { type: 'STRING', nullable: true },
          trecho: { type: 'STRING' },
        },
        required: ['secao', 'campo', 'valor', 'trecho'],
      },
    },
  },
  required: ['sugestoes'],
};

export function promptSugestoes(e: {
  empresa: string;
  perfilAtual: string;
  fonte: { tipo: string; rotulo: string; texto: string };
}): string {
  const campos = Object.entries(CAMPOS_SUGERIVEIS)
    .map(
      ([s, c]) =>
        `- ${s}: ${Object.entries(c)
          .map(
            ([k, t]) =>
              `${k} (${t === 'par' ? 'item com valor + complemento' : t === 'lista' ? 'um item por sugestão' : 'texto'})`,
          )
          .join(', ')}`,
    )
    .join('\n');
  return [
    `Você ajuda a ${e.empresa} a configurar a assistente de atendimento do WhatsApp. Leia a FONTE e sugira conteúdo para os campos abaixo.`,
    'Regras, sem exceção:',
    '- Use SÓ o que está escrito na fonte. Nada de deduzir, completar ou melhorar números, nomes, prazos ou preços.',
    '- Cada sugestão traz "trecho": a frase da fonte que a sustenta, copiada exatamente (até 250 caracteres).',
    '- Não repita o que o perfil atual já tem. Prefira campos vazios.',
    '- "par": diferenciais → valor = o diferencial, complemento = a prova; linhas → valor = nome, complemento = descrição; objecoes.itens → valor = o que o cliente diz, complemento = a resposta que a empresa usou.',
    '- quem.exemplos: só mensagens REAIS escritas pela equipe da empresa, copiadas como estão (para imitar o estilo). Nunca invente.',
    '- regiao.ufs: sigla de 2 letras. Uma sugestão por estado ou cidade.',
    '- Escreva em português do Brasil, frases curtas. No máximo 25 sugestões.',
    '',
    'CAMPOS (secao: campo):',
    campos,
    '',
    'PERFIL ATUAL (o que já está preenchido):',
    e.perfilAtual || '(vazio)',
    '',
    `FONTE (${e.fonte.tipo}: ${e.fonte.rotulo}):`,
    e.fonte.texto.slice(0, 40_000),
    '',
    'Responda em JSON com "sugestoes".',
  ].join('\n');
}

export function lerSugestoes(bruto: string, fonteTexto: string): SugestaoPerfil[] {
  let j: { sugestoes?: unknown };
  try {
    j = JSON.parse(bruto) as { sugestoes?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(j.sugestoes)) return [];
  const saida: SugestaoPerfil[] = [];
  for (const x of j.sugestoes.slice(0, 40) as Record<string, unknown>[]) {
    const secao = String(x.secao ?? '') as SecaoIa;
    const campo = String(x.campo ?? '');
    const tipo = CAMPOS_SUGERIVEIS[secao]?.[campo];
    if (!tipo) continue;
    const valor = String(x.valor ?? '')
      .trim()
      .slice(0, 800);
    const trecho = String(x.trecho ?? '')
      .trim()
      .slice(0, 300);
    if (!valor || !trecho || !trechoNaFonte(trecho, fonteTexto)) continue;
    if (secao === 'regiao' && campo === 'ufs' && !/^[A-Za-z]{2}$/.test(valor)) continue;
    if (tipo === 'par') {
      const b = String(x.complemento ?? '')
        .trim()
        .slice(0, 800);
      // Objeção sem resposta não serve; diferencial e linha podem vir sem complemento.
      if (secao === 'objecoes' && !b) continue;
      saida.push({ secao, campo, valor: { a: valor, b }, trecho });
    } else
      saida.push({
        secao,
        campo,
        valor: secao === 'regiao' && campo === 'ufs' ? valor.toUpperCase() : valor,
        trecho,
      });
  }
  return saida.slice(0, 25);
}

export async function sugerirPerfil(
  cfg: ConfigIa,
  e: { empresa: string; perfilAtual: string; fonte: { tipo: string; rotulo: string; texto: string } },
): Promise<SugestaoPerfil[]> {
  const texto = await gerarJson(cfg, {
    prompt: promptSugestoes(e),
    esquema: ESQUEMA_SUGESTOES,
    temperatura: 0.2,
    timeoutMs: 90_000,
    maxTokens: 4000,
  });
  return lerSugestoes(texto, e.fonte.texto);
}

/** Perguntas da entrevista: o que falta, em linguagem de gente. */
export function perguntasDaEntrevista(faltando: { secao: SecaoIa; itens: string[] }[]): string[] {
  const p: string[] = [];
  const mapa: Record<string, string> = {
    'Como se apresenta': 'Como a assistente deve se apresentar na primeira mensagem?',
    'O que a empresa faz (pelo menos uma frase completa)': 'Em poucas frases: o que a empresa faz?',
    'Para quem vende': 'Para quem vocês vendem (tipo de cliente, porte, ramo)?',
    'Pelo menos 2 diferenciais':
      'Por que um cliente escolhe vocês e não outro? Tem como provar (número, tempo, garantia)?',
    'Horário de funcionamento': 'Qual o horário de funcionamento?',
    'Onde atende (Brasil todo, estados ou cidades)': 'Em quais estados ou cidades vocês atendem?',
    'Pelo menos uma linha de produto ou serviço': 'Quais produtos ou serviços vocês vendem?',
    'Pelo menos uma coisa que vocês não fazem': 'O que os clientes às vezes pedem e vocês NÃO fazem?',
    'O que pode ser dito sobre preço': 'O que a assistente pode dizer sobre preço (pedido mínimo, faixa)?',
    'Condições de pagamento': 'Quais as formas e prazos de pagamento?',
    'Prazos de entrega ou de início': 'Qual o prazo de entrega (ou para começar o serviço)?',
    'Pelo menos uma pergunta de qualificação': 'O que você precisa saber do cliente antes de uma reunião?',
    'Pelo menos 3 objeções com resposta aprovada':
      'Quais as 3 objeções que vocês mais ouvem, e o que vocês respondem para cada uma?',
    'Pelo menos uma coisa que ela nunca pode dizer': 'O que a assistente nunca pode dizer ou prometer?',
    'Horários livres': 'Em que dias e horários dá para marcar reunião?',
  };
  for (const s of faltando) for (const i of s.itens) if (mapa[i]) p.push(mapa[i]);
  return p.slice(0, 15);
}
