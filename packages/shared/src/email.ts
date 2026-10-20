import { z } from 'zod';

/* ───────────────────────────── Montagem do e-mail ───────────────────────────── */

export interface VariaveisEmail {
  /** Primeiro nome do decisor (pode faltar). */
  nome?: string | null;
  empresa: string;
  cidade?: string | null;
  remetente?: string | null;
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

/** {saudacao}, {nome}, {empresa}, {cidade}, {remetente}: as mesmas variáveis do WhatsApp. */
export function aplicarVariaveisEmail(texto: string, v: VariaveisEmail): string {
  const nome = v.nome?.trim() || '';
  const valores: Record<string, string> = {
    saudacao: nome ? `Olá, ${nome}!` : 'Olá!',
    nome,
    empresa: v.empresa,
    cidade: v.cidade?.trim() || 'sua cidade',
    remetente: v.remetente?.trim() || '',
  };
  return texto
    .replace(/\{(\w+)\}/g, (todo, k: string) => valores[k] ?? todo)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1');
}

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

/**
 * Texto simples → HTML de e-mail. Linha em branco separa parágrafos; "- " no começo vira lista;
 * **assim** fica em negrito; links viram clicáveis (e rastreados, se pedido).
 */
function corpoHtml(texto: string, links: string[], rastrear: OpcoesMontagem['rastrearLink']): string {
  const linha = (l: string) =>
    escapar(l)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(URL_RE, (bruto) => {
        const [, url = bruto, sobra = ''] = bruto.match(/^(.*?)([.,;:!?)\]]*)$/) ?? [];
        const real = (url.startsWith('http') ? url : `https://${url}`).replace(/&amp;/g, '&');
        const i = links.push(real) - 1;
        const href = rastrear ? rastrear(i, real) : real;
        return `<a href="${escapar(href)}" style="color:#0f766e;text-decoration:underline" target="_blank">${url}</a>${sobra}`;
      });
  const blocos = texto
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/);
  const ehItem = (l: string) => /^\s*[-•*]\s+/.test(l);
  return blocos
    .map((b) => {
      // Dentro do bloco, linhas de "- item" seguidas viram lista; o resto, parágrafo.
      const grupos: { lista: boolean; linhas: string[] }[] = [];
      for (const l of b.split('\n')) {
        const lista = ehItem(l);
        const ultimo = grupos.at(-1);
        const item = lista ? l.replace(/^\s*[-•*]\s+/, '') : l;
        if (ultimo && ultimo.lista === lista) ultimo.linhas.push(item);
        else grupos.push({ lista, linhas: [item] });
      }
      return grupos
        .map((g, i) => {
          const margem = i < grupos.length - 1 ? '8px' : '16px';
          return g.lista
            ? `<ul style="margin:0 0 ${margem};padding-left:20px">${g.linhas
                .map((l) => `<li style="margin:0 0 6px">${linha(l)}</li>`)
                .join('')}</ul>`
            : `<p style="margin:0 0 ${margem}">${g.linhas.map(linha).join('<br>')}</p>`;
        })
        .join('\n');
    })
    .join('\n');
}

/** Monta o e-mail final (assunto, HTML e versão em texto) a partir do modelo e do lead. */
export function montarEmail(
  modelo: { assunto: string; corpo: string },
  v: VariaveisEmail,
  op: OpcoesMontagem = {},
): EmailMontado {
  const assunto = aplicarVariaveisEmail(modelo.assunto, v).replace(/\s+/g, ' ').trim();
  const corpo = aplicarVariaveisEmail(modelo.corpo, v).trim();
  const assinatura = op.assinatura ? aplicarVariaveisEmail(op.assinatura, v).trim() : '';
  const links: string[] = [];
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(assunto)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2933">
${corpoHtml(corpo, links, op.rastrearLink)}
${assinatura ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#475569;font-size:14px">${corpoHtml(assinatura, links, op.rastrearLink)}</div>` : ''}
${op.descadastro ? `<p style="margin:32px 0 0;color:#94a3b8;font-size:12px">Não quer mais receber nossos e-mails? <a href="${escapar(op.descadastro)}" style="color:#94a3b8">Clique aqui para sair da lista</a>.</p>` : ''}
${op.pixel ? `<img src="${escapar(op.pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ''}
</div>
</body></html>`;
  const texto = [
    corpo.replace(/\*\*(.+?)\*\*/g, '$1'),
    assinatura ? `--\n${assinatura}` : '',
    op.descadastro ? `Para sair da lista: ${op.descadastro}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { assunto, html, texto, links };
}

/* ───────────────────────────── Validação ───────────────────────────── */

/** Anexos de um modelo: no máximo 10 MB somando todos (provedores recusam e-mails maiores). */
export const LIMITE_ANEXOS_EMAIL = 10 * 1024 * 1024;

export const modeloEmailEntrada = z.object({
  nome: z.string().trim().min(1, 'Dê um nome ao modelo.').max(80),
  assunto: z.string().trim().min(1, 'Escreva o assunto.').max(200),
  corpo: z.string().trim().min(1, 'Escreva o texto do e-mail.').max(20_000),
  anexos: z.array(z.number().int().positive()).max(5).default([]),
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
});
export type CampanhaEmailEntrada = z.infer<typeof campanhaEmailEntrada>;

export const configEmailEntrada = z.object({
  ligado: z.boolean(),
  remetenteNome: z.string().trim().min(1, 'Informe o nome do remetente.').max(80),
  responderPara: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail inválido.')
    .or(z.literal(''))
    .nullable()
    .transform((v) => v || null),
  assinatura: z.string().max(2000),
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
