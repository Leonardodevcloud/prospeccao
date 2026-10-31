import { z } from 'zod';

/* ───────────────────────────── Fundos das reuniões ───────────────────────────── */

/**
 * Fundos da câmera nas reuniões: desfoque, cenários prontos e fotos da empresa. Nos cenários (e nas
 * fotos), a logo da marca própria entra sozinha num "lugar" pensado para ficar fora de onde a pessoa
 * aparece (em cima e nos cantos). Coordenadas em frações do quadro 16:9.
 */

export type EstiloLogo = 'placa' | 'adesivo' | 'original';
export const ESTILOS_LOGO: { id: EstiloLogo; nome: string }[] = [
  { id: 'placa', nome: 'Placa branca' },
  { id: 'adesivo', nome: 'Adesivo na cor' },
  { id: 'original', nome: 'Logo como está' },
];

export interface LugarLogo {
  id: string;
  nome: string;
  /** Caixa onde a logo cabe (frações de 0 a 1 da largura e da altura). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Superfície pintada antes da logo (a tela da TV, o passe-partout do quadro), na mesma escala. */
  base?: { cor: string; x: number; y: number; w: number; h: number; raio?: number };
}

export interface CenaFundo {
  id: string;
  nome: string;
  /** Desenho em /fundos/<id>.svg (a parede da marca é pintada com a cor da marca, sem arquivo). */
  arquivo: string | null;
  lugares: LugarLogo[];
  estiloPadrao: EstiloLogo;
}

export const CENAS_FUNDO: CenaFundo[] = [
  {
    id: 'sala',
    nome: 'Sala de reunião',
    arquivo: '/fundos/sala.svg',
    estiloPadrao: 'adesivo',
    lugares: [
      { id: 'vidro', nome: 'Na parede de vidro', x: 0.055, y: 0.13, w: 0.27, h: 0.15 },
      {
        id: 'tv',
        nome: 'Na TV',
        x: 0.722,
        y: 0.185,
        w: 0.176,
        h: 0.15,
        base: { cor: '#f5f5f2', x: 0.712, y: 0.172, w: 0.196, h: 0.178 },
      },
      { id: 'canto', nome: 'Canto de cima', x: 0.74, y: 0.045, w: 0.21, h: 0.09 },
    ],
  },
  {
    id: 'escritorio',
    nome: 'Escritório',
    arquivo: '/fundos/escritorio.svg',
    estiloPadrao: 'original',
    lugares: [
      {
        id: 'quadro',
        nome: 'No quadro da parede',
        x: 0.705,
        y: 0.19,
        w: 0.205,
        h: 0.17,
        base: { cor: '#fbfaf6', x: 0.69, y: 0.168, w: 0.235, h: 0.214 },
      },
      { id: 'canto', nome: 'Canto de cima', x: 0.05, y: 0.05, w: 0.22, h: 0.1 },
    ],
  },
  {
    id: 'estante',
    nome: 'Estante',
    arquivo: '/fundos/estante.svg',
    estiloPadrao: 'placa',
    lugares: [
      {
        id: 'placa',
        nome: 'Na estante',
        x: 0.672,
        y: 0.118,
        w: 0.17,
        h: 0.12,
        base: { cor: '#3f2b1e', x: 0.6625, y: 0.0889, w: 0.3125, h: 0.1889 },
      },
      { id: 'parede', nome: 'Na parede', x: 0.06, y: 0.11, w: 0.25, h: 0.13 },
    ],
  },
  {
    id: 'marca',
    nome: 'Parede da marca',
    arquivo: null,
    estiloPadrao: 'placa',
    lugares: [
      { id: 'grande', nome: 'Grande, em cima', x: 0.06, y: 0.1, w: 0.36, h: 0.17 },
      { id: 'canto', nome: 'Canto de cima', x: 0.74, y: 0.06, w: 0.21, h: 0.1 },
    ],
  },
  {
    id: 'minimal',
    nome: 'Minimalista',
    arquivo: '/fundos/minimal.svg',
    estiloPadrao: 'adesivo',
    lugares: [
      { id: 'canto', nome: 'Canto de cima', x: 0.73, y: 0.08, w: 0.22, h: 0.11 },
      { id: 'esquerda', nome: 'À esquerda', x: 0.05, y: 0.12, w: 0.25, h: 0.13 },
    ],
  },
  {
    id: 'recepcao',
    nome: 'Recepção',
    arquivo: '/fundos/recepcao.svg',
    estiloPadrao: 'adesivo',
    lugares: [
      { id: 'letreiro', nome: 'Letreiro na parede', x: 0.33, y: 0.12, w: 0.34, h: 0.17 },
      { id: 'canto', nome: 'Canto de cima', x: 0.74, y: 0.05, w: 0.21, h: 0.1 },
    ],
  },
  {
    id: 'loja',
    nome: 'Loja',
    arquivo: '/fundos/loja.svg',
    estiloPadrao: 'placa',
    lugares: [
      { id: 'letreiro', nome: 'Letreiro em cima', x: 0.05, y: 0.025, w: 0.27, h: 0.1 },
      { id: 'canto', nome: 'Canto de cima', x: 0.74, y: 0.025, w: 0.21, h: 0.1 },
    ],
  },
];

/** Nas fotos que a empresa envia: a logo vai num canto de cima (ou não vai). */
export const LUGARES_FOTO: LugarLogo[] = [
  { id: 'canto-dir', nome: 'Canto de cima, à direita', x: 0.74, y: 0.05, w: 0.21, h: 0.1 },
  { id: 'canto-esq', nome: 'Canto de cima, à esquerda', x: 0.05, y: 0.05, w: 0.21, h: 0.1 },
];

export const SEM_LOGO = 'sem';

/**
 * Ids dos fundos (o mesmo texto na configuração, no padrão e no que a pessoa escolheu):
 * - `nenhum`, `desfoque-leve`, `desfoque-forte`
 * - `cena:<id>` (sem logo) e `logo:<id>` (o cenário com a logo da empresa)
 * - `foto:<n>` (foto enviada pela empresa, com a logo no lugar escolhido)
 */
export const EFEITOS_FUNDO = [
  { id: 'nenhum', nome: 'Nenhum' },
  { id: 'desfoque-leve', nome: 'Desfoque leve' },
  { id: 'desfoque-forte', nome: 'Desfoque forte' },
] as const;

export const ID_FUNDO = /^(nenhum|desfoque-leve|desfoque-forte|cena:[a-z]+|logo:[a-z]+|foto:\d{1,12})$/;

export interface ConfigFundos {
  /** Fundos com a logo (logo:<cena> e foto:<n>) liberados para o time. */
  liberados: string[];
  /** Fundo que já vem escolhido para o time ao entrar (null: nenhum). */
  padrao: string | null;
  /** Todo mundo do time fica com o padrão (ninguém troca). */
  travar: boolean;
  /** O time também pode usar o desfoque e os cenários sem logo. */
  simples: boolean;
  /** Onde e como a logo entra em cada cenário (ou foto). */
  lugares: Record<string, { lugar: string; estilo: EstiloLogo }>;
}

export const CONFIG_FUNDOS_PADRAO: ConfigFundos = {
  liberados: CENAS_FUNDO.filter((c) => c.id !== 'loja').map((c) => `logo:${c.id}`),
  padrao: null,
  travar: false,
  simples: true,
  lugares: {},
};

const idFundo = z.string().max(40).regex(ID_FUNDO, 'Fundo desconhecido.');

export const configFundosEntrada = z.object({
  liberados: z.array(idFundo).max(60),
  padrao: idFundo.nullable(),
  travar: z.boolean(),
  simples: z.boolean(),
  lugares: z
    .record(
      z
        .string()
        .max(40)
        .regex(/^(logo:[a-z]+|foto:\d{1,12})$/),
      z.object({ lugar: z.string().max(20), estilo: z.enum(['placa', 'adesivo', 'original']) }),
    )
    .refine((r) => Object.keys(r).length <= 60),
});

export const fotoFundoEntrada = z.object({
  nome: z.string().trim().min(2, 'Dê um nome para a foto (ex.: Recepção).').max(40),
  /** JPEG ou PNG em data URL (o navegador já manda em 1920×1080). */
  imagem: z
    .string()
    .max(2_400_000, 'Foto grande demais: use uma imagem de até 1,5 MB.')
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Use uma imagem JPG ou PNG.'),
});

/** Junta a configuração salva com o padrão (campos novos, valores antigos inválidos). */
export function lerConfigFundos(bruto: unknown): ConfigFundos {
  const r = configFundosEntrada.safeParse({ ...CONFIG_FUNDOS_PADRAO, ...(bruto as object) });
  return r.success ? r.data : { ...CONFIG_FUNDOS_PADRAO };
}

/** Lugar e estilo da logo de um fundo (o salvo, ou o padrão do cenário). */
export function lugarDaLogo(
  config: ConfigFundos,
  id: string,
): { lugar: LugarLogo | null; estilo: EstiloLogo } {
  const salvo = config.lugares[id];
  if (id.startsWith('foto:')) {
    const lugar =
      salvo?.lugar === SEM_LOGO
        ? null
        : (LUGARES_FOTO.find((l) => l.id === salvo?.lugar) ?? LUGARES_FOTO[0]!);
    return { lugar, estilo: salvo?.estilo ?? 'placa' };
  }
  const cena = CENAS_FUNDO.find((c) => `logo:${c.id}` === id);
  if (!cena) return { lugar: null, estilo: 'placa' };
  const lugar =
    salvo?.lugar === SEM_LOGO ? null : (cena.lugares.find((l) => l.id === salvo?.lugar) ?? cena.lugares[0]!);
  return { lugar, estilo: salvo?.estilo ?? cena.estiloPadrao };
}

/** Nome para a tela ("Sala de reunião", "Desfoque leve", "Recepção (foto)"…). */
export function nomeDoFundo(id: string, fotos: { id: number; nome: string }[] = []): string {
  const efeito = EFEITOS_FUNDO.find((e) => e.id === id);
  if (efeito) return efeito.nome;
  const [tipo, resto] = id.split(':');
  if (tipo === 'foto') {
    const f = fotos.find((x) => String(x.id) === resto);
    return f ? `${f.nome} · foto` : 'Foto da empresa';
  }
  return CENAS_FUNDO.find((c) => c.id === resto)?.nome ?? 'Fundo';
}
