import { type Executor, valoresEmLote } from '@prospeccao/db';
import type { receita } from '@prospeccao/integrations';

/** Escritas no schema base_cnpj. Só este serviço escreve aqui. */

export interface Importacao {
  id: number;
  mes: string;
  status: string;
}

export async function criarImportacao(db: Executor, motivo: 'manual' | 'agendada', mes: string | null) {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO base_cnpj.importacoes (mes, motivo) VALUES ($1, $2) RETURNING id`,
    [mes ?? 'auto', motivo],
  );
  return rows[0]!.id;
}

export async function obterImportacao(db: Executor, id: number): Promise<Importacao | null> {
  const { rows } = await db.query<Importacao>(
    'SELECT id, mes, status FROM base_cnpj.importacoes WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function marcarInicio(db: Executor, id: number, mes: string, ufs: string[], cnaes: string[]) {
  await db.query(
    `UPDATE base_cnpj.importacoes
        SET status = 'rodando', mes = $2, ufs = $3, cnaes = $4, iniciado_em = now(), erro = NULL,
            linhas_lidas = 0, estabelecimentos = 0, empresas = 0, socios = 0
      WHERE id = $1`,
    [id, mes, ufs, cnaes],
  );
}

export async function registrarProgresso(
  db: Executor,
  id: number,
  p: { etapa: string; linhasLidas: number; estabelecimentos: number; empresas: number; socios: number },
) {
  await db.query(
    `UPDATE base_cnpj.importacoes
        SET etapa = $2, linhas_lidas = $3, estabelecimentos = $4, empresas = $5, socios = $6
      WHERE id = $1`,
    [id, p.etapa, p.linhasLidas, p.estabelecimentos, p.empresas, p.socios],
  );
}

export async function marcarFim(db: Executor, id: number, erro: string | null) {
  await db.query(
    `UPDATE base_cnpj.importacoes
        SET status = $2, erro = $3, etapa = NULL, concluido_em = now()
      WHERE id = $1`,
    [id, erro ? 'erro' : 'concluida', erro],
  );
}

export async function lerAlvos(db: Executor): Promise<{ cnaes: string[]; ufs: string[] }> {
  const { rows } = await db.query<{ cnaes: string[]; ufs: string[] }>(
    'SELECT cnaes, ufs FROM cadastro.v_alvos_importacao',
  );
  return rows[0] ?? { cnaes: [], ufs: [] };
}

export async function salvarDominio(
  db: Executor,
  tabela: 'municipios' | 'qualificacoes' | 'cnaes',
  itens: { codigo: string; descricao: string }[],
) {
  if (!itens.length) return;
  const coluna = tabela === 'municipios' ? 'nome' : 'descricao';
  const { placeholders, valores } = valoresEmLote(itens.map((i) => [i.codigo, i.descricao]));
  await db.query(
    `INSERT INTO base_cnpj.${tabela} (codigo, ${coluna}) VALUES ${placeholders}
     ON CONFLICT (codigo) DO UPDATE SET ${coluna} = EXCLUDED.${coluna}`,
    valores,
  );
}

export async function salvarEstabelecimentos(
  db: Executor,
  importacaoId: number,
  itens: receita.Estabelecimento[],
) {
  if (!itens.length) return;
  const { placeholders, valores } = valoresEmLote(
    itens.map((e) => [
      e.cnpj,
      e.cnpjBasico,
      e.matriz,
      e.nomeFantasia,
      e.situacao,
      e.dataSituacao,
      e.dataInicio,
      e.cnaePrincipal,
      e.cnaesSecundarios,
      e.tipoLogradouro,
      e.logradouro,
      e.numero,
      e.complemento,
      e.bairro,
      e.cep,
      e.uf,
      e.municipioCodigo,
      e.telefones,
      e.email,
      importacaoId,
    ]),
  );
  await db.query(
    `INSERT INTO base_cnpj.estabelecimentos
       (cnpj, cnpj_basico, matriz, nome_fantasia, situacao, data_situacao, data_inicio, cnae_principal,
        cnaes_secundarios, tipo_logradouro, logradouro, numero, complemento, bairro, cep, uf,
        municipio_codigo, telefones, email, importacao_id)
     VALUES ${placeholders}
     ON CONFLICT (cnpj) DO UPDATE SET
       matriz = EXCLUDED.matriz, nome_fantasia = EXCLUDED.nome_fantasia, situacao = EXCLUDED.situacao,
       data_situacao = EXCLUDED.data_situacao, data_inicio = EXCLUDED.data_inicio,
       cnae_principal = EXCLUDED.cnae_principal, cnaes_secundarios = EXCLUDED.cnaes_secundarios,
       tipo_logradouro = EXCLUDED.tipo_logradouro, logradouro = EXCLUDED.logradouro, numero = EXCLUDED.numero,
       complemento = EXCLUDED.complemento, bairro = EXCLUDED.bairro, cep = EXCLUDED.cep, uf = EXCLUDED.uf,
       municipio_codigo = EXCLUDED.municipio_codigo, telefones = EXCLUDED.telefones, email = EXCLUDED.email,
       importacao_id = EXCLUDED.importacao_id, atualizado_em = now()`,
    valores,
  );
}

export async function salvarEmpresas(db: Executor, importacaoId: number, itens: receita.Empresa[]) {
  if (!itens.length) return;
  const { placeholders, valores } = valoresEmLote(
    itens.map((e) => [
      e.cnpjBasico,
      e.razaoSocial,
      e.naturezaJuridica,
      e.capitalSocial,
      e.porte,
      importacaoId,
    ]),
  );
  await db.query(
    `INSERT INTO base_cnpj.empresas (cnpj_basico, razao_social, natureza_juridica, capital_social, porte, importacao_id)
     VALUES ${placeholders}
     ON CONFLICT (cnpj_basico) DO UPDATE SET
       razao_social = EXCLUDED.razao_social, natureza_juridica = EXCLUDED.natureza_juridica,
       capital_social = EXCLUDED.capital_social, porte = EXCLUDED.porte,
       importacao_id = EXCLUDED.importacao_id, atualizado_em = now()`,
    valores,
  );
}

/** Sócios são substituídos por inteiro a cada importação (o quadro muda). */
export async function limparSocios(db: Executor, basicos: string[]) {
  for (let i = 0; i < basicos.length; i += 5000) {
    await db.query('DELETE FROM base_cnpj.socios WHERE cnpj_basico = ANY($1)', [basicos.slice(i, i + 5000)]);
  }
}

export async function salvarSocios(db: Executor, importacaoId: number, itens: receita.Socio[]) {
  if (!itens.length) return;
  const { placeholders, valores } = valoresEmLote(
    itens.map((s) => [
      s.cnpjBasico,
      s.tipo,
      s.nome,
      s.documento,
      s.qualificacaoCodigo,
      s.dataEntrada,
      s.faixaEtaria,
      importacaoId,
    ]),
  );
  await db.query(
    `INSERT INTO base_cnpj.socios
       (cnpj_basico, tipo, nome, documento, qualificacao_codigo, data_entrada, faixa_etaria, importacao_id)
     VALUES ${placeholders}`,
    valores,
  );
}
