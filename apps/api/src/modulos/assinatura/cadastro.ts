import { createHash, randomBytes } from 'node:crypto';
import { comTransacao } from '@prospeccao/db';
import { conferirCaptcha } from '@prospeccao/integrations/cobranca';
import {
  AppError,
  type CadastroTesteEntrada,
  cnpjDoTexto,
  DIAS_TESTE,
  LEADS_TESTE,
  normalizarTelefone,
  TERMOS_VERSAO,
  USUARIOS_TESTE,
} from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import { salvarPlano } from '../plano/repositorio.js';
import { type DepsEmailSistema, mandarEmailSistema } from './email.js';

/**
 * Teste grátis pelo site: o cadastro fica esperando a confirmação do e-mail; o link cria a
 * organização (plano Time com 2 usuários e 100 leads, sem módulos), a pessoa como administradora e
 * o pedido no quadro de vendas do master (coluna "Testando").
 */

export interface DepsCadastro extends DepsEmailSistema {
  /** Cloudflare Turnstile (sem: o cadastro não pede captcha, como em desenvolvimento). */
  captcha: { site: string; segredo: string } | null;
}

const HORAS_LINK = 48;
const CADASTROS_POR_IP_DIA = 3;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const hashIp = (ip: string) =>
  createHash('sha256').update(`${ip}|prospect-teste`).digest('hex').slice(0, 32);

/** Cadastro do teste: confere o antiabuso, guarda e manda o link de confirmação. */
export async function iniciar(
  deps: DepsCadastro,
  d: CadastroTesteEntrada,
  ip: string,
  endereco: string,
): Promise<{ email: string; emailEnviado: boolean }> {
  const { pool } = deps;
  if (deps.captcha) {
    if (!d.captcha || !(await conferirCaptcha(deps.captcha.segredo, d.captcha, ip)))
      throw AppError.invalido('Confirme que você não é um robô (a caixinha do formulário) e tente de novo.');
  }
  const whatsapp = normalizarTelefone(d.whatsapp)!;
  const cnpj = d.cnpj ? cnpjDoTexto(d.cnpj) : null;
  const ipHash = hashIp(ip);
  const { rows: ips } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cadastro.cadastros_teste WHERE ip_hash = $1 AND criado_em > now() - interval '1 day'`,
    [ipHash],
  );
  if ((ips[0]?.n ?? 0) >= CADASTROS_POR_IP_DIA)
    throw new AppError(
      429,
      'muitos_cadastros',
      'Muitos cadastros deste endereço hoje. Fale com a gente pelo WhatsApp.',
    );
  const { rows: ja } = await pool.query(`SELECT 1 FROM cadastro.usuarios WHERE lower(email) = $1`, [d.email]);
  if (ja[0])
    throw AppError.conflito(
      'Este e-mail já tem conta no Prospect Team. Entre com ele ou peça uma senha nova.',
    );
  const { rows: usou } = await pool.query(
    `SELECT 1 FROM cadastro.cadastros_teste
      WHERE confirmado_em IS NOT NULL AND (lower(email) = $1 OR whatsapp = $2 OR ($3::text IS NOT NULL AND cnpj = $3))`,
    [d.email, whatsapp, cnpj],
  );
  if (usou[0])
    throw AppError.conflito(
      'Esta empresa já usou o teste grátis. Fale com a gente pelo WhatsApp para assinar ou testar de novo.',
    );

  const token = randomBytes(32).toString('base64url');
  const senhaHash = await bcrypt.hash(d.senha, 10);
  // O mesmo e-mail ainda esperando: troca o link (o anterior deixa de valer).
  await pool.query(`DELETE FROM cadastro.cadastros_teste WHERE lower(email) = $1 AND confirmado_em IS NULL`, [
    d.email,
  ]);
  await pool.query(
    `INSERT INTO cadastro.cadastros_teste (nome, empresa, email, whatsapp, cnpj, senha_hash, token_hash, ip_hash, expira_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => ${HORAS_LINK}))`,
    [d.nome, d.empresa, d.email, whatsapp, cnpj, senhaHash, hashToken(token), ipHash],
  );
  const emailEnviado = await mandarConfirmacao(deps, { ...d, token, endereco });
  return { email: d.email, emailEnviado };
}

async function mandarConfirmacao(
  deps: DepsEmailSistema,
  d: { nome: string; empresa: string; email: string; token: string; endereco: string },
): Promise<boolean> {
  const link = `${d.endereco}/teste/confirmar/${d.token}`;
  return mandarEmailSistema(deps, {
    para: d.email,
    nome: d.nome,
    empresa: d.empresa,
    assunto: 'Confirme o seu e-mail para começar o teste',
    corpo: `{saudacao}\n\nFalta só confirmar o seu e-mail para a conta de teste da ${d.empresa} no Prospect Team.\n\n[[Confirmar e entrar|${link}]]\n\nO link vale ${HORAS_LINK} horas. O teste dura ${DIAS_TESTE} dias a partir da confirmação, sem cartão. Se não foi você, ignore este e-mail.`,
    chave: `teste-${hashToken(d.token).slice(0, 16)}`,
  });
}

/** Manda o link de novo (troca o link: o anterior deixa de valer). */
export async function reenviar(deps: DepsCadastro, email: string, endereco: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const { rows } = await deps.pool.query<{ nome: string; empresa: string; email: string }>(
    `UPDATE cadastro.cadastros_teste
        SET token_hash = $2, expira_em = now() + make_interval(hours => ${HORAS_LINK})
      WHERE lower(email) = $1 AND confirmado_em IS NULL AND criado_em > now() - interval '7 days'
      RETURNING nome, empresa, email`,
    [email.trim().toLowerCase(), hashToken(token)],
  );
  // Sempre a mesma resposta (não revela quem se cadastrou).
  if (rows[0]) await mandarConfirmacao(deps, { ...rows[0], token, endereco });
}

/**
 * O link do e-mail: cria a organização, a conta e a pessoa (administradora, com a senha do
 * cadastro e os termos aceitos) e começa o teste. Devolve o usuário para abrir a sessão.
 */
export async function confirmar(
  deps: DepsCadastro,
  token: string,
): Promise<{ usuarioId: number; contaId: number }> {
  const { pool } = deps;
  return comTransacao(pool, async (tx) => {
    const { rows } = await tx.query<{
      id: number;
      nome: string;
      empresa: string;
      email: string;
      whatsapp: string;
      cnpj: string | null;
      senha_hash: string;
      confirmado_em: string | null;
      vencido: boolean;
      conta_id: number | null;
    }>(
      `SELECT id::int, nome, empresa, email, whatsapp, cnpj, senha_hash, confirmado_em, (expira_em < now()) AS vencido, conta_id
         FROM cadastro.cadastros_teste WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(token)],
    );
    const c = rows[0];
    if (!c) throw AppError.naoEncontrado('Link de confirmação');
    if (c.confirmado_em)
      throw AppError.conflito('Este link já foi usado: a conta já existe. Entre com o seu e-mail e senha.');
    if (c.vencido) throw AppError.invalido('O link venceu. Peça um novo na tela de cadastro.');
    const { rows: ja } = await tx.query(`SELECT 1 FROM cadastro.usuarios WHERE lower(email) = lower($1)`, [
      c.email,
    ]);
    if (ja[0]) throw AppError.conflito('Este e-mail já tem conta no Prospect Team. Entre com ele.');

    // Nome do cliente é único: "Nexo Sistemas (2)" quando já existe outro igual.
    let organizacaoId: number | null = null;
    for (let i = 1; i <= 20 && !organizacaoId; i++) {
      const nome = i === 1 ? c.empresa : `${c.empresa} (${i})`;
      const { rows: o } = await tx.query<{ id: number }>(
        `INSERT INTO cadastro.organizacoes (nome, observacoes, assinatura, teste_ate)
         VALUES ($1, $2, 'teste', now() + make_interval(days => ${DIAS_TESTE}))
         ON CONFLICT ((lower(nome))) DO NOTHING RETURNING id`,
        [nome, `Teste grátis pelo site (${c.nome}, ${c.email})`],
      );
      organizacaoId = o[0]?.id ?? null;
    }
    if (!organizacaoId)
      throw AppError.conflito('Não deu para criar a conta com esse nome. Fale com a gente.');
    const { rows: ct } = await tx.query<{ id: number }>(
      `INSERT INTO cadastro.contas (nome, organizacao_id) VALUES ($1, $2) RETURNING id`,
      [c.empresa, organizacaoId],
    );
    const contaId = ct[0]!.id;
    await tx.query('SELECT cadastro.preparar_conta($1)', [contaId]);
    const { rows: u } = await tx.query<{ id: number }>(
      `INSERT INTO cadastro.usuarios (nome, email, papel, telefone, senha_hash, conta_id, alcance, termos_versao, termos_aceitos_em)
       VALUES ($1, $2, 'admin', $3, $4, $5, 'unidade', $6, now()) RETURNING id`,
      [c.nome, c.email, c.whatsapp, c.senha_hash, contaId, TERMOS_VERSAO],
    );
    const usuarioId = u[0]!.id;
    await tx.query('INSERT INTO comercial.metas (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      usuarioId,
    ]);
    await salvarPlano(tx, organizacaoId, {
      plano: 'time',
      limiteUsuarios: USUARIOS_TESTE,
      limiteLeadsMes: LEADS_TESTE,
      modulos: [],
      mensalidadeManual: 0,
      numerosExtras: 0,
      recursosExtras: [],
      horasReuniao: null,
      conversasIa: null,
      minutosLigacao: null,
    });
    const { rows: p } = await tx.query<{ id: string }>(
      `INSERT INTO cadastro.pedidos_site (nome, empresa, whatsapp, email, plano, canal, etapa, conta_id, nota)
       VALUES ($1, $2, $3, $4, 'Teste grátis', 'teste', 'teste', $5, $6) RETURNING id`,
      [c.nome, c.empresa, c.whatsapp, c.email, contaId, c.cnpj ? `CNPJ ${c.cnpj}` : null],
    );
    await tx.query(
      `INSERT INTO cadastro.pedidos_site_historico (pedido_id, texto, autor) VALUES ($1, $2, 'Site')`,
      [p[0]!.id, `Começou o teste grátis de ${DIAS_TESTE} dias.`],
    );
    await tx.query(
      `UPDATE cadastro.cadastros_teste SET confirmado_em = now(), organizacao_id = $2, conta_id = $3, pedido_id = $4
        WHERE id = $1`,
      [c.id, organizacaoId, contaId, p[0]!.id],
    );
    return { usuarioId, contaId };
  });
}
