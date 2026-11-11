import {
  CHAMADAS_FINAIS,
  type ChamadaFinal,
  OBJETIVOS_CARROSSEL,
  type ObjetivoCarrossel,
} from '@prospeccao/shared/carrosseis-time';
import { type ClienteClaude, USO_ZERO, type UsoClaude } from './claude.js';
import type { PostQueFuncionou } from './time.js';
import { sistemaDoTime } from './time.js';

/**
 * As ideias do time (v134): o estrategista propõe as próximas 2 semanas de carrosséis a partir do que
 * a empresa quer divulgar, do que os clientes perguntam, das objeções, do que funcionou nos posts,
 * do que o time aprendeu e das contas de referência. Cada ideia mostra de onde veio, com a evidência;
 * número que não está na fonte derruba a linha (a ideia sem nenhuma fonte que preste sai). Duas de
 * cada dez são testes (algo que a conta ainda não tentou).
 */

export const FONTES_DAS_IDEIAS = [
  'CAMPANHA',
  'CONVERSAS',
  'OBJEÇÕES',
  'INSTAGRAM',
  'LIGAÇÕES',
  'REFERÊNCIAS',
  'APRENDIDO',
  'SEGUNDO CÉREBRO',
  'TESTE',
] as const;
export type FonteDaIdeia = (typeof FONTES_DAS_IDEIAS)[number];

export interface EntradaIdeias {
  empresa: string;
  dossieTexto: string;
  postsQueFuncionaram: PostQueFuncionou[];
  anteriores: string[];
  hoje: string;
  /** O texto de cada fonte (o que a IA pode citar), pelo rótulo. Fonte vazia não entra. */
  fontes: Partial<Record<FonteDaIdeia, string>>;
  /** O teste da vez (o formato que a conta usou pouco). */
  teste: string;
  quantas?: number;
}

export interface IdeiaDoTime {
  titulo: string;
  gancho: string;
  formato: string;
  objetivo: ObjetivoCarrossel;
  slides: number | null;
  chamada: ChamadaFinal;
  teste: boolean;
  fontes: { rotulo: FonteDaIdeia; texto: string }[];
}

const ESQUEMA_IDEIAS = {
  type: 'object',
  properties: {
    ideias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'A ideia do carrossel em uma frase (até 90 letras).' },
          gancho: { type: 'string', description: 'O gancho da capa, como vai no slide (até 90 letras).' },
          formato: {
            type: 'string',
            description: 'O formato em poucas palavras: "Lista · 7 slides · fecha com a promoção".',
          },
          objetivo: { type: 'string', enum: [...OBJETIVOS_CARROSSEL] },
          slides: { type: ['integer', 'null'] },
          chamada: { type: 'string', enum: [...CHAMADAS_FINAIS] },
          teste: { type: 'boolean', description: 'É um dos testes (algo que a conta ainda não tentou).' },
          fontes: {
            type: 'array',
            description: 'De onde a ideia veio: o rótulo e a evidência, com o número copiado da fonte.',
            items: {
              type: 'object',
              properties: {
                rotulo: { type: 'string', enum: [...FONTES_DAS_IDEIAS] },
                texto: { type: 'string' },
              },
              required: ['rotulo', 'texto'],
            },
          },
        },
        required: ['titulo', 'gancho', 'formato', 'objetivo', 'chamada', 'fontes'],
      },
    },
  },
  required: ['ideias'],
} as const;

export function mensagemDasIdeias(e: EntradaIdeias): string {
  const n = e.quantas ?? 10;
  const blocos = (Object.entries(e.fontes) as [FonteDaIdeia, string][])
    .filter(([, t]) => t?.trim())
    .map(([r, t]) => `[${r}]\n${t.trim().slice(0, 3000)}`);
  return [
    `Você é o ESTRATEGISTA. Proponha ${n} ideias de carrossel para as próximas 2 semanas, bem diferentes entre si.`,
    `HOJE: ${e.hoje}`,
    '',
    'AS FONTES (cada ideia diz de onde veio, com a evidência; o número da evidência é copiado da fonte, nunca inventado):',
    blocos.join('\n\n') || '(nenhuma fonte além do cérebro da marca)',
    '',
    `TESTES: exatamente 2 das ${n} ideias são testes (teste = true, com a fonte TESTE). O teste desta vez: ${e.teste}`,
    'Regras:',
    '- O que a empresa quer divulgar vem primeiro: pelo menos uma ideia para cada campanha da fonte CAMPANHA.',
    '- Ligue as ideias ao que os clientes perguntam e às objeções, com o número de vezes quando a fonte tem.',
    '- Use o que o time aprendeu (APRENDIDO) para escolher o formato; o que o time evita, evite.',
    '- REFERÊNCIAS servem para ver o que funciona no nicho: nunca copie o post de outra conta.',
    '- SEGUNDO CÉREBRO é o que a própria empresa escreveu e aprovou (regras, decisões, clientes): use para ideias com autoridade, sem expor nada interno nem prometer o que não está lá.',
    '- Não repita o ângulo dos carrosséis que o time já fez.',
    '- O gancho segue o manual de redação (específico, sem frase pronta).',
  ].join('\n');
}

const numerosDe = (t: string) => [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.'));

/** Cada número da evidência tem que estar na fonte do mesmo rótulo (ou o rótulo não tem fonte: sai). */
export function evidenciaConfere(
  rotulo: FonteDaIdeia,
  texto: string,
  fontes: Partial<Record<FonteDaIdeia, string>>,
): boolean {
  if (rotulo === 'TESTE') return true;
  const fonte = fontes[rotulo];
  if (!fonte?.trim()) return false;
  const daFonte = new Set(numerosDe(fonte));
  return numerosDe(texto).every((n) => daFonte.has(n));
}

export function lerIdeias(d: Record<string, unknown>, e: EntradaIdeias): IdeiaDoTime[] {
  const curto = (v: unknown, n: number) =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, n);
  const ideias: IdeiaDoTime[] = [];
  let testes = 0;
  for (const bruta of (Array.isArray(d.ideias) ? d.ideias : []) as Record<string, unknown>[]) {
    const titulo = curto(bruta.titulo, 120);
    const gancho = curto(bruta.gancho, 120);
    if (titulo.length < 6 || gancho.length < 6) continue;
    let teste = bruta.teste === true;
    if (teste && testes >= 2) teste = false;
    const fontes = ((Array.isArray(bruta.fontes) ? bruta.fontes : []) as Record<string, unknown>[])
      .map((f) => ({ rotulo: String(f.rotulo) as FonteDaIdeia, texto: curto(f.texto, 200) }))
      .filter((f) => (FONTES_DAS_IDEIAS as readonly string[]).includes(f.rotulo) && f.texto.length >= 4)
      .filter((f) => f.rotulo !== 'TESTE' || teste)
      .filter((f) => evidenciaConfere(f.rotulo, f.texto, e.fontes))
      .slice(0, 4);
    if (teste && !fontes.some((f) => f.rotulo === 'TESTE'))
      fontes.unshift({ rotulo: 'TESTE', texto: e.teste });
    if (!fontes.length) continue;
    if (teste) testes++;
    const slides = Number(bruta.slides);
    ideias.push({
      titulo,
      gancho,
      formato: curto(bruta.formato, 120),
      objetivo: (OBJETIVOS_CARROSSEL as readonly string[]).includes(String(bruta.objetivo))
        ? (bruta.objetivo as ObjetivoCarrossel)
        : 'ensinar',
      slides: Number.isInteger(slides) && slides >= 4 && slides <= 10 ? slides : null,
      chamada: (CHAMADAS_FINAIS as readonly string[]).includes(String(bruta.chamada))
        ? (bruta.chamada as ChamadaFinal)
        : 'salvar',
      teste,
      fontes,
    });
  }
  return ideias.slice(0, e.quantas ?? 10);
}

export async function pedirIdeias(
  claude: ClienteClaude,
  e: EntradaIdeias,
): Promise<{ ideias: IdeiaDoTime[]; uso: UsoClaude; custoUsd: number }> {
  const r = await claude.pedir({
    agente: 'estrategista',
    sistema: sistemaDoTime(e),
    mensagem: mensagemDasIdeias(e),
    ferramenta: {
      nome: 'ideias',
      descricao: 'As ideias de carrossel com as fontes.',
      esquema: ESQUEMA_IDEIAS,
    },
    maxTokens: 5000,
    temperatura: 0.8,
    timeoutMs: 150_000,
  });
  return { ideias: lerIdeias(r.dados, e), uso: r.uso ?? USO_ZERO, custoUsd: r.custoUsd };
}
