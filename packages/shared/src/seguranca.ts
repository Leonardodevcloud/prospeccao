import { z } from 'zod';

/* ───────────────────────────── Segurança, LGPD e marca ───────────────────────────── */

/** Versão dos termos de uso e da política de privacidade em vigor (muda → todos aceitam de novo). */
export const TERMOS_VERSAO = '2026-10';

export const codigoDuasEtapas = z.object({
  codigo: z
    .string()
    .trim()
    .min(6, 'Digite o código de 6 números do app (ou um código de recuperação).')
    .max(20),
});

export const loginDuasEtapas = codigoDuasEtapas.extend({
  desafio: z.string().min(10).max(2000),
});

export const desativarDuasEtapas = z.object({ senha: z.string().min(1, 'Informe a sua senha.') });

export const termosEntrada = z.object({ versao: z.literal(TERMOS_VERSAO) });

/** Luminância relativa (WCAG) de uma cor #rrggbb. */
function luminancia(hex: string): number {
  const c = hex.replace('#', '');
  const canal = (i: number) => {
    const v = Number.parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

/** Contraste da cor com texto branco (botões da marca têm texto branco): WCAG, 1 a 21. */
export function contrasteComBranco(hex: string): number {
  return 1.05 / (luminancia(hex) + 0.05);
}

/** Imagem da marca em data URL (PNG ou JPEG), com o limite em KB. null apaga; ausente mantém. */
const imagemMarca = (kb: number, oQue: string) =>
  z
    .string()
    .max(
      Math.ceil(kb * 1024 * 1.37) + 100,
      `${oQue} grande demais: use uma imagem de até ${kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`}.`,
    )
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Use uma imagem PNG ou JPG.')
    .nullish();

const corHex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #1a2b3c.');

/** Contraste de uma cor com o texto quase preto do sistema (#18181b). */
export function contrasteComEscuro(hex: string): number {
  const l = luminancia(hex);
  return (l + 0.05) / (luminancia('#18181b') + 0.05);
}

export const marcaEntrada = z.object({
  /** Nome que aparece no menu e nos relatórios (padrão: o nome da organização). */
  nome: z.string().trim().max(60).nullish(),
  /** Primária: botões e ações principais (texto branco em cima). */
  cor: corHex
    .refine(
      (c) => contrasteComBranco(c) >= 4.5,
      'Cor primária clara demais: o texto branco dos botões fica ilegível. Escolha um tom mais escuro.',
    )
    .nullish(),
  /** Secundária: menu lateral, login e abertura do app (texto branco em cima). */
  corSecundaria: corHex
    .refine(
      (c) => contrasteComBranco(c) >= 4.5,
      'Cor secundária clara demais: o texto branco do menu fica ilegível. Escolha um tom mais escuro.',
    )
    .nullish(),
  /** Destaque: links, gráficos e a rota no mapa (em cima do branco). */
  corDestaque: corHex
    .refine(
      (c) => contrasteComBranco(c) >= 3,
      'Cor de destaque clara demais: os links somem no fundo branco. Escolha um tom mais forte.',
    )
    .nullish(),
  /** Clara: etiquetas e fundos de chips (texto escuro em cima). */
  corClara: corHex
    .refine(
      (c) => contrasteComEscuro(c) >= 9,
      'Cor clara escura demais: as etiquetas ficam difíceis de ler. Escolha um tom bem claro.',
    )
    .nullish(),
  /** Menu lateral na cor secundária (com a logo para fundo escuro). */
  menuEscuro: z.boolean().optional(),
  /** Logo para fundo claro (e-mails, PDF, telas brancas), até 300 KB. */
  logo: imagemMarca(300, 'Logo'),
  /** Logo para fundo escuro (menu na cor secundária, login, abertura do app), até 300 KB. */
  logoEscuro: imagemMarca(300, 'Logo para fundo escuro'),
  /** Ícone da marca (sala de reunião, selos pequenos), quadrado, até 200 KB. */
  icone: imagemMarca(200, 'Ícone'),
  /** Ícone da aba do navegador, quadrado, até 200 KB. */
  favicon: imagemMarca(200, 'Ícone da aba'),
  /** Ícone do app instalado no celular, quadrado, até 200 KB. */
  app: imagemMarca(200, 'Ícone do app'),
  /** Imagem de divulgação (ao lado do login e na prévia do link), PNG ou JPEG até 1 MB. */
  imagem: imagemMarca(1024, 'Imagem'),
});
export type MarcaEntrada = z.infer<typeof marcaEntrada>;

/** Domínio próprio do cliente (crm.suaempresa.com.br): aceita colar com https:// ou barra no fim. */
export const dominioEntrada = z.object({
  dominio: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) =>
      d
        .replace(/^[a-z]+:\/\//, '')
        .replace(/[/?#].*$/, '')
        .replace(/\.$/, ''),
    )
    .pipe(
      z
        .string()
        .max(200)
        .regex(
          /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/,
          'Use um endereço como crm.suaempresa.com.br (sem espaços nem acentos).',
        ),
    ),
});

export const segurancaOrganizacao = z.object({ exigirDuasEtapas: z.boolean() });

export const esquecerTitular = z.object({
  empresaId: z.number().int().positive(),
  /** Quem pediu e como (e-mail, telefone, protocolo): fica no registro. */
  pedidoPor: z.string().trim().max(200).nullish(),
  motivo: z.string().trim().max(500).nullish(),
});
