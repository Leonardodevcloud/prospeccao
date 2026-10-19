import { type Executor, valoresEmLote } from '@prospeccao/db';
import { receita } from '@prospeccao/integrations';

/** Escritas no schema base_cnpj. Só este serviço escreve aqui. */

export interface Importacao {
  id: number;
  mes: string;
  status: string;
  /** Arquivos já processados por uma tentativa anterior (a nova tentativa pula). */
  arquivosConcluidos: string[];
  linhasLidas: number;
  estabelecimentos: number;
  empresas: number;
  socios: number;
}

/**
 * Importação de um job da fila. Nova tentativa do mesmo job (deploy, queda de rede) devolve
 * a mesma importação, para continuar de onde parou em vez de criar outra do zero.
 */
export async function importacaoDoJob(
  db: Executor,
  jobId: string,
  motivo: 'manual' | 'agendada' | 'mei',
  mes: string | null,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO base_cnpj.importacoes (mes, motivo, job_id) VALUES ($1, $2, $3)
     ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO UPDATE SET job_id = EXCLUDED.job_id
     RETURNING id`,
    [mes ?? 'auto', motivo, jobId],
  );
  return Number(rows[0]!.id);
}

export async function criarImportacao(
  db: Executor,
  motivo: 'manual' | 'agendada' | 'mei',
  mes: string | null,
) {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO base_cnpj.importacoes (mes, motivo) VALUES ($1, $2) RETURNING id`,
    [mes ?? 'auto', motivo],
  );
  return Number(rows[0]!.id);
}

export async function obterImportacao(db: Executor, id: number): Promise<Importacao | null> {
  const { rows } = await db.query<Importacao>(
    `SELECT id, mes, status, arquivos_concluidos AS "arquivosConcluidos",
            coalesce((placar_concluido->>'linhasLidas')::bigint, 0)::float8 AS "linhasLidas",
            coalesce((placar_concluido->>'estabelecimentos')::int, 0) AS estabelecimentos,
            coalesce((placar_concluido->>'empresas')::int, 0) AS empresas,
            coalesce((placar_concluido->>'socios')::int, 0) AS socios
       FROM base_cnpj.importacoes WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Começo (ou retomada) da importação. Na retomada, mantém os contadores e os arquivos já feitos. */
export async function marcarInicio(
  db: Executor,
  id: number,
  mes: string,
  ufs: string[],
  cnaes: string[],
  retomando = false,
) {
  await db.query(
    retomando
      ? `UPDATE base_cnpj.importacoes
            SET status = 'rodando', mes = $2, ufs = $3, cnaes = $4, erro = NULL, concluido_em = NULL
          WHERE id = $1`
      : `UPDATE base_cnpj.importacoes
            SET status = 'rodando', mes = $2, ufs = $3, cnaes = $4, iniciado_em = now(), erro = NULL,
                concluido_em = NULL, linhas_lidas = 0, estabelecimentos = 0, empresas = 0, socios = 0,
                arquivos_concluidos = '{}', placar_concluido = NULL
          WHERE id = $1`,
    [id, mes, ufs, cnaes],
  );
}

/** Ponto de retomada: arquivo processado por inteiro, com os contadores daquele momento. */
export async function marcarArquivoConcluido(
  db: Executor,
  id: number,
  arquivos: string[],
  p: { linhasLidas: number; estabelecimentos: number; empresas: number; socios: number },
) {
  await db.query(
    `UPDATE base_cnpj.importacoes
        SET arquivos_concluidos = (SELECT array_agg(DISTINCT a) FROM unnest(arquivos_concluidos || $2::text[]) a),
            placar_concluido = $3::jsonb
      WHERE id = $1`,
    [
      id,
      arquivos,
      JSON.stringify({
        linhasLidas: p.linhasLidas,
        estabelecimentos: p.estabelecimentos,
        empresas: p.empresas,
        socios: p.socios,
      }),
    ],
  );
}

/** Raízes de CNPJ já guardadas por esta importação (para retomar depois dos estabelecimentos). */
export async function basicosDaImportacao(db: Executor, id: number): Promise<string[]> {
  const { rows } = await db.query<{ cnpj_basico: string }>(
    'SELECT DISTINCT cnpj_basico FROM base_cnpj.estabelecimentos WHERE importacao_id = $1',
    [id],
  );
  return rows.map((r) => r.cnpj_basico);
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
    itens.map((e) => {
      const mei = receita.pareceMei(e.naturezaJuridica, e.razaoSocial);
      return [
        e.cnpjBasico,
        e.razaoSocial,
        e.naturezaJuridica,
        e.capitalSocial,
        e.porte,
        importacaoId,
        mei,
        mei ? 'nome' : null,
      ];
    }),
  );
  await db.query(
    `INSERT INTO base_cnpj.empresas
       (cnpj_basico, razao_social, natureza_juridica, capital_social, porte, importacao_id, mei, mei_fonte)
     VALUES ${placeholders}
     ON CONFLICT (cnpj_basico) DO UPDATE SET
       razao_social = EXCLUDED.razao_social, natureza_juridica = EXCLUDED.natureza_juridica,
       capital_social = EXCLUDED.capital_social, porte = EXCLUDED.porte,
       importacao_id = EXCLUDED.importacao_id, atualizado_em = now(),
       -- a marca do Simples (oficial) vale mais que a dedução pelo nome
       -- MEI pelo Simples OU pelo nome no formato do MEI (ex-MEI também fica de fora)
       mei = coalesce(base_cnpj.empresas.mei_fonte = 'simples' AND base_cnpj.empresas.mei, false) OR EXCLUDED.mei,
       mei_fonte = CASE WHEN base_cnpj.empresas.mei_fonte = 'simples' THEN 'simples' ELSE EXCLUDED.mei_fonte END`,
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

/** Importação que estava rodando quando o serviço caiu: fecha como interrompida (a fila tenta de novo). */
export async function encerrarInterrompidas(db: Executor, motivo: string): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE base_cnpj.importacoes SET status = 'erro', erro = $1, concluido_em = now()
      WHERE status IN ('rodando', 'na_fila')`,
    [motivo],
  );
  return rowCount ?? 0;
}

/** Marca Simples e MEI pela tabela oficial da Receita (vale mais que a dedução pelo nome). */
export async function salvarSimples(db: Executor, itens: receita.OpcaoSimples[]): Promise<number> {
  if (!itens.length) return 0;
  const { rowCount } = await db.query(
    `UPDATE base_cnpj.empresas e
        SET simples = x.simples, mei_fonte = 'simples',
            -- MEI hoje (Simples) ou ex-MEI (nome no formato do MEI): os dois ficam de fora
            mei = x.mei OR e.razao_social ~ '^d{2}.d{3}.d{3}s'
                  OR (e.natureza_juridica = '2135' AND e.razao_social ~ 'd{11}s*$')
       FROM unnest($1::text[], $2::boolean[], $3::boolean[]) AS x(cnpj_basico, simples, mei)
      WHERE e.cnpj_basico = x.cnpj_basico`,
    [itens.map((i) => i.cnpjBasico), itens.map((i) => i.simples), itens.map((i) => i.mei)],
  );
  return rowCount ?? 0;
}

/** Raízes de CNPJ de toda a base (para ler o Simples sem reimportar tudo). */
export async function todosOsBasicos(db: Executor): Promise<string[]> {
  const { rows } = await db.query<{ cnpj_basico: string }>('SELECT cnpj_basico FROM base_cnpj.empresas');
  return rows.map((r) => r.cnpj_basico);
}

/** A base já tem empresas, mas nenhuma marcada pelo Simples: falta ler o arquivo do MEI. */
export async function faltaLerSimples(db: Executor): Promise<boolean> {
  const { rows } = await db.query<{ falta: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM base_cnpj.empresas)
            AND NOT EXISTS (SELECT 1 FROM base_cnpj.empresas WHERE mei_fonte = 'simples') AS falta`,
  );
  return rows[0]?.falta ?? false;
}
