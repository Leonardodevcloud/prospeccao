import { z } from 'zod';

/* ───────────────────────────── Montagem do e-mail ───────────────────────────── */

export interface VariaveisEmail {
  /** Primeiro nome do decisor (pode faltar). */
  nome?: string | null;
  empresa: string;
  cidade?: string | null;
  remetente?: string | null;
  /** Abertura escrita pela IA para este lead (vazia: a linha some). */
  abertura?: string | null;
}

/** Identidade visual do e-mail (white label). */
export interface MarcaEmailVisual {
  /** Nome da marca (aparece no cabeçalho quando não há logo). */
  nome: string;
  /** "cartao": cabeçalho com logo, corpo num cartão, botão colorido. "simples": parece e-mail pessoal. */
  estilo: 'cartao' | 'simples';
  corPrimaria: string;
  corFundo: string;
  corTexto: string;
  corCabecalho: string;
  logoUrl?: string | null;
  larguraLogo?: number;
  capaUrl?: string | null;
  /** Razão social, endereço, site: rodapé pequeno. */
  rodape?: string | null;
}

export interface OpcoesMontagem {
  /** Assinatura (texto, uma informação por linha). */
  assinatura?: string | null;
  /** Endereço para descadastrar (rodapé). */
  descadastro?: string | null;
  /** Imagem 1×1 que marca a abertura. */
  pixel?: string | null;
  /** Troca cada link pelo endereço que conta o clique (recebe o índice do link). */
  rastrearLink?: ((indice: number, url: string) => string) | null;
  /** Cores, logo e capa. Sem marca, o e-mail sai simples. */
  marca?: MarcaEmailVisual | null;
}

export interface EmailMontado {
  assunto: string;
  html: string;
  texto: string;
  /** Links do corpo, na ordem (o clique rastreado aponta para o índice). */
  links: string[];
}

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Só cor #rgb/#rrggbb entra no HTML (o resto vira a cor padrão). */
export function corSegura(cor: string | null | undefined, padrao: string): string {
  return cor && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(cor.trim()) ? cor.trim() : padrao;
}

/** Texto legível sobre a cor (botão e cabeçalho): branco no escuro, quase preto no claro. */
export function corSobre(fundo: string): string {
  const h = fundo.replace('#', '');
  const cheio = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(cheio.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
  return lum > 0.45 ? '#111827' : '#ffffff';
}

/** {saudacao}, {nome}, {empresa}, {cidade}, {remetente}, {abertura}: as mesmas variáveis do WhatsApp e mais a da IA. */
export function aplicarVariaveisEmail(texto: string, v: VariaveisEmail): string {
  const nome = v.nome?.trim() || '';
  const valores: Record<string, string> = {
    saudacao: nome ? `Olá, ${nome}!` : 'Olá!',
    nome,
    empresa: v.empresa,
    cidade: v.cidade?.trim() || 'sua cidade',
    remetente: v.remetente?.trim() || '',
    abertura: v.abertura?.trim() || '',
  };
  return texto
    .replace(/\{(\w+)\}/g, (todo, k: string) => valores[k] ?? todo)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
/** [[Texto do botão|https://link]] numa linha sozinha vira um botão. */
const BOTAO_RE = /^\s*\[\[(.+?)\|\s*((?:https?:\/\/|www\.)[^\s\]]+)\s*\]\]\s*$/i;

interface Estilo {
  link: string;
  botaoFundo: string;
  botaoTexto: string;
}

/**
 * Texto simples → HTML de e-mail. Linha em branco separa parágrafos; "- " no começo vira lista;
 * **assim** fica em negrito; links viram clicáveis (e rastreados, se pedido); [[Texto|link]] vira botão.
 */
function corpoHtml(
  texto: string,
  links: string[],
  rastrear: OpcoesMontagem['rastrearLink'],
  estilo: Estilo,
): string {
  const href = (bruto: string) => {
    const real = (bruto.startsWith('http') ? bruto : `https://${bruto}`).replace(/&amp;/g, '&');
    const i = links.push(real) - 1;
    return escapar(rastrear ? rastrear(i, real) : real);
  };
  const linha = (l: string) =>
    escapar(l)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(URL_RE, (bruto) => {
        const [, url = bruto, sobra = ''] = bruto.match(/^(.*?)([.,;:!?)\]]*)$/) ?? [];
        return `<a href="${href(url.replace(/&amp;/g, '&'))}" style="color:${estilo.link};text-decoration:underline" target="_blank">${url}</a>${sobra}`;
      });
  const botao = (rotulo: string, url: string) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 18px"><tr><td style="border-radius:8px;background:${estilo.botaoFundo}"><a href="${href(url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-weight:bold;font-size:15px;color:${estilo.botaoTexto};text-decoration:none;border-radius:8px">${escapar(rotulo.trim())}</a></td></tr></table>`;
  const blocos = texto
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/)
    .filter((b) => b.trim());
  const ehItem = (l: string) => /^\s*[-•*]\s+/.test(l);
  return blocos
    .map((b) => {
      // Dentro do bloco, linhas de "- item" seguidas viram lista; botão é uma linha só; o resto, parágrafo.
      const grupos: { tipo: 'lista' | 'texto' | 'botao'; linhas: string[] }[] = [];
      for (const l of b.split('\n')) {
        const tipo = BOTAO_RE.test(l) ? 'botao' : ehItem(l) ? 'lista' : 'texto';
        const item = tipo === 'lista' ? l.replace(/^\s*[-•*]\s+/, '') : l;
        const ultimo = grupos.at(-1);
        if (ultimo && ultimo.tipo === tipo && tipo !== 'botao') ultimo.linhas.push(item);
        else grupos.push({ tipo, linhas: [item] });
      }
      return grupos
        .map((g, i) => {
          const margem = i < grupos.length - 1 ? '8px' : '16px';
          if (g.tipo === 'botao') {
            const [, rotulo = '', url = ''] = g.linhas[0]!.match(BOTAO_RE) ?? [];
            return botao(rotulo, url);
          }
          return g.tipo === 'lista'
            ? `<ul style="margin:0 0 ${margem};padding-left:20px">${g.linhas
                .map((l) => `<li style="margin:0 0 6px">${linha(l)}</li>`)
                .join('')}</ul>`
            : `<p style="margin:0 0 ${margem}">${g.linhas.map(linha).join('<br>')}</p>`;
        })
        .join('\n');
    })
    .join('\n');
}

/** Versão em texto (para quem não abre HTML e para os filtros de spam). */
function corpoTexto(t: string): string {
  return t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .split('\n')
    .map((l) => {
      const b = l.match(BOTAO_RE);
      return b ? `${b[1]?.trim()}: ${b[2]}` : l;
    })
    .join('\n');
}

const FONTE = 'Arial,Helvetica,sans-serif';

/** Monta o e-mail final (assunto, HTML e versão em texto) a partir do modelo, do lead e da marca. */
export function montarEmail(
  modelo: { assunto: string; corpo: string },
  v: VariaveisEmail,
  op: OpcoesMontagem = {},
): EmailMontado {
  const assunto = aplicarVariaveisEmail(modelo.assunto, v).replace(/\s+/g, ' ').trim();
  const corpo = aplicarVariaveisEmail(modelo.corpo, v).trim();
  const assinatura = op.assinatura ? aplicarVariaveisEmail(op.assinatura, v).trim() : '';
  const m = op.marca ?? null;
  const primaria = corSegura(m?.corPrimaria, '#0f766e');
  const texto = corSegura(m?.corTexto, '#1f2933');
  const fundo = corSegura(m?.corFundo, '#f4f4f5');
  const cabecalho = corSegura(m?.corCabecalho, '#ffffff');
  const estilo: Estilo = { link: primaria, botaoFundo: primaria, botaoTexto: corSobre(primaria) };
  const links: string[] = [];
  const corpoH = corpoHtml(corpo, links, op.rastrearLink, estilo);
  const assinaturaH = assinatura ? corpoHtml(assinatura, links, op.rastrearLink, estilo) : '';
  const rodape = m?.rodape?.trim() ? escapar(m.rodape.trim()).replace(/\n/g, '<br>') : '';
  const sair = op.descadastro
    ? `Não quer mais receber nossos e-mails? <a href="${escapar(op.descadastro)}" style="color:#94a3b8">Clique aqui para sair da lista</a>.`
    : '';
  const pixel = op.pixel
    ? `<img src="${escapar(op.pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`
    : '';
  const logo = m?.logoUrl
    ? `<img src="${escapar(m.logoUrl)}" width="${Math.max(40, Math.min(400, m.larguraLogo ?? 140))}" alt="${escapar(m.nome)}" style="display:block;border:0;height:auto;max-width:100%">`
    : '';
  const cabeca = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapar(assunto)}</title></head>`;

  let html: string;
  if (m && m.estilo === 'cartao') {
    const topo = logo
      ? logo
      : `<span style="font-family:${FONTE};font-size:20px;font-weight:bold;color:${corSobre(cabecalho) === '#ffffff' ? '#ffffff' : primaria}">${escapar(m.nome)}</span>`;
    html = `${cabeca}
<body style="margin:0;padding:0;background:${fundo}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${fundo}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:${cabecalho};padding:20px 28px;border-bottom:3px solid ${primaria}">${topo}</td></tr>
${m.capaUrl ? `<tr><td style="padding:0"><img src="${escapar(m.capaUrl)}" width="600" alt="" style="display:block;border:0;width:100%;height:auto"></td></tr>` : ''}
<tr><td style="padding:28px 28px 8px;font-family:${FONTE};font-size:15px;line-height:1.6;color:${texto}">
${corpoH}
</td></tr>
${assinaturaH ? `<tr><td style="padding:4px 28px 26px;font-family:${FONTE};font-size:14px;line-height:1.5;color:${texto}"><div style="border-top:1px solid #e5e7eb;padding-top:16px">${assinaturaH}</div></td></tr>` : ''}
</table>
${rodape || sair ? `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr><td style="padding:16px 28px;font-family:${FONTE};font-size:12px;line-height:1.5;color:#94a3b8;text-align:center">${rodape}${rodape && sair ? '<br><br>' : ''}${sair}</td></tr></table>` : ''}
${pixel}
</td></tr></table>
</body></html>`;
  } else {
    html = `${cabeca}
<body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:${FONTE};font-size:15px;line-height:1.55;color:${texto}">
${corpoH}
${assinaturaH || logo ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#475569;font-size:14px">${assinaturaH}${logo ? `<div style="margin-top:8px">${logo.replace(/width="\d+"/, `width="${Math.min(120, m?.larguraLogo ?? 120)}"`)}</div>` : ''}</div>` : ''}
${rodape ? `<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">${rodape}</p>` : ''}
${sair ? `<p style="margin:${rodape ? '8px' : '32px'} 0 0;color:#94a3b8;font-size:12px">${sair}</p>` : ''}
${pixel}
</div>
</body></html>`;
  }
  const textoFinal = [
    corpoTexto(corpo),
    assinatura ? `--\n${corpoTexto(assinatura)}` : '',
    m?.rodape?.trim() ?? '',
    op.descadastro ? `Para sair da lista: ${op.descadastro}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { assunto, html, texto: textoFinal, links };
}

/* ───────────────────────────── Validação ───────────────────────────── */

/** Anexos de um modelo: no máximo 10 MB somando todos (provedores recusam e-mails maiores). */
export const LIMITE_ANEXOS_EMAIL = 10 * 1024 * 1024;

export const modeloEmailEntrada = z.object({
  nome: z.string().trim().min(1, 'Dê um nome ao modelo.').max(80),
  assunto: z.string().trim().min(1, 'Escreva o assunto.').max(200),
  corpo: z.string().trim().min(1, 'Escreva o texto do e-mail.').max(20_000),
  anexos: z.array(z.number().int().positive()).max(5).default([]),
  /** Nicho do modelo (só organiza a lista). */
  nichoId: z.number().int().positive().nullable().optional(),
});
export type ModeloEmailEntrada = z.infer<typeof modeloEmailEntrada>;

export const anexoEmailEntrada = z.object({
  nome: z.string().trim().min(1).max(200),
  mime: z
    .string()
    .trim()
    .max(120)
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'Tipo de arquivo inválido.'),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((LIMITE_ANEXOS_EMAIL * 4) / 3) + 8, 'Arquivo grande demais (até 10 MB).'),
});

export const passoEmail = z.object({
  modeloId: z.number().int().positive(),
  /** Dias depois do passo anterior, sem resposta (o 1º passo usa 0). */
  dias: z.number().int().min(0).max(60),
});

export const campanhaEmailEntrada = z.object({
  nome: z.string().trim().min(1, 'Dê um nome.').max(120),
  /** Campanha de prospecção de onde vêm os leads. */
  campanhaId: z.number().int().positive(),
  passos: z.array(passoEmail).min(1, 'Escolha o modelo do 1º e-mail.').max(4),
  /** Só estas notas (vazio = todas, inclusive sem nota). */
  faixas: z.array(z.enum(['A', 'B', 'C'])).default([]),
  /** Pula quem já está no funil (abordado, em conversa, cliente…). */
  pularNoFunil: z.boolean().default(true),
  /** E-mail que pode ser do contador (veio só da Receita com cara de escritório). */
  incluirContador: z.boolean().default(false),
  /** Identidade visual (cores, logo, remetente, assinatura). */
  marcaId: z.number().int().positive({ message: 'Escolha a identidade visual do e-mail.' }),
  /** O que a IA precisa saber do nicho para escrever a abertura de cada e-mail. */
  instrucoesIa: z.string().trim().max(3000).default(''),
  /** A IA escreve a {abertura} de cada e-mail olhando o lead. */
  personalizarIa: z.boolean().default(false),
});
export type CampanhaEmailEntrada = z.infer<typeof campanhaEmailEntrada>;

/** Mudar a campanha de e-mail depois de criada (a prospecção e o público não mudam). */
export const campanhaEmailAtualizar = z
  .object({
    nome: z.string().trim().min(1).max(120).optional(),
    passos: z.array(passoEmail).min(1).max(4).optional(),
    marcaId: z.number().int().positive().optional(),
    instrucoesIa: z.string().trim().max(3000).optional(),
    personalizarIa: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type CampanhaEmailAtualizar = z.infer<typeof campanhaEmailAtualizar>;

const cor = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{3}([0-9a-f]{3})?$/i, 'Cor no formato #RRGGBB.');

export const marcaEmailEntrada = z.object({
  nome: z.string().trim().min(1, 'Dê um nome à identidade visual.').max(80),
  remetenteNome: z.string().trim().min(1, 'Informe o nome que aparece como remetente.').max(80),
  /** Vazio: o remetente da conta. Outro endereço precisa ser de um domínio verificado no Resend. */
  remetenteEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Remetente inválido.')
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => v || null),
  responderPara: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail inválido.')
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => v || null),
  estilo: z.enum(['cartao', 'simples']).default('cartao'),
  corPrimaria: cor,
  corFundo: cor,
  corTexto: cor,
  corCabecalho: cor,
  logoId: z.number().int().positive().nullable().optional(),
  larguraLogo: z.number().int().min(40).max(400).default(140),
  capaId: z.number().int().positive().nullable().optional(),
  assinatura: z.string().max(2000).default(''),
  rodape: z.string().max(1000).default(''),
});
export type MarcaEmailEntrada = z.infer<typeof marcaEmailEntrada>;

/** Imagem da marca (logo, capa): até 2 MB, PNG/JPG/GIF/WebP. */
export const LIMITE_IMAGEM_EMAIL = 2 * 1024 * 1024;
export const imagemEmailEntrada = z.object({
  nome: z.string().trim().min(1).max(200),
  mime: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp'], {
    message: 'Use uma imagem PNG, JPG, GIF ou WebP.',
  }),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((LIMITE_IMAGEM_EMAIL * 4) / 3) + 8, 'Imagem grande demais (até 2 MB).'),
});

export const configEmailEntrada = z.object({
  ligado: z.boolean(),
  limiteDia: z.number().int().min(1).max(2000),
  intervaloSeg: z.number().int().min(10).max(3600),
  horaInicio: z.number().int().min(0).max(23),
  horaFim: z.number().int().min(1).max(24),
  diasSemana: z.array(z.number().int().min(0).max(6)).min(1),
  rastrearAbertura: z.boolean(),
});
export type ConfigEmailEntrada = z.infer<typeof configEmailEntrada>;

export const CLASSES_RESPOSTA = ['interessado', 'sem_interesse', 'descadastro', 'automatica'] as const;
export type ClasseResposta = (typeof CLASSES_RESPOSTA)[number];

export const responderEmailEntrada = z.object({ texto: z.string().trim().min(1).max(20_000) });

/** Classificação pelo texto, quando a IA não está configurada (ou falha). */
export function classificarRespostaSimples(assunto: string, texto: string): ClasseResposta {
  const t = `${assunto}\n${texto}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (
    /(resposta automatica|ausente do escritorio|out of office|auto.?reply|estou de ferias|retorno (no|em) dia)/.test(
      t,
    )
  )
    return 'automatica';
  if (
    /(descadastr|remov(a|er) (meu|o meu|da lista)|nao (me )?(envie|mande)|sair da lista|unsubscribe|parem de enviar)/.test(
      t,
    )
  )
    return 'descadastro';
  if (
    /(nao (temos|tenho|ha) interesse|sem interesse|nao precisamos|ja (temos|possuimos) (motoboy|entregador|fornecedor)|nao e do nosso interesse)/.test(
      t,
    )
  )
    return 'sem_interesse';
  return 'interessado';
}
