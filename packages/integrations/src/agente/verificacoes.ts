/**
 * Verificações antes de cada mensagem da IA sair. São regras fixas (sem IA), rápidas e iguais
 * sempre: o que não passa volta para a IA reescrever uma vez, com o motivo; se a reescrita também
 * não passar, a mensagem não sai e o lead vai para o time.
 */

export type RegraVerificacao =
  | 'vazia'
  | 'longa'
  | 'perguntas_demais'
  | 'preco_fora_da_base'
  | 'link_fora_da_base'
  | 'contato_fora_da_base'
  | 'repetida'
  | 'formatacao'
  | 'texto_de_robo'
  | 'promessa'
  | 'retorno_sem_passar'
  | 'agenda_sem_reuniao'
  | 'sem_fonte';

export interface ProblemaVerificacao {
  regra: RegraVerificacao;
  /** O que mostrar para a IA (na reescrita) e para a equipe (no registro). */
  detalhe: string;
}

export interface EntradaVerificacao {
  texto: string;
  /** Tudo o que a IA podia usar: sobre a empresa, regras, trechos da base e a conversa. */
  fontes: string[];
  /** Nossas últimas mensagens neste lead (para não repetir). */
  enviadasAntes: string[];
  /** O que a IA decidiu fazer junto com a mensagem. */
  acao?: string;
}

/** Limite de caracteres por resposta (somando as bolhas). */
export const LIMITE_CARACTERES = 700;

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Números de um texto como aparecem num valor: "R$ 1.250,00" → "1250" (sem milhar e centavos). */
function numerosDoTexto(t: string): Set<string> {
  const limpo = t.replace(/(\d)[.](?=\d{3}\b)/g, '$1').replace(/(\d),\d{1,2}\b/g, '$1');
  return new Set(limpo.match(/\d+/g) ?? []);
}

/** Palavras em trios ("hoje a gente", "a gente compra"…), para medir o quanto duas frases se parecem. */
function trios(t: string): Set<string> {
  const p = semAcento(t)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + 2 < p.length; i++) s.add(`${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  if (!s.size && p.length) s.add(p.join(' '));
  return s;
}

/** Parecença de 0 a 1 entre dois textos (trios de palavras em comum). */
export function parecenca(a: string, b: string): number {
  const x = trios(a);
  const y = trios(b);
  if (!x.size || !y.size) return 0;
  let comum = 0;
  for (const t of x) if (y.has(t)) comum++;
  return comum / Math.min(x.size, y.size);
}

export function verificarMensagem(e: EntradaVerificacao): ProblemaVerificacao[] {
  const problemas: ProblemaVerificacao[] = [];
  const t = e.texto.trim();
  const base = semAcento(e.fontes.join('\n'));
  const numerosDaBase = numerosDoTexto(e.fontes.join('\n'));

  if (!t) return [{ regra: 'vazia', detalhe: 'A mensagem está vazia.' }];

  if (t.length > LIMITE_CARACTERES)
    problemas.push({
      regra: 'longa',
      detalhe: `Tem ${t.length} caracteres; o máximo é ${LIMITE_CARACTERES}. Seja mais direto.`,
    });

  if ((t.match(/\?/g) ?? []).length > 2)
    problemas.push({ regra: 'perguntas_demais', detalhe: 'Faça no máximo duas perguntas por vez.' });

  // Valores: só os que estão escritos na base (preço inventado é o erro mais caro).
  const valores = t.match(/R\$\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:reais|mil reais|%|por cento)/gi) ?? [];
  const valoresInventados = valores.filter((v) => [...numerosDoTexto(v)].some((n) => !numerosDaBase.has(n)));
  if (valoresInventados.length)
    problemas.push({
      regra: 'preco_fora_da_base',
      detalhe: `Valor que não está na base: ${valoresInventados.join(', ')}. Não informe preço, desconto ou percentual que não esteja escrito na base.`,
    });

  // Links: só domínios que aparecem na base ou na conversa.
  const links =
    t.match(/\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(?:com|com\.br|net|br|io|app)(?:\/[^\s]*)?/gi) ?? [];
  const linksInventados = links.filter((l) => {
    const dominio = semAcento(l)
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/^www\./, '')
      .split('/')[0];
    return dominio && !base.includes(dominio);
  });
  if (linksInventados.length)
    problemas.push({
      regra: 'link_fora_da_base',
      detalhe: `Link que não está na base: ${linksInventados.join(', ')}. Não mande links que não estejam na base.`,
    });

  // Telefone e e-mail: idem.
  const emails = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const telefones = (t.match(/\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g) ?? []).map((x) =>
    x.replace(/\D/g, ''),
  );
  const baseSoDigitos = e.fontes.join('\n').replace(/\D/g, '');
  const contatosInventados = [
    ...emails.filter((m) => !base.includes(semAcento(m))),
    ...telefones.filter((n) => !baseSoDigitos.includes(n.slice(-8))),
  ];
  if (contatosInventados.length)
    problemas.push({
      regra: 'contato_fora_da_base',
      detalhe: `Telefone ou e-mail que não está na base: ${contatosInventados.join(', ')}.`,
    });

  // Repetição: parecida demais com uma das nossas últimas mensagens. Mensagem curtinha ("Combinado!")
  // pode repetir; e se os números mudaram (outro horário, outro valor) não é repetição.
  const digitos = (x: string) => (x.match(/\d+/g) ?? []).join(' ');
  const repetida =
    t.length > 20
      ? e.enviadasAntes.find((a) => parecenca(t, a) >= 0.75 && digitos(a) === digitos(t))
      : undefined;
  if (repetida)
    problemas.push({
      regra: 'repetida',
      detalhe: `Está repetindo uma mensagem que já mandamos: "${repetida.slice(0, 120)}". Diga algo novo ou avance a conversa.`,
    });

  // Formatação que não existe no WhatsApp ou denuncia texto gerado.
  if (
    /\*\*|__|^#{1,6}\s|```|\[[^\]]+\]\([^)]+\)/m.test(t) ||
    /\{[a-z_]+\}|\[(nome|empresa|cidade|seu nome)\]/i.test(t)
  )
    problemas.push({
      regra: 'formatacao',
      detalhe:
        'Tire markdown (**, #, links entre colchetes) e campos de modelo como {nome} ou [nome]. Escreva como no WhatsApp.',
    });

  if (
    /(modelo de linguagem|base de conhecimento|minhas instrucoes|\bprompt\b|\bjson\b|nao tenho acesso a|nao tenho essa informacao na base)/.test(
      semAcento(t),
    )
  )
    problemas.push({
      regra: 'texto_de_robo',
      detalhe:
        'Não fale de instruções, base de conhecimento, prompt ou de ser um modelo de linguagem. Fale como alguém da empresa.',
    });

  // Promessas fortes que só valem se estiverem na base.
  const promessas =
    semAcento(t).match(/\b(garanti\w*|sem custo|gratis|gratuit\w*|100%|entrega no mesmo dia|desconto)\b/g) ??
    [];
  const promessasFora = promessas.filter((p) => !base.includes(p.slice(0, 7)));
  if (promessasFora.length)
    problemas.push({
      regra: 'promessa',
      detalhe: `Promessa que a base não sustenta: ${[...new Set(promessasFora)].join(', ')}. Não prometa o que não está escrito.`,
    });

  // "Vou verificar e te retorno" sem passar para o time: ninguém vai retornar.
  const st = semAcento(t);
  if (
    e.acao === 'responder' &&
    /\b(vou (verificar|confirmar|consultar|checar|ver com|levantar|conferir)|te (retorno|aviso|falo|respondo) (ja|logo|em breve|assim que)|ja te (retorno|respondo|falo)|vou te retornar)/.test(
      st,
    )
  )
    problemas.push({
      regra: 'retorno_sem_passar',
      detalhe:
        'Você prometeu verificar e retornar, mas ninguém do time foi avisado. Responda com o que está na base ou use "passar_para_humano".',
    });

  // "Está agendado/confirmado" sem marcar a reunião: o lead acha que tem reunião e ela não existe.
  if (
    e.acao !== 'marcar_reuniao' &&
    /\b(esta|ficou|fica|deixei) (agendad|marcad|confirmad)|\b(reuniao|conversa|visita) (agendada|marcada|confirmada)/.test(
      st,
    )
  )
    problemas.push({
      regra: 'agenda_sem_reuniao',
      detalhe:
        'Você disse que a reunião está marcada, mas não marcou. Se ele confirmou dia e hora, use "marcar_reuniao"; senão, ofereça horários.',
    });

  return problemas;
}

/**
 * Divide a resposta em até 3 bolhas, como uma pessoa escreve no WhatsApp: cada parágrafo é uma
 * mensagem; o que passar de 3 vai junto na última.
 */
export function emBolhas(texto: string, maximo = 3): string[] {
  const partes = texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length <= maximo) return partes.length ? partes : [texto.trim()];
  return [...partes.slice(0, maximo - 1), partes.slice(maximo - 1).join('\n\n')];
}
