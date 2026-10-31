import { randomBytes } from 'node:crypto';
import { type Executor, INICIO_MES_SP_TS, type Pool } from '@prospeccao/db';
import type { Armazenamento, ConfigTranscricao } from '@prospeccao/integrations/reuniao';
import type { ServicoTelefonia } from '@prospeccao/integrations/telefonia';
import {
  AppError,
  type IniciarLigacaoEntrada,
  minutosCobrados,
  numeroDeSaida,
  ordenarTelefones,
  type ResultadoLigacaoEntrada,
  ROTULO_RESULTADO_LIGACAO,
  SEM_CONVERSA,
  TELEFONIA_PADRAO,
  type TelefoneBruto,
  type TelefoniaConfigEntrada,
} from '@prospeccao/shared';
import { conta, contaSql, donoDaBase, usuarioAtual } from '../../contexto.js';
import { contratoDaConta } from '../../recursos.js';
import { visivel } from '../../visibilidade.js';
import * as agenda from '../agenda/repositorio.js';
import * as contatos from '../contatos/repositorio.js';
import { registrarFeedback } from '../empresas/repositorio.js';
import * as funil from '../funil/repositorio.js';

/**
 * Ligações pelo CRM. O comercial liga pelo navegador: a api abre a sala no LiveKit, dá o acesso e,
 * quando o navegador já está na sala, manda discar para o lead com o número da empresa. O navegador
 * conta o que acontece (tocou, atendeu, terminou), grava os dois lados e manda os arquivos quando
 * desliga; depois a IA transcreve e resume (processar.ts).
 */

export interface DepsTelefonia {
  /** LiveKit com o tronco SIP do provedor (sem ele, o módulo explica o que falta). */
  servico: ServicoTelefonia | null;
  /** Onde as gravações ficam (sem ele, liga sem gravar). */
  armazenamento: Armazenamento | null;
  /** Whisper (sem ele, grava sem transcrever). */
  transcricao: ConfigTranscricao | null;
  /** Voz para tocar o aviso de gravação (sem ela, o comercial lê o aviso). */
  fala: { falar(texto: string, o: { voz: string; velocidade: number }): Promise<Uint8Array> } | null;
}

export const SEM_TELEFONIA: DepsTelefonia = {
  servico: null,
  armazenamento: null,
  transcricao: null,
  fala: null,
};

const ABERTAS = `('preparando', 'chamando', 'tocando', 'em_andamento')`;

/* ───────────────────────────── Plano e configuração ───────────────────────────── */

/** O módulo Ligações está no plano? (Conta sem plano tem tudo.) */
export async function temModulo(db: Executor, contaId: number = conta()): Promise<boolean> {
  const c = await contratoDaConta(db, contaId).catch(() => null);
  return !c || c.modulos.includes('ligacoes');
}

export async function exigirModulo(db: Executor): Promise<void> {
  if (!(await temModulo(db)))
    throw new AppError(
      403,
      'fora_do_plano',
      'Ligações é um módulo à parte (com franquia de minutos). Fale com a gente para liberar.',
      { detalhes: { modulo: 'ligacoes' } },
    );
}

export async function config(db: Executor): Promise<TelefoniaConfigEntrada> {
  const { rows } = await db.query<TelefoniaConfigEntrada>(
    `SELECT gravar, aviso_gravacao AS "avisoGravacao", aviso_falado AS "avisoFalado", transcrever,
            toque_segundos AS "toqueSegundos", mesmo_ddd AS "mesmoDdd", guardar_meses AS "guardarMeses"
       FROM comercial.telefonia_contas WHERE conta_id = ${contaSql()}`,
  );
  return rows[0] ?? TELEFONIA_PADRAO;
}

export async function salvarConfig(db: Executor, c: TelefoniaConfigEntrada): Promise<void> {
  await db.query(
    `INSERT INTO comercial.telefonia_contas
       (conta_id, gravar, aviso_gravacao, aviso_falado, transcrever, toque_segundos, mesmo_ddd, guardar_meses)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conta_id) DO UPDATE SET gravar = $1, aviso_gravacao = $2, aviso_falado = $3, transcrever = $4,
       toque_segundos = $5, mesmo_ddd = $6, guardar_meses = $7, atualizado_em = now()`,
    [c.gravar, c.avisoGravacao, c.avisoFalado, c.transcrever, c.toqueSegundos, c.mesmoDdd, c.guardarMeses],
  );
}

export interface NumeroEmpresa {
  id: number;
  numero: string;
  rotulo: string | null;
  principal: boolean;
}

export async function numeros(db: Executor, contaId: number = conta()): Promise<NumeroEmpresa[]> {
  const { rows } = await db.query<NumeroEmpresa>(
    `SELECT id::int, numero, rotulo, principal FROM comercial.telefonia_numeros
      WHERE conta_id = $1 AND ativo ORDER BY principal DESC, id`,
    [contaId],
  );
  return rows;
}

/** Minutos de ligação usados no mês pela organização toda (cada ligação atendida arredonda para cima). */
export async function minutosNoMes(db: Executor, contaId: number = conta()): Promise<number> {
  const { rows } = await db.query<{ m: number }>(
    `SELECT coalesce(sum(ceil(l.duracao_segundos / 60.0)), 0)::int AS m
       FROM comercial.ligacoes l JOIN cadastro.contas c ON c.id = l.conta_id
      WHERE c.organizacao_id = (SELECT organizacao_id FROM cadastro.contas WHERE id = $1)
        AND l.atendida_em IS NOT NULL AND l.iniciada_em >= ${INICIO_MES_SP_TS}`,
    [contaId],
  );
  return rows[0]?.m ?? 0;
}

/** O que a tela precisa para saber se dá para ligar (e por que não). */
export async function situacao(db: Executor, deps: DepsTelefonia) {
  const [modulo, cfg, nums, usados, contrato] = await Promise.all([
    temModulo(db),
    config(db),
    numeros(db),
    minutosNoMes(db),
    contratoDaConta(db).catch(() => null),
  ]);
  const motivo = !modulo
    ? 'fora_do_plano'
    : !deps.servico
      ? 'sem_telefonia'
      : !nums.length
        ? 'sem_numero'
        : null;
  return {
    modulo,
    disponivel: !motivo,
    motivo,
    numeros: nums,
    config: cfg,
    minutos: { usados, franquia: contrato ? contrato.minutosLigacao : null },
    gravacao: !!deps.armazenamento && cfg.gravar,
    transcricao: !!deps.armazenamento && !!deps.transcricao && cfg.gravar && cfg.transcrever,
    avisoFalado: !!deps.fala && cfg.avisoFalado,
  };
}

/* ───────────────────────────── Números do lead ───────────────────────────── */

/** Todos os números do lead, de todas as fontes, na ordem em que o CRM tenta. */
export async function telefonesDoLead(db: Executor, empresaId: number) {
  const C = contaSql();
  const [enriq, pessoas, empresa, confirmados, tentativas, errados] = await Promise.all([
    db.query<{
      valor: string;
      canal: string;
      rotulo: string | null;
      principal: boolean;
      whatsapp: boolean | null;
    }>(
      `SELECT c.valor, c.canal, coalesce(p.nome || coalesce(' · ' || p.cargo, ''), c.rotulo) AS rotulo,
              c.principal, (c.canal = 'whatsapp' OR c.whatsapp IS TRUE) AS whatsapp
         FROM enriquecimento.contatos c LEFT JOIN enriquecimento.pessoas p ON p.id = c.pessoa_id
        WHERE c.empresa_id = $1 AND c.canal IN ('whatsapp', 'telefone') AND ${visivel('c')}`,
      [empresaId],
    ),
    db.query<{ telefone: string; nome: string; cargo: string | null }>(
      `SELECT telefone, nome, cargo FROM comercial.contatos_lead
        WHERE conta_id = ${C} AND empresa_id = $1 AND status = 'confirmado' AND telefone IS NOT NULL`,
      [empresaId],
    ),
    db.query<{ maps: string | null; receita: string[] | null }>(
      `SELECT maps_telefone AS maps, telefones_receita AS receita FROM descoberta.empresas WHERE id = $1`,
      [empresaId],
    ),
    db.query<{ telefone: string }>(
      `SELECT telefone FROM comercial.telefones_confirmados WHERE conta_id = ${C} AND empresa_id = $1`,
      [empresaId],
    ),
    db.query<{ telefone: string; n: number; em: string; resultado: TelefoneBruto['ultimoResultado'] }>(
      `SELECT DISTINCT ON (telefone) telefone, count(*) OVER (PARTITION BY telefone)::int AS n,
              iniciada_em AS em, resultado
         FROM comercial.ligacoes WHERE conta_id = ${C} AND empresa_id = $1 AND direcao = 'saida'
        ORDER BY telefone, iniciada_em DESC`,
      [empresaId],
    ),
    db.query<{ valor: string }>(
      `SELECT valor FROM comercial.feedback WHERE empresa_id = $1 AND tipo = 'numero_errado'`,
      [empresaId],
    ),
  ]);
  const errado = new Set(errados.rows.map((r) => r.valor.replace(/\D/g, '').slice(-8)));
  const conf = new Set(confirmados.rows.map((r) => r.telefone.slice(-8)));
  const tent = new Map(tentativas.rows.map((r) => [r.telefone.slice(-8), r]));
  const extras = (numero: string): Partial<TelefoneBruto> => {
    const k = numero.replace(/\D/g, '').slice(-8);
    const t = tent.get(k);
    return {
      errado: errado.has(k),
      confirmado: conf.has(k),
      ultimaEm: t ? new Date(t.em).toISOString() : null,
      ultimoResultado: t?.resultado ?? null,
      tentativas: t?.n ?? 0,
    };
  };
  const brutos: TelefoneBruto[] = [
    ...pessoas.rows.map((p) => ({
      numero: p.telefone,
      origem: 'contato' as const,
      rotulo: [p.nome, p.cargo].filter(Boolean).join(' · '),
      ...extras(p.telefone),
    })),
    ...enriq.rows.map((c) => ({
      numero: c.valor,
      origem: c.canal === 'whatsapp' ? ('whatsapp' as const) : ('enriquecimento' as const),
      rotulo: c.rotulo,
      principal: c.principal,
      whatsapp: c.whatsapp,
      ...extras(c.valor),
    })),
    ...(empresa.rows[0]?.maps
      ? [
          {
            numero: empresa.rows[0].maps,
            origem: 'google' as const,
            rotulo: 'Perfil no Google',
            ...extras(empresa.rows[0].maps),
          },
        ]
      : []),
    ...(empresa.rows[0]?.receita ?? []).map((n) => ({
      numero: n,
      origem: 'receita' as const,
      rotulo: 'Cadastro da Receita',
      ...extras(n),
    })),
  ];
  return ordenarTelefones(brutos);
}

/* ───────────────────────────── A ligação ───────────────────────────── */

export interface Ligacao {
  id: number;
  contaId: number;
  empresaId: number | null;
  usuarioId: number | null;
  telefone: string;
  numeroEmpresa: string | null;
  sala: string;
  situacao: 'preparando' | 'chamando' | 'tocando' | 'em_andamento' | 'encerrada' | 'falhou';
  atendidaEm: Date | null;
  encerradaEm: Date | null;
  duracaoSegundos: number | null;
  resultado: string | null;
  gravar: boolean;
  processamento: string;
}

const CAMPOS = `l.id::int, l.conta_id AS "contaId", l.empresa_id::int AS "empresaId", l.usuario_id AS "usuarioId",
  l.telefone, l.numero_empresa AS "numeroEmpresa", l.sala, l.situacao, l.atendida_em AS "atendidaEm",
  l.encerrada_em AS "encerradaEm", l.duracao_segundos AS "duracaoSegundos", l.resultado, l.gravar, l.processamento`;

export async function ligacao(db: Executor, id: number): Promise<Ligacao> {
  const { rows } = await db.query<Ligacao>(
    `SELECT ${CAMPOS} FROM comercial.ligacoes l WHERE l.id = $1 AND l.conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Ligação');
  return rows[0];
}

/** Só quem ligou mexe na ligação (o administrador também, para resolver uma esquecida). */
export async function minha(db: Executor, id: number): Promise<Ligacao> {
  const l = await ligacao(db, id);
  const u = usuarioAtual();
  if (l.usuarioId && u && l.usuarioId !== u.id && u.papel !== 'admin' && !u.master)
    throw AppError.proibido('Esta ligação é de outra pessoa.');
  return l;
}

/** Ligação que esta pessoa pode ver (quem vê só a própria base vê só as suas). */
export async function visivelParaMim(db: Executor, id: number): Promise<Ligacao> {
  const l = await ligacao(db, id);
  const d = donoDaBase();
  if (d && l.usuarioId !== d) throw AppError.naoEncontrado('Ligação');
  return l;
}

const nomeSala = (contaId: number) => `lig-${contaId}-${randomBytes(6).toString('hex')}`;

/**
 * Prepara a ligação: confere plano, número e lead, abre a sala e devolve o acesso do navegador. A
 * discagem vem depois (discar), quando o navegador já está na sala com o microfone ligado.
 */
export async function iniciar(db: Executor, deps: DepsTelefonia, d: IniciarLigacaoEntrada) {
  await exigirModulo(db);
  if (!deps.servico)
    throw AppError.invalido(
      'A telefonia ainda não foi ligada na plataforma. Fale com o suporte do Prospect Team.',
    );
  const u = usuarioAtual();
  if (!u) throw AppError.naoAutorizado();
  const nums = await numeros(db);
  const cfg = await config(db);
  const saida = numeroDeSaida(nums, d.telefone, cfg.mesmoDdd);
  if (!saida)
    throw AppError.invalido(
      'A conta ainda não tem número de telefone para ligar. Peça ao suporte do Prospect Team em Gestão › Telefonia.',
    );
  let lead: string | null = null;
  if (d.empresaId) {
    const { rows } = await db.query<{ nome: string; nao_ligar_em: Date | null }>(
      `SELECT coalesce(e.maps_nome, e.nome) AS nome, o.nao_ligar_em
         FROM descoberta.empresas e
         LEFT JOIN comercial.oportunidades o ON o.conta_id = ${contaSql()} AND o.empresa_id = e.id
        WHERE e.id = $1`,
      [d.empresaId],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Lead');
    if (rows[0].nao_ligar_em)
      throw AppError.conflito('Este lead pediu para não receber ligações. Use outro canal.');
    lead = rows[0].nome;
  }
  // Uma ligação por vez para cada pessoa (outra aba esquecida aberta é encerrada).
  const { rows: abertas } = await db.query<{ id: number; sala: string }>(
    `SELECT id::int, sala FROM comercial.ligacoes
      WHERE conta_id = ${contaSql()} AND usuario_id = $1 AND situacao IN ${ABERTAS}`,
    [u.id],
  );
  for (const a of abertas) await encerrar(db, deps, a.id, 'nova ligação');

  const sala = nomeSala(conta());
  const gravar = !!deps.armazenamento && cfg.gravar;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.ligacoes (conta_id, empresa_id, usuario_id, telefone, numero_empresa, sala, gravar)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6) RETURNING id::int`,
    [d.empresaId, u.id, d.telefone, saida.numero, sala, gravar],
  );
  const id = rows[0]!.id;
  try {
    await deps.servico.abrirSala(sala);
  } catch (e) {
    await falhou(db, id, (e as Error).message);
    throw AppError.externo('Telefonia', 'Não deu para preparar a ligação agora. Tente de novo.', e);
  }
  const identidade = `u${u.id}`;
  return {
    id,
    sala,
    url: deps.servico.urlCliente,
    token: await deps.servico.acesso({ sala, identidade, nome: u.nome }),
    identidade,
    telefone: d.telefone,
    numeroEmpresa: saida.numero,
    lead,
    empresaId: d.empresaId,
    gravar,
    aviso: gravar ? { texto: cfg.avisoGravacao, falado: !!deps.fala && cfg.avisoFalado } : null,
  };
}

/** O navegador já está na sala: liga para o lead. */
export async function discar(db: Executor, deps: DepsTelefonia, id: number): Promise<void> {
  const l = await minha(db, id);
  if (l.situacao !== 'preparando') return;
  if (!deps.servico) throw AppError.invalido('A telefonia não está ligada.');
  const cfg = await config(db);
  const { rows } = await db.query<{ nome: string | null }>(
    `SELECT coalesce(e.maps_nome, e.nome) AS nome FROM descoberta.empresas e WHERE e.id = $1`,
    [l.empresaId ?? 0],
  );
  try {
    await deps.servico.discar({
      sala: l.sala,
      numero: l.telefone,
      de: l.numeroEmpresa,
      nome: rows[0]?.nome ?? 'Lead',
      toqueSegundos: cfg.toqueSegundos,
    });
  } catch (e) {
    await falhou(db, id, (e as Error).message);
    await deps.servico.encerrar(l.sala).catch(() => undefined);
    throw AppError.externo('Telefonia', 'A ligação não completou. Confira o número e tente de novo.', e);
  }
  await db.query(
    `UPDATE comercial.ligacoes SET situacao = 'chamando' WHERE id = $1 AND situacao = 'preparando'`,
    [id],
  );
}

async function falhou(db: Executor, id: number, erro: string): Promise<void> {
  await db.query(
    `UPDATE comercial.ligacoes SET situacao = 'falhou', encerrada_em = now(), duracao_segundos = 0,
            motivo_fim = 'falhou', erro = $2
      WHERE id = $1 AND situacao IN ${ABERTAS}`,
    [id, erro.slice(0, 300)],
  );
}

/** O que o navegador viu na sala. */
export async function registrarEstado(
  db: Executor,
  deps: DepsTelefonia,
  id: number,
  evento: 'tocando' | 'atendeu' | 'encerrou' | 'falhou',
  motivo?: string | null,
): Promise<void> {
  await minha(db, id);
  if (evento === 'tocando')
    await db.query(
      `UPDATE comercial.ligacoes SET situacao = 'tocando' WHERE id = $1 AND situacao IN ('preparando', 'chamando')`,
      [id],
    );
  else if (evento === 'atendeu')
    await db.query(
      `UPDATE comercial.ligacoes SET situacao = 'em_andamento', atendida_em = coalesce(atendida_em, now())
        WHERE id = $1 AND situacao IN ('preparando', 'chamando', 'tocando')`,
      [id],
    );
  else if (evento === 'falhou') {
    await falhou(db, id, motivo ?? 'falhou no navegador');
    const l = await ligacao(db, id);
    await deps.servico?.encerrar(l.sala).catch(() => undefined);
  } else await encerrar(db, deps, id, motivo ?? 'desligou');
}

/**
 * Encerra a ligação (quem desligou, a sala que fechou ou a ligação esquecida aberta). A duração
 * conta do atendimento até aqui. Com gravação, o processamento espera os arquivos do navegador.
 */
export async function encerrar(db: Executor, deps: DepsTelefonia, id: number, motivo: string): Promise<void> {
  const { rows } = await db.query<{ sala: string }>(
    `UPDATE comercial.ligacoes
        SET situacao = 'encerrada', encerrada_em = now(), motivo_fim = $2,
            duracao_segundos = CASE WHEN atendida_em IS NULL THEN 0
                                    ELSE greatest(0, extract(epoch FROM now() - atendida_em))::int END,
            processamento = CASE WHEN gravar AND atendida_em IS NOT NULL THEN 'aguardando' ELSE 'sem_gravacao' END,
            -- Espera os arquivos do navegador (chegam em segundos; a rodada confere de novo).
            processar_em = CASE WHEN gravar AND atendida_em IS NOT NULL THEN now() + interval '1 minute' END
      WHERE id = $1 AND situacao IN ${ABERTAS}
      RETURNING sala`,
    [id, motivo.slice(0, 120)],
  );
  if (rows[0]) await deps.servico?.encerrar(rows[0].sala).catch(() => undefined);
}

/* ───────────────────────────── Gravação ───────────────────────────── */

export const LIMITE_AUDIO = 30 * 1024 * 1024;

/** Um arquivo gravado pelo navegador (a sua voz, a do lead ou a conversa junta). */
export async function receberAudio(
  db: Executor,
  deps: DepsTelefonia,
  id: number,
  quem: 'voce' | 'lead' | 'conversa',
  corpo: Uint8Array,
  tipo: string,
  deslocamentoMs: number,
): Promise<void> {
  const l = await minha(db, id);
  if (!l.gravar || !deps.armazenamento) throw AppError.invalido('Esta ligação não é gravada.');
  if (!corpo.length) throw AppError.invalido('Arquivo vazio.');
  const extensao = /ogg/.test(tipo) ? 'ogg' : /mp4|m4a|aac/.test(tipo) ? 'm4a' : 'webm';
  const chave = `ligacoes/${l.contaId}/${l.id}/${quem}.${extensao}`;
  await deps.armazenamento.enviar(chave, corpo, tipo || 'audio/webm');
  await db.query(
    `INSERT INTO comercial.ligacao_audios (ligacao_id, conta_id, quem, chave, tipo, bytes, deslocamento_ms)
     VALUES ($1, ${contaSql()}, $2, $3, $4, $5, $6)
     ON CONFLICT (ligacao_id, quem) DO UPDATE SET chave = EXCLUDED.chave, tipo = EXCLUDED.tipo,
       bytes = EXCLUDED.bytes, deslocamento_ms = EXCLUDED.deslocamento_ms`,
    [l.id, quem, chave, tipo || 'audio/webm', corpo.length, Math.max(0, Math.round(deslocamentoMs))],
  );
  // Chegaram os dois lados: processa já.
  await db.query(
    `UPDATE comercial.ligacoes SET processar_em = now()
      WHERE id = $1 AND processamento = 'aguardando'
        AND (SELECT count(*) FROM comercial.ligacao_audios a WHERE a.ligacao_id = $1 AND a.quem IN ('voce', 'lead')) = 2`,
    [l.id],
  );
}

/* ───────────────────────────── "Como foi?" ───────────────────────────── */

/**
 * Guarda o resultado e aplica no lead o que a pessoa marcou: o registro no histórico (a etapa anda
 * sozinha como num contato registrado), número confirmado ou errado, "não ligar mais", etapa,
 * reunião, contatos novos e o retorno.
 */
export async function salvarResultado(pool: Pool, id: number, d: ResultadoLigacaoEntrada): Promise<void> {
  const l = await minha(pool, id);
  if (['preparando', 'chamando', 'tocando', 'em_andamento'].includes(l.situacao))
    throw AppError.conflito('A ligação ainda está em andamento.');
  const primeira = !l.resultado;
  const { rows: r } = await pool.query<{ resumo: { resumo?: string; proximoPasso?: string | null } | null }>(
    `UPDATE comercial.ligacoes SET resultado = $2, nota = $3, resultado_em = now() WHERE id = $1 RETURNING resumo`,
    [id, d.resultado, d.nota ?? null],
  );
  if (!l.empresaId) return;
  const empresaId = l.empresaId;
  const u = usuarioAtual();
  const autor = u?.nome ?? 'sistema';

  if (primeira) {
    const conversou = d.resultado === 'conversou';
    const resumo = r[0]?.resumo?.resumo;
    const texto =
      d.nota?.trim() ||
      (resumo
        ? `Resumo da ligação: ${resumo}`
        : `${ROTULO_RESULTADO_LIGACAO[d.resultado]} (ligação pelo CRM)`);
    // Conversou: o lead respondeu (etapa anda para Respondeu); senão, contato feito (Abordado).
    await funil.registrarAtividade(
      pool,
      empresaId,
      { tipo: 'ligacao', direcao: conversou ? 'recebida' : 'enviada', texto, contato: l.telefone },
      autor,
    );
    await pool.query(
      `UPDATE comercial.atividades SET ligacao_id = $2
        WHERE id = (SELECT max(id) FROM comercial.atividades
                     WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND tipo = 'ligacao' AND ligacao_id IS NULL)`,
      [empresaId, id],
    );
  }

  if (d.resultado === 'conversou')
    await pool.query(
      `INSERT INTO comercial.telefones_confirmados (conta_id, empresa_id, telefone, usuario_id)
       VALUES (${contaSql()}, $1, $2, $3) ON CONFLICT DO NOTHING`,
      [empresaId, l.telefone, u?.id ?? null],
    );
  if (d.resultado === 'numero_errado')
    await registrarFeedback(
      pool,
      empresaId,
      { tipo: 'numero_errado', valor: l.telefone, canal: 'telefone' },
      autor,
    );
  if (d.resultado === 'nao_ligar')
    await pool.query(
      `UPDATE comercial.oportunidades SET nao_ligar_em = now() WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [empresaId],
    );

  if (d.etapaId)
    await funil.atualizar(
      pool,
      empresaId,
      { etapaId: d.etapaId, motivo: d.motivo ?? d.nota ?? 'Pela ligação' },
      autor,
    );
  if (d.reuniao) {
    const { rows: n } = await pool.query<{ nome: string }>(
      'SELECT coalesce(maps_nome, nome) AS nome FROM descoberta.empresas WHERE id = $1',
      [empresaId],
    );
    await agenda.criar(pool, {
      empresaId,
      tipo: 'reuniao',
      titulo: `Reunião com ${n[0]?.nome ?? 'o lead'}`,
      inicio: d.reuniao.inicio,
      descricao: r[0]?.resumo?.proximoPasso ?? null,
      sala: d.reuniao.sala
        ? { entrada: 'livre', gravar: true, transcrever: true, abreMinutosAntes: 10 }
        : null,
    });
  }
  for (const c of d.contatos)
    await contatos
      .criar(pool, empresaId, {
        nome: c.nome,
        cargo: c.cargo ?? null,
        telefone: c.telefone ?? null,
        decisor: c.decisor,
      } as Parameters<typeof contatos.criar>[2])
      .catch((e) => {
        // Já estava nos contatos: tudo certo.
        if (!(e instanceof AppError)) throw e;
      });
  if (d.retornarEm && SEM_CONVERSA.has(d.resultado))
    await agenda.criar(pool, {
      empresaId,
      tipo: 'ligacao',
      titulo: 'Ligar de novo',
      inicio: d.retornarEm,
    });
}

/* ───────────────────────────── Leitura ───────────────────────────── */

const CAMPOS_LISTA = `l.id::int, l.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS "leadNome",
  l.usuario_id AS "usuarioId", u.nome AS "usuarioNome", l.direcao, l.telefone, l.numero_empresa AS "numeroEmpresa",
  l.situacao, l.iniciada_em AS "iniciadaEm", l.atendida_em AS "atendidaEm", l.duracao_segundos AS "duracaoSegundos",
  l.resultado, l.processamento, l.resumo->>'resumo' AS resumo, l.resumo->>'clima' AS clima,
  l.resumo->>'sentimento' AS sentimento, l.nota,
  EXISTS (SELECT 1 FROM comercial.ligacao_audios a WHERE a.ligacao_id = l.id) AS gravada`;

export async function doLead(db: Executor, empresaId: number) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS_LISTA}
       FROM comercial.ligacoes l
       LEFT JOIN descoberta.empresas e ON e.id = l.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = l.usuario_id
      WHERE l.conta_id = ${contaSql()} AND l.empresa_id = $1
      ORDER BY l.iniciada_em DESC LIMIT 20`,
    [empresaId],
  );
  const { rows: op } = await db.query<{ nao_ligar_em: Date | null }>(
    `SELECT nao_ligar_em FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  return {
    telefones: await telefonesDoLead(db, empresaId),
    ligacoes: rows,
    naoLigar: op[0]?.nao_ligar_em ?? null,
  };
}

export async function lista(
  db: Executor,
  f: {
    usuarioId: number | null;
    resultado?: string | null;
    dias: number;
    limite: number;
    empresaId?: number | null;
  },
) {
  const valores: unknown[] = [f.dias];
  if (f.empresaId) valores.push(f.empresaId);
  const where = [`l.conta_id = ${contaSql()}`, `l.iniciada_em >= now() - make_interval(days => $1::int)`];
  if (f.empresaId) where.push('l.empresa_id = $2');
  if (f.usuarioId) {
    valores.push(f.usuarioId);
    where.push(`l.usuario_id = $${valores.length}`);
  }
  if (f.resultado === 'sem_resultado') where.push(`l.resultado IS NULL AND l.situacao = 'encerrada'`);
  else if (f.resultado) {
    valores.push(f.resultado);
    where.push(`l.resultado = $${valores.length}`);
  }
  const [lig, tot] = await Promise.all([
    db.query(
      `SELECT ${CAMPOS_LISTA}
         FROM comercial.ligacoes l
         LEFT JOIN descoberta.empresas e ON e.id = l.empresa_id
         LEFT JOIN cadastro.usuarios u ON u.id = l.usuario_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.iniciada_em DESC LIMIT $${valores.length + 1}`,
      [...valores, f.limite],
    ),
    db.query<{ feitas: number; atendidas: number; conversas: number; segundos: number }>(
      `SELECT count(*)::int AS feitas, count(*) FILTER (WHERE atendida_em IS NOT NULL)::int AS atendidas,
              count(*) FILTER (WHERE resultado = 'conversou')::int AS conversas,
              coalesce(sum(duracao_segundos), 0)::int AS segundos
         FROM comercial.ligacoes l
        WHERE ${where.join(' AND ')}`,
      valores,
    ),
  ]);
  return { ligacoes: lig.rows, totais: tot.rows[0] };
}

export async function detalhe(db: Executor, deps: DepsTelefonia, id: number) {
  await visivelParaMim(db, id);
  const { rows } = await db.query(
    `SELECT ${CAMPOS_LISTA}, l.encerrada_em AS "encerradaEm", l.motivo_fim AS "motivoFim", l.transcricao,
            l.resumo AS "resumoCompleto", l.erro
       FROM comercial.ligacoes l
       LEFT JOIN descoberta.empresas e ON e.id = l.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = l.usuario_id
      WHERE l.id = $1`,
    [id],
  );
  const [falas, audios] = await Promise.all([
    db.query(
      `SELECT quem, nome, inicio_ms AS "inicioMs", fim_ms AS "fimMs", texto
         FROM comercial.ligacao_falas WHERE ligacao_id = $1 ORDER BY inicio_ms, id`,
      [id],
    ),
    db.query<{ quem: string; chave: string }>(
      `SELECT quem, chave FROM comercial.ligacao_audios WHERE ligacao_id = $1`,
      [id],
    ),
  ]);
  // Para ouvir: a conversa junta (ou, sem ela, a voz do lead).
  const ouvir = audios.rows.find((a) => a.quem === 'conversa') ?? audios.rows.find((a) => a.quem === 'lead');
  const audio =
    ouvir && deps.armazenamento
      ? await deps.armazenamento.urlAssinada(ouvir.chave, { segundos: 3600 })
      : null;
  return { ...rows[0], falas: falas.rows, audio };
}

/** Minutos por usado com a franquia (para avisar perto do limite). */
export async function usoDoMes(db: Executor) {
  const [usados, contrato] = await Promise.all([minutosNoMes(db), contratoDaConta(db).catch(() => null)]);
  const franquia = contrato?.minutosLigacao ?? null;
  return { usados, franquia, excedente: franquia == null ? 0 : Math.max(0, usados - franquia) };
}

export { minutosCobrados };
