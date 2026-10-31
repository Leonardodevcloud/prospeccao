import type { Executor, Pool } from '@prospeccao/db';
import type { CobrancaAsaas, ServicoCobranca } from '@prospeccao/integrations/cobranca';
import {
  AppError,
  type AssinarEntrada,
  type AssinaturaDaConta,
  contratoDoPedido,
  DIAS_AVISO_VENCIMENTO,
  DIAS_SO_LEITURA,
  DIAS_TOLERANCIA_ATRASO,
  DIFERENCA_MINIMA,
  documentoDoTexto,
  type Logger,
  MODULOS,
  NOME_PLANO,
  planoEfetivo,
  type SituacaoAssinatura,
  type TipoCobranca,
} from '@prospeccao/shared';
import { comConta, usuarioAtual } from '../../contexto.js';
import { contratoDaConta, esquecerRecursos } from '../../recursos.js';
import type { ResolverServicos } from '../../servicos.js';
import { notificar } from '../notificacoes/repositorio.js';
import { organizacaoDaConta, salvarPlano, tabelaDePrecos } from '../plano/repositorio.js';
import { mandarEmailSistema } from './email.js';

/**
 * A assinatura que a empresa contrata sozinha. Sem recorrência: cada mês é uma cobrança avulsa no
 * Asaas (Pix na tela, boleto ou cartão na página do Asaas), gerada 7 dias antes de vencer. Pagou,
 * vale por mais um mês. Venceu sem pagar: 3 dias normais e depois só leitura até pagar (quem já
 * pagou nunca perde os dados; o teste que vence sem assinar fica só leitura 15 dias e arquiva).
 * Mudar para mais: paga a diferença proporcional e vale quando cair. Para menos: vale na renovação.
 * Minutos de ligação: pacotes avulsos que entram num saldo que não vence.
 */

export interface DepsAssinatura {
  pool: Pool;
  log: Logger;
  servicos: ResolverServicos;
  cobranca: ServicoCobranca | null;
}

/** O plano pedido (ou pago), com o documento limpo e o valor do mês. */
export type Pedido = AssinarEntrada & { valor: number };

interface LinhaOrg {
  id: number;
  nome: string;
  assinatura: SituacaoAssinatura | null;
  teste_ate: string | null;
  acesso_ate: string | null;
  so_leitura_desde: string | null;
  assinatura_contrato: Pedido | null;
  assinatura_proximo: Pedido | null;
  assinatura_valor: string | null;
  renovar: boolean;
  asaas_cliente: string | null;
  cobranca_documento: string | null;
  cobranca_nome: string | null;
  cobranca_email: string | null;
  plano: string | null;
  minutos_saldo: number;
}

async function org(db: Executor, organizacaoId: number): Promise<LinhaOrg> {
  const { rows } = await db.query<LinhaOrg>(
    `SELECT id, nome, assinatura, teste_ate, acesso_ate, so_leitura_desde, assinatura_contrato, assinatura_proximo,
            assinatura_valor, renovar, asaas_cliente, cobranca_documento, cobranca_nome, cobranca_email, plano,
            minutos_saldo
       FROM cadastro.organizacoes WHERE id = $1`,
    [organizacaoId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Organização');
  return rows[0];
}

const DIA = 86_400_000;
const brData = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const diaMes = (d: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(d));
const somarDias = (iso: string | Date, dias: number) => new Date(new Date(iso).getTime() + dias * DIA);
const reais = (n: number) =>
  `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mesAtual = () => brData(new Date()).slice(0, 7);

function exigirCobranca(deps: DepsAssinatura): ServicoCobranca {
  if (!deps.cobranca)
    throw new AppError(
      503,
      'cobranca_desligada',
      'A assinatura pelo sistema ainda não foi ligada. Fale com a gente.',
    );
  return deps.cobranca;
}

/** Situação para a tela (faixa do teste, vencimento, só leitura). null = contrato combinado à mão. */
export async function situacaoDaConta(db: Executor, contaId: number): Promise<AssinaturaDaConta | null> {
  const { rows } = await db.query<{
    assinatura: SituacaoAssinatura | null;
    teste_ate: string | null;
    acesso_ate: string | null;
    so_leitura_desde: string | null;
    renovar: boolean;
    esperando: boolean;
    ja_pagou: boolean;
  }>(
    `SELECT o.assinatura, o.teste_ate, o.acesso_ate, o.so_leitura_desde, o.renovar,
            EXISTS (SELECT 1 FROM cadastro.cobrancas b WHERE b.organizacao_id = o.id
                       AND b.situacao IN ('pendente', 'atrasada') AND b.tipo IN ('mensalidade', 'diferenca')) AS esperando,
            EXISTS (SELECT 1 FROM cadastro.cobrancas b WHERE b.organizacao_id = o.id
                       AND b.situacao = 'paga' AND b.tipo = 'mensalidade') AS ja_pagou
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
    toleranciaAte: o.acesso_ate ? somarDias(o.acesso_ate, DIAS_TOLERANCIA_ATRASO).toISOString() : null,
    soLeituraAte:
      o.so_leitura_desde && !o.ja_pagou ? somarDias(o.so_leitura_desde, DIAS_SO_LEITURA).toISOString() : null,
    esperandoPagamento: o.esperando,
    jaPagou: o.ja_pagou,
    renovar: o.renovar,
    leadsUsados: contrato?.uso.leadsMes ?? 0,
    leadsLimite: contrato?.leadsMes ?? null,
  };
}

const CAMPOS_COBRANCA = `id::int, asaas_id AS "asaasId", tipo, descricao, valor::float8 AS valor,
  to_char(vencimento, 'YYYY-MM-DD') AS vencimento, situacao, forma, link, pago_em AS "pagoEm", minutos`;

/** Meu plano › Assinar: a tabela de preços, o plano pago, o pedido em aberto, os minutos e as cobranças. */
export async function resumo(deps: DepsAssinatura, contaId: number) {
  const { pool } = deps;
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const o = await org(pool, organizacaoId);
  const [tabela, cobrancas, situacao, feito, aberto] = await Promise.all([
    tabelaDePrecos(pool),
    pool.query(
      `SELECT ${CAMPOS_COBRANCA} FROM cadastro.cobrancas WHERE organizacao_id = $1
        ORDER BY criado_em DESC, id DESC LIMIT 24`,
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
    pool.query<{ pedido: Pedido }>(
      `SELECT pedido FROM cadastro.cobrancas WHERE organizacao_id = $1 AND situacao IN ('pendente', 'atrasada')
          AND tipo IN ('mensalidade', 'diferenca') AND pedido IS NOT NULL ORDER BY criado_em DESC LIMIT 1`,
      [organizacaoId],
    ),
  ]);
  return {
    disponivel: !!deps.cobranca,
    sandbox: deps.cobranca?.sandbox ?? false,
    situacao,
    feito: {
      leads: situacao?.leadsUsados ?? 0,
      funil: feito.rows[0]?.funil ?? 0,
      reunioes: feito.rows[0]?.reunioes ?? 0,
    },
    tabela,
    /** O plano pago que está valendo. */
    contrato: o.assinatura_contrato,
    /** Mudança para menos que vale na próxima renovação. */
    proximo: o.assinatura_proximo,
    /** O pedido esperando o pagamento (assinar ou subir de plano). */
    pedido: aberto.rows[0]?.pedido ?? null,
    valor: o.assinatura_valor == null ? null : Number(o.assinatura_valor),
    dados: { documento: o.cobranca_documento, nome: o.cobranca_nome ?? o.nome, email: o.cobranca_email },
    minutos: { saldo: o.minutos_saldo },
    cobrancas: cobrancas.rows,
  };
}

const descricaoDoPedido = (d: AssinarEntrada) =>
  [
    `Plano ${NOME_PLANO[d.plano]}`,
    `${d.usuarios} usuário${d.usuarios > 1 ? 's' : ''}`,
    ...d.modulos.map((m) => MODULOS[m].nome),
  ].join(' · ');

/** Cria a cobrança no Asaas e guarda (com o que ela paga). */
async function novaCobranca(
  deps: DepsAssinatura,
  organizacaoId: number,
  cliente: string,
  c: {
    tipo: TipoCobranca;
    valor: number;
    vencimento: string;
    descricao: string;
    pedido?: Pedido | null;
    minutos?: number | null;
    periodoDe?: string | null;
  },
) {
  const asaas = exigirCobranca(deps);
  const b = await asaas.criarCobranca({
    cliente,
    valor: c.valor,
    vencimento: c.vencimento,
    descricao: `Prospect Team · ${c.descricao}`,
    referencia: `org:${organizacaoId}`,
  });
  const { rows } = await deps.pool.query(
    `INSERT INTO cadastro.cobrancas (organizacao_id, asaas_id, tipo, pedido, minutos, periodo_de, descricao, valor,
                                     vencimento, situacao, forma, link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${CAMPOS_COBRANCA}`,
    [
      organizacaoId,
      b.id,
      c.tipo,
      c.pedido ? JSON.stringify(c.pedido) : null,
      c.minutos ?? null,
      c.periodoDe ?? null,
      c.descricao,
      c.valor,
      b.vencimento || c.vencimento,
      b.situacao,
      b.forma,
      b.link,
    ],
  );
  return rows[0];
}

/** Apaga no Asaas as cobranças em aberto destes tipos (a que valer é gerada de novo). */
async function cancelarAbertas(deps: DepsAssinatura, organizacaoId: number, tipos: TipoCobranca[]) {
  const { rows } = await deps.pool.query<{ id: number; asaas_id: string }>(
    `SELECT id, asaas_id FROM cadastro.cobrancas
      WHERE organizacao_id = $1 AND situacao IN ('pendente', 'atrasada') AND tipo = ANY($2)`,
    [organizacaoId, tipos],
  );
  for (const r of rows) {
    if (deps.cobranca)
      await deps.cobranca
        .cancelarCobranca(r.asaas_id)
        .catch((e) =>
          deps.log.warn({ err: e, cobranca: r.asaas_id }, 'assinatura: não deu para apagar no Asaas'),
        );
    await deps.pool.query(
      `UPDATE cadastro.cobrancas SET situacao = 'cancelada', atualizado_em = now() WHERE id = $1`,
      [r.id],
    );
  }
}

/**
 * Assinar ou mudar o plano. Sem mês pago valendo: gera a mensalidade (vale quando pagar). Com mês
 * pago: para mais, cobra a diferença proporcional aos dias que faltam (pequena: vale na hora); para
 * menos, fica marcado e vale na próxima renovação.
 */
export async function assinar(deps: DepsAssinatura, contaId: number, d: AssinarEntrada) {
  const { pool } = deps;
  const asaas = exigirCobranca(deps);
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const o = await org(pool, organizacaoId);
  if (o.assinatura === null && o.plano)
    throw AppError.conflito('O seu contrato foi combinado com a gente: para mudar, fale com o nosso time.');
  const tabela = await tabelaDePrecos(pool);
  const efetivo = planoEfetivo(contratoDoPedido(d), tabela);
  const valor = efetivo.mensalidade ?? tabela.planos[d.plano].preco;
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
    cliente = await asaas.criarCliente({
      nome: d.nome,
      documento,
      email: d.email,
      telefone,
      referencia: `org:${organizacaoId}`,
    });
  else await asaas.atualizarCliente(cliente, { nome: d.nome, documento, email: d.email });
  await pool.query(
    `UPDATE cadastro.organizacoes SET asaas_cliente = $2, cobranca_documento = $3, cobranca_nome = $4, cobranca_email = $5
      WHERE id = $1`,
    [organizacaoId, cliente, documento, d.nome, d.email],
  );
  const pedido: Pedido = { ...d, documento, valor };
  const hoje = brData(new Date());

  // Mês pago valendo: mudança de plano.
  const pago = o.acesso_ate && new Date(o.acesso_ate).getTime() > Date.now() && o.assinatura_contrato;
  if (pago) {
    const atual = Number(o.assinatura_valor ?? 0);
    await cancelarAbertas(deps, organizacaoId, ['diferenca']);
    if (valor > atual) {
      const restam = Math.min(
        30,
        Math.max(1, Math.ceil((new Date(o.acesso_ate!).getTime() - Date.now()) / DIA)),
      );
      const diferenca = Math.round((valor - atual) * (restam / 30) * 100) / 100;
      await pool.query('UPDATE cadastro.organizacoes SET assinatura_proximo = NULL WHERE id = $1', [
        organizacaoId,
      ]);
      if (diferenca < DIFERENCA_MINIMA) {
        await valerAgora(deps, organizacaoId, pedido);
        return { valor, tipo: 'na_hora' as const, cobranca: null, valeEm: null };
      }
      const cobranca = await novaCobranca(deps, organizacaoId, cliente, {
        tipo: 'diferenca',
        valor: diferenca,
        vencimento: hoje,
        descricao: `Mudança para ${descricaoDoPedido(d)} (proporcional até ${diaMes(o.acesso_ate!)})`,
        pedido,
      });
      return { valor, tipo: 'diferenca' as const, cobranca, valeEm: null };
    }
    // Para menos (ou igual): vale na renovação. A mensalidade já gerada sai e volta com o valor novo.
    const igual =
      JSON.stringify(contratoDoPedido(pedido)) === JSON.stringify(contratoDoPedido(o.assinatura_contrato!));
    await pool.query('UPDATE cadastro.organizacoes SET assinatura_proximo = $2 WHERE id = $1', [
      organizacaoId,
      igual ? null : JSON.stringify(pedido),
    ]);
    await cancelarAbertas(deps, organizacaoId, ['mensalidade']);
    return { valor, tipo: 'proximo' as const, cobranca: null, valeEm: o.acesso_ate };
  }

  // Sem mês pago valendo (teste, venceu, só leitura): a mensalidade. Quem estava em dia continua
  // contando do vencimento (dentro da tolerância); senão, o mês começa quando pagar.
  await cancelarAbertas(deps, organizacaoId, ['mensalidade', 'diferenca']);
  await pool.query(
    'UPDATE cadastro.organizacoes SET renovar = true, assinatura_proximo = NULL WHERE id = $1',
    [organizacaoId],
  );
  const cobranca = await novaCobranca(deps, organizacaoId, cliente, {
    tipo: 'mensalidade',
    valor,
    vencimento: hoje,
    descricao: `Mensalidade · ${descricaoDoPedido(d)}`,
    pedido,
    periodoDe: o.acesso_ate ? brData(new Date(o.acesso_ate)) : null,
  });
  return { valor, tipo: 'mensalidade' as const, cobranca, valeEm: null };
}

/** O plano pedido passa a valer agora (mudança paga ou pequena). */
async function valerAgora(deps: DepsAssinatura, organizacaoId: number, p: Pedido) {
  await aplicarPlano(deps.pool, organizacaoId, p);
  await deps.pool.query(
    `UPDATE cadastro.organizacoes SET assinatura_contrato = $2, assinatura_valor = $3, assinatura_proximo = NULL
      WHERE id = $1`,
    [organizacaoId, JSON.stringify(p), p.valor],
  );
  // A mensalidade seguinte (se já gerada) volta com o valor novo.
  await cancelarAbertas(deps, organizacaoId, ['mensalidade']);
}

/** As cobranças em aberto e a escolhida (com o Pix na tela). */
export async function aPagar(deps: DepsAssinatura, contaId: number, escolhida?: number | null) {
  const { pool, cobranca } = deps;
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const { rows } = await pool.query<{ id: number; asaasId: string; forma: string | null }>(
    `SELECT ${CAMPOS_COBRANCA} FROM cadastro.cobrancas
      WHERE organizacao_id = $1 AND situacao IN ('pendente', 'atrasada')
      ORDER BY (tipo = 'minutos'), vencimento, id`,
    [organizacaoId],
  );
  const c = rows.find((x) => x.id === escolhida) ?? rows[0];
  if (!c) return { cobranca: null, abertas: [] };
  let pix: { imagem: string; copiaECola: string; expiraEm: string | null } | null = null;
  if (cobranca && c.forma !== 'BOLETO' && c.forma !== 'CREDIT_CARD')
    pix = await cobranca.pix(c.asaasId).catch((e) => {
      deps.log.warn({ err: e }, 'assinatura: não deu para buscar o Pix');
      return null;
    });
  return { cobranca: { ...c, pix }, abertas: rows };
}

/** Não renovar: a cobrança do mês seguinte não é gerada; o acesso vai até o fim do mês pago. */
export async function cancelar(deps: DepsAssinatura, contaId: number): Promise<void> {
  const { pool } = deps;
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const o = await org(pool, organizacaoId);
  await cancelarAbertas(deps, organizacaoId, ['mensalidade', 'diferenca']);
  const valendo = o.acesso_ate && new Date(o.acesso_ate).getTime() > Date.now();
  await pool.query(
    `UPDATE cadastro.organizacoes
        SET renovar = false, assinatura_proximo = NULL,
            assinatura = CASE WHEN assinatura IN ('ativa', 'cancelada') AND $2 THEN 'cancelada'
                              WHEN assinatura = 'atrasada' THEN 'so_leitura' ELSE assinatura END,
            so_leitura_desde = CASE WHEN assinatura = 'atrasada' THEN now() ELSE so_leitura_desde END
      WHERE id = $1`,
    [organizacaoId, !!valendo],
  );
}

/** Voltar a renovar (desfaz o cancelar enquanto o mês pago vale). */
export async function voltarARenovar(deps: DepsAssinatura, contaId: number): Promise<void> {
  const organizacaoId = await organizacaoDaConta(deps.pool, contaId);
  await deps.pool.query(
    `UPDATE cadastro.organizacoes
        SET renovar = true, assinatura = CASE WHEN assinatura = 'cancelada' THEN 'ativa' ELSE assinatura END
      WHERE id = $1`,
    [organizacaoId],
  );
}

/** Pacote de minutos de ligação: cobrança avulsa; os minutos entram no saldo quando pagar. */
export async function comprarMinutos(deps: DepsAssinatura, contaId: number, pacotes: number) {
  const { pool } = deps;
  exigirCobranca(deps);
  const organizacaoId = await organizacaoDaConta(pool, contaId);
  const o = await org(pool, organizacaoId);
  if (!o.assinatura || !['ativa', 'atrasada', 'cancelada'].includes(o.assinatura) || !o.asaas_cliente)
    throw AppError.invalido('Os pacotes de minutos são para quem assina pelo sistema. Fale com a gente.');
  const contrato = await contratoDaConta(pool, contaId);
  if (!contrato.modulos.includes('ligacoes'))
    throw AppError.invalido('O módulo Ligações não está no seu plano: inclua em Meu plano › Assinar.');
  const tabela = await tabelaDePrecos(pool);
  const minutos = pacotes * tabela.pacoteMinutos;
  const valor = Math.round(pacotes * tabela.pacotePreco * 100) / 100;
  await cancelarAbertas(deps, organizacaoId, ['minutos']);
  return novaCobranca(deps, organizacaoId, o.asaas_cliente, {
    tipo: 'minutos',
    valor,
    vencimento: brData(new Date()),
    descricao: `+${minutos.toLocaleString('pt-BR')} minutos de ligação`,
    minutos,
  });
}

/** O plano pedido passa a valer (salva o contrato da organização). */
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
 * Uma cobrança mudou (aviso do Asaas ou conferência). Paga: mensalidade = mais um mês do plano
 * pedido; mudança de plano = o plano novo vale; minutos = entram no saldo.
 */
export async function processarCobranca(deps: DepsAssinatura, c: CobrancaAsaas): Promise<void> {
  const { pool } = deps;
  const { rows } = await pool.query<{
    id: number;
    organizacao_id: number;
    tipo: TipoCobranca;
    situacao: string;
    pedido: Pedido | null;
    minutos: number | null;
    periodo_de: string | null;
  }>(
    `SELECT id, organizacao_id, tipo, situacao, pedido, minutos, to_char(periodo_de, 'YYYY-MM-DD') AS periodo_de
       FROM cadastro.cobrancas WHERE asaas_id = $1`,
    [c.id],
  );
  const b = rows[0];
  if (!b) return;
  await pool.query(
    `UPDATE cadastro.cobrancas SET valor = $2, vencimento = $3, situacao = $4, forma = coalesce($5, forma),
            link = coalesce($6, link), pago_em = coalesce($7::timestamptz, pago_em), atualizado_em = now()
      WHERE id = $1`,
    [b.id, c.valor, c.vencimento, c.situacao, c.forma, c.link, c.pagoEm],
  );
  if (b.situacao === c.situacao || c.situacao !== 'paga') return;
  const organizacaoId = b.organizacao_id;
  const o = await org(pool, organizacaoId);

  if (b.tipo === 'minutos') {
    await pool.query(
      `UPDATE cadastro.organizacoes
          SET minutos_saldo = minutos_saldo + $2, minutos_saldo_mes = coalesce(minutos_saldo_mes, $3)
        WHERE id = $1`,
      [organizacaoId, b.minutos ?? 0, mesAtual()],
    );
    await avisarConta(
      deps,
      organizacaoId,
      'Minutos de ligação liberados',
      `+${(b.minutos ?? 0).toLocaleString('pt-BR')} minutos já estão valendo. O saldo do pacote não vence.`,
    );
    return;
  }
  if (!b.pedido) return;
  if (b.tipo === 'diferenca') {
    await valerAgora(deps, organizacaoId, b.pedido);
    await avisarConta(
      deps,
      organizacaoId,
      'Plano novo valendo',
      `Pagamento recebido: ${descricaoDoPedido(b.pedido)}.`,
    );
    return;
  }

  // Mensalidade: mais um mês. Pagou em dia (ou dentro dos 3 dias): conta do vencimento; senão, de hoje.
  const ja = await pool.query(
    `SELECT 1 FROM cadastro.cobrancas WHERE organizacao_id = $1 AND tipo = 'mensalidade' AND situacao = 'paga' AND id <> $2 LIMIT 1`,
    [organizacaoId, b.id],
  );
  const emDia =
    !!b.periodo_de &&
    !!o.acesso_ate &&
    Date.now() <= somarDias(o.acesso_ate, DIAS_TOLERANCIA_ATRASO).getTime();
  await aplicarPlano(pool, organizacaoId, b.pedido);
  await pool.query(
    `UPDATE cadastro.organizacoes
        SET assinatura = 'ativa', renovar = true, assinatura_contrato = $2, assinatura_valor = $3, assinatura_proximo = NULL,
            so_leitura_desde = NULL, ativa = true, desativada_em = NULL,
            acesso_ate = (CASE WHEN $4 THEN acesso_ate ELSE now() END) + interval '1 month'
      WHERE id = $1`,
    [organizacaoId, JSON.stringify(b.pedido), b.pedido.valor, emDia],
  );
  await pool.query(
    'UPDATE cadastro.contas SET ativa = true, desativada_em = NULL WHERE organizacao_id = $1',
    [organizacaoId],
  );
  esquecerRecursos();
  if (!ja.rows[0]) {
    await pool.query(
      `UPDATE cadastro.pedidos_site SET etapa = 'cliente', plano = $2, atualizado_em = now()
        WHERE conta_id IN (SELECT id FROM cadastro.contas WHERE organizacao_id = $1) AND etapa <> 'cliente'`,
      [organizacaoId, NOME_PLANO[b.pedido.plano]],
    );
    await avisarConta(
      deps,
      organizacaoId,
      'Pagamento recebido: assinatura ativa',
      'Obrigado! O plano já está valendo para toda a equipe.',
    );
  } else if (o.assinatura !== 'ativa')
    await avisarConta(deps, organizacaoId, 'Pagamento recebido', 'A conta voltou ao normal. Obrigado!');
}

/** Notificação para os administradores da organização (em todas as contas dela). */
async function avisarConta(deps: DepsAssinatura, organizacaoId: number, titulo: string, texto: string) {
  const { rows } = await deps.pool.query<{ id: number; conta_id: number }>(
    `SELECT u.id, u.conta_id FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
      WHERE c.organizacao_id = $1 AND u.papel = 'admin' AND u.ativo AND NOT u.master`,
    [organizacaoId],
  );
  for (const u of rows)
    await comConta(u.conta_id, () =>
      notificar(deps.pool, u.id, { tipo: 'sistema', titulo, texto, link: '/plano' }),
    ).catch((e) => deps.log.warn({ err: e }, 'assinatura: não deu para avisar'));
}

/* ───────────────────────────── Rotina ───────────────────────────── */

interface Avisavel {
  id: number;
  nome: string;
  email: string | null;
  usuario: string;
  teste_ate: string | null;
  acesso_ate: string | null;
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
  o.avisos.push(chave);
  if (!o.email) return;
  await mandarEmailSistema(deps, {
    para: o.email,
    nome: o.usuario,
    empresa: o.nome,
    assunto,
    corpo,
    chave: `assinatura-${o.id}-${chave}`,
  });
}

/** Minutos de ligação usados num mês (YYYY-MM) pela organização. */
async function minutosDoMes(db: Executor, organizacaoId: number, mes: string): Promise<number> {
  const { rows } = await db.query<{ m: number }>(
    `SELECT coalesce(sum(ceil(l.duracao_segundos / 60.0)), 0)::int AS m
       FROM comercial.ligacoes l JOIN cadastro.contas c ON c.id = l.conta_id
      WHERE c.organizacao_id = $1 AND l.atendida_em IS NOT NULL
        AND l.iniciada_em >= ($2::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
        AND l.iniciada_em < ($2::date + interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo'`,
    [organizacaoId, `${mes}-01`],
  );
  return rows[0]?.m ?? 0;
}

/**
 * Fecha o saldo dos pacotes de minutos: o que cada mês passou da franquia sai do saldo (o resto
 * fica para os meses seguintes).
 */
export async function fecharMinutos(deps: DepsAssinatura): Promise<void> {
  const { pool } = deps;
  const agora = mesAtual();
  const { rows } = await pool.query<{ id: number; saldo: number; mes: string; conta: number }>(
    `SELECT o.id, o.minutos_saldo AS saldo, o.minutos_saldo_mes AS mes,
            (SELECT c.id FROM cadastro.contas c WHERE c.organizacao_id = o.id ORDER BY c.id LIMIT 1) AS conta
       FROM cadastro.organizacoes o
      WHERE o.minutos_saldo_mes IS NOT NULL AND o.minutos_saldo_mes < $1 LIMIT 200`,
    [agora],
  );
  for (const o of rows) {
    const franquia = (await contratoDaConta(pool, o.conta).catch(() => null))?.minutosLigacao ?? 0;
    let saldo = o.saldo;
    let mes = o.mes;
    while (mes < agora && saldo > 0) {
      saldo = Math.max(0, saldo - Math.max(0, (await minutosDoMes(pool, o.id, mes)) - franquia));
      const [a, m] = mes.split('-').map(Number) as [number, number];
      mes = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
    }
    await pool.query(
      'UPDATE cadastro.organizacoes SET minutos_saldo = $2, minutos_saldo_mes = $3 WHERE id = $1',
      [o.id, saldo, saldo > 0 ? agora : null],
    );
  }
}

/**
 * Uma rodada: avisos e fim do teste; mensalidade do mês seguinte (7 dias antes) e os avisos do
 * vencimento; venceu → 3 dias → só leitura; teste em só leitura 15 dias → arquiva; saldo dos
 * minutos; confere no Asaas as cobranças em aberto.
 */
export async function rodadaAssinaturas(deps: DepsAssinatura, endereco: string): Promise<void> {
  const { pool } = deps;
  const assinar = `${endereco}/plano/assinar`;
  const pagar = `${endereco}/plano/pagar`;
  const admins = (filtro: string) =>
    pool.query<Avisavel>(
      `SELECT o.id, o.nome, o.teste_ate, o.acesso_ate, o.avisos_assinatura AS avisos,
              (SELECT u.email FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
                WHERE c.organizacao_id = o.id AND u.papel = 'admin' AND u.ativo AND NOT u.master ORDER BY u.id LIMIT 1) AS email,
              (SELECT u.nome FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
                WHERE c.organizacao_id = o.id AND u.papel = 'admin' AND u.ativo AND NOT u.master ORDER BY u.id LIMIT 1) AS usuario
         FROM cadastro.organizacoes o WHERE ${filtro} LIMIT 200`,
    );

  // Teste: faltam 2 dias, termina amanhã, acabou.
  for (const o of (await admins(`o.assinatura = 'teste'`)).rows) {
    const falta = new Date(o.teste_ate ?? 0).getTime() - Date.now();
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
          `{saudacao}\n\nOs 7 dias de teste da ${o.nome} acabaram. Tudo o que vocês fizeram continua lá: o sistema fica só para leitura por ${DIAS_SO_LEITURA} dias.\n\n[[Assinar e continuar|${assinar}]]\n\nSe não assinar, a conta é arquivada depois desse prazo.`,
        );
    } else if (falta <= DIA && !o.avisos.includes('d6'))
      await avisoPorEmail(
        deps,
        o,
        'd6',
        'O seu teste termina amanhã',
        `{saudacao}\n\nO teste da ${o.nome} no Prospect Team termina amanhã. Assine para continuar sem parar: os leads, o funil e as conversas ficam onde estão.\n\n[[Assinar agora|${assinar}]]`,
      );
    else if (falta <= 2 * DIA && !o.avisos.includes('d5'))
      await avisoPorEmail(
        deps,
        o,
        'd5',
        'Faltam 2 dias do seu teste',
        `{saudacao}\n\nFaltam 2 dias do teste da ${o.nome} no Prospect Team. Quer ajuda para tirar o máximo dele? Responda este e-mail que a gente marca 20 minutos com você.\n\n[[Ver os planos|${assinar}]]`,
      );
  }

  // Mensalidade do mês seguinte: gerada 7 dias antes de vencer (com a mudança marcada, se houver).
  if (deps.cobranca) {
    const { rows } = await pool.query<{
      id: number;
      acesso_ate: string;
      contrato: Pedido;
      proximo: Pedido | null;
      cliente: string;
    }>(
      `SELECT o.id, o.acesso_ate, o.assinatura_contrato AS contrato, o.assinatura_proximo AS proximo, o.asaas_cliente AS cliente
         FROM cadastro.organizacoes o
        WHERE o.assinatura IN ('ativa', 'atrasada') AND o.renovar AND o.assinatura_contrato IS NOT NULL
          AND o.asaas_cliente IS NOT NULL AND o.acesso_ate < now() + make_interval(days => ${DIAS_AVISO_VENCIMENTO})
          AND NOT EXISTS (SELECT 1 FROM cadastro.cobrancas b WHERE b.organizacao_id = o.id AND b.tipo = 'mensalidade'
                            AND b.situacao IN ('pendente', 'atrasada', 'paga')
                            AND b.periodo_de = (o.acesso_ate AT TIME ZONE 'America/Sao_Paulo')::date)
        LIMIT 50`,
    );
    for (const o of rows) {
      const p = o.proximo ?? o.contrato;
      const de = brData(new Date(o.acesso_ate));
      const hoje = brData(new Date());
      try {
        await novaCobranca(deps, o.id, o.cliente, {
          tipo: 'mensalidade',
          valor: p.valor,
          vencimento: de < hoje ? hoje : de,
          descricao: `Mensalidade de ${diaMes(o.acesso_ate)} a ${diaMes(somarDias(o.acesso_ate, 30))} · ${descricaoDoPedido(p)}`,
          pedido: p,
          periodoDe: de,
        });
      } catch (e) {
        deps.log.warn({ err: e, organizacao: o.id }, 'assinatura: não deu para gerar a mensalidade');
      }
    }
  }

  // Avisos do vencimento (7, 3 e 1 dia antes) para quem ainda não pagou o mês seguinte.
  for (const o of (
    await admins(`o.assinatura = 'ativa' AND o.renovar AND o.acesso_ate < now() + make_interval(days => ${DIAS_AVISO_VENCIMENTO})
      AND EXISTS (SELECT 1 FROM cadastro.cobrancas b WHERE b.organizacao_id = o.id AND b.tipo = 'mensalidade'
                    AND b.situacao IN ('pendente', 'atrasada'))`)
  ).rows) {
    const falta = new Date(o.acesso_ate!).getTime() - Date.now();
    const venc = brData(new Date(o.acesso_ate!));
    const marca = falta <= DIA ? 'v1' : falta <= 3 * DIA ? 'v3' : 'v7';
    const chave = `${marca}:${venc}`;
    if (falta <= 0 || o.avisos.includes(chave)) continue;
    await avisoPorEmail(
      deps,
      o,
      chave,
      marca === 'v1'
        ? 'O plano do Prospect Team vence amanhã'
        : `O plano do Prospect Team vence em ${diaMes(o.acesso_ate!)}`,
      `{saudacao}\n\nO mês pago da ${o.nome} no Prospect Team vai até ${diaMes(o.acesso_ate!)}. A mensalidade seguinte já está disponível: pague com Pix (libera na hora), boleto ou cartão.\n\n[[Pagar agora|${pagar}]]\n\nSe vencer, a conta continua normal por mais ${DIAS_TOLERANCIA_ATRASO} dias; depois fica só leitura até o pagamento.`,
    );
  }

  // Venceu: renovando → atrasada (3 dias normais); sem renovar → só leitura.
  for (const o of (await admins(`o.assinatura IN ('ativa', 'cancelada') AND o.acesso_ate < now()`)).rows) {
    const { rows } = await pool.query<{ assinatura: string }>(
      `UPDATE cadastro.organizacoes
          SET assinatura = CASE WHEN renovar AND assinatura = 'ativa' THEN 'atrasada' ELSE 'so_leitura' END,
              so_leitura_desde = CASE WHEN renovar AND assinatura = 'ativa' THEN NULL ELSE now() END
        WHERE id = $1 RETURNING assinatura`,
      [o.id],
    );
    const venc = brData(new Date(o.acesso_ate!));
    if (rows[0]?.assinatura === 'atrasada' && !o.avisos.includes(`venceu:${venc}`))
      await avisoPorEmail(
        deps,
        o,
        `venceu:${venc}`,
        'O plano do Prospect Team venceu',
        `{saudacao}\n\nO mês pago da ${o.nome} venceu em ${diaMes(o.acesso_ate!)}. A conta continua normal até ${diaMes(somarDias(o.acesso_ate!, DIAS_TOLERANCIA_ATRASO))}; depois fica só leitura (dá para ver e exportar tudo, mas não mexer) até o pagamento.\n\n[[Pagar agora|${pagar}]]`,
      );
  }

  // Passou da tolerância: só leitura até pagar.
  for (const o of (
    await admins(
      `o.assinatura = 'atrasada' AND o.acesso_ate < now() - make_interval(days => ${DIAS_TOLERANCIA_ATRASO})`,
    )
  ).rows) {
    await pool.query(
      `UPDATE cadastro.organizacoes SET assinatura = 'so_leitura', so_leitura_desde = now() WHERE id = $1`,
      [o.id],
    );
    const venc = brData(new Date(o.acesso_ate!));
    if (!o.avisos.includes(`leitura:${venc}`))
      await avisoPorEmail(
        deps,
        o,
        `leitura:${venc}`,
        'A conta do Prospect Team ficou só leitura',
        `{saudacao}\n\nO pagamento da ${o.nome} não caiu, e a conta ficou só leitura: vocês continuam vendo e exportando os leads e os contatos, mas não dá para mexer. Pague para voltar na hora, do jeito que estava.\n\n[[Pagar agora|${pagar}]]`,
      );
  }

  // Teste vencido sem assinar, só leitura há mais de 15 dias: arquiva (quem já pagou não arquiva).
  for (const o of (
    await admins(
      `o.assinatura = 'so_leitura' AND o.so_leitura_desde < now() - make_interval(days => ${DIAS_SO_LEITURA})
       AND NOT EXISTS (SELECT 1 FROM cadastro.cobrancas b WHERE b.organizacao_id = o.id AND b.tipo = 'mensalidade' AND b.situacao = 'paga')`,
    )
  ).rows) {
    await pool.query(
      `UPDATE cadastro.organizacoes SET assinatura = 'arquivada', ativa = false, desativada_em = now() WHERE id = $1`,
      [o.id],
    );
    await pool.query(
      'UPDATE cadastro.contas SET ativa = false, desativada_em = now() WHERE organizacao_id = $1',
      [o.id],
    );
    await pool.query(
      `UPDATE cadastro.pedidos_site SET etapa = 'perdido', motivo_perda = coalesce(motivo_perda, 'O teste venceu sem assinar'),
              atualizado_em = now()
        WHERE conta_id IN (SELECT id FROM cadastro.contas WHERE organizacao_id = $1) AND etapa NOT IN ('cliente', 'perdido')`,
      [o.id],
    );
    if (!o.avisos.includes('arquivar'))
      await avisoPorEmail(
        deps,
        o,
        'arquivar',
        'A conta do Prospect Team foi arquivada',
        `{saudacao}\n\nA conta de teste da ${o.nome} foi arquivada. Os dados ficam guardados por 90 dias: para voltar de onde parou, responda este e-mail que a gente reativa.`,
      );
  }

  await fecharMinutos(deps);

  // Cobranças em aberto: confere no Asaas (caso algum aviso não tenha chegado).
  if (deps.cobranca) {
    const { rows } = await pool.query<{ asaas_id: string }>(
      `SELECT asaas_id FROM cadastro.cobrancas
        WHERE situacao IN ('pendente', 'atrasada') AND atualizado_em < now() - interval '30 minutes'
        ORDER BY atualizado_em LIMIT 30`,
    );
    for (const r of rows) {
      try {
        await processarCobranca(deps, await deps.cobranca.cobranca(r.asaas_id));
        await pool.query('UPDATE cadastro.cobrancas SET atualizado_em = now() WHERE asaas_id = $1', [
          r.asaas_id,
        ]);
      } catch (e) {
        deps.log.warn({ err: e, cobranca: r.asaas_id }, 'assinatura: conferência no Asaas falhou');
      }
    }
  }
}

/** "Já paguei": confere agora no Asaas as cobranças em aberto da conta. */
export async function conferir(deps: DepsAssinatura, contaId: number): Promise<void> {
  if (!deps.cobranca) return;
  const organizacaoId = await organizacaoDaConta(deps.pool, contaId);
  const { rows } = await deps.pool.query<{ asaas_id: string }>(
    `SELECT asaas_id FROM cadastro.cobrancas WHERE organizacao_id = $1 AND situacao IN ('pendente', 'atrasada')`,
    [organizacaoId],
  );
  for (const r of rows) await processarCobranca(deps, await deps.cobranca.cobranca(r.asaas_id));
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
            (SELECT count(*)::int FROM cadastro.cadastros_teste t
              WHERE t.confirmado_em > now() - interval '30 days' AND EXISTS (
                SELECT 1 FROM cadastro.cobrancas b WHERE b.organizacao_id = t.organizacao_id
                   AND b.tipo = 'mensalidade' AND b.situacao = 'paga')) AS "viraram30",
            (SELECT coalesce(sum(b.valor), 0)::float8 FROM cadastro.cobrancas b JOIN cadastro.organizacoes x ON x.id = b.organizacao_id
              WHERE b.situacao IN ('pendente', 'atrasada') AND b.tipo = 'mensalidade'
                AND x.assinatura IN ('atrasada', 'so_leitura') AND x.acesso_ate IS NOT NULL) AS "emAberto"
       FROM cadastro.organizacoes`,
  );
  return rows[0];
}
