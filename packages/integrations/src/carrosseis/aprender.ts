/**
 * O time aprende com os números de cada post (v134). Tudo aqui é conta, sem IA: cada post feito no
 * CRM tem o seu DNA (o que ele é); os números do Instagram (alcance, salvos, compartilhamentos) e o que
 * só o CRM sabe (os leads que vieram do post) entram, e cada característica é comparada com a mediana
 * da própria conta, com peso maior para leads. Com poucos posts, diz "ainda testando": não inventa
 * certeza. O que a pessoa sempre muda no editor também ensina (títulos mais curtos, por exemplo).
 */

/** Um post com o DNA (o que ele é) e os números. */
export interface PostParaAprender {
  tipo: 'carrossel' | 'video' | 'outro';
  /** Do DNA (null nos posts que não saíram do CRM). */
  modelos: string[] | null;
  slides: number | null;
  estilo: string | null;
  chamada: string | null;
  fotos: number | null;
  fotosIa: number | null;
  objetivo: string | null;
  /** Dia da semana (0 = domingo) e hora, no horário de Brasília. */
  diaSemana: number | null;
  hora: number | null;
  alcance: number | null;
  salvos: number | null;
  compartilhamentos: number | null;
  interacoes: number | null;
  leads: number;
}

export type Confianca = 'testando' | 'media' | 'alta';
export type MetricaAprendida = 'leads' | 'salvos' | 'alcance' | 'compartilhamentos';

export interface Aprendizado {
  id: string;
  rotulo: string;
  metrica: MetricaAprendida;
  /** Quantas vezes a mediana da conta (2,1 = 2,1× mais). */
  vezes: number;
  posts: number;
  confianca: Confianca;
  /** O time evita (rendeu menos que a mediana). */
  evita: boolean;
}

/** As características que valem comparar (cada uma diz se o post tem ou não). */
const CARACTERISTICAS: { id: string; rotulo: string; tem: (p: PostParaAprender) => boolean | null }[] = [
  {
    id: 'lista',
    rotulo: 'Lista e passo a passo',
    tem: (p) => (p.modelos ? p.modelos.some((m) => m === 'lista' || m === 'item') : null),
  },
  {
    id: 'comentar',
    rotulo: 'Chamada “comente a palavra”',
    tem: (p) => (p.chamada == null ? null : p.chamada === 'comentar' || p.chamada === 'comente'),
  },
  {
    id: 'foto_real',
    rotulo: 'Foto real da empresa',
    tem: (p) => (p.fotos == null ? null : p.fotos > 0 && (p.fotosIa ?? 0) < p.fotos),
  },
  { id: 'imagem_ia', rotulo: 'Imagem feita pela IA', tem: (p) => (p.fotosIa == null ? null : p.fotosIa > 0) },
  { id: 'muitos_slides', rotulo: 'Mais de 8 slides', tem: (p) => (p.slides == null ? null : p.slides > 8) },
  { id: 'poucos_slides', rotulo: 'Até 6 slides', tem: (p) => (p.slides == null ? null : p.slides <= 6) },
  {
    id: 'numero',
    rotulo: 'Número grande ou comparação',
    tem: (p) => (p.modelos ? p.modelos.some((m) => m === 'numero' || m === 'comparacao') : null),
  },
  {
    id: 'vender',
    rotulo: 'Carrossel para vender',
    tem: (p) => (p.objetivo == null ? null : p.objetivo === 'vender'),
  },
  { id: 'reels', rotulo: 'Reels', tem: (p) => (p.tipo === 'outro' ? null : p.tipo === 'video') },
];

const mediana = (v: number[]): number | null => {
  const x = v.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!x.length) return null;
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m]! : (x[m - 1]! + x[m]!) / 2;
};

const confianca = (n: number): Confianca => (n >= 10 ? 'alta' : n >= 4 ? 'media' : 'testando');

/** Mínimo de posts com a característica para dizer algo (com menos, nem aparece). */
export const MIN_POSTS_APRENDER = 3;

/**
 * Compara cada característica com a mediana da conta. Usa leads quando a conta já tem leads vindos
 * dos posts (peso maior); senão, salvos; senão, alcance. Devolve os mais fortes primeiro.
 */
export function aprendizados(posts: PostParaAprender[]): Aprendizado[] {
  const doCrm = posts.filter((p) => p.modelos || p.tipo === 'video');
  const temLeads = posts.some((p) => p.leads > 0);
  const metricas: MetricaAprendida[] = temLeads
    ? ['leads', 'salvos', 'alcance']
    : ['salvos', 'compartilhamentos', 'alcance'];
  const valor = (p: PostParaAprender, m: MetricaAprendida) =>
    m === 'leads'
      ? p.leads
      : ((m === 'salvos' ? p.salvos : m === 'alcance' ? p.alcance : p.compartilhamentos) ?? NaN);
  const base = Object.fromEntries(metricas.map((m) => [m, mediana(posts.map((p) => valor(p, m)))])) as Record<
    MetricaAprendida,
    number | null
  >;
  const saida: Aprendizado[] = [];
  for (const c of CARACTERISTICAS) {
    const com = (c.id === 'reels' ? posts : doCrm).filter((p) => c.tem(p) === true);
    if (com.length < MIN_POSTS_APRENDER) continue;
    // A métrica que mais diz sobre a característica, comparada com a mediana da conta.
    let melhor: { m: MetricaAprendida; vezes: number } | null = null;
    for (const m of metricas) {
      const b = base[m];
      const v = mediana(com.map((p) => valor(p, m)));
      if (b == null || v == null || b <= 0) continue;
      const vezes = v / b;
      const peso = m === 'leads' ? 1.5 : 1;
      if (
        !melhor ||
        Math.abs(Math.log(vezes)) * peso > Math.abs(Math.log(melhor.vezes)) * (melhor.m === 'leads' ? 1.5 : 1)
      )
        melhor = { m, vezes };
    }
    if (!melhor || Math.abs(melhor.vezes - 1) < 0.2) continue;
    saida.push({
      id: c.id,
      rotulo: c.rotulo,
      metrica: melhor.m,
      vezes: Math.round(melhor.vezes * 10) / 10,
      posts: com.length,
      confianca: confianca(com.length),
      evita: melhor.vezes < 0.8,
    });
  }
  return saida.sort((a, b) => Math.abs(Math.log(b.vezes)) - Math.abs(Math.log(a.vezes))).slice(0, 6);
}

const NOME_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * O melhor horário pelo que já foi postado: a taxa de interação (interações por alcance) por dia da
 * semana e faixa de 2 horas. Precisa de pelo menos 8 posts com números; os dois melhores dias e a
 * melhor faixa.
 */
export function melhorHorario(posts: PostParaAprender[]): { texto: string; posts: number } | null {
  const com = posts.filter(
    (p) => p.diaSemana != null && p.hora != null && (p.alcance ?? 0) > 0 && p.interacoes != null,
  );
  if (com.length < 8) return null;
  const taxa = (p: PostParaAprender) => (p.interacoes ?? 0) / (p.alcance || 1);
  const porDia = new Map<number, number[]>();
  const porFaixa = new Map<number, number[]>();
  for (const p of com) {
    porDia.set(p.diaSemana!, [...(porDia.get(p.diaSemana!) ?? []), taxa(p)]);
    const f = Math.floor(p.hora! / 2) * 2;
    porFaixa.set(f, [...(porFaixa.get(f) ?? []), taxa(p)]);
  }
  const dias = [...porDia.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([d, v]) => ({ d, m: mediana(v)! }))
    .sort((a, b) => b.m - a.m)
    .slice(0, 2)
    .map((x) => x.d)
    .sort((a, b) => a - b);
  const faixa = [...porFaixa.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([f, v]) => ({ f, m: mediana(v)! }))
    .sort((a, b) => b.m - a.m)[0];
  if (!dias.length || !faixa) return null;
  return {
    texto: `${dias.map((d) => NOME_DIA[d]).join(' e ')}, ${faixa.f}h a ${faixa.f + 2}h`,
    posts: com.length,
  };
}

/** O carrossel como o time fez e como a pessoa publicou (os títulos e textos dos slides). */
export interface ParDeEdicao {
  doTime: { titulo: string; texto: string }[];
  final: { titulo: string; texto: string }[];
}

/**
 * O que a pessoa sempre muda no editor vira preferência do redator: só quando ela mexeu em pelo menos
 * 3 carrosséis do time e o mesmo tipo de mudança aparece em 60% deles.
 */
export function preferenciasDasEdicoes(pares: ParDeEdicao[]): { texto: string; de: number; em: number }[] {
  const tamanho = (l: { titulo: string; texto: string }[], k: 'titulo' | 'texto') =>
    l.reduce((s, x) => s + x[k].trim().length, 0);
  const mexidos = pares.filter(
    (p) => JSON.stringify(p.doTime) !== JSON.stringify(p.final) && p.doTime.length && p.final.length,
  );
  if (mexidos.length < 3) return [];
  const saida: { texto: string; de: number; em: number }[] = [];
  const contar = (k: 'titulo' | 'texto', menor: boolean) =>
    mexidos.filter((p) => {
      const a = tamanho(p.doTime, k);
      const b = tamanho(p.final, k);
      return a > 0 && (menor ? b <= a * 0.85 : b >= a * 1.15);
    }).length;
  const regras: { k: 'titulo' | 'texto'; menor: boolean; texto: string }[] = [
    {
      k: 'titulo',
      menor: true,
      texto: 'Quem publica costuma encurtar os títulos do time: escreva títulos mais curtos.',
    },
    {
      k: 'texto',
      menor: true,
      texto: 'Quem publica costuma cortar o texto dos slides: escreva menos em cada slide.',
    },
    {
      k: 'titulo',
      menor: false,
      texto: 'Quem publica costuma completar os títulos: pode explicar um pouco mais no título.',
    },
  ];
  for (const r of regras) {
    const n = contar(r.k, r.menor);
    if (n / mexidos.length >= 0.6) saida.push({ texto: r.texto, de: n, em: mexidos.length });
  }
  return saida;
}

const VEZES = (v: number) => `${String(v).replace('.', ',')}×`;
const ROTULO_METRICA: Record<MetricaAprendida, string> = {
  leads: 'leads',
  salvos: 'salvos',
  alcance: 'alcance',
  compartilhamentos: 'compartilhamentos',
};

/** Uma linha para a tela e para o estrategista: "Lista e passo a passo: 2,1× salvos · 6 posts". */
export function linhaDoAprendizado(a: Aprendizado): string {
  const conf =
    a.confianca === 'testando' ? 'ainda testando' : a.evita ? 'o time evita' : `confiança ${a.confianca}`;
  return `${a.rotulo}: ${VEZES(a.vezes)} ${ROTULO_METRICA[a.metrica]} · ${a.posts} posts · ${conf}`;
}

/**
 * Quando é a vez de testar algo novo (2 de cada 10 carrosséis do time): o 5º e o 10º de cada dez.
 * O teste é o formato que a conta ainda usou pouco, para o time não ficar preso no que já sabe.
 */
export function vezDeTestar(numeroDoCarrossel: number): boolean {
  const n = numeroDoCarrossel % 10;
  return n === 5 || n === 0;
}

export const TESTES_POSSIVEIS = [
  { id: 'lista', texto: 'Teste um carrossel de lista ou passo a passo (modelos "lista" ou "item").' },
  {
    id: 'numero',
    texto: 'Teste um carrossel guiado por um número grande ou uma comparação (antes e depois).',
  },
  { id: 'foto_real', texto: 'Teste um carrossel com as fotos reais da empresa (bastidores, equipe, loja).' },
  { id: 'poucos_slides', texto: 'Teste um carrossel curto: 5 slides, uma ideia forte.' },
  { id: 'comentar', texto: 'Teste a chamada "comente a palavra" com um material útil no direct.' },
] as const;

/** O teste da vez: o formato com menos posts na conta (o que ainda não se sabe). */
export function testeDaVez(posts: PostParaAprender[]): string {
  const doCrm = posts.filter((p) => p.modelos);
  const contagem = TESTES_POSSIVEIS.map((t) => {
    const c = CARACTERISTICAS.find((x) => x.id === t.id)!;
    return { t, n: doCrm.filter((p) => c.tem(p) === true).length };
  }).sort((a, b) => a.n - b.n);
  return contagem[0]!.t.texto;
}
