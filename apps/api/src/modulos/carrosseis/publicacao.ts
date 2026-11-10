import { randomUUID } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import { type ClienteClaude, escreverDirect } from '@prospeccao/integrations/carrosseis';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { AppError } from '@prospeccao/shared';
import {
  directPadrao,
  ENTREGA,
  type Entrega,
  EXTENSAO_ARQUIVO,
  LIMITE_ARQUIVO_DIRECT,
  numeroWhatsapp,
  type PublicacaoCarrossel,
  type PublicacaoEntrada,
  palavraDaChamada,
  podeReconhecer,
  type RegraDoCarrossel,
  situacaoDaPublicacao,
  TIPOS_ARQUIVO_DIRECT,
} from '@prospeccao/shared/carrosseis-publicacao';
import { type DivulgarEntrada, textoDoDossie } from '@prospeccao/shared/carrosseis-time';
import { conta, contaSql, usuarioAtual } from '../../contexto.js';
import { temRecurso } from '../../recursos.js';
import type { DepsLead } from '../instagram/servico.js';
import * as instagram from '../instagram/servico.js';
import * as cerebro from './cerebro.js';
import * as repo from './repositorio.js';

/**
 * A aba Publicação do editor: a regra do "comente e receba" que nasce com o carrossel, o que vai no
 * direct e o post (reconhecido pela legenda ou escolhido). A regra é a mesma de Instagram ›
 * Comente e receba (marcada com o carrossel): mudar aqui ou lá muda a mesma regra.
 */

interface LinhaRegra {
  id: number;
  alvo: string;
  midia_id: string | null;
  midia_link: string | null;
  midia_imagem: string | null;
  midia_tipo: string | null;
  midia_legenda: string | null;
  midia_em: string | null;
  palavras: string[];
  respostas: string[];
  entrega: Entrega | null;
  mensagem: string;
  botao_texto: string | null;
  botao_link: string | null;
  arquivo_nome: string | null;
  arquivo_tipo: string | null;
  arquivo_bytes: number | null;
  arquivo_chave: string | null;
  divulgar_id: number | null;
  whatsapp: string | null;
  ia_continua: boolean;
  etapa_id: number | null;
  responsavel_id: number | null;
  ligada: boolean;
  criado_em: string;
}

async function linhaDaRegra(db: Executor, carrosselId: number): Promise<LinhaRegra | null> {
  const { rows } = await db.query<LinhaRegra>(
    `SELECT id::int, alvo, midia_id, midia_link, midia_imagem, midia_tipo, midia_legenda, midia_em, palavras, respostas,
            entrega, mensagem, botao_texto, botao_link, arquivo_nome, arquivo_tipo, arquivo_bytes, arquivo_chave,
            divulgar_id, whatsapp, ia_continua, etapa_id, responsavel_id, ligada, criado_em
       FROM comercial.instagram_regras WHERE conta_id = ${contaSql()} AND carrossel_id = $1`,
    [carrosselId],
  );
  return rows[0] ?? null;
}

const paraRegra = (l: LinhaRegra): RegraDoCarrossel => ({
  id: l.id,
  palavras: l.palavras,
  respostas: l.respostas,
  entrega: l.entrega ?? (l.botao_link ? 'link' : 'conversa'),
  mensagem: l.mensagem,
  botaoTexto: l.botao_texto ?? '',
  link: l.botao_link ?? '',
  arquivo:
    l.arquivo_chave && l.arquivo_nome
      ? { nome: l.arquivo_nome, tipo: l.arquivo_tipo ?? '', bytes: l.arquivo_bytes ?? 0 }
      : null,
  divulgarId: l.divulgar_id,
  whatsapp: l.whatsapp ?? '',
  iaContinua: l.ia_continua,
  etapaId: l.etapa_id,
  responsavelId: l.responsavel_id,
  ligada: l.ligada,
  criadoEm: l.criado_em,
});

/** O WhatsApp conectado no CRM (o primeiro chip ativo com número). */
export async function whatsappDaEmpresa(db: Executor): Promise<string | null> {
  const { rows } = await db.query<{ numero: string }>(
    `SELECT numero FROM comercial.chips WHERE conta_id = ${contaSql()} AND ativo AND numero IS NOT NULL ORDER BY id LIMIT 1`,
  );
  const n = numeroWhatsapp(rows[0]?.numero);
  return /^\d{10,11}$/.test(n) ? n : null;
}

/** O Instagram no plano e conectado (para o pedido ao time avisar antes de pedir "comente"). */
export async function instagramDaConta(db: Executor): Promise<{ noPlano: boolean; conectado: boolean }> {
  const noPlano = await temRecurso(db, 'instagram');
  if (!noPlano) return { noPlano, conectado: false };
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT ig_id IS NOT NULL AND token_cifrado IS NOT NULL AS ok FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`,
  );
  return { noPlano, conectado: !!rows[0]?.ok && !!instagram.meta() };
}

async function promocaoDoDirect(
  db: Executor,
  id: number | null,
): Promise<(DivulgarEntrada & { id: number }) | null> {
  if (!id) return null;
  const d = await cerebro.divulgar(db, id).catch(() => null);
  return d && d.tipo === 'promocao' ? d : null;
}

/* ───────────────────────────── Criar a regra ───────────────────────────── */

/**
 * Cria a regra do carrossel (quando a chamada é "comente" e ainda não tem): a palavra do último
 * slide, o direct (o da redatora ou o padrão) e a entrega. Sem o Instagram no plano, não cria.
 */
export async function criarRegra(
  db: Executor,
  carrosselId: number,
  d: {
    palavra: string;
    entrega: Entrega;
    mensagem: string;
    botao: string;
    divulgarId?: number | null;
    whatsapp?: string | null;
    criadoPor?: number | null;
  },
): Promise<number | null> {
  if (!(await temRecurso(db, 'instagram'))) return null;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.instagram_regras
       (conta_id, alvo, carrossel_id, palavras, respostas, mensagem, botao_texto, entrega, divulgar_id, whatsapp,
        etiquetas, criado_por)
     VALUES (${contaSql()}, 'carrossel', $1, $2, $3, $4, $5, $6, $7, $8, '{instagram,carrossel}', $9)
     ON CONFLICT (carrossel_id) WHERE carrossel_id IS NOT NULL DO NOTHING
     RETURNING id::int`,
    [
      carrosselId,
      [d.palavra.toUpperCase()],
      ['Te mandei no direct, {nome}!'],
      d.mensagem,
      d.entrega === 'conversa' ? null : d.botao || ENTREGA[d.entrega].botao,
      d.entrega,
      d.divulgarId ?? null,
      d.whatsapp ?? null,
      d.criadoPor !== undefined ? d.criadoPor : (usuarioAtual()?.id ?? null),
    ],
  );
  return rows[0]?.id ?? null;
}

/** A entrega de partida: a promoção do carrossel (quando há WhatsApp); senão, só a conversa. */
export async function entregaDePartida(
  db: Executor,
  divulgarId: number | null,
): Promise<{ entrega: Entrega; divulgarId: number | null; whatsapp: string | null }> {
  const promo = await promocaoDoDirect(db, divulgarId);
  const whatsapp = await whatsappDaEmpresa(db);
  return promo && whatsapp
    ? { entrega: 'promocao', divulgarId: promo.id, whatsapp }
    : { entrega: 'conversa', divulgarId: null, whatsapp: null };
}

/** O direct escrito pela redatora (com o time ligado) ou o padrão. */
export async function directDoCarrossel(
  db: Executor,
  claude: ClienteClaude | null,
  e: { carrosselId: number; palavra: string; entrega: Entrega; divulgarId: number | null; material: string },
) {
  const c = await repo.carrossel(db, e.carrosselId);
  const promocao = await promocaoDoDirect(db, e.divulgarId);
  const empresa = await cerebro.nomeDaEmpresa(db);
  const dossie = (await cerebro.cerebro(db)).dossie;
  return escreverDirect(claude, {
    empresa,
    dossieTexto: textoDoDossie(dossie, empresa),
    titulo: c.titulo,
    slides: c.conteudo,
    legenda: c.legenda,
    palavra: e.palavra,
    entrega: e.entrega,
    material: e.material,
    promocao,
  });
}

/* ───────────────────────────── A aba ───────────────────────────── */

export async function publicacao(
  db: Executor,
  carrosselId: number,
  redatora: boolean,
): Promise<PublicacaoCarrossel> {
  const c = await repo.carrossel(db, carrosselId);
  const noPlano = await temRecurso(db, 'instagram');
  const palavraDoSlide = palavraDaChamada(c.conteudo);
  let l = await linhaDaRegra(db, carrosselId);
  // Carrossel feito à mão que pede para comentar: a regra nasce com o direct padrão.
  if (!l && noPlano && palavraDoSlide && c.situacao !== 'publicado') {
    await criarRegra(db, carrosselId, {
      palavra: palavraDoSlide,
      entrega: 'conversa',
      mensagem: directPadrao('conversa', c.titulo),
      botao: '',
    });
    l = await linhaDaRegra(db, carrosselId);
  }
  const { rows: ig } = await db.query<{
    usuario: string | null;
    nome: string | null;
    foto: string | null;
    ok: boolean;
  }>(
    `SELECT ig_usuario AS usuario, ig_nome AS nome, ig_foto AS foto, ig_id IS NOT NULL AND token_cifrado IS NOT NULL AS ok
       FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`,
  );
  const conectado = noPlano && !!ig[0]?.ok && !!instagram.meta();
  const { rows: pronto } = await db.query<{
    pronto_em: string | null;
    baixado_em: string | null;
    midia_link: string | null;
    publicado_em: string | null;
  }>(
    `SELECT pronto_em, baixado_em, midia_link, publicado_em FROM comercial.carrosseis WHERE id = $1 AND conta_id = ${contaSql()}`,
    [carrosselId],
  );
  const p = pronto[0];
  const esperandoDesde =
    l && p?.pronto_em
      ? new Date(Math.max(new Date(l.criado_em).getTime(), new Date(p.pronto_em).getTime())).toISOString()
      : null;
  const postLigado = !!l?.midia_id && l.alvo === 'publicacao';
  let numeros: PublicacaoCarrossel['numeros'] = null;
  if (l && postLigado) {
    const { rows } = await db.query<NonNullable<PublicacaoCarrossel['numeros']>>(
      `SELECT count(*)::int AS comentaram, count(*) FILTER (WHERE direct = 'enviado')::int AS receberam,
              count(*) FILTER (WHERE abriu_em IS NOT NULL)::int AS abriram,
              count(*) FILTER (WHERE respondeu_em IS NOT NULL)::int AS responderam,
              count(DISTINCT empresa_id)::int AS leads
         FROM comercial.instagram_interacoes WHERE conta_id = ${contaSql()} AND regra_id = $1`,
      [l.id],
    );
    numeros = rows[0] ?? null;
  }
  const promocoes = (await cerebro.listarDivulgar(db)).filter((d) => d.tipo === 'promocao');
  return {
    situacao: situacaoDaPublicacao({
      temRegra: !!l,
      instagram: conectado,
      carrossel: c.situacao,
      postLigado,
      esperandoDesde,
    }),
    instagram: {
      noPlano,
      conectado,
      usuario: ig[0]?.usuario ?? null,
      nome: ig[0]?.nome ?? null,
      foto: ig[0]?.foto ?? null,
    },
    regra: l ? paraRegra(l) : null,
    post:
      postLigado && l?.midia_id
        ? {
            midiaId: l.midia_id,
            link: l.midia_link ?? p?.midia_link ?? null,
            imagem: l.midia_imagem,
            tipo: l.midia_tipo,
            legenda: l.midia_legenda,
            em: l.midia_em ?? p?.publicado_em ?? null,
          }
        : null,
    numeros,
    palavraDoSlide,
    podeReconhecer: podeReconhecer(c.legenda),
    esperandoDesde,
    baixadoEm: p?.baixado_em ?? null,
    promocoes: promocoes.map((d) => ({
      id: d.id,
      titulo: d.titulo,
      produto: d.produto,
      precoDe: d.precoDe,
      precoPor: d.precoPor,
      validade: d.validade,
      ate: d.ate,
    })),
    whatsappDaEmpresa: await whatsappDaEmpresa(db),
    redatora,
  };
}

/* ───────────────────────────── Salvar ───────────────────────────── */

async function conferirDestino(db: Executor, etapaId: number | null, responsavelId: number | null) {
  if (etapaId) {
    const { rows } = await db.query(
      `SELECT 1 FROM comercial.etapas WHERE id = $1 AND conta_id = ${contaSql()}`,
      [etapaId],
    );
    if (!rows.length) throw AppError.naoEncontrado('Etapa');
  }
  if (responsavelId) {
    const { rows } = await db.query(
      `SELECT 1 FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${contaSql()} AND ativo`,
      [responsavelId],
    );
    if (!rows.length) throw AppError.naoEncontrado('Responsável');
  }
}

export async function salvar(db: Executor, carrosselId: number, d: PublicacaoEntrada): Promise<void> {
  await repo.carrossel(db, carrosselId);
  if (!(await temRecurso(db, 'instagram')))
    throw AppError.invalido('O Comente e receba faz parte do Instagram, que não está no seu plano.');
  await conferirDestino(db, d.etapaId, d.responsavelId);
  if (d.entrega === 'promocao' && !(await promocaoDoDirect(db, d.divulgarId)))
    throw AppError.invalido('Escolha uma promoção cadastrada em O que divulgar.');
  const atual = await linhaDaRegra(db, carrosselId);
  if (d.entrega === 'arquivo' && !atual?.arquivo_chave)
    throw AppError.invalido('Envie o arquivo que vai no direct.');
  const valores = [
    d.palavras,
    d.respostas,
    d.mensagem,
    d.entrega === 'conversa' ? null : d.botaoTexto,
    d.entrega === 'link' ? d.link : null,
    d.entrega,
    d.entrega === 'promocao' ? d.divulgarId : null,
    d.entrega === 'promocao' ? d.whatsapp : null,
    d.iaContinua,
    d.etapaId,
    d.responsavelId,
    d.ligada,
  ];
  if (atual)
    await db.query(
      `UPDATE comercial.instagram_regras
          SET palavras = $2, respostas = $3, mensagem = $4, botao_texto = $5, botao_link = $6, entrega = $7,
              divulgar_id = $8, whatsapp = $9, ia_continua = $10, etapa_id = $11, responsavel_id = $12, ligada = $13
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [atual.id, ...valores],
    );
  else
    await db.query(
      `INSERT INTO comercial.instagram_regras
         (conta_id, alvo, carrossel_id, palavras, respostas, mensagem, botao_texto, botao_link, entrega, divulgar_id,
          whatsapp, ia_continua, etapa_id, responsavel_id, ligada, etiquetas, criado_por)
       VALUES (${contaSql()}, 'carrossel', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '{instagram,carrossel}', $14)`,
      [carrosselId, ...valores, usuarioAtual()?.id ?? null],
    );
}

/** O arquivo do direct: guarda no armazenamento (o anterior sai). */
export async function guardarArquivo(
  db: Executor,
  arm: Armazenamento,
  carrosselId: number,
  a: { corpo: Uint8Array; tipo: string; nome: string },
): Promise<void> {
  if (!(TIPOS_ARQUIVO_DIRECT as readonly string[]).includes(a.tipo))
    throw AppError.invalido('Envie um PDF, JPG ou PNG.');
  if (!a.corpo.byteLength) throw AppError.invalido('O arquivo veio vazio.');
  if (a.corpo.byteLength > LIMITE_ARQUIVO_DIRECT) throw AppError.invalido('O arquivo pode ter até 10 MB.');
  const regra = await linhaDaRegra(db, carrosselId);
  if (!regra) throw AppError.conflito('Salve a regra antes de enviar o arquivo.');
  const ext = EXTENSAO_ARQUIVO[a.tipo as keyof typeof EXTENSAO_ARQUIVO];
  const chave = `instagram/${conta()}/arquivos/${randomUUID()}.${ext}`;
  await arm.enviar(chave, a.corpo, a.tipo);
  const nome =
    a.nome
      .replace(/[\\/\r\n"]/g, '')
      .trim()
      .slice(0, 120) || `arquivo.${ext}`;
  await db.query(
    `UPDATE comercial.instagram_regras
        SET arquivo_chave = $2, arquivo_nome = $3, arquivo_tipo = $4, arquivo_bytes = $5, entrega = 'arquivo',
            botao_texto = coalesce(nullif(botao_texto, ''), $6), botao_link = NULL
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [regra.id, chave, nome, a.tipo, a.corpo.byteLength, ENTREGA.arquivo.botao],
  );
  if (regra.arquivo_chave) await arm.apagar([regra.arquivo_chave]).catch(() => undefined);
}

/** O arquivo para a pessoa conferir (link temporário). */
export async function linkDoArquivo(db: Executor, arm: Armazenamento, carrosselId: number): Promise<string> {
  const regra = await linhaDaRegra(db, carrosselId);
  if (!regra?.arquivo_chave) throw AppError.naoEncontrado('Arquivo');
  return arm.urlAssinada(regra.arquivo_chave, { segundos: 600 });
}

/* ───────────────────────────── O post ───────────────────────────── */

/** "Já postei: escolher o post" (ou "É este"): liga a regra no post escolhido. */
export async function escolherPost(deps: DepsLead, carrosselId: number, midiaId: string): Promise<void> {
  const regra = await linhaDaRegra(deps.pool, carrosselId);
  if (!regra) throw AppError.conflito('Este carrossel não tem regra de Comente e receba.');
  const c = await instagram.conexaoDaConta(deps.pool);
  const m = instagram.meta();
  if (!c || !m) throw AppError.invalido('Conecte o Instagram da empresa primeiro.');
  const pub = await m.publicacao(midiaId, c.token).catch(async (e) => {
    await instagram.registrarErroDaMeta(deps.pool, e);
    throw AppError.invalido('O Instagram não respondeu. Tente de novo em instantes.');
  });
  if (!pub) throw AppError.naoEncontrado('Publicação');
  await deps.pool.query(
    `UPDATE comercial.instagram_regras SET midias_recusadas = array_remove(midias_recusadas, $2)
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [regra.id, pub.id],
  );
  await instagram.ligarRegraNoPost(deps, c, regra.id, pub, { avisar: false });
}

/** "Não é este post": a regra volta a esperar (e não liga mais nesse post). */
export async function naoEOPost(db: Executor, carrosselId: number): Promise<void> {
  const regra = await linhaDaRegra(db, carrosselId);
  if (!regra?.midia_id) throw AppError.conflito('Este carrossel ainda não está ligado a um post.');
  await db.query(
    `UPDATE comercial.instagram_regras
        SET alvo = 'carrossel', midias_recusadas = array_append(midias_recusadas, midia_id), midia_id = NULL,
            midia_legenda = NULL, midia_tipo = NULL, midia_link = NULL, midia_imagem = NULL, midia_em = NULL,
            esperando_aviso_em = NULL
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [regra.id],
  );
  await db.query(
    `UPDATE comercial.carrosseis SET situacao = 'pronto', midia_id = NULL, midia_link = NULL, publicado_em = NULL,
            pronto_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [carrosselId],
  );
}

/** As últimas publicações (para escolher o post). */
export async function ultimasPublicacoes(db: Executor) {
  const pubs = await instagram.publicacoes(db);
  return pubs.slice(0, 12).map((p) => ({
    midiaId: p.id,
    legenda: p.legenda,
    tipo: p.tipo,
    imagem: p.imagem,
    link: p.link,
    em: p.em,
    comentarios: p.comentarios ?? null,
  }));
}
