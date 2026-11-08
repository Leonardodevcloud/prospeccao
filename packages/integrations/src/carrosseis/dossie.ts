import { type DossieMarca, dossieCompleto, textoDoDossie } from '@prospeccao/shared/carrosseis-time';
import type { ClienteClaude, UsoClaude } from './claude.js';
import type { PostQueFuncionou } from './time.js';

/**
 * O cérebro da marca: um rascunho do dossiê montado com o que o CRM já sabe da empresa. O
 * administrador lê, corrige e confere; só o conferido vale para o time de IA.
 *
 * O que vai para a IA é o da própria conta (como em todas as funções de IA do CRM). Mensagens e
 * comentários de clientes entram sem telefone, e-mail, documento nem endereço de site, e a IA
 * devolve só padrões ("quando trocar a pastilha"), nunca o que uma pessoa disse.
 */

export interface FontesDoDossie {
  empresa: string;
  /** O dossiê como está (o rascunho novo melhora, não apaga o que a pessoa escreveu). */
  atual: DossieMarca;
  perfilIa: string | null;
  conhecimento: { titulo: string; texto: string }[];
  site: { url: string; texto: string } | null;
  nichos: string[];
  posts: PostQueFuncionou[];
  comentarios: { texto: string; interesse: string | null }[];
  mensagens: string[];
  quadros: { quadro: string; coluna: string; leads: number }[];
  ligacoes: string[];
  reunioes: string[];
}

/** Telefone, e-mail, CPF/CNPJ e endereços de site saem antes de qualquer texto de cliente ir para a IA. */
export function semDadosPessoais(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[site]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quantos itens de cada fonte foram lidos (a tela mostra "de onde veio"). */
export function resumoDasFontes(f: FontesDoDossie): { rotulo: string; quantos: number }[] {
  return [
    { rotulo: 'Configuração da IA de atendimento', quantos: f.perfilIa ? 1 : 0 },
    { rotulo: 'Base de conhecimento', quantos: f.conhecimento.length },
    { rotulo: 'Site da empresa', quantos: f.site ? 1 : 0 },
    { rotulo: 'Posts do Instagram', quantos: f.posts.length },
    { rotulo: 'Comentários com interesse', quantos: f.comentarios.length },
    { rotulo: 'Mensagens de clientes', quantos: f.mensagens.length },
    { rotulo: 'Quadros', quantos: f.quadros.length },
    { rotulo: 'Resumos de ligações', quantos: f.ligacoes.length },
    { rotulo: 'Resumos de reuniões', quantos: f.reunioes.length },
  ];
}

const ESQUEMA_DOSSIE = {
  type: 'object',
  properties: {
    nicho: { type: 'string', description: 'O nicho em poucas palavras (até 160 letras).' },
    publico: { type: 'string', description: 'Para quem a empresa vende, concreto (até 600 letras).' },
    oQueVende: { type: 'string', description: 'O que vende, com as linhas principais (até 900 letras).' },
    diferenciais: { type: 'array', items: { type: 'string' } },
    dores: { type: 'array', items: { type: 'string' } },
    desejos: { type: 'array', items: { type: 'string' } },
    objecoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { diz: { type: 'string' }, resposta: { type: 'string' } },
        required: ['diz', 'resposta'],
      },
    },
    provas: {
      type: 'array',
      description:
        'Só fatos escritos nas fontes (número, prazo, garantia, tempo de mercado), com o rótulo da fonte.',
      items: {
        type: 'object',
        properties: { texto: { type: 'string' }, fonte: { type: 'string' } },
        required: ['texto', 'fonte'],
      },
    },
    perguntas: {
      type: 'array',
      description: 'O que os clientes mais perguntam, agrupado, com quantas vezes apareceu nas amostras.',
      items: {
        type: 'object',
        properties: {
          texto: { type: 'string' },
          vezes: { type: ['integer', 'null'] },
          fonte: { type: 'string', description: 'Conversas, Comentários, Ligações, Reuniões ou Quadros.' },
        },
        required: ['texto', 'fonte'],
      },
    },
    tom: { type: 'string', description: 'O tom de voz em uma ou duas frases.' },
    palavras: { type: 'array', items: { type: 'string' } },
    nuncaDizer: { type: 'array', items: { type: 'string' } },
    pilares: { type: 'array', description: 'De 3 a 6 assuntos para os posts.', items: { type: 'string' } },
  },
  required: ['nicho', 'publico', 'oQueVende', 'tom', 'pilares'],
};

function mensagem(f: FontesDoDossie): string {
  const bloco = (titulo: string, linhas: string[], max = 60) =>
    linhas.length
      ? `${titulo}:\n${linhas
          .slice(0, max)
          .map((l) => `- ${l}`)
          .join('\n')}`
      : '';
  return [
    `Você monta o CÉREBRO DA MARCA da ${f.empresa}: o dossiê que o time de conteúdo lê antes de criar qualquer carrossel do Instagram. Um administrador da empresa vai conferir cada linha.`,
    '',
    'COMO FAZER',
    '- Use só o que está nas fontes abaixo. Não invente diferencial, número, prazo ou garantia.',
    '- "provas": só fatos escritos nas fontes, com o rótulo da fonte entre os colchetes dela (ex.: "Configuração da IA", "Site", "Base de conhecimento").',
    '- "perguntas": agrupe o que os clientes perguntam de verdade nas mensagens, comentários, ligações e reuniões; conte quantas vezes cada grupo aparece nas amostras. Escreva a pergunta como o cliente falaria, sem dado de nenhuma pessoa.',
    '- "dores", "desejos" e "objeções": tire das conversas, dos quadros e das objeções já cadastradas.',
    '- "tom": como a empresa fala (pelas mensagens do time, pelo site e pela configuração).',
    '- "pilares": de 3 a 6 assuntos que o cliente quer ler e que a empresa pode falar com autoridade.',
    '- O DOSSIÊ ATUAL foi escrito ou corrigido por uma pessoa: mantenha o que está lá e só complete ou melhore.',
    '- Português do Brasil, frases curtas.',
    '',
    `DOSSIÊ ATUAL:\n${textoDoDossie(f.atual, f.empresa)}`,
    '',
    f.perfilIa ? `[Configuração da IA] (conferida pela empresa):\n${f.perfilIa.slice(0, 12_000)}` : '',
    bloco(
      '[Base de conhecimento]',
      f.conhecimento.map((k) => `${k.titulo}: ${k.texto.replace(/\s+/g, ' ').slice(0, 700)}`),
      25,
    ),
    f.site ? `[Site] (${f.site.url}):\n${f.site.texto.slice(0, 10_000)}` : '',
    f.nichos.length ? `NICHOS QUE A EMPRESA PROSPECTA: ${f.nichos.join(', ')}` : '',
    bloco(
      '[Posts do Instagram] (com os números)',
      f.posts.map(
        (p) =>
          `[${p.tipo}] alcance ${p.alcance}, ${p.salvos} salvos, ${p.compartilhamentos} compart., ${p.leads} leads: ${p.legenda.replace(/\s+/g, ' ').slice(0, 300)}`,
      ),
      30,
    ),
    bloco(
      '[Comentários] (com interesse)',
      f.comentarios.map(
        (c) => `${c.interesse ? `(${c.interesse}) ` : ''}${semDadosPessoais(c.texto).slice(0, 200)}`,
      ),
      80,
    ),
    bloco(
      '[Conversas] (mensagens de clientes, amostra)',
      f.mensagens.map((m) => semDadosPessoais(m).slice(0, 240)),
      150,
    ),
    bloco(
      '[Quadros] (colunas dos quadros e quantos leads estão em cada uma)',
      f.quadros.map((q) => `${q.quadro} › ${q.coluna}: ${q.leads}`),
      40,
    ),
    bloco(
      '[Ligações] (resumos)',
      f.ligacoes.map((l) => semDadosPessoais(l).slice(0, 400)),
      30,
    ),
    bloco(
      '[Reuniões] (resumos)',
      f.reunioes.map((l) => semDadosPessoais(l).slice(0, 500)),
      20,
    ),
  ]
    .filter((x) => x !== '')
    .join('\n\n');
}

const textos = (v: unknown, max: number, n: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) =>
      String(x ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max),
    )
    .filter(Boolean)
    .slice(0, n);

/** O rascunho do dossiê (validado e cortado no tamanho de cada campo). */
export async function montarDossie(
  claude: ClienteClaude,
  f: FontesDoDossie,
): Promise<{ dossie: DossieMarca; uso: UsoClaude; custoUsd: number }> {
  const r = await claude.pedir({
    agente: 'cerebro',
    sistema: [
      {
        texto:
          'Você é o estrategista de conteúdo de uma agência. Monta dossiês de marca precisos, concretos e sem inventar nada.',
      },
    ],
    mensagem: mensagem(f),
    ferramenta: { nome: 'dossie', descricao: 'O dossiê da marca.', esquema: ESQUEMA_DOSSIE },
    maxTokens: 6000,
    temperatura: 0.3,
    timeoutMs: 180_000,
  });
  const d = r.dados;
  const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const dossie = dossieCompleto({
    nicho: String(d.nicho ?? '').slice(0, 160),
    publico: String(d.publico ?? '').slice(0, 600),
    oQueVende: String(d.oQueVende ?? '').slice(0, 900),
    diferenciais: textos(d.diferenciais, 220, 8),
    dores: textos(d.dores, 220, 8),
    desejos: textos(d.desejos, 220, 8),
    objecoes: lista(d.objecoes)
      .map((o) => ({
        diz: String(o.diz ?? '').slice(0, 180),
        resposta: String(o.resposta ?? '').slice(0, 320),
      }))
      .filter((o) => o.diz.trim() && o.resposta.trim())
      .slice(0, 8),
    provas: lista(d.provas)
      .map((p) => ({
        texto: String(p.texto ?? '').slice(0, 260),
        fonte: String(p.fonte ?? 'Fonte').slice(0, 80),
      }))
      .filter((p) => p.texto.trim())
      .slice(0, 12),
    perguntas: lista(d.perguntas)
      .map((p) => ({
        texto: semDadosPessoais(String(p.texto ?? '')).slice(0, 220),
        vezes: Number.isFinite(Number(p.vezes)) && Number(p.vezes) > 0 ? Math.round(Number(p.vezes)) : null,
        fonte: String(p.fonte ?? 'Conversas').slice(0, 60),
      }))
      .filter((p) => p.texto.trim())
      .slice(0, 12),
    tom: String(d.tom ?? '').slice(0, 500),
    palavras: textos(d.palavras, 50, 15),
    nuncaDizer: textos(d.nuncaDizer, 180, 15),
    pilares: textos(d.pilares, 50, 6),
  });
  // O que a pessoa escreveu não some: campo vazio no rascunho fica com o que já estava.
  const atual = f.atual;
  const junto: DossieMarca = { ...dossie };
  for (const k of Object.keys(atual) as (keyof DossieMarca)[]) {
    const novo = dossie[k];
    const vazio = Array.isArray(novo) ? novo.length === 0 : !String(novo ?? '').trim();
    if (vazio) (junto as Record<string, unknown>)[k] = atual[k];
  }
  return { dossie: junto, uso: r.uso, custoUsd: r.custoUsd };
}
