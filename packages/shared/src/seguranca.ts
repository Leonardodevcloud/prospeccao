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

/** Contraste da cor com texto branco (botões da marca têm texto branco): WCAG, 1 a 21. */
export function contrasteComBranco(hex: string): number {
  const c = hex.replace('#', '');
  const canal = (i: number) => {
    const v = Number.parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  return 1.05 / (l + 0.05);
}

export const marcaEntrada = z.object({
  /** Nome que aparece no menu e nos relatórios (padrão: o nome da organização). */
  nome: z.string().trim().max(60).nullish(),
  cor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #1a2b3c.')
    .refine(
      (c) => contrasteComBranco(c) >= 4.5,
      'Cor clara demais: o texto branco dos botões fica ilegível. Escolha um tom mais escuro.',
    )
    .nullish(),
  /** Logo em PNG ou JPEG (data URL, até 300 KB). null apaga; ausente mantém. */
  logo: z
    .string()
    .max(420_000, 'Logo grande demais: use uma imagem de até 300 KB.')
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Use uma imagem PNG ou JPG.')
    .nullish(),
  /** Ícone quadrado (aba do navegador e app no celular), PNG ou JPEG até 200 KB. */
  icone: z
    .string()
    .max(280_000, 'Ícone grande demais: use uma imagem de até 200 KB.')
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Use uma imagem PNG ou JPG.')
    .nullish(),
  /** Imagem de divulgação (ao lado do login e na prévia do link), PNG ou JPEG até 1 MB. */
  imagem: z
    .string()
    .max(1_400_000, 'Imagem grande demais: use uma imagem de até 1 MB.')
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Use uma imagem PNG ou JPG.')
    .nullish(),
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
