import type { Executor } from '@prospeccao/db';
import type { CampanhaEntrada, StatusCampanha } from '@prospeccao/shared';

/** Campanha com o progresso da descoberta (lido das views publicadas pelo domínio descoberta). */
const SELECT = `
  SELECT c.id, c.nome, c.nicho_id AS "nichoId", n.nome AS "nichoNome", c.cidades, c.raio_km::float8 AS "raioKm",
         c.meta_diaria AS "metaDiaria", c.limite_envios_dia AS "limiteEnviosDia", c.cadencia, c.modo,
         c.max_por_busca AS "maxPorBusca", c.status, c.iniciada_em AS "iniciadaEm",
         c.criado_em AS "criadoEm", c.atualizado_em AS "atualizadoEm",
         json_build_object(
           'empresas', coalesce(p.empresas, 0),
           'comCnpj', coalesce(p.com_cnpj, 0),
           'noMaps', coalesce(p.no_maps, 0),
           'soMaps', coalesce(p.so_maps, 0),
           'dentroDoRaio', coalesce(p.dentro_do_raio, 0),
           'semLocalizacao', coalesce(p.sem_localizacao, 0),
           'comSinalEntrega', coalesce(p.com_sinal_entrega, 0),
           'buscasPendentes', coalesce(b.pendentes, 0) + coalesce(b.rodando, 0),
           'buscasConcluidas', coalesce(b.concluidas, 0),
           'buscasComErro', coalesce(b.com_erro, 0),
           'ultimaBusca', b.ultima_conclusao,
           'novos', coalesce(f.novos, 0),
           'noFunil', coalesce(f.no_funil, 0),
           'descartados', coalesce(f.descartados, 0),
           'mei', coalesce(f.mei, 0)
         ) AS progresso
    FROM cadastro.campanhas c
    JOIN cadastro.nichos n ON n.id = c.nicho_id
    LEFT JOIN descoberta.v_progresso_campanha p ON p.campanha_id = c.id
    LEFT JOIN descoberta.v_buscas_campanha b ON b.campanha_id = c.id
    LEFT JOIN LATERAL (
      -- Situação comercial dos leads da campanha: novos = nunca trabalhados.
      SELECT count(*) FILTER (WHERE o.empresa_id IS NULL AND NOT e.mei)::int AS novos,
             count(*) FILTER (WHERE e.mei AND o.empresa_id IS NULL)::int AS mei,
             count(*) FILTER (WHERE o.etapa <> 'descartado')::int AS no_funil,
             count(*) FILTER (WHERE o.etapa = 'descartado')::int AS descartados
        FROM descoberta.campanha_empresas ce
        JOIN descoberta.empresas e ON e.id = ce.empresa_id
        LEFT JOIN comercial.oportunidades o ON o.empresa_id = ce.empresa_id
       WHERE ce.campanha_id = c.id
    ) f ON true`;

export async function listar(db: Executor) {
  const { rows } = await db.query(
    `${SELECT} ORDER BY CASE c.status WHEN 'ativa' THEN 0 WHEN 'pausada' THEN 1 WHEN 'rascunho' THEN 2 ELSE 3 END, c.criado_em DESC`,
  );
  return rows;
}

export async function obter(db: Executor, id: number) {
  const { rows } = await db.query(`${SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function nichoAtivo(db: Executor, nichoId: number): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM cadastro.nichos WHERE id = $1 AND ativo', [nichoId]);
  return rows.length > 0;
}

export async function criar(db: Executor, c: CampanhaEntrada): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO cadastro.campanhas (nome, nicho_id, cidades, raio_km, meta_diaria, limite_envios_dia, cadencia, modo, max_por_busca)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      c.nome,
      c.nichoId,
      JSON.stringify(c.cidades),
      c.raioKm,
      c.metaDiaria,
      c.limiteEnviosDia,
      c.cadencia,
      c.modo,
      c.maxPorBusca,
    ],
  );
  return rows[0]!.id;
}

const COLUNAS: Record<string, string> = {
  nome: 'nome',
  nichoId: 'nicho_id',
  cidades: 'cidades',
  raioKm: 'raio_km',
  metaDiaria: 'meta_diaria',
  limiteEnviosDia: 'limite_envios_dia',
  cadencia: 'cadencia',
  modo: 'modo',
  maxPorBusca: 'max_por_busca',
};

export async function atualizar(db: Executor, id: number, dados: Record<string, unknown>) {
  const sets: string[] = [];
  const valores: unknown[] = [id];
  for (const [campo, valor] of Object.entries(dados)) {
    const coluna = COLUNAS[campo];
    if (!coluna || valor === undefined) continue;
    valores.push(campo === 'cidades' ? JSON.stringify(valor) : valor);
    sets.push(`${coluna} = $${valores.length}`);
  }
  if (sets.length) await db.query(`UPDATE cadastro.campanhas SET ${sets.join(', ')} WHERE id = $1`, valores);
}

export async function statusAtual(db: Executor, id: number): Promise<StatusCampanha | null> {
  const { rows } = await db.query<{ status: StatusCampanha }>(
    'SELECT status FROM cadastro.campanhas WHERE id = $1',
    [id],
  );
  return rows[0]?.status ?? null;
}

export async function mudarStatus(db: Executor, id: number, status: StatusCampanha) {
  await db.query(
    `UPDATE cadastro.campanhas
        SET status = $2, iniciada_em = CASE WHEN $2 = 'ativa' THEN coalesce(iniciada_em, now()) ELSE iniciada_em END
      WHERE id = $1`,
    [id, status],
  );
}

export async function baseCnpjImportada(db: Executor): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM base_cnpj.v_ultima_importacao WHERE status = 'concluida'`);
  return rows.length > 0;
}
