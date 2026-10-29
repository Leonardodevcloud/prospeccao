import { randomBytes } from 'node:crypto';
import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import type { EntradaAbertura } from '@prospeccao/integrations/agente';
import {
  AppError,
  type CampanhaEmailAtualizar,
  type CampanhaEmailEntrada,
  type ClasseResposta,
  type ConfigEmailEntrada,
  LIMITE_ANEXOS_EMAIL,
  type MarcaEmailEntrada,
  type MarcaEmailVisual,
  type ModeloEmailEntrada,
  montarEmail,
  type PassoSequencia,
  type VariaveisEmail,
} from '@prospeccao/shared';
import { contaSql, empresaNaBase, usuarioAtual } from '../../contexto.js';
import { urlPublicaApi } from '../../endereco.js';
import { visivel } from '../../visibilidade.js';
import { obterConfig as configCadencia } from '../funil/cadencia.js';
import { emSequenciaSql, RESPONDEU_EMAIL, RESPONDEU_WHATSAPP } from './sequencia.js';

/** Prospecção por e-mail (schema comercial, só a API escreve). Tudo é da conta da sessão. */

export const HOJE_SP = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;

/* ───────────── Configuração (ritmo de envio da conta) ───────────── */

export interface ConfigEmail extends ConfigEmailEntrada {
  /** Último aviso do Resend recebido (mostra se o webhook está configurado e chegando). */
  webhookEm: string | null;
}

export async function obterConfig(db: Executor): Promise<ConfigEmail> {
  const { rows } = await db.query<ConfigEmail>(
    `SELECT ligado, limite_dia AS "limiteDia", intervalo_seg AS "intervaloSeg", hora_inicio AS "horaInicio",
            hora_fim AS "horaFim", dias_semana AS "diasSemana", rastrear_abertura AS "rastrearAbertura",
            webhook_em AS "webhookEm"
       FROM comercial.config_email WHERE conta_id = ${contaSql()}`,
  );
  const c = rows[0];
  if (!c) throw new Error('config_email vazia para a conta: a migration 030 não rodou');
  return c;
}

export async function salvarConfig(db: Executor, c: ConfigEmailEntrada): Promise<void> {
  await db.query(
    `UPDATE comercial.config_email
        SET ligado = $1, limite_dia = $2, intervalo_seg = $3, hora_inicio = $4, hora_fim = $5,
            dias_semana = $6, rastrear_abertura = $7, atualizado_em = now()
      WHERE conta_id = ${contaSql()}`,
    [c.ligado, c.limiteDia, c.intervaloSeg, c.horaInicio, c.horaFim, c.diasSemana, c.rastrearAbertura],
  );
}

/* ───────────── Imagens públicas (logo e capa vão no e-mail do lead) ───────────── */

export function urlImagem(origens: string[], token: string): string {
  return `${urlPublicaApi(origens)}/e/i/${token}`;
}

/** Guarda a imagem da marca com um endereço público (sem login: o leitor do lead precisa abrir). */
export async function guardarImagem(
  db: Executor,
  m: { mime: string; nome: string; base64: string },
): Promise<{ id: number; token: string }> {
  const dados = Buffer.from(m.base64, 'base64');
  if (!dados.length) throw AppError.invalido('Imagem vazia.');
  const token = randomBytes(18).toString('base64url');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.midias (conta_id, mime, nome, tamanho, dados, publico_token)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5) RETURNING id::int`,
    [m.mime, m.nome, dados.length, dados, token],
  );
  return { id: rows[0]!.id, token };
}

/* ───────────── Identidade visual (marcas) ───────────── */

export interface Marca {
  id: number;
  nome: string;
  remetenteNome: string;
  remetenteEmail: string | null;
  responderPara: string | null;
  estilo: 'cartao' | 'simples';
  corPrimaria: string;
  corFundo: string;
  corTexto: string;
  corCabecalho: string;
  logoId: number | null;
  larguraLogo: number;
  capaId: number | null;
  assinatura: string;
  rodape: string;
  logoToken: string | null;
  capaToken: string | null;
  campanhas: number;
}

const CAMPOS_MARCA = `m.id, m.nome, m.remetente_nome AS "remetenteNome", m.remetente_email AS "remetenteEmail",
  m.responder_para AS "responderPara", m.estilo, m.cor_primaria AS "corPrimaria", m.cor_fundo AS "corFundo",
  m.cor_texto AS "corTexto", m.cor_cabecalho AS "corCabecalho", m.logo_id::int AS "logoId",
  m.largura_logo AS "larguraLogo", m.capa_id::int AS "capaId", m.assinatura, m.rodape,
  lg.publico_token AS "logoToken", cp.publico_token AS "capaToken",
  (SELECT count(*)::int FROM comercial.campanhas_email ce WHERE ce.marca_id = m.id) AS campanhas`;
const JUNCOES_MARCA = `LEFT JOIN comercial.midias lg ON lg.id = m.logo_id AND lg.conta_id = m.conta_id
  LEFT JOIN comercial.midias cp ON cp.id = m.capa_id AND cp.conta_id = m.conta_id`;

export async function listarMarcas(db: Executor, origens: string[]) {
  const { rows } = await db.query<Marca>(
    `SELECT ${CAMPOS_MARCA} FROM comercial.marcas_email m ${JUNCOES_MARCA}
      WHERE m.conta_id = ${contaSql()} ORDER BY m.id`,
  );
  return rows.map((m) => comUrls(m, origens));
}

function comUrls(m: Marca, origens: string[]) {
  return {
    ...m,
    logoUrl: m.logoToken ? urlImagem(origens, m.logoToken) : null,
    capaUrl: m.capaToken ? urlImagem(origens, m.capaToken) : null,
  };
}

export async function obterMarca(db: Executor, id: number | null, origens: string[]) {
  const { rows } = await db.query<Marca>(
    `SELECT ${CAMPOS_MARCA} FROM comercial.marcas_email m ${JUNCOES_MARCA}
      WHERE m.conta_id = ${contaSql()} AND ($1::int IS NULL OR m.id = $1)
      ORDER BY m.id LIMIT 1`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Identidade visual do e-mail');
  return comUrls(rows[0], origens);
}

/** O que o montador do e-mail precisa da marca. */
export function visualDaMarca(m: Awaited<ReturnType<typeof obterMarca>>): MarcaEmailVisual {
  return {
    nome: m.nome,
    estilo: m.estilo,
    corPrimaria: m.corPrimaria,
    corFundo: m.corFundo,
    corTexto: m.corTexto,
    corCabecalho: m.corCabecalho,
    logoUrl: m.logoUrl,
    larguraLogo: m.larguraLogo,
    capaUrl: m.capaUrl,
    rodape: m.rodape,
  };
}

async function conferirImagem(db: Executor, id: number | null | undefined) {
  if (!id) return;
  const { rows } = await db.query(
    `SELECT 1 FROM comercial.midias WHERE id = $1 AND conta_id = ${contaSql()} AND publico_token IS NOT NULL`,
    [id],
  );
  if (!rows.length) throw AppError.naoEncontrado('Imagem');
}

export async function salvarMarca(db: Executor, d: MarcaEmailEntrada, id?: number): Promise<number> {
  await conferirImagem(db, d.logoId);
  await conferirImagem(db, d.capaId);
  const valores = [
    d.nome,
    d.remetenteNome,
    d.remetenteEmail,
    d.responderPara,
    d.estilo,
    d.corPrimaria,
    d.corFundo,
    d.corTexto,
    d.corCabecalho,
    d.logoId ?? null,
    d.larguraLogo,
    d.capaId ?? null,
    d.assinatura,
    d.rodape,
  ];
  if (id) {
    const { rowCount } = await db.query(
      `UPDATE comercial.marcas_email
          SET nome = $2, remetente_nome = $3, remetente_email = $4, responder_para = $5, estilo = $6,
              cor_primaria = $7, cor_fundo = $8, cor_texto = $9, cor_cabecalho = $10, logo_id = $11,
              largura_logo = $12, capa_id = $13, assinatura = $14, rodape = $15, atualizado_em = now()
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id, ...valores],
    );
    if (!rowCount) throw AppError.naoEncontrado('Identidade visual do e-mail');
    return id;
  }
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.marcas_email
       (conta_id, nome, remetente_nome, remetente_email, responder_para, estilo, cor_primaria, cor_fundo,
        cor_texto, cor_cabecalho, logo_id, largura_logo, capa_id, assinatura, rodape)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    valores,
  );
  return rows[0]!.id;
}

export async function apagarMarca(db: Executor, id: number): Promise<void> {
  const C = contaSql();
  const { rows } = await db.query<{ campanhas: number; total: number }>(
    `SELECT (SELECT count(*) FROM comercial.campanhas_email WHERE marca_id = $1)::int AS campanhas,
            (SELECT count(*) FROM comercial.marcas_email WHERE conta_id = ${C})::int AS total`,
    [id],
  );
  if ((rows[0]?.campanhas ?? 0) > 0)
    throw AppError.invalido('Esta identidade visual é usada por campanhas de e-mail. Troque nelas antes.');
  if ((rows[0]?.total ?? 0) <= 1) throw AppError.invalido('Precisa ficar pelo menos uma identidade visual.');
  const { rowCount } = await db.query(
    `DELETE FROM comercial.marcas_email WHERE id = $1 AND conta_id = ${C}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Identidade visual do e-mail');
}

/* ───────────── Modelos e anexos ───────────── */

export async function listarModelos(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query(
    `SELECT m.id, m.nome, m.assunto, m.corpo, m.anexos::int[] AS anexos, m.nicho_id::int AS "nichoId",
            n.nome AS "nichoNome", m.atualizado_em AS "atualizadoEm",
            coalesce((SELECT json_agg(json_build_object('id', a.id, 'nome', a.nome, 'mime', a.mime, 'tamanho', a.tamanho)
                                      ORDER BY a.id)
                        FROM comercial.midias a WHERE a.id = ANY(m.anexos) AND a.conta_id = ${C}), '[]') AS arquivos
       FROM comercial.modelos_email m
       LEFT JOIN cadastro.nichos n ON n.id = m.nicho_id AND n.conta_id = ${C}
      WHERE m.conta_id = ${C}
      ORDER BY m.id`,
  );
  return rows;
}

async function conferirAnexos(db: Executor, ids: number[]) {
  if (!ids.length) return;
  const { rows } = await db.query<{ n: number; total: number }>(
    `SELECT count(*)::int AS n, coalesce(sum(tamanho), 0)::int AS total FROM comercial.midias
      WHERE id = ANY($1::bigint[]) AND conta_id = ${contaSql()}`,
    [ids],
  );
  if ((rows[0]?.n ?? 0) !== new Set(ids).size) throw AppError.naoEncontrado('Anexo');
  if ((rows[0]?.total ?? 0) > LIMITE_ANEXOS_EMAIL)
    throw AppError.invalido(
      'Os anexos somam mais de 10 MB: muitos provedores recusam o e-mail. Use um PDF menor.',
    );
}

export async function salvarModelo(db: Executor, d: ModeloEmailEntrada, id?: number): Promise<number> {
  await conferirAnexos(db, d.anexos);
  const C = contaSql();
  if (d.nichoId) {
    const { rows } = await db.query(`SELECT 1 FROM cadastro.nichos WHERE id = $1 AND conta_id = ${C}`, [
      d.nichoId,
    ]);
    if (!rows.length) throw AppError.naoEncontrado('Nicho');
  }
  if (id) {
    const { rowCount } = await db.query(
      `UPDATE comercial.modelos_email
          SET nome = $2, assunto = $3, corpo = $4, anexos = $5, nicho_id = $6, atualizado_em = now()
        WHERE id = $1 AND conta_id = ${C}`,
      [id, d.nome, d.assunto, d.corpo, d.anexos, d.nichoId ?? null],
    );
    if (!rowCount) throw AppError.naoEncontrado('Modelo');
    return id;
  }
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.modelos_email (conta_id, nome, assunto, corpo, anexos, nicho_id)
     VALUES (${C}, $1, $2, $3, $4, $5) RETURNING id`,
    [d.nome, d.assunto, d.corpo, d.anexos, d.nichoId ?? null],
  );
  return rows[0]!.id;
}

export async function apagarModelo(db: Executor, id: number): Promise<void> {
  const C = contaSql();
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.campanhas_email
      WHERE conta_id = ${C} AND status IN ('enviando', 'pausada', 'rascunho')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(passos) p WHERE (p->>'modeloId')::int = $1)`,
    [id],
  );
  if ((rows[0]?.n ?? 0) > 0)
    throw AppError.invalido('Este modelo está numa campanha de e-mail em andamento.');
  await db.query(`DELETE FROM comercial.modelos_email WHERE id = $1 AND conta_id = ${C}`, [id]);
}

export async function obterModelo(db: Executor, id: number) {
  const { rows } = await db.query<{ id: number; assunto: string; corpo: string; anexos: number[] }>(
    `SELECT id, assunto, corpo, anexos::int[] AS anexos FROM comercial.modelos_email
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Modelo de e-mail');
  return rows[0];
}

export async function anexosDoModelo(db: Executor, ids: number[]) {
  if (!ids.length) return [];
  const { rows } = await db.query<{ nome: string; mime: string; dados: Buffer }>(
    `SELECT coalesce(nome, $2) AS nome, mime, dados FROM comercial.midias
      WHERE id = ANY($1::bigint[]) AND conta_id = ${contaSql()} ORDER BY id`,
    [ids, 'anexo'],
  );
  return rows.map((r) => ({ nome: r.nome, mime: r.mime, conteudo: r.dados }));
}

/* ───────────── Dados do lead para o texto e para a IA ───────────── */

const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase());

export async function variaveisDoLead(
  db: Executor,
  empresaId: number,
  remetentePadrao: string,
): Promise<VariaveisEmail> {
  const [{ rows }, cad] = await Promise.all([
    db.query<{ nome: string; cidade: string | null; decisor: string | null }>(
      `SELECT e.nome, e.cidade,
              (SELECT p.nome FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor AND ${visivel('p')}
                ORDER BY (p.conta_id <> 0) DESC, p.id LIMIT 1) AS decisor
         FROM descoberta.empresas e WHERE e.id = $1`,
      [empresaId],
    ),
    configCadencia(db),
  ]);
  const l = rows[0];
  if (!l) throw AppError.naoEncontrado('Empresa');
  return {
    nome: l.decisor ? titulo(l.decisor.trim().split(/\s+/)[0] ?? '') : null,
    empresa: l.nome === l.nome.toUpperCase() ? titulo(l.nome) : l.nome,
    cidade: l.cidade ? titulo(l.cidade) : null,
    remetente: cad.remetente || remetentePadrao,
  };
}

/** Fatos do lead que a IA pode usar na abertura (só o que o enriquecimento achou). */
export async function fatosDoLead(db: Executor, empresaId: number): Promise<EntradaAbertura['lead']> {
  const { rows } = await db.query<{
    nome: string;
    cidade: string | null;
    decisor: string | null;
    categoria: string | null;
    resumo: string | null;
    nota: number | null;
    avaliacoes: number | null;
    site: string | null;
    instagram: string | null;
    anos: number | null;
  }>(
    `SELECT e.nome, e.cidade,
            (SELECT p.nome FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor AND ${visivel('p')}
              ORDER BY (p.conta_id <> 0) DESC, p.id LIMIT 1)
              AS decisor,
            coalesce(e.maps_categoria, l.maps_categoria) AS categoria, l.resumo,
            coalesce(e.maps_nota, l.maps_nota)::float8 AS nota, coalesce(e.maps_avaliacoes, l.maps_avaliacoes) AS avaliacoes,
            coalesce(l.site_url, e.maps_site) AS site, l.instagram,
            CASE WHEN e.data_abertura IS NOT NULL
                 THEN extract(year FROM age(current_date, e.data_abertura))::int END AS anos
       FROM descoberta.empresas e LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
      WHERE e.id = $1`,
    [empresaId],
  );
  const l = rows[0];
  if (!l) throw AppError.naoEncontrado('Empresa');
  return {
    empresa: l.nome === l.nome.toUpperCase() ? titulo(l.nome) : l.nome,
    cidade: l.cidade ? titulo(l.cidade) : null,
    contato: l.decisor ? titulo(l.decisor.trim().split(/\s+/)[0] ?? '') : null,
    categoria: l.categoria,
    resumo: l.resumo,
    notaGoogle: l.nota,
    avaliacoesGoogle: l.avaliacoes,
    site: l.site,
    instagram: l.instagram,
    anosDeEmpresa: l.anos,
  };
}

/** O que a conta faz (base de conhecimento do agente): dá contexto para a IA. */
export async function sobreEmpresa(db: Executor): Promise<string> {
  const { rows } = await db.query<{ sobre: string }>(
    `SELECT sobre_empresa AS sobre FROM comercial.config_agente WHERE conta_id = ${contaSql()}`,
  );
  return rows[0]?.sobre ?? '';
}

/**
 * Lead para a prévia: o pedido (se for da conta), senão o primeiro que vai receber a campanha,
 * senão o primeiro lead da conta com decisor, senão um inventado.
 */
export async function leadDaPrevia(
  db: Executor,
  d: { empresaId?: number | null; campanhaId?: number | null },
): Promise<number | null> {
  const C = contaSql();
  if (d.empresaId) {
    const { rows } = await db.query(
      `SELECT 1 FROM descoberta.campanha_empresas WHERE empresa_id = $1 AND conta_id = ${C} AND liberado_em IS NOT NULL LIMIT 1`,
      [d.empresaId],
    );
    if (!rows.length) throw AppError.naoEncontrado('Lead');
    return d.empresaId;
  }
  const { rows } = await db.query<{ empresa_id: number }>(
    `SELECT ce.empresa_id::int FROM descoberta.campanha_empresas ce
       JOIN enriquecimento.pessoas p ON p.empresa_id = ce.empresa_id AND p.decisor AND ${visivel('p')}
      WHERE ce.conta_id = ${C} AND ce.liberado_em IS NOT NULL AND ($1::bigint IS NULL OR ce.campanha_id = $1)
        AND EXISTS (SELECT 1 FROM enriquecimento.contatos c
                     WHERE c.empresa_id = ce.empresa_id AND c.canal = 'email' AND c.status <> 'invalido' AND ${visivel('c')})
      ORDER BY ce.adicionada_em DESC LIMIT 1`,
    [d.campanhaId ?? null],
  );
  if (rows[0]) return rows[0].empresa_id;
  const { rows: qualquer } = await db.query<{ empresa_id: number }>(
    `SELECT ce.empresa_id::int FROM descoberta.campanha_empresas ce
      WHERE ce.conta_id = ${C} AND ce.liberado_em IS NOT NULL AND ($1::bigint IS NULL OR ce.campanha_id = $1)
      ORDER BY ce.adicionada_em DESC LIMIT 1`,
    [d.campanhaId ?? null],
  );
  return qualquer[0]?.empresa_id ?? null;
}

export const LEAD_INVENTADO: EntradaAbertura['lead'] = {
  empresa: 'Auto Peças Exemplo',
  cidade: 'Salvador',
  contato: 'Marcos',
  categoria: 'Loja de autopeças',
  resumo: 'Vende peças para carros populares e faz entregas no bairro.',
  notaGoogle: 4.6,
  avaliacoesGoogle: 214,
  site: null,
  instagram: null,
  anosDeEmpresa: 9,
};

export interface PreviaEmail {
  assunto: string;
  html: string;
  texto: string;
  de: { nome: string; email: string | null };
  responderPara: string | null;
  lead: { empresaId: number | null; empresa: string; contato: string | null; cidade: string | null };
  abertura: string | null;
  /** Por que não tem abertura personalizada (sem IA, IA falhou, modelo sem {abertura}). */
  aviso: string | null;
  anexos: { id: number; nome: string; tamanho: number }[];
}

/**
 * Prévia real: o e-mail exatamente como o lead vai receber (marca, lead de verdade, abertura da
 * IA). Os links levam direto ao destino (sem contar clique) e o "sair da lista" não funciona.
 */
export async function previa(
  db: Executor,
  d: {
    assunto: string;
    corpo: string;
    marcaId: number | null;
    empresaId?: number | null;
    campanhaId?: number | null;
    instrucoesIa?: string;
    personalizarIa?: boolean;
    anexos?: number[];
  },
  ctx: {
    origens: string[];
    remetenteConta: string | null;
    personalizar: ((e: EntradaAbertura) => Promise<string | null>) | null;
  },
): Promise<PreviaEmail> {
  const marca = await obterMarca(db, d.marcaId, ctx.origens);
  const empresaId = await leadDaPrevia(db, d);
  const v: VariaveisEmail = empresaId
    ? await variaveisDoLead(db, empresaId, marca.remetenteNome)
    : {
        nome: LEAD_INVENTADO.contato,
        empresa: LEAD_INVENTADO.empresa,
        cidade: LEAD_INVENTADO.cidade,
        remetente: (await configCadencia(db)).remetente || marca.remetenteNome,
      };
  let abertura: string | null = null;
  let aviso: string | null = null;
  const usaAbertura = /\{abertura\}/.test(d.corpo);
  if (usaAbertura && d.personalizarIa) {
    if (!ctx.personalizar) aviso = 'A IA não está configurada nesta conta: a abertura fica vazia.';
    else
      try {
        abertura = await ctx.personalizar({
          sobreEmpresa: await sobreEmpresa(db),
          instrucoes: d.instrucoesIa ?? '',
          corpo: d.corpo,
          lead: empresaId ? await fatosDoLead(db, empresaId) : LEAD_INVENTADO,
        });
        if (!abertura) aviso = 'A IA não devolveu uma abertura para este lead: a linha fica vazia.';
      } catch (erro) {
        aviso = `A IA falhou (${erro instanceof Error ? erro.message.slice(0, 120) : 'erro'}): a abertura fica vazia.`;
      }
  } else if (usaAbertura) aviso = 'Personalização pela IA desligada: a linha {abertura} fica vazia.';
  const e = montarEmail(
    { assunto: d.assunto, corpo: d.corpo },
    { ...v, abertura },
    {
      assinatura: marca.assinatura,
      descadastro: '#descadastro',
      marca: visualDaMarca(marca),
    },
  );
  const C = contaSql();
  const { rows: anexos } = d.anexos?.length
    ? await db.query<{ id: number; nome: string; tamanho: number }>(
        `SELECT id::int, coalesce(nome, 'anexo') AS nome, tamanho FROM comercial.midias
          WHERE id = ANY($1::bigint[]) AND conta_id = ${C} ORDER BY id`,
        [d.anexos],
      )
    : { rows: [] };
  return {
    assunto: e.assunto,
    html: e.html,
    texto: e.texto,
    de: { nome: marca.remetenteNome, email: marca.remetenteEmail ?? ctx.remetenteConta },
    responderPara: marca.responderPara,
    lead: { empresaId, empresa: v.empresa, contato: v.nome ?? null, cidade: v.cidade ?? null },
    abertura,
    aviso,
    anexos,
  };
}

/* ───────────── Quem recebe ───────────── */

/** WhatsApp do lead (o mesmo critério da mensagem pronta do funil). */
const SQL_TEM_WHATSAPP = (empresa: string) => `EXISTS (
  SELECT 1 FROM enriquecimento.contatos c
   WHERE c.empresa_id = ${empresa} AND c.status <> 'invalido' AND ${visivel('c')}
     AND (c.canal = 'whatsapp' OR (c.canal = 'telefone' AND c.whatsapp)))`;
const SQL_TEM_TELEFONE = (empresa: string) => `(EXISTS (
  SELECT 1 FROM enriquecimento.contatos c
   WHERE c.empresa_id = ${empresa} AND c.status <> 'invalido' AND c.canal IN ('whatsapp', 'telefone') AND ${visivel('c')})
  OR (SELECT e2.maps_telefone FROM descoberta.empresas e2 WHERE e2.id = ${empresa}) IS NOT NULL)`;

type FiltroQuem = Pick<CampanhaEmailEntrada, 'faixas' | 'pularNoFunil' | 'incluirContador'> & {
  /** Canais da sequência: decide quem pode entrar (sem e-mail entra se houver passo de WhatsApp…). */
  canais?: Set<string>;
};

/**
 * Leads da campanha de prospecção que podem entrar na sequência: têm algum canal que ela usa
 * (e-mail válido, WhatsApp ou telefone), não pediram para sair (desta conta), não foram descartados,
 * não estão em outra sequência e (se pedido) ainda não estão sendo trabalhados no funil.
 */
function sqlElegiveis(c: FiltroQuem) {
  const C = contaSql();
  const canais = c.canais ?? new Set(['email']);
  const condicoes = [
    canais.has('email') ? 'alvo.email IS NOT NULL' : null,
    canais.has('whatsapp') ? 'alvo.whatsapp' : null,
    canais.has('ligacao') ? 'alvo.telefone' : null,
  ].filter(Boolean);
  return `
    WITH alvo AS (
      SELECT ce.empresa_id, e.nome, e.cidade, l.faixa, o.etapa,
             (SELECT c.valor FROM enriquecimento.contatos c
               WHERE c.empresa_id = ce.empresa_id AND c.canal = 'email' AND c.status <> 'invalido' AND ${visivel('c')}
                 ${c.incluirContador ? '' : `AND NOT (c.status = 'atencao' AND coalesce(c.rotulo, '') ILIKE '%contador%')`}
               ORDER BY c.principal DESC, (c.fontes <@ ARRAY['receita']::text[]), c.confianca DESC
               LIMIT 1) AS email,
             ${SQL_TEM_WHATSAPP('ce.empresa_id')} AS whatsapp,
             ${SQL_TEM_TELEFONE('ce.empresa_id')} AS telefone
        FROM descoberta.campanha_empresas ce
        JOIN cadastro.campanhas cp ON cp.id = ce.campanha_id AND cp.conta_id = ${C}
        JOIN descoberta.empresas e ON e.id = ce.empresa_id
        LEFT JOIN enriquecimento.leads l ON l.empresa_id = ce.empresa_id
        LEFT JOIN comercial.oportunidades o ON o.conta_id = ${C} AND o.empresa_id = ce.empresa_id
       WHERE ce.campanha_id = $1 AND ce.liberado_em IS NOT NULL)
    SELECT DISTINCT ON (coalesce(lower(alvo.email), 'lead:' || alvo.empresa_id))
           alvo.empresa_id::int AS "empresaId", alvo.nome, alvo.cidade,
           alvo.faixa, lower(alvo.email) AS email, alvo.whatsapp, alvo.telefone
      FROM alvo
     WHERE (${condicoes.join(' OR ') || 'false'})
       AND alvo.etapa IS DISTINCT FROM 'descartado'
       ${c.pularNoFunil ? `AND (alvo.etapa IS NULL OR alvo.etapa = 'a_abordar')` : ''}
       ${c.faixas.length ? 'AND alvo.faixa = ANY($2::text[])' : ''}
       AND NOT EXISTS (SELECT 1 FROM comercial.descadastros_email d
                        WHERE d.conta_id = ${C} AND d.email = lower(alvo.email))
       -- quem já recebeu e-mail de outra campanha da conta nos últimos 30 dias fica de fora
       AND NOT EXISTS (SELECT 1 FROM comercial.envios_email x
                        WHERE x.conta_id = ${C} AND lower(x.email) = lower(alvo.email) AND x.canal = 'email'
                          AND x.status = 'enviado' AND x.enviado_em > now() - interval '30 days')
       -- nem quem já está no meio de outra sequência
       AND NOT ${emSequenciaSql(C, 'alvo.empresa_id')}
     ORDER BY coalesce(lower(alvo.email), 'lead:' || alvo.empresa_id), alvo.faixa NULLS LAST`;
}

export async function elegiveis(db: Executor, c: FiltroQuem & Pick<CampanhaEmailEntrada, 'campanhaId'>) {
  const valores: unknown[] = [c.campanhaId];
  if (c.faixas.length) valores.push(c.faixas);
  const { rows } = await db.query<{
    empresaId: number;
    nome: string;
    cidade: string | null;
    faixa: string | null;
    email: string | null;
    whatsapp: boolean;
    telefone: boolean;
  }>(sqlElegiveis(c), valores);
  const { rows: total } = await db.query<{ leads: number; comEmail: number; comWhatsapp: number }>(
    `SELECT count(*)::int AS leads,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM enriquecimento.contatos c
                                            WHERE c.empresa_id = ce.empresa_id AND c.canal = 'email'
                                              AND c.status <> 'invalido' AND ${visivel('c')}))::int AS "comEmail",
            count(*) FILTER (WHERE ${SQL_TEM_WHATSAPP('ce.empresa_id')})::int AS "comWhatsapp"
       FROM descoberta.campanha_empresas ce
      WHERE ce.campanha_id = $1 AND ce.conta_id = ${contaSql()} AND ce.liberado_em IS NOT NULL`,
    [c.campanhaId],
  );
  return {
    leads: total[0]?.leads ?? 0,
    comEmail: total[0]?.comEmail ?? 0,
    comWhatsapp: total[0]?.comWhatsapp ?? 0,
    elegiveis: rows,
  };
}

/* ───────────── Campanhas de e-mail ───────────── */

async function conferirMarca(db: Executor, marcaId: number) {
  const { rows } = await db.query(
    `SELECT 1 FROM comercial.marcas_email WHERE id = $1 AND conta_id = ${contaSql()}`,
    [marcaId],
  );
  if (!rows.length) throw AppError.naoEncontrado('Identidade visual do e-mail');
}

/** Passo guardado: o canal, o que ele usa (modelo do e-mail ou texto) e a espera (o 1º não espera). */
const normalizarPassos = (passos: PassoSequencia[]) =>
  passos.map((p, i) => ({
    canal: p.canal ?? 'email',
    ...(p.canal === 'email' || !p.canal ? { modeloId: p.modeloId } : {}),
    ...(p.canal !== 'email' && p.texto ? { texto: p.texto } : {}),
    dias: i === 0 ? 0 : Math.max(1, p.dias),
  }));

/** Os modelos de e-mail dos passos existem e são da conta. */
async function conferirPassos(db: Executor, passos: PassoSequencia[]) {
  for (const p of passos)
    if ((p.canal ?? 'email') === 'email' && p.modeloId) await obterModelo(db, p.modeloId);
}

/** Canais que a sequência usa (decide quem pode entrar). */
export function canaisDe(passos: { canal?: string }[]): Set<string> {
  return new Set(passos.map((p) => p.canal ?? 'email'));
}

export async function criarCampanha(db: Executor, d: CampanhaEmailEntrada): Promise<number> {
  const C = contaSql();
  await conferirPassos(db, d.passos);
  await conferirMarca(db, d.marcaId);
  const { rows: camp } = await db.query(
    `SELECT 1 FROM cadastro.campanhas WHERE id = $1 AND conta_id = ${C}`,
    [d.campanhaId],
  );
  if (!camp.length) throw AppError.naoEncontrado('Campanha de prospecção');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.campanhas_email
       (conta_id, nome, campanha_id, passos, faixas, pular_no_funil, incluir_contador, criado_por,
        marca_id, instrucoes_ia, personalizar_ia)
     VALUES (${C}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      d.nome,
      d.campanhaId,
      JSON.stringify(normalizarPassos(d.passos)),
      d.faixas,
      d.pularNoFunil,
      d.incluirContador,
      usuarioAtual()?.id ?? null,
      d.marcaId,
      d.instrucoesIa,
      d.personalizarIa,
    ],
  );
  return rows[0]!.id;
}

export async function atualizarCampanha(db: Executor, id: number, d: CampanhaEmailAtualizar): Promise<void> {
  const c = await obterCampanhaRow(db, id);
  if (c.status === 'concluida') throw AppError.invalido('Esta campanha já terminou.');
  if (d.passos) await conferirPassos(db, d.passos);
  if (d.marcaId) await conferirMarca(db, d.marcaId);
  const sets: string[] = [];
  const valores: unknown[] = [id];
  const set = (coluna: string, v: unknown) => {
    valores.push(v);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (d.nome !== undefined) set('nome', d.nome);
  if (d.passos !== undefined) set('passos', JSON.stringify(normalizarPassos(d.passos)));
  if (d.marcaId !== undefined) set('marca_id', d.marcaId);
  if (d.instrucoesIa !== undefined) set('instrucoes_ia', d.instrucoesIa);
  if (d.personalizarIa !== undefined) set('personalizar_ia', d.personalizarIa);
  if (sets.length)
    await db.query(
      `UPDATE comercial.campanhas_email SET ${sets.join(', ')} WHERE id = $1 AND conta_id = ${contaSql()}`,
      valores,
    );
}

export interface CampanhaEmailRow {
  id: number;
  nome: string;
  campanhaId: number;
  passos: { canal?: 'email' | 'whatsapp' | 'ligacao'; modeloId?: number; texto?: string; dias: number }[];
  faixas: ('A' | 'B' | 'C')[];
  pularNoFunil: boolean;
  incluirContador: boolean;
  status: 'rascunho' | 'enviando' | 'pausada' | 'concluida';
  marcaId: number | null;
  instrucoesIa: string;
  personalizarIa: boolean;
}

export async function obterCampanhaRow(db: Executor, id: number): Promise<CampanhaEmailRow> {
  const { rows } = await db.query<CampanhaEmailRow>(
    `SELECT id, nome, campanha_id::int AS "campanhaId", passos, faixas, pular_no_funil AS "pularNoFunil",
            incluir_contador AS "incluirContador", status, marca_id AS "marcaId",
            instrucoes_ia AS "instrucoesIa", personalizar_ia AS "personalizarIa"
       FROM comercial.campanhas_email WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Campanha de e-mail');
  return rows[0];
}

/** Começa (ou retoma): põe na fila o 1º e-mail de quem pode receber. */
export async function iniciarCampanha(pool: Pool, id: number): Promise<{ naFila: number }> {
  return comTransacao(pool, async (tx) => {
    const c = await obterCampanhaRow(tx, id);
    if (c.status === 'concluida') throw AppError.invalido('Esta campanha já terminou.');
    const C = contaSql();
    const { elegiveis: lista } = await elegiveis(tx, { ...c, canais: canaisDe(c.passos) });
    const canal = c.passos[0]?.canal ?? 'email';
    let naFila = 0;
    for (const l of lista) {
      const { rowCount } = await tx.query(
        `INSERT INTO comercial.envios_email (conta_id, campanha_email_id, empresa_id, email, passo, canal)
         VALUES (${C}, $1, $2, $3, 1, $4) ON CONFLICT DO NOTHING`,
        [id, l.empresaId, l.email, canal],
      );
      naFila += rowCount ?? 0;
    }
    await tx.query(
      `UPDATE comercial.campanhas_email SET status = 'enviando', iniciada_em = coalesce(iniciada_em, now())
        WHERE id = $1 AND conta_id = ${C}`,
      [id],
    );
    return { naFila };
  });
}

export async function pausarCampanha(db: Executor, id: number): Promise<void> {
  await db.query(
    `UPDATE comercial.campanhas_email SET status = 'pausada'
      WHERE id = $1 AND conta_id = ${contaSql()} AND status = 'enviando'`,
    [id],
  );
}

export async function apagarCampanha(db: Executor, id: number): Promise<void> {
  await obterCampanhaRow(db, id);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.envios_email WHERE campanha_email_id = $1 AND status = 'enviado'`,
    [id],
  );
  if ((rows[0]?.n ?? 0) > 0)
    throw AppError.invalido('Esta campanha já enviou e-mails: pause em vez de apagar (o histórico fica).');
  await db.query(`DELETE FROM comercial.campanhas_email WHERE id = $1 AND conta_id = ${contaSql()}`, [id]);
}

export async function listarCampanhas(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query(
    `SELECT ce.id, ce.nome, ce.status, ce.passos, ce.faixas, ce.pular_no_funil AS "pularNoFunil",
            ce.incluir_contador AS "incluirContador", ce.campanha_id::int AS "campanhaId", c.nome AS "campanhaNome",
            ce.marca_id AS "marcaId", mc.nome AS "marcaNome", ce.instrucoes_ia AS "instrucoesIa",
            ce.personalizar_ia AS "personalizarIa",
            ce.criado_em AS "criadoEm", ce.iniciada_em AS "iniciadaEm", ce.concluida_em AS "concluidaEm",
            count(DISTINCT en.empresa_id)::int AS leads,
            count(*) FILTER (WHERE en.status = 'na_fila')::int AS "naFila",
            count(*) FILTER (WHERE en.status = 'enviado')::int AS enviados,
            count(*) FILTER (WHERE en.status = 'enviado' AND en.canal = 'email')::int AS "enviadosEmail",
            count(*) FILTER (WHERE en.status = 'enviado' AND en.canal = 'whatsapp')::int AS "enviadosWhatsapp",
            count(*) FILTER (WHERE en.status = 'enviado' AND en.canal = 'ligacao')::int AS "ligacoes",
            count(*) FILTER (WHERE en.status = 'pulado')::int AS pulados,
            count(*) FILTER (WHERE en.status IN ('erro', 'devolvido'))::int AS erros,
            count(DISTINCT en.empresa_id) FILTER (WHERE en.aberto_em IS NOT NULL)::int AS abriram,
            count(DISTINCT en.empresa_id) FILTER (WHERE en.clicado_em IS NOT NULL)::int AS clicaram,
            count(DISTINCT en.empresa_id) FILTER (
              WHERE en.respondido_em IS NOT NULL OR en.parado_motivo IN ('${RESPONDEU_EMAIL}', '${RESPONDEU_WHATSAPP}'))::int AS responderam,
            count(DISTINCT en.empresa_id) FILTER (WHERE en.parado_motivo = '${RESPONDEU_WHATSAPP}')::int AS "responderamWhatsapp",
            (SELECT count(DISTINCT r.empresa_id)::int FROM comercial.respostas_email r
               JOIN comercial.envios_email x ON x.id = r.envio_id
              WHERE x.campanha_email_id = ce.id AND r.classe = 'interessado') AS interessados,
            max(en.enviado_em) AS "ultimoEnvio"
       FROM comercial.campanhas_email ce
       JOIN cadastro.campanhas c ON c.id = ce.campanha_id
       LEFT JOIN comercial.marcas_email mc ON mc.id = ce.marca_id
       LEFT JOIN comercial.envios_email en ON en.campanha_email_id = ce.id
      WHERE ce.conta_id = ${C}
      GROUP BY ce.id, c.nome, mc.nome
      ORDER BY ce.id DESC`,
  );
  return rows;
}

export async function envios(
  db: Executor,
  f: {
    campanhaEmailId?: number;
    filtro?: 'todos' | 'abriram' | 'responderam' | 'erros' | 'fila';
    busca?: string;
  },
) {
  const C = contaSql();
  const where = [`en.conta_id = ${C}`, empresaNaBase('en.empresa_id')];
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  if (f.campanhaEmailId) where.push(`en.campanha_email_id = ${p(f.campanhaEmailId)}`);
  if (f.filtro === 'abriram') where.push('en.aberto_em IS NOT NULL');
  if (f.filtro === 'responderam') where.push('en.respondido_em IS NOT NULL');
  if (f.filtro === 'erros') where.push(`en.status IN ('erro', 'devolvido')`);
  if (f.filtro === 'fila') where.push(`en.status = 'na_fila'`);
  if (f.busca)
    where.push(
      `(e.nome ILIKE ${p(`%${f.busca}%`)} OR en.email ILIKE ${p(`%${f.busca}%`)} OR en.telefone LIKE ${p(`%${f.busca.replace(/\D/g, '') || '§'}%`)})`,
    );
  const { rows } = await db.query(
    `SELECT en.id::int, en.empresa_id::int AS "empresaId", e.nome, e.cidade, en.email, en.passo, en.status,
            en.canal, en.telefone, en.parado_motivo AS "paradoMotivo",
            en.assunto, en.erro, en.enviado_em AS "enviadoEm", en.aberto_em AS "abertoEm", en.aberturas,
            en.clicado_em AS "clicadoEm", en.cliques, en.respondido_em AS "respondidoEm",
            en.personalizacao, ce.nome AS "campanhaNome", ce.id AS "campanhaEmailId",
            (SELECT r.classe FROM comercial.respostas_email r WHERE r.envio_id = en.id
              ORDER BY r.recebido_em DESC LIMIT 1) AS "classeResposta",
            o.etapa AS "etapaFunil"
       FROM comercial.envios_email en
       JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
       JOIN descoberta.empresas e ON e.id = en.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = en.conta_id AND o.empresa_id = en.empresa_id
      WHERE ${where.join(' AND ')}
      ORDER BY coalesce(en.respondido_em, en.enviado_em, en.criado_em) DESC, en.id DESC
      LIMIT 500`,
    valores,
  );
  return rows;
}

export async function respostas(db: Executor, f: { classe?: ClasseResposta; naoLidas?: boolean }) {
  const { rows } = await db.query(
    `SELECT r.id::int, r.empresa_id::int AS "empresaId", e.nome, e.cidade, r.de_email AS "deEmail",
            r.de_nome AS "deNome", r.assunto, r.texto, r.recebido_em AS "recebidoEm", r.classe, r.resumo,
            r.classificado_por AS "classificadoPor", r.lida_em AS "lidaEm", o.etapa AS "etapaFunil",
            ce.nome AS "campanhaNome"
       FROM comercial.respostas_email r
       LEFT JOIN descoberta.empresas e ON e.id = r.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = r.conta_id AND o.empresa_id = r.empresa_id
       LEFT JOIN comercial.envios_email en ON en.id = r.envio_id
       LEFT JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
      WHERE r.conta_id = ${contaSql()} AND ($1::text IS NULL OR r.classe = $1) AND (NOT $2 OR r.lida_em IS NULL)
        AND ${empresaNaBase('r.empresa_id')}
      ORDER BY r.recebido_em DESC LIMIT 300`,
    [f.classe ?? null, f.naoLidas ?? false],
  );
  return rows;
}

export async function resumo(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query<{ enviadosHoje: number; naFila: number; respostasNaoLidas: number }>(
    `SELECT (SELECT count(*) FROM comercial.envios_email
              WHERE conta_id = ${C} AND status = 'enviado' AND enviado_em >= ${HOJE_SP})::int AS "enviadosHoje",
            (SELECT count(*) FROM comercial.envios_email en JOIN comercial.campanhas_email ce
                ON ce.id = en.campanha_email_id
              WHERE en.conta_id = ${C} AND en.status = 'na_fila' AND ce.status = 'enviando')::int AS "naFila",
            (SELECT count(*) FROM comercial.respostas_email r
              WHERE r.conta_id = ${C} AND r.lida_em IS NULL AND r.classe <> 'automatica'
                AND ${empresaNaBase('r.empresa_id')})::int AS "respostasNaoLidas"`,
  );
  return rows[0]!;
}

/** E-mails de um lead (para a ficha): o que foi enviado e o que ele respondeu. */
export async function doLead(db: Executor, empresaId: number) {
  const C = contaSql();
  const [env, resp] = await Promise.all([
    db.query(
      `SELECT en.id::int, en.email, en.passo, en.status, en.canal, en.assunto, en.enviado_em AS "enviadoEm",
              en.aberto_em AS "abertoEm", en.aberturas, en.clicado_em AS "clicadoEm", en.respondido_em AS "respondidoEm",
              ce.nome AS "campanhaNome"
         FROM comercial.envios_email en JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
        WHERE en.conta_id = ${C} AND en.empresa_id = $1 AND en.status <> 'cancelado' ORDER BY en.id DESC LIMIT 50`,
      [empresaId],
    ),
    db.query(
      `SELECT r.id::int, r.de_email AS "deEmail", r.assunto, r.texto, r.recebido_em AS "recebidoEm", r.classe, r.resumo
         FROM comercial.respostas_email r WHERE r.conta_id = ${C} AND r.empresa_id = $1
        ORDER BY r.recebido_em DESC LIMIT 50`,
      [empresaId],
    ),
  ]);
  return { envios: env.rows, respostas: resp.rows };
}

export async function descadastrar(db: Executor, email: string, motivo: string): Promise<void> {
  const C = contaSql();
  await db.query(
    `INSERT INTO comercial.descadastros_email (conta_id, email, motivo) VALUES (${C}, lower($1), $2)
     ON CONFLICT (conta_id, email) DO NOTHING`,
    [email, motivo],
  );
  await db.query(
    `UPDATE comercial.envios_email SET status = 'cancelado', erro = 'Pediu para sair da lista'
      WHERE conta_id = ${C} AND lower(email) = lower($1) AND status = 'na_fila'`,
    [email],
  );
}
