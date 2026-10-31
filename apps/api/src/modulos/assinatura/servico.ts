import type { Executor, Pool } from '@prospeccao/db';
import type { CobrancaAsaas, ServicoCobranca } from '@prospeccao/integrations/cobranca';
import {
  AppError,
  type AssinarEntrada,
  type AssinaturaDaConta,
  contratoDoPedido,
  DIAS_SO_LEITURA,
  DIAS_TOLERANCIA_ATRASO,
  documentoDoTexto,
  type Logger,
  MODULOS,
  NOME_PLANO,
  planoEfetivo,
  type SituacaoAssinatura,
} from '@prospeccao/shared';
import { comConta, usuarioAtual } from '../../contexto.js';
import { contratoDaConta } from '../../recursos.js';
import type { ResolverServicos } from '../../servicos.js';
import { avisarAdmins } from '../instagram/servico.js';
import { organizacaoDaConta, salvarPlano, tabelaDePrecos } from '../plano/repositorio.js';
import { mandarEmailSistema } from './email.js';

/**
 * A assinatura que a empresa contrata sozinha: escolhe plano, usuários e módulos, paga no Asaas
 * (Pix, boleto ou cartão) e o plano vale assim que o pagamento cai. Atrasou: 7 dias de tolerância
 * e só leitura; só leitura por 15 dias: arquiva.
 */

export interface DepsAssinatura {
  pool: Pool;
  log: Logger;
  servicos: ResolverServicos;
  cobranca: ServicoCobranca | null;
}

interface LinhaOrg {
  id: number;
  nome: string;
  assinatura: SituacaoAssinatura | null;
  teste_ate: string | null;
  acesso_ate: string | null;
  so_leitura_desde: string | null;
  assinatura_pedido: (AssinarEntrada & { valor: number }) | null;
  assinatura_valor: string | null;
  assinatura_forma: 'PIX' | 'BOLETO' | 'CREDIT_CARD' | null;
  asaas_cliente: string | null;
  asaas_assinatura: string | null;
  cobranca_documento: string | null;
  cobranca_nome: string | null;
  cobranca_email: string | null;
  plano: string | null;
}

async function org(db: Executor, organizacaoId: number): Promise<LinhaOrg> {
  const { rows } = await db.query<LinhaOrg>(
    `SELECT id, nome, assinatura, teste_ate, acesso_ate, so_leitura_desde, assinatura_pedido, assinatura_valor,
            assinatura_forma, asaas_cliente, asaas_assinatura, cobranca_documento, cobranca_nome, cobranca_email, plano
       FROM cadastro.organizacoes WHERE id = $1`,
    [organizacaoId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Organização');
  return rows[0];
}

const brData = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const somarDias = (iso: string | Date, dias: number) => new Date(new Date(iso).getTime() + dias * 86_400_000);

/** Situação para a tela (faixa do teste, só leitura). null = contrato combinado à mão. */
export async function situacaoDaConta(db: Executor, contaId: number): Promise<AssinaturaDaConta | null> {
  const { rows } = await db.query<{
    assinatura: SituacaoAssinatura | null;
    teste_ate: string | null;
    acesso_ate: string | null;
    so_leitura_desde: string | null;
    esperando: boolean;
  }>(
    `SELECT o.assinatura, o.teste_ate, o.acesso_ate, o.so_leitura_desde,
            (o.assinatura_pedido IS NOT NULL) AS esperando
       FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id WHERE c.id = $1`,
    [contaId],
  );
  const o = rows[0];
  if (!o?.assinatura) return null;
  const contrato = await contratoDaConta(db, contaId).catch(() => null);
  return {
    situacao: o.assinatura,
    testeAte: o.teste_ate,
    acessoAte: o.acesso_ate,
    soLeituraAte: o.so_leitura_desde ? somarDias(o.so_leitura_desde, DIAS_SO_LEITURA).toISOString() : null,
    esperandoPagamento: o.esperando,
    leadsUsados: contrato?.uso.leadsMes ?? 0,
    leadsLimite: contrato?.leadsMes ?? null,
  };
}

/** Meu plano › Assinar: a tabela de preços, o que já foi pedido, a situação e as cobranças. */
export async function resumo(deps: DepsAssinatura, contaId: number) {
  const { pool } = deps;
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const o = await org(pool, organizacaoId);
  const [tabela, cobrancas, situacao, feito] = await Promise.all([
    tabelaDePrecos(pool),
    pool.query(
      `SELECT id::int, asaas_id AS "asaasId", descricao, valor::float8 AS valor, to_char(vencimento, 'YYYY-MM-DD') AS vencimento,
              situacao, forma, link, pago_em AS "pagoEm"
         FROM cadastro.cobrancas WHERE organizacao_id = $1 ORDER BY vencimento DESC, id DESC LIMIT 24`,
      [organizacaoId],
    ),
    situacaoDaConta(pool, contaId),
    // O que a empresa já fez (o resumo do fim do teste).
    pool.query<{ funil: number; reunioes: number }>(
      `SELECT (SELECT count(*)::int FROM comercial.oportunidades op JOIN cadastro.contas x ON x.id = op.conta_id
                WHERE x.organizacao_id = $1) AS funil,
              (SELECT count(*)::int FROM comercial.tarefas t JOIN cadastro.contas x ON x.id = t.conta_id
                WHERE x.organizacao_id = $1 AND t.tipo = 'reuniao') AS reunioes`,
      [organizacaoId],
    ),
  ]);
  return {
    disponivel: !!deps.cobranca,
    feito: {
      leads: situacao?.leadsUsados ?? 0,
      funil: feito.rows[0]?.funil ?? 0,
      reunioes: feito.rows[0]?.reunioes ?? 0,
    },
    sandbox: deps.cobranca?.sandbox ?? false,
    situacao,
    tabela,
    pedido: o.assinatura_pedido,
    valor: o.assinatura_valor == null ? null : Number(o.assinatura_valor),
    forma: o.assinatura_forma,
    dados: { documento: o.cobranca_documento, nome: o.cobranca_nome ?? o.nome, email: o.cobranca_email },
    cobrancas: cobrancas.rows,
  };
}

const descricaoDoPedido = (d: AssinarEntrada) =>
  [
    `Prospect Team · Plano ${NOME_PLANO[d.plano]}`,
    `${d.usuarios} usuário${d.usuarios > 1 ? 's' : ''}`,
    ...d.modulos.map((m) => MODULOS[m].nome),
  ].join(' · ');

/** Grava a cobrança do Asaas no histórico (e devolve se mudou de situação). */
async function guardarCobranca(
  db: Executor,
  organizacaoId: number,
  c: CobrancaAsaas,
): Promise<string | null> {
  const { rows } = await db.query<{ antes: string | null }>(
    `WITH antes AS (SELECT situacao FROM cadastro.cobrancas WHERE asaas_id = $2)
     INSERT INTO cadastro.cobrancas (organizacao_id, asaas_id, asaas_assinatura, descricao, valor, vencimento, situacao, forma, link, pago_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (asaas_id) DO UPDATE SET valor = EXCLUDED.valor, vencimento = EXCLUDED.vencimento,
            situacao = EXCLUDED.situacao, forma = EXCLUDED.forma, link = coalesce(EXCLUDED.link, cadastro.cobrancas.link),
            pago_em = coalesce(EXCLUDED.pago_em, cadastro.cobrancas.pago_em), atualizado_em = now()
     RETURNING (SELECT situacao FROM antes) AS antes`,
    [
      organizacaoId,
      c.id,
      c.assinatura,
      c.descricao,
      c.valor,
      c.vencimento,
      c.situacao,
      c.forma,
      c.link,
      c.pagoEm,
    ],
  );
  return rows[0]?.antes ?? null;
}

/**
 * Assinar (ou mudar a assinatura): calcula o preço pela tabela, cria o cliente e a assinatura no
 * Asaas (a 1ª cobrança vence hoje) e devolve a cobrança para pagar. O plano novo vale quando o
 * pagamento cair; quem já tem a assinatura ativa muda na hora e paga a diferença no próximo mês.
 */
export async function assinar(deps: DepsAssinatura, contaId: number, d: AssinarEntrada) {
  const { pool, cobranca } = deps;
  if (!cobranca)
    throw new AppError(
      503,
      'cobranca_desligada',
      'A assinatura pelo sistema ainda não foi ligada. Fale com a gente.',
    );
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const o = await org(pool, organizacaoId);
  if (o.assinatura === null && o.plano)
    throw AppError.conflito('O seu contrato foi combinado com a gente: para mudar, fale com o nosso time.');
  const tabela = await tabelaDePrecos(pool);
  const pronto = tabela.planos[d.plano];
  if (d.usuarios < 1) throw AppError.invalido('Escolha ao menos 1 usuário.');
  const efetivo = planoEfetivo(contratoDoPedido(d), tabela);
  const valor = efetivo.mensalidade ?? pronto.preco;
  const documento = documentoDoTexto(d.documento)!;
  const contrato = await contratoDaConta(pool, contaId).catch(() => null);
  if (contrato && contrato.uso.usuarios > d.usuarios)
    throw AppError.invalido(
      `Vocês têm ${contrato.uso.usuarios} pessoas ativas: escolha ao menos ${contrato.uso.usuarios} usuários (ou desative alguém em Equipe).`,
    );

  const telefone = usuarioAtual()?.id
    ? ((
        await pool.query<{ telefone: string | null }>(
          'SELECT telefone FROM cadastro.usuarios WHERE id = $1',
          [usuarioAtual()!.id],
        )
      ).rows[0]?.telefone ?? null)
    : null;
  let cliente = o.asaas_cliente;
  if (!cliente)
    cliente = await cobranca.criarCliente({
      nome: d.nome,
      documento,
      email: d.email,
      telefone,
      referencia: `org:${organizacaoId}`,
    });
  else await cobranca.atualizarCliente(cliente, { nome: d.nome, documento, email: d.email });

  const pedido = { ...d, documento, valor };
  // Já pagando: muda o plano agora e o valor das próximas cobranças.
  if ((o.assinatura === 'ativa' || o.assinatura === 'atrasada') && o.asaas_assinatura) {
    await cobranca.atualizarAssinatura(o.asaas_assinatura, {
      valor,
      forma: d.forma,
      descricao: descricaoDoPedido(d),
    });
    await aplicarPlano(pool, organizacaoId, pedido);
    await pool.query(
      `UPDATE cadastro.organizacoes SET assinatura_valor = $2, assinatura_forma = $3, asaas_cliente = $4,
              cobranca_documento = $5, cobranca_nome = $6, cobranca_email = $7
        WHERE id = $1`,
      [organizacaoId, valor, d.forma, cliente, documento, d.nome, d.email],
    );
    return { valor, mudouNaHora: true, cobranca: null };
  }

  // Nova assinatura (do teste, do só leitura ou de uma que foi cancelada): a anterior que ninguém pagou sai.
  if (o.asaas_assinatura) await cobranca.cancelarAssinatura(o.asaas_assinatura).catch(() => undefined);
  const asaasAssinatura = await cobranca.criarAssinatura({
    cliente,
    forma: d.forma,
    valor,
    vencimento: brData(new Date()),
    descricao: descricaoDoPedido(d),
    referencia: `org:${organizacaoId}`,
  });
  await pool.query(
    `UPDATE cadastro.organizacoes SET asaas_cliente = $2, asaas_assinatura = $3, assinatura_pedido = $4,
            assinatura_valor = $5, assinatura_forma = $6, cobranca_documento = $7, cobranca_nome = $8, cobranca_email = $9
      WHERE id = $1`,
    [
      organizacaoId,
      cliente,
      asaasAssinatura,
      JSON.stringify(pedido),
      valor,
      d.forma,
      documento,
      d.nome,
      d.email,
    ],
  );
  await pool.query(
    `UPDATE cadastro.cobrancas SET situacao = 'cancelada', atualizado_em = now()
      WHERE organizacao_id = $1 AND situacao IN ('pendente', 'atrasada') AND asaas_assinatura IS DISTINCT FROM $2`,
    [organizacaoId, asaasAssinatura],
  );
  const cobrancas = await cobranca.cobrancasDaAssinatura(asaasAssinatura);
  for (const c of cobrancas) await guardarCobranca(pool, organizacaoId, c);
  const primeira = cobrancas.sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0] ?? null;
  return { valor, mudouNaHora: false, cobranca: primeira };
}

/** A cobrança que falta pagar (com o Pix, se for Pix). */
export async function aPagar(deps: DepsAssinatura, contaId: number) {
  const { pool, cobranca } = deps;
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const { rows } = await pool.query<{
    asaas_id: string;
    valor: number;
    vencimento: string;
    forma: string | null;
    link: string | null;
    situacao: string;
  }>(
    `SELECT asaas_id, valor::float8 AS valor, to_char(vencimento, 'YYYY-MM-DD') AS vencimento, forma, link, situacao
       FROM cadastro.cobrancas WHERE organizacao_id = $1 AND situacao IN ('pendente', 'atrasada')
      ORDER BY vencimento LIMIT 1`,
    [organizacaoId],
  );
  const c = rows[0];
  if (!c) return null;
  let pix: { imagem: string; copiaECola: string; expiraEm: string | null } | null = null;
  if (cobranca && (c.forma === 'PIX' || c.forma === 'UNDEFINED'))
    pix = await cobranca.pix(c.asaas_id).catch((e) => {
      deps.log.warn({ err: e }, 'assinatura: não deu para buscar o Pix');
      return null;
    });
  return { ...c, pix };
}

/** Cancelar: o acesso continua até o fim do período pago; depois fica só leitura. */
export async function cancelar(deps: DepsAssinatura, contaId: number): Promise<void> {
  const { pool, cobranca } = deps;
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const o = await org(pool, organizacaoId);
  if (!o.asaas_assinatura) throw AppError.invalido('Não há assinatura para cancelar.');
  if (cobranca) await cobranca.cancelarAssinatura(o.asaas_assinatura);
  const pendente = o.assinatura !== 'ativa' && o.assinatura !== 'atrasada';
  await pool.query(
    `UPDATE cadastro.organizacoes
        SET assinatura = CASE WHEN $2 THEN assinatura ELSE 'cancelada' END, asaas_assinatura = NULL, assinatura_pedido = NULL
      WHERE id = $1`,
    [organizacaoId, pendente],
  );
  await pool.query(
    `UPDATE cadastro.cobrancas SET situacao = 'cancelada', atualizado_em = now()
      WHERE organizacao_id = $1 AND situacao IN ('pendente', 'atrasada')`,
    [organizacaoId],
  );
}

/** O plano pedido passa a valer (o pagamento caiu, ou já pagava e mudou). */
async function aplicarPlano(db: Executor, organizacaoId: number, p: AssinarEntrada) {
  await salvarPlano(db, organizacaoId, {
    plano: p.plano,
    limiteUsuarios: p.usuarios,
    limiteLeadsMes: null,
    modulos: p.modulos,
    mensalidadeManual: null,
    numerosExtras: p.modulos.includes('whatsapp') ? p.numerosExtras : 0,
    recursosExtras: [],
    horasReuniao: null,
    conversasIa: null,
    minutosLigacao: null,
  });
}

/**
 * Uma cobrança mudou (aviso do Asaas ou conferência da rotina). Paga: o plano pedido vale, a
 * assinatura fica ativa e o acesso vai até um mês depois do vencimento. Atrasada: assinatura
 * atrasada (a rotina passa para só leitura depois da tolerância).
 */
export async function processarCobranca(deps: DepsAssinatura, c: CobrancaAsaas): Promise<void> {
  const { pool } = deps;
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM cadastro.organizacoes WHERE asaas_assinatura = $1
     UNION SELECT organizacao_id FROM cadastro.cobrancas WHERE asaas_id = $2 LIMIT 1`,
    [c.assinatura ?? '', c.id],
  );
  const organizacaoId =
    rows[0]?.id ?? (c.referencia?.startsWith('org:') ? Number(c.referencia.slice(4)) : null);
  if (!organizacaoId) return;
  const antes = await guardarCobranca(pool, organizacaoId, c);
  if (antes === c.situacao) return;
  const o = await org(pool, organizacaoId);
  if (c.situacao === 'paga') {
    if (o.assinatura_pedido) await aplicarPlano(pool, organizacaoId, o.assinatura_pedido);
    const virouCliente = o.assinatura !== 'ativa';
    await pool.query(
      `UPDATE cadastro.organizacoes
          SET assinatura = CASE WHEN assinatura = 'cancelada' THEN 'cancelada' ELSE 'ativa' END,
              assinatura_pedido = NULL, so_leitura_desde = NULL, ativa = true, desativada_em = NULL,
              acesso_ate = greatest(coalesce(acesso_ate, now()), ($2::date + interval '1 month' + interval '1 day'))
        WHERE id = $1`,
      [organizacaoId, c.vencimento],
    );
    await pool.query(
      `UPDATE cadastro.contas SET ativa = true, desativada_em = NULL WHERE organizacao_id = $1`,
      [organizacaoId],
    );
    if (virouCliente) {
      await pool.query(
        `UPDATE cadastro.pedidos_site SET etapa = 'cliente', plano = coalesce($2, plano), atualizado_em = now()
          WHERE conta_id IN (SELECT id FROM cadastro.contas WHERE organizacao_id = $1) AND etapa <> 'cliente'`,
        [organizacaoId, o.assinatura_pedido ? NOME_PLANO[o.assinatura_pedido.plano] : null],
      );
      await avisarConta(
        deps,
        organizacaoId,
        'Pagamento recebido: assinatura ativa',
        'Obrigado! O plano já está valendo para toda a equipe.',
      );
    }
  } else if (c.situacao === 'atrasada' && o.assinatura === 'ativa') {
    await pool.query(`UPDATE cadastro.organizacoes SET assinatura = 'atrasada' WHERE id = $1`, [
      organizacaoId,
    ]);
    await avisarConta(
      deps,
      organizacaoId,
      'Pagamento em atraso',
      `A mensalidade venceu e ainda não foi paga. Pague em Meu plano para não perder o acesso (o sistema fica só leitura ${DIAS_TOLERANCIA_ATRASO} dias depois do vencimento).`,
    );
  }
}

/** Notificação para os administradores da organização (na conta principal dela). */
async function avisarConta(deps: DepsAssinatura, organizacaoId: number, titulo: string, texto: string) {
  const { rows } = await deps.pool.query<{ id: number }>(
    'SELECT id FROM cadastro.contas WHERE organizacao_id = $1 ORDER BY id LIMIT 1',
    [organizacaoId],
  );
  if (rows[0])
    await comConta(rows[0].id, () => avisarAdmins(deps.pool, titulo, texto)).catch((e) =>
      deps.log.warn({ err: e }, 'assinatura: não deu para avisar'),
    );
}

/* ───────────────────────────── Rotina ───────────────────────────── */

interface Avisavel {
  id: number;
  nome: string;
  email: string;
  usuario: string;
  teste_ate: string;
  avisos: string[];
}

async function avisoPorEmail(
  deps: DepsAssinatura,
  o: Avisavel,
  chave: string,
  assunto: string,
  corpo: string,
) {
  await deps.pool.query(
    `UPDATE cadastro.organizacoes SET avisos_assinatura = array_append(avisos_assinatura, $2) WHERE id = $1`,
    [o.id, chave],
  );
  await mandarEmailSistema(deps, {
    para: o.email,
    nome: o.usuario,
    empresa: o.nome,
    assunto,
    corpo,
    chave: `assinatura-${o.id}-${chave}`,
  });
}

/** Uma rodada: avisos do teste, teste vencido, atraso, cancelada, arquivar e conferir as cobranças. */
export async function rodadaAssinaturas(deps: DepsAssinatura, endereco: string): Promise<void> {
  const { pool } = deps;
  const link = `${endereco}/plano/assinar`;
  const admins = (filtro: string) =>
    pool.query<Avisavel>(
      `SELECT o.id, o.nome, o.teste_ate, o.avisos_assinatura AS avisos,
              (SELECT u.email FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
                WHERE c.organizacao_id = o.id AND u.papel = 'admin' AND u.ativo AND NOT u.master ORDER BY u.id LIMIT 1) AS email,
              (SELECT u.nome FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
                WHERE c.organizacao_id = o.id AND u.papel = 'admin' AND u.ativo AND NOT u.master ORDER BY u.id LIMIT 1) AS usuario
         FROM cadastro.organizacoes o WHERE ${filtro} LIMIT 200`,
    );

  // Teste: faltam 2 dias, termina amanhã, acabou.
  for (const o of (await admins(`o.assinatura = 'teste'`)).rows) {
    if (!o.email) continue;
    const falta = new Date(o.teste_ate).getTime() - Date.now();
    if (falta <= 0) {
      await pool.query(
        `UPDATE cadastro.organizacoes SET assinatura = 'so_leitura', so_leitura_desde = now() WHERE id = $1 AND assinatura = 'teste'`,
        [o.id],
      );
      if (!o.avisos.includes('fim'))
        await avisoPorEmail(
          deps,
          o,
          'fim',
          'O seu teste do Prospect Team acabou',
          `{saudacao}\n\nOs 7 dias de teste da ${o.nome} acabaram. Tudo o que vocês fizeram continua lá: o sistema fica só para leitura por ${DIAS_SO_LEITURA} dias.\n\n[[Assinar e continuar|${link}]]\n\nSe não assinar, a conta é arquivada depois desse prazo.`,
        );
    } else if (falta <= 86_400_000 && !o.avisos.includes('d6'))
      await avisoPorEmail(
        deps,
        o,
        'd6',
        'O seu teste termina amanhã',
        `{saudacao}\n\nO teste da ${o.nome} no Prospect Team termina amanhã. Assine para continuar sem parar: os leads, o funil e as conversas ficam onde estão.\n\n[[Assinar agora|${link}]]`,
      );
    else if (falta <= 2 * 86_400_000 && !o.avisos.includes('d5'))
      await avisoPorEmail(
        deps,
        o,
        'd5',
        'Faltam 2 dias do seu teste',
        `{saudacao}\n\nFaltam 2 dias do teste da ${o.nome} no Prospect Team. Quer ajuda para tirar o máximo dele? Responda este e-mail que a gente marca 20 minutos com você.\n\n[[Ver os planos|${link}]]`,
      );
  }

  // Atrasada além da tolerância e cancelada sem acesso: só leitura.
  await pool.query(
    `UPDATE cadastro.organizacoes o SET assinatura = 'so_leitura', so_leitura_desde = now()
      WHERE (o.assinatura = 'atrasada' AND EXISTS (
               SELECT 1 FROM cadastro.cobrancas c WHERE c.organizacao_id = o.id AND c.situacao = 'atrasada'
                 AND c.vencimento < (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${DIAS_TOLERANCIA_ATRASO}))
         OR (o.assinatura = 'cancelada' AND o.acesso_ate < now())`,
  );

  // Só leitura há mais de 15 dias: arquiva (desativa; os dados ficam guardados).
  for (const o of (
    await admins(
      `o.assinatura = 'so_leitura' AND o.so_leitura_desde < now() - make_interval(days => ${DIAS_SO_LEITURA})`,
    )
  ).rows) {
    await pool.query(
      `UPDATE cadastro.organizacoes SET assinatura = 'arquivada', ativa = false, desativada_em = now() WHERE id = $1`,
      [o.id],
    );
    await pool.query(
      `UPDATE cadastro.contas SET ativa = false, desativada_em = now() WHERE organizacao_id = $1`,
      [o.id],
    );
    await pool.query(
      `UPDATE cadastro.pedidos_site SET etapa = 'perdido', motivo_perda = coalesce(motivo_perda, 'Teste ou assinatura venceu sem pagar'),
              atualizado_em = now()
        WHERE conta_id IN (SELECT id FROM cadastro.contas WHERE organizacao_id = $1) AND etapa NOT IN ('cliente', 'perdido')`,
      [o.id],
    );
    if (o.email && !o.avisos.includes('arquivar'))
      await avisoPorEmail(
        deps,
        o,
        'arquivar',
        'A conta do Prospect Team foi arquivada',
        `{saudacao}\n\nA conta da ${o.nome} foi arquivada. Os dados ficam guardados por 90 dias: para voltar de onde parou, responda este e-mail que a gente reativa.`,
      );
  }

  // Cobranças em aberto: confere no Asaas (caso algum aviso não tenha chegado).
  if (deps.cobranca) {
    const { rows } = await pool.query<{ asaas_assinatura: string }>(
      `SELECT DISTINCT o.asaas_assinatura FROM cadastro.organizacoes o
         JOIN cadastro.cobrancas c ON c.organizacao_id = o.id AND c.situacao IN ('pendente', 'atrasada')
        WHERE o.asaas_assinatura IS NOT NULL AND c.atualizado_em < now() - interval '30 minutes'
        LIMIT 20`,
    );
    for (const r of rows) {
      try {
        for (const c of await deps.cobranca.cobrancasDaAssinatura(r.asaas_assinatura))
          await processarCobranca(deps, c);
        await pool.query(
          `UPDATE cadastro.cobrancas SET atualizado_em = now() WHERE asaas_assinatura = $1 AND situacao IN ('pendente', 'atrasada')`,
          [r.asaas_assinatura],
        );
      } catch (e) {
        deps.log.warn({ err: e, assinatura: r.asaas_assinatura }, 'assinatura: conferência no Asaas falhou');
      }
    }
  }
}

export function iniciarAssinaturas(deps: DepsAssinatura, endereco: string): () => void {
  let rodando = false;
  const rodar = () => {
    if (rodando) return;
    rodando = true;
    void rodadaAssinaturas(deps, endereco)
      .catch((e) => deps.log.warn({ err: e }, 'assinatura: rodada falhou'))
      .finally(() => {
        rodando = false;
      });
  };
  const t = setInterval(rodar, 5 * 60_000);
  t.unref();
  setTimeout(rodar, 30_000).unref();
  return () => clearInterval(t);
}

/** Painel master: números das assinaturas e dos testes. */
export async function numerosDaPlataforma(db: Executor) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE assinatura = 'teste')::int AS "testando",
            count(*) FILTER (WHERE assinatura = 'teste' AND teste_ate < now() + interval '7 days')::int AS "terminamNaSemana",
            count(*) FILTER (WHERE assinatura IN ('ativa', 'atrasada', 'cancelada'))::int AS "ativas",
            coalesce(sum(assinatura_valor) FILTER (WHERE assinatura IN ('ativa', 'atrasada')), 0)::float8 AS "mrr",
            count(*) FILTER (WHERE assinatura = 'atrasada')::int AS "atrasadas",
            count(*) FILTER (WHERE assinatura = 'so_leitura')::int AS "soLeitura",
            (SELECT count(*)::int FROM cadastro.cadastros_teste WHERE confirmado_em > now() - interval '30 days') AS "testes30",
            (SELECT count(*)::int FROM cadastro.cadastros_teste t JOIN cadastro.organizacoes x ON x.id = t.organizacao_id
              WHERE t.confirmado_em > now() - interval '30 days' AND x.assinatura IN ('ativa', 'atrasada', 'cancelada')) AS "viraram30",
            (SELECT coalesce(sum(valor), 0)::float8 FROM cadastro.cobrancas WHERE situacao = 'atrasada') AS "emAberto"
       FROM cadastro.organizacoes`,
  );
  return rows[0];
}
