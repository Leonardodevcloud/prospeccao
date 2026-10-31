import { randomBytes } from 'node:crypto';
import { comTransacao, type Executor, INICIO_MES_SP_TS, type Pool } from '@prospeccao/db';
import {
  AppError,
  type MarcaEntrada,
  type PessoaAtualizar,
  type PessoaNova,
  type UnidadeAtualizar,
  type UnidadeNova,
} from '@prospeccao/shared';
import { DIAS_CONVITE } from '../equipe/repositorio.js';
import { exigirVagaDeUsuario, planoDaOrganizacao } from '../plano/repositorio.js';

/**
 * Organização (o cliente) e as unidades dela. Só o gestor da organização (ou o master) chega aqui;
 * toda consulta filtra pela organização da sessão, nunca pelo que vem na requisição.
 */

const ABERTO = `o.etapa NOT IN ('ganho', 'perdido', 'descartado')`;

export async function unidadeDaOrganizacao(db: Executor, organizacaoId: number, unidadeId: number) {
  const { rows } = await db.query<{ id: number; nome: string; ativa: boolean }>(
    'SELECT id, nome, ativa FROM cadastro.contas WHERE id = $1 AND organizacao_id = $2',
    [unidadeId, organizacaoId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Unidade');
  return rows[0];
}

export async function resumo(db: Executor, organizacaoId: number) {
  const [org, plano, unidades, pessoas] = await Promise.all([
    db.query<{
      id: number;
      nome: string;
      exigirDuasEtapas: boolean;
      marca: { nome: string | null; cor: string | null; logo: boolean };
    }>(
      `SELECT id, nome, exigir_2fa AS "exigirDuasEtapas",
              json_build_object('nome', marca_nome, 'cor', marca_cor, 'logo', marca_logo IS NOT NULL) AS marca
         FROM cadastro.organizacoes WHERE id = $1`,
      [organizacaoId],
    ),
    planoDaOrganizacao(db, organizacaoId),
    db.query(
      `SELECT c.id, c.nome, c.ativa, c.principal, c.cota_leads_mes AS "cotaLeadsMes",
              (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
                WHERE ca.conta_id = c.id AND l.status = 'concluido' AND l.concluido_em >= ${INICIO_MES_SP_TS})::int
                AS "leadsMes",
              (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
                WHERE ca.conta_id = c.id AND l.status = 'limite')::int AS "leadsEsperando",
              (SELECT count(*) FROM cadastro.usuarios u
                WHERE u.conta_id = c.id AND u.ativo AND u.papel NOT IN ('gestor', 'leitura') AND NOT u.master)::int
                AS pessoas,
              (SELECT count(*) FROM comercial.oportunidades o WHERE o.conta_id = c.id AND ${ABERTO})::int AS "noFunil",
              (SELECT count(*) FROM comercial.oportunidades o
                WHERE o.conta_id = c.id AND o.etapa = 'ganho' AND o.etapa_desde >= ${INICIO_MES_SP_TS})::int AS "ganhosMes",
              (SELECT max(u.ultimo_acesso) FROM cadastro.usuarios u WHERE u.conta_id = c.id AND NOT u.master)
                AS "ultimoAcesso",
              c.criado_em AS "criadoEm"
         FROM cadastro.contas c WHERE c.organizacao_id = $1
        ORDER BY c.ativa DESC, c.criado_em`,
      [organizacaoId],
    ),
    db.query(
      `SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.telefone, u.conta_id AS "unidadeId", c.nome AS "unidadeNome",
              (u.senha_hash IS NULL) AS "convitePendente", u.ultimo_acesso AS "ultimoAcesso",
              u.totp_ativo AS "duasEtapas",
              (SELECT count(*)::int FROM comercial.oportunidades o
                WHERE o.conta_id = u.conta_id AND o.responsavel_id = u.id AND ${ABERTO}) AS "leadsAbertos"
         FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
        WHERE c.organizacao_id = $1 AND NOT u.master
        ORDER BY u.ativo DESC,
                 CASE u.papel WHEN 'gestor' THEN 0 WHEN 'leitura' THEN 1 WHEN 'admin' THEN 2 WHEN 'sdr' THEN 3 ELSE 4 END,
                 u.nome`,
      [organizacaoId],
    ),
  ]);
  if (!org.rows[0]) throw AppError.naoEncontrado('Organização');
  return { organizacao: org.rows[0], plano, unidades: unidades.rows, pessoas: pessoas.rows };
}

/** As cotas das unidades somadas não passam do limite da organização. */
async function conferirCotas(
  db: Executor,
  organizacaoId: number,
  unidadeId: number | null,
  cota: number | null,
) {
  if (cota == null) return;
  const p = await planoDaOrganizacao(db, organizacaoId);
  if (p.leadsMes == null) return;
  const { rows } = await db.query<{ soma: number }>(
    `SELECT coalesce(sum(cota_leads_mes), 0)::int AS soma FROM cadastro.contas
      WHERE organizacao_id = $1 AND ativa AND ($2::int IS NULL OR id <> $2)`,
    [organizacaoId, unidadeId],
  );
  const soma = (rows[0]?.soma ?? 0) + cota;
  if (soma > p.leadsMes)
    throw AppError.invalido(
      `As cotas somadas (${soma.toLocaleString('pt-BR')}) passam dos ${p.leadsMes.toLocaleString('pt-BR')} leads por mês do plano. Diminua outra cota ou peça para aumentar o plano.`,
    );
}

export async function criarUnidade(pool: Pool, organizacaoId: number, d: UnidadeNova): Promise<number> {
  await conferirCotas(pool, organizacaoId, null, d.cotaLeadsMes ?? null);
  return comTransacao(pool, async (tx) => {
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO cadastro.contas (nome, organizacao_id, cota_leads_mes) VALUES ($1, $2, $3)
       ON CONFLICT (organizacao_id, (lower(nome))) DO NOTHING RETURNING id`,
      [d.nome, organizacaoId, d.cotaLeadsMes ?? null],
    );
    const id = rows[0]?.id;
    if (!id) throw AppError.conflito('Já existe uma unidade com esse nome.');
    await tx.query('SELECT cadastro.preparar_conta($1)', [id]);
    // Mensagens e e-mails modelo falam em nome da empresa (organização), não da unidade.
    const { rows: o } = await tx.query<{ nome: string }>(
      'SELECT nome FROM cadastro.organizacoes WHERE id = $1',
      [organizacaoId],
    );
    const empresa = o[0]?.nome ?? d.nome;
    if (empresa !== d.nome) {
      const par = [id, `da ${d.nome}`, `da ${empresa}`];
      await tx.query(
        'UPDATE comercial.modelos_mensagem SET texto = replace(texto, $2, $3) WHERE conta_id = $1',
        par,
      );
      await tx.query(
        'UPDATE comercial.respostas_rapidas SET texto = replace(texto, $2, $3) WHERE conta_id = $1',
        par,
      );
      await tx.query(
        'UPDATE comercial.modelos_email SET corpo = replace(corpo, $2, $3) WHERE conta_id = $1',
        par,
      );
      await tx.query(
        `UPDATE comercial.marcas_email SET nome = $2, remetente_nome = $2, assinatura = replace(assinatura, $3, $2)
          WHERE conta_id = $1`,
        [id, empresa, d.nome],
      );
    }
    return id;
  });
}

export async function atualizarUnidade(db: Executor, organizacaoId: number, id: number, d: UnidadeAtualizar) {
  const u = await unidadeDaOrganizacao(db, organizacaoId, id);
  if (d.cotaLeadsMes !== undefined) await conferirCotas(db, organizacaoId, id, d.cotaLeadsMes);
  if (d.ativa === false) {
    const { rows } = await db.query<{ n: number; principal: boolean }>(
      `SELECT (SELECT count(*)::int FROM cadastro.contas WHERE organizacao_id = $1 AND ativa AND id <> $2) AS n,
              (SELECT principal FROM cadastro.contas WHERE id = $2) AS principal`,
      [organizacaoId, id],
    );
    if (rows[0]?.principal)
      throw AppError.invalido('A conta principal da plataforma não pode ser desativada.');
    if (!rows[0]?.n) throw AppError.invalido('Precisa ficar pelo menos uma unidade ativa.');
  }
  try {
    await db.query(
      `UPDATE cadastro.contas
          SET nome = coalesce($2, nome), ativa = coalesce($3, ativa),
              cota_leads_mes = CASE WHEN $4 THEN $5 ELSE cota_leads_mes END
        WHERE id = $1`,
      [id, d.nome ?? null, d.ativa ?? null, d.cotaLeadsMes !== undefined, d.cotaLeadsMes ?? null],
    );
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505')
      throw AppError.conflito('Já existe uma unidade com esse nome.');
    throw erro;
  }
  return u;
}

export async function criarPessoa(
  pool: Pool,
  organizacaoId: number,
  d: PessoaNova,
): Promise<{ id: number; token: string }> {
  await unidadeDaOrganizacao(pool, organizacaoId, d.unidadeId);
  await exigirVagaDeUsuario(pool, d.unidadeId);
  const token = randomBytes(24).toString('base64url');
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO cadastro.usuarios (nome, email, papel, telefone, convite_token, convite_expira, conta_id)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => ${DIAS_CONVITE}), $6)
     ON CONFLICT ((lower(email))) DO NOTHING
     RETURNING id`,
    [d.nome, d.email, d.papel, d.telefone ?? null, token, d.unidadeId],
  );
  if (!rows[0]) throw AppError.conflito('Já existe alguém com este e-mail no sistema.');
  await pool.query('INSERT INTO comercial.metas (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [
    rows[0].id,
  ]);
  return { id: rows[0].id, token };
}

async function pessoaDaOrganizacao(db: Executor, organizacaoId: number, id: number) {
  const { rows } = await db.query<{
    id: number;
    nome: string;
    papel: string;
    ativo: boolean;
    conta_id: number;
  }>(
    `SELECT u.id, u.nome, u.papel, u.ativo, u.conta_id FROM cadastro.usuarios u
       JOIN cadastro.contas c ON c.id = u.conta_id
      WHERE u.id = $1 AND c.organizacao_id = $2 AND NOT u.master`,
    [id, organizacaoId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Pessoa');
  return rows[0];
}

/** Quantos gestores ativos ficam se esta pessoa deixar de ser gestora. */
async function outrosGestores(db: Executor, organizacaoId: number, exceto: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
      WHERE c.organizacao_id = $1 AND u.papel = 'gestor' AND u.ativo AND u.id <> $2`,
    [organizacaoId, exceto],
  );
  return rows[0]?.n ?? 0;
}

export async function atualizarPessoa(
  pool: Pool,
  organizacaoId: number,
  id: number,
  d: PessoaAtualizar,
  quem: { id: number; master: boolean },
) {
  const p = await pessoaDaOrganizacao(pool, organizacaoId, id);
  if (id === quem.id && (d.ativo === false || (d.papel && d.papel !== p.papel)))
    throw AppError.invalido('Você não pode desativar nem mudar o próprio papel. Peça a outro gestor.');
  const deixaDeSerGestor = p.papel === 'gestor' && ((d.papel && d.papel !== 'gestor') || d.ativo === false);
  if (deixaDeSerGestor && !quem.master && (await outrosGestores(pool, organizacaoId, id)) === 0)
    throw AppError.invalido('Precisa ficar pelo menos um gestor ativo na organização.');
  if (d.unidadeId) await unidadeDaOrganizacao(pool, organizacaoId, d.unidadeId);
  if (d.ativo === true && !p.ativo) await exigirVagaDeUsuario(pool, p.conta_id);
  const saiDaUnidade = (d.unidadeId && d.unidadeId !== p.conta_id) || (d.ativo === false && p.ativo);
  if (saiDaUnidade && d.transferirPara) {
    const { rows } = await pool.query(
      `SELECT 1 FROM cadastro.usuarios WHERE id = $1 AND conta_id = $2 AND ativo AND papel NOT IN ('gestor', 'leitura')`,
      [d.transferirPara, p.conta_id],
    );
    if (!rows.length)
      throw AppError.invalido('Quem recebe os leads precisa ser uma pessoa ativa da mesma unidade.');
  }

  await comTransacao(pool, async (tx) => {
    // Os leads abertos ficam na unidade: passam para quem foi escolhido ou ficam sem dono (rodízio).
    if (saiDaUnidade)
      await tx.query(
        `UPDATE comercial.oportunidades o SET responsavel_id = $3
          WHERE o.conta_id = $1 AND o.responsavel_id = $2 AND ${ABERTO}`,
        [p.conta_id, id, d.transferirPara ?? null],
      );
    const sets: string[] = [];
    const valores: unknown[] = [id];
    const set = (coluna: string, v: unknown) => {
      valores.push(v);
      sets.push(`${coluna} = $${valores.length}`);
    };
    if (d.nome !== undefined) set('nome', d.nome);
    if (d.papel !== undefined) set('papel', d.papel);
    if (d.ativo !== undefined) set('ativo', d.ativo);
    if (d.unidadeId !== undefined) set('conta_id', d.unidadeId);
    if (sets.length) await tx.query(`UPDATE cadastro.usuarios SET ${sets.join(', ')} WHERE id = $1`, valores);
  });
  return p;
}

export async function novoConvite(pool: Pool, organizacaoId: number, id: number): Promise<string> {
  await pessoaDaOrganizacao(pool, organizacaoId, id);
  const token = randomBytes(24).toString('base64url');
  await pool.query(
    `UPDATE cadastro.usuarios
        SET convite_token = $2, convite_expira = now() + make_interval(days => ${DIAS_CONVITE}), senha_hash = NULL
      WHERE id = $1`,
    [id, token],
  );
  return token;
}

/* ───────────── Marca e segurança da organização ───────────── */

/** Confere uma imagem em data URL (PNG ou JPEG de verdade, no tamanho) e devolve os bytes. */
export function imagemDaMarca(
  dataUrl: string,
  limiteKb: number,
  oQue: string,
): { buf: Buffer; tipo: string } {
  const [cabeca, dados] = dataUrl.split(',');
  const tipo = cabeca!.includes('png') ? 'image/png' : 'image/jpeg';
  const buf = Buffer.from(dados ?? '', 'base64');
  // Confere o arquivo de verdade (não só o que o navegador disse).
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if ((tipo === 'image/png' && !png) || (tipo === 'image/jpeg' && !jpg))
    throw AppError.invalido(`${oQue}: o arquivo não é uma imagem PNG ou JPG válida.`);
  if (buf.length > limiteKb * 1024)
    throw AppError.invalido(
      `${oQue} grande demais: use uma imagem de até ${limiteKb >= 1024 ? `${limiteKb / 1024} MB` : `${limiteKb} KB`}.`,
    );
  return { buf, tipo };
}

export async function salvarMarca(db: Executor, organizacaoId: number, d: MarcaEntrada): Promise<void> {
  const sets: string[] = ['marca_atualizada_em = now()'];
  const valores: unknown[] = [organizacaoId];
  const set = (coluna: string, v: unknown) => {
    valores.push(v);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (d.nome !== undefined) set('marca_nome', d.nome || null);
  if (d.cor !== undefined) set('marca_cor', d.cor || null);
  const arquivos: [keyof MarcaEntrada, string, number, string][] = [
    ['logo', 'marca_logo', 300, 'Logo'],
    ['icone', 'marca_icone', 200, 'Ícone'],
    ['imagem', 'marca_imagem', 1024, 'Imagem de divulgação'],
  ];
  for (const [campo, coluna, limiteKb, oQue] of arquivos) {
    const v = d[campo];
    if (v === undefined) continue;
    if (v === null) {
      set(coluna, null);
      set(`${coluna}_tipo`, null);
    } else {
      const { buf, tipo } = imagemDaMarca(v, limiteKb, oQue);
      set(coluna, buf);
      set(`${coluna}_tipo`, tipo);
    }
  }
  await db.query(`UPDATE cadastro.organizacoes SET ${sets.join(', ')} WHERE id = $1`, valores);
}

export async function logo(db: Executor, organizacaoId: number) {
  const { rows } = await db.query<{ marca_logo: Buffer | null; marca_logo_tipo: string | null }>(
    'SELECT marca_logo, marca_logo_tipo FROM cadastro.organizacoes WHERE id = $1',
    [organizacaoId],
  );
  return rows[0]?.marca_logo
    ? { dados: rows[0].marca_logo, tipo: rows[0].marca_logo_tipo ?? 'image/png' }
    : null;
}

export async function marca(db: Executor, organizacaoId: number) {
  const { rows } = await db.query<{ nome: string; marca_nome: string | null; marca_cor: string | null }>(
    'SELECT nome, marca_nome, marca_cor FROM cadastro.organizacoes WHERE id = $1',
    [organizacaoId],
  );
  return rows[0] ?? null;
}

/** Celular perdido: tira a verificação em duas etapas da pessoa (ela configura de novo). */
export async function zerarDuasEtapas(db: Executor, organizacaoId: number, id: number) {
  await pessoaDaOrganizacao(db, organizacaoId, id);
  await db.query(
    `UPDATE cadastro.usuarios SET totp_ativo = false, totp_segredo = NULL, totp_desde = NULL, totp_recuperacao = '{}'
      WHERE id = $1`,
    [id],
  );
  await db.query(
    'UPDATE cadastro.sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL',
    [id],
  );
}
