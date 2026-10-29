import type { Pool } from '@prospeccao/db';
import type { MensagemIa, PedidoConversa } from '@prospeccao/integrations/ia';
import {
  type DadosAssistenteDTO,
  type GraficoDTO,
  type Logger,
  type TurnoAnterior,
  tarefaEntrada,
} from '@prospeccao/shared';
import type { UsuarioSessao } from '../../contexto.js';
import * as agenda from '../agenda/repositorio.js';
import { assinarEscopo, consultar, type Escopo, validarSql } from './acesso.js';
import {
  carregarCatalogo,
  catalogoDe,
  detalharTabelas,
  REGRAS_NEGOCIO,
  resumoDoCatalogo,
  type TabelaCatalogo,
} from './catalogo.js';
import { mascarar, restaurar } from './mascara.js';
import { embrulharDados, lerJson, montarContextoAgente, type PassoAgente, SISTEMA_AGENTE } from './prompt.js';
import { CONSULTAS_PRONTAS, consultaPronta, planoRapido } from './prontas.js';

export interface DepsAgente {
  /** Dono do banco (só para criar tarefas, pelas regras normais do sistema). */
  pool: Pool;
  /** Papel só leitura (as consultas da IA). Null: dados desligados. */
  leitura: Pool | null;
  /** Chave que assina o escopo. */
  chave: string | null;
  conversar: (p: PedidoConversa) => Promise<string>;
  raciocinio: PedidoConversa['raciocinio'];
  log: Logger;
  agora?: () => Date;
}

export interface RespostaAgente {
  fala: string;
  analise: string | null;
  dados: DadosAssistenteDTO | null;
  abrir: string | null;
  tarefa: { id: number; titulo: string } | null;
  passos: number;
  tempos: Record<string, number>;
  confirmar: boolean;
}

const MAX_PASSOS = 8;
const LINHAS_PARA_IA = 40;
const LINHAS_PARA_TELA = 50;
// Colunas com nomes de pessoas: o valor é mascarado antes de ir para a IA.
const COLUNA_DE_PESSOA = /(^|_)(responsavel|pessoa|autor|vendedor|nome_pessoa|decisor)($|_)/i;
// Nessas tabelas, até a coluna "nome" é de pessoa.
const TABELA_DE_PESSOA = /^(equipe|decisores)$/;

interface Resultado {
  id: string;
  titulo: string;
  origem: 'pronta' | 'livre';
  sql: string;
  colunas: string[];
  linhas: Record<string, unknown>[];
  cortado: boolean;
  totais: DadosAssistenteDTO['totais'];
  tabelas: string[];
  ms: number;
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x));

/** O escopo da pessoa: a própria unidade, as da organização (gestor/diretoria) ou tudo (master). */
export async function escopoDe(pool: Pool, u: UsuarioSessao): Promise<Escopo & { descricao: string }> {
  if (u.master)
    return {
      tudo: true,
      contas: [],
      descricao:
        'a plataforma inteira (é o dono do sistema): todas as organizações e unidades, mais as views plataforma_* (clientes, consumo, pedidos do site).',
    };
  if (u.papelOrganizacao) {
    const { rows } = await pool.query<{ id: number; nome: string; org: string }>(
      `SELECT c.id, c.nome, o.nome AS org FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
        WHERE c.organizacao_id = $1 ORDER BY c.nome`,
      [u.organizacaoId],
    );
    return {
      tudo: false,
      contas: rows.map((r) => r.id),
      descricao: `todas as unidades da organização ${rows[0]?.org ?? ''} (${rows.map((r) => r.nome).join(', ')}). ${
        u.papelOrganizacao === 'leitura'
          ? 'Acesso só de leitura (diretoria): não cria tarefas.'
          : 'É gestor da organização.'
      }`,
    };
  }
  // Na unidade: a pessoa vê a unidade toda ou só a própria base (o gestor escolhe na Equipe).
  if (u.soPropriaBase)
    return {
      tudo: false,
      contas: [u.contaId],
      dono: u.id,
      descricao: `só a base de ${u.nome} na unidade ${u.contaNome}: as negociações em que é a responsável, as tarefas dela e o que vem dessas empresas. Configurações da unidade (nichos, campanhas, etapas) aparecem; o resto da equipe e o consumo de IA, não. Se perguntarem da unidade toda, explique que o acesso é só da própria base.`,
    };
  return { tudo: false, contas: [u.contaId], descricao: `só a unidade ${u.contaNome}.` };
}

const hojeLocal = (d: Date) =>
  d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
const hojeIso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Argos: entende a pergunta, consulta o que precisar (em etapas) e responde. */
export async function agenteArgos(
  deps: DepsAgente,
  u: UsuarioSessao,
  pergunta: string,
  historico: TurnoAnterior[] = [],
): Promise<RespostaAgente> {
  const inicio = Date.now();
  const agora = (deps.agora ?? (() => new Date()))();
  const tempos: Record<string, number> = {};
  const comDados = !!(deps.leitura && deps.chave);
  const plano = comDados ? planoRapido(pergunta) : null;

  // O escopo assinado vale para esta pergunta (todas as etapas).
  const escopo = await escopoDe(deps.pool, u);
  const assinado = deps.chave ? assinarEscopo(deps.chave, escopo, 300, agora.getTime()) : '';
  const leitura = deps.leitura;

  // Tudo o que não depende da IA sai junto: o catálogo e, se der para prever, os dados.
  const [cat, preBusca] = await Promise.all([
    comDados && leitura
      ? carregarCatalogo(leitura).then(
          (c) => ({ c, erro: null as Error | null }),
          (erro: Error) => ({ c: [] as TabelaCatalogo[], erro }),
        )
      : null,
    plano && leitura ? rodarPronta(leitura, assinado, plano.nome, plano.parametros).catch(() => null) : null,
  ]);
  tempos.preparo = Date.now() - inicio;

  let avisoDados = '';
  let catalogo: TabelaCatalogo[] = [];
  if (!comDados)
    avisoDados = 'Os dados ainda não estão ligados ao Argos. Diga isso se a pergunta precisar de dados.';
  else if (cat?.erro) {
    avisoDados = 'O banco está fora do ar agora.';
    deps.log.warn({ erro: cat.erro.message }, 'argos: catálogo indisponível');
  } else catalogo = catalogoDe(cat?.c ?? [], u.master);
  const nomesTabelas = new Set(catalogo.map((t) => t.nome));

  const papel = u.master
    ? 'dono da plataforma'
    : u.papelOrganizacao === 'gestor'
      ? 'gestor da organização'
      : u.papelOrganizacao === 'leitura'
        ? 'diretoria (só leitura)'
        : u.papel;
  const sistema = `${SISTEMA_AGENTE}\n\n${montarContextoAgente({
    hoje: `${hojeLocal(agora)} (${hojeIso(agora)})`,
    pessoa: `${u.nome.split(' ')[0]} (${papel}, usuario_id ${u.id}, unidade atual ${u.contaNome})`,
    escopo: escopo.descricao,
    regras: REGRAS_NEGOCIO,
    prontas: CONSULTAS_PRONTAS.filter(
      (c) => c.nome !== 'por_unidade' || escopo.tudo || escopo.contas.length > 1,
    )
      .map((c) => `- ${c.nome}: ${c.descricao} Parâmetros: ${JSON.stringify(c.parametros)}`)
      .join('\n'),
    catalogo: catalogo.length ? resumoDoCatalogo(catalogo) : avisoDados,
  })}`;

  // Uma máscara para a conversa inteira: o mesmo nome vira sempre o mesmo marcador.
  const mapa = new Map<string, string>();
  const esconder = (texto: string, nomes: string[] = []) =>
    mascarar(texto, { nomes, mapaAnterior: mapa }).texto;
  // O nome de quem pergunta também não sai daqui.
  const nomesBase = [u.nome];

  const mensagens: MensagemIa[] = [];
  for (const t of historico.slice(-8)) {
    const nomes = [...nomesBase, ...nomesNoTexto(`${t.pergunta}\n${t.resposta}`)];
    mensagens.push({ papel: 'user', conteudo: esconder(`Pergunta:\n${embrulharDados(t.pergunta)}`, nomes) });
    mensagens.push({
      papel: 'assistant',
      conteudo: json({ acao: 'responder', fala: esconder(t.resposta, nomes) }),
    });
  }
  const hora = agora.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  mensagens.push({
    papel: 'user',
    conteudo: esconder(
      `Agora são ${hora}.${avisoDados ? ` ${avisoDados}` : ''}\nPergunta:\n${embrulharDados(pergunta)}`,
      nomesBase,
    ),
  });

  const resultados: Resultado[] = [];
  let tarefaCriada: RespostaAgente['tarefa'] = null;
  const observar = (texto: string, nomes: string[] = []) =>
    mensagens.push({ papel: 'user', conteudo: esconder(texto, [...nomesBase, ...nomes]) });

  const registrarResultado = (r: Resultado, extra = '') => {
    resultados.push(r);
    const amostra = r.linhas.slice(0, LINHAS_PARA_IA);
    observar(
      `Resultado ${r.id} — ${r.titulo}: ${r.linhas.length}${r.cortado ? '+ (cortado)' : ''} linhas, ${r.ms} ms.${extra}\n` +
        (Object.keys(r.totais).length ? `Totais: ${json(r.totais)}\n` : '') +
        `Colunas: ${r.colunas.join(', ')}\n` +
        embrulharDados(json(amostra)) +
        (r.linhas.length > LINHAS_PARA_IA
          ? `\n(mostrando ${LINHAS_PARA_IA} de ${r.linhas.length}; agregue no SQL se precisar do todo)`
          : ''),
      nomesDePessoas(amostra, r.tabelas),
    );
  };

  // A consulta prevista já voltou: entra como 1ª etapa, e a IA costuma responder de primeira.
  if (plano && preBusca) {
    mensagens.push({
      papel: 'assistant',
      conteudo: json({
        acao: 'pronta',
        nome: plano.nome,
        parametros: plano.parametros,
        pensamento: 'consulta pronta',
      }),
    });
    registrarResultado(
      { ...preBusca, id: 'r1' },
      ' Se isso já responde, responda agora; se a pergunta pedir outro recorte, consulte de novo.',
    );
  }

  for (let passo = 1; passo <= MAX_PASSOS; passo++) {
    const ultimo = passo === MAX_PASSOS;
    if (ultimo)
      observar(
        'Limite de etapas atingido. Responda agora com {"acao":"responder", ...} usando o que já tem.',
      );

    const t = Date.now();
    const bruto = await deps.conversar({
      sistema,
      mensagens,
      temperatura: 0.1,
      maxTokens: 1200,
      raciocinio: deps.raciocinio,
    });
    tempos[`ia${passo}`] = Date.now() - t;
    mensagens.push({ papel: 'assistant', conteudo: bruto });
    let p: PassoAgente;
    try {
      p = lerJson<PassoAgente>(bruto);
    } catch {
      observar('Sua resposta não era um JSON válido. Devolva só o objeto JSON da próxima ação.');
      continue;
    }
    deps.log.info({ passo, acao: p.acao, pensamento: p.pensamento?.slice(0, 200) }, 'argos: etapa');

    if (p.acao === 'responder' || ultimo) {
      const final = lerJson<PassoAgente>(restaurar(bruto, mapa));
      const escolhido =
        (final.mostrar && resultados.find((r) => r.id === final.mostrar)) ||
        [...resultados].reverse().find((r) => r.linhas.length) ||
        resultados.at(-1) ||
        null;
      const confirmar = final.confirmar === true;
      tempos.total = Date.now() - inicio;
      deps.log.info({ tempos, passos: passo }, 'argos: respondeu');
      return {
        fala: (final.fala ?? '').trim() || 'Pronto.',
        analise: confirmar ? null : final.analise?.trim() || null,
        dados: !confirmar && escolhido ? paraTela(escolhido, resultados, final, pergunta) : null,
        abrir: confirmar ? null : final.abrir?.trim() || null,
        tarefa: tarefaCriada,
        passos: passo,
        tempos,
        confirmar,
      };
    }

    switch (p.acao) {
      case 'colunas': {
        if (!catalogo.length) {
          observar(`Erro: ${avisoDados || 'sem catálogo'}`);
          break;
        }
        const pedidas = (p.tabelas ?? []).map((x) => String(x).replace(/^cerebro\./, ''));
        const existentes = pedidas.filter((x) => nomesTabelas.has(x)).slice(0, 8);
        const faltando = pedidas.filter((x) => !nomesTabelas.has(x));
        observar(
          `${existentes.length ? detalharTabelas(catalogo, existentes) : 'Nenhuma dessas tabelas existe.'}` +
            (faltando.length
              ? `\n\nNão existem: ${faltando.join(', ')}. Procure no catálogo um nome parecido.`
              : ''),
        );
        break;
      }

      case 'pronta':
      case 'sql': {
        if (!leitura || !assinado) {
          observar(`Erro: ${avisoDados}`);
          break;
        }
        const id = `r${resultados.length + 1}`;
        try {
          const t0 = Date.now();
          let r: Resultado;
          if (p.acao === 'pronta') {
            const parametros = JSON.parse(restaurar(json(p.parametros ?? {}), mapa)) as Record<
              string,
              unknown
            >;
            r = { ...(await rodarPronta(leitura, assinado, p.nome ?? '', parametros)), id };
          } else {
            // Marcadores ([CNPJ_1], [PESSOA_2]) voltam ao valor antes de consultar; depois, valida.
            const sql = validarSql(restaurar(p.sql ?? '', mapa));
            if (
              !catalogo.some((tb) => new RegExp(`\\b${tb.nome}\\b`, 'i').test(sql)) &&
              /\bfrom\b/i.test(sql)
            )
              throw new Error('Use as tabelas do catálogo.');
            const x = await consultar(leitura, assinado, sql, [], { limite: 200 });
            const tabelas = [...nomesTabelas].filter((nome) => new RegExp(`\\b${nome}\\b`, 'i').test(sql));
            r = {
              id,
              titulo: p.titulo?.trim() || 'Consulta',
              origem: 'livre',
              sql,
              colunas: x.colunas,
              linhas: x.linhas,
              cortado: x.cortado,
              totais: {},
              tabelas,
              ms: x.ms,
            };
          }
          tempos[`banco${passo}`] = Date.now() - t0;
          registrarResultado(r);
        } catch (erro) {
          const msg = (erro as Error).message.slice(0, 500);
          deps.log.warn({ erro: msg }, 'argos: consulta falhou');
          observar(`Erro na consulta: ${msg}\nConfira as colunas (acao "colunas") e tente de novo.`);
        }
        break;
      }

      case 'criar_tarefa': {
        if (u.papelOrganizacao === 'leitura') {
          observar(
            'Esta pessoa tem acesso só de leitura: não dá para criar tarefas. Explique isso na resposta.',
          );
          break;
        }
        if (tarefaCriada) {
          observar(`A tarefa "${tarefaCriada.titulo}" já foi criada agora. Não crie outra; responda.`);
          break;
        }
        try {
          const titulo =
            restaurar(p.titulo ?? '', mapa)
              .trim()
              .slice(0, 200) || pergunta.slice(0, 200);
          const inicioTarefa = lerInicio(p.inicio, agora);
          const entrada = tarefaEntrada.parse({
            tipo: ['tarefa', 'ligacao', 'reuniao', 'visita'].includes(String(p.tipo)) ? p.tipo : 'tarefa',
            titulo,
            descricao: p.descricao ? restaurar(p.descricao, mapa).slice(0, 2000) : undefined,
            inicio: inicioTarefa,
            usuarioId: u.id,
          });
          const idTarefa = await agenda.criar(deps.pool, entrada);
          tarefaCriada = { id: idTarefa, titulo };
          const quando = new Date(inicioTarefa).toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          observar(`Tarefa "${titulo}" criada na agenda da pessoa para ${quando}.`);
        } catch (erro) {
          observar(`Não consegui criar a tarefa: ${(erro as Error).message.slice(0, 300)}`);
        }
        break;
      }

      default:
        observar(`Ação "${String(p.acao)}" não existe. Use colunas, sql, pronta, criar_tarefa ou responder.`);
    }
  }
  return {
    fala: 'Não consegui concluir agora. Tente perguntar de outro jeito.',
    analise: null,
    dados: null,
    abrir: null,
    tarefa: tarefaCriada,
    passos: MAX_PASSOS,
    tempos: { ...tempos, total: Date.now() - inicio },
    confirmar: false,
  };
}

async function rodarPronta(
  pool: Pool,
  escopo: string,
  nome: string,
  parametros: Record<string, unknown>,
): Promise<Omit<Resultado, 'id'>> {
  const pronta = consultaPronta(nome);
  if (!pronta)
    throw new Error(
      `Consulta pronta "${nome}" não existe. Use: ${CONSULTAS_PRONTAS.map((c) => c.nome).join(', ')}.`,
    );
  const x = await pronta.executar(pool, escopo, parametros);
  return {
    titulo: x.titulo,
    origem: 'pronta',
    sql: x.sql,
    colunas: x.colunas,
    linhas: x.linhas,
    cortado: x.cortado,
    totais: x.totais,
    tabelas: [],
    ms: x.ms,
  };
}

/** "2026-10-30T15:00" no horário de Brasília → ISO. Sem data: daqui a 1 hora. */
function lerInicio(v: string | null | undefined, agora: Date): string {
  const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v.trim()) : null;
  if (!m) return new Date(agora.getTime() + 60 * 60_000).toISOString();
  // Brasília não tem horário de verão desde 2019: UTC-3 o ano todo.
  return new Date(`${m[1]}T${m[2] ?? '09'}:${m[3] ?? '00'}:00-03:00`).toISOString();
}

/**
 * Prováveis nomes próprios num texto livre: duas a cinco palavras com inicial maiúscula. Empresas
 * também entram — mascarar a mais é inofensivo, o marcador volta a ser o nome na resposta.
 */
export function nomesNoTexto(texto: string): string[] {
  const achados =
    texto.match(
      /(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+(?:[ \t]+(?:d[aeo]s?[ \t]+)?\p{Lu}\p{Ll}+){1,4}(?![\p{L}\p{N}])/gu,
    ) ?? [];
  return [...new Set(achados)].filter((n) => n.length >= 5).slice(0, 80);
}

/** Valores de colunas de pessoa, para a máscara. */
function nomesDePessoas(linhas: Record<string, unknown>[], tabelas: string[]): string[] {
  const deTabelaDePessoa = tabelas.some((t) => TABELA_DE_PESSOA.test(t));
  const nomes = new Set<string>();
  for (const l of linhas)
    for (const [col, v] of Object.entries(l))
      if (typeof v === 'string' && (COLUNA_DE_PESSOA.test(col) || (deTabelaDePessoa && /^nome$/i.test(col))))
        nomes.add(v);
  return [...nomes];
}

function paraTela(
  r: Resultado,
  todos: Resultado[],
  final: PassoAgente,
  pergunta: string,
): DadosAssistenteDTO {
  const outras = todos.filter((x) => x !== r);
  return {
    titulo: r.titulo,
    origem: r.origem,
    colunas: r.colunas,
    linhas: r.linhas.slice(0, LINHAS_PARA_TELA),
    cortado: r.cortado || r.linhas.length > LINHAS_PARA_TELA,
    totais: r.totais,
    destaques: (final.destaques ?? [])
      .filter((d) => d?.rotulo && d?.valor)
      .slice(0, 4)
      .map((d) => ({ rotulo: String(d.rotulo), valor: String(d.valor) })),
    analise: final.analise?.trim() || null,
    sql: [r.sql, ...outras.map((o) => `-- ${o.titulo}\n${o.sql}`)].join('\n\n'),
    explicacao: todos.length > 1 ? `${todos.length} consultas para chegar na resposta.` : null,
    tabelas: [...new Set(todos.flatMap((x) => x.tabelas))],
    ms: todos.reduce((s, x) => s + x.ms, 0),
    grafico: lerGrafico(final.grafico, r, pergunta),
  };
}

const PEDIU_GRAFICO = /gr[aá]fico|grafic|barras?|pizza|linha do tempo|evolu[cç][aã]o|tend[eê]ncia|compar/i;
const ehNumero = (v: unknown) =>
  v === null ||
  typeof v === 'number' ||
  typeof v === 'bigint' ||
  (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));

/** O gráfico que a IA sugeriu, conferido contra o resultado (só colunas que existem, só números em y). */
export function lerGrafico(
  g: PassoAgente['grafico'],
  r: Pick<Resultado, 'colunas' | 'linhas'>,
  pergunta: string,
): GraficoDTO | null {
  if (!g || typeof g !== 'object' || !r.linhas.length) return null;
  const tipo = g.tipo === 'linha' || g.tipo === 'barras' || g.tipo === 'pizza' ? g.tipo : null;
  if (!tipo || !g.x || !r.colunas.includes(g.x)) return null;
  const amostra = r.linhas.slice(0, 20);
  const pedidos = (Array.isArray(g.y) ? g.y : g.y ? [g.y] : []).filter(
    (c): c is string => typeof c === 'string',
  );
  const y = [...new Set(pedidos)]
    .filter((c) => c !== g.x && r.colunas.includes(c) && amostra.every((l) => ehNumero(l[c])))
    .slice(0, tipo === 'pizza' ? 1 : 3);
  if (!y.length) return null;
  if (tipo === 'pizza' && r.linhas.length > 12) return null;
  return {
    tipo,
    x: g.x,
    y,
    titulo: typeof g.titulo === 'string' && g.titulo.trim() ? g.titulo.trim().slice(0, 120) : null,
    principal: PEDIU_GRAFICO.test(pergunta),
  };
}
