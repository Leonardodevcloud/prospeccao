import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import type { ItemMaps } from '@prospeccao/integrations/apify';
import { normalizarCidade, normalizarNome } from '@prospeccao/shared';
import type { CampanhaDescoberta } from './repositorio.js';

export type TipoCruzamento = 'place_id' | 'telefone' | 'nome_cep' | 'nome_cidade' | 'novo' | 'descartado';

/** Similaridade mínima de nome (pg_trgm) para aceitar o par. */
export const SIMILARIDADE_COM_CEP = 0.45;
export const SIMILARIDADE_SO_CIDADE = 0.62;

interface Candidato {
  id: number;
  sim: number;
}

/** Nome ou categoria com palavra negativa do nicho (ex.: "oficina", "fechado") não entra na campanha. */
export function temPalavraNegativa(item: Pick<ItemMaps, 'nome' | 'categoria'>, palavras: string[]): boolean {
  if (!palavras.length) return false;
  const texto = ` ${normalizarNome(`${item.nome} ${item.categoria ?? ''}`)} `;
  return palavras.some((p) => {
    const alvo = normalizarNome(p);
    return alvo.length > 0 && texto.includes(` ${alvo} `);
  });
}

/**
 * Acha a empresa da base que corresponde ao lugar do Maps, em ordem de
 * confiança: mesmo place_id, mesmo telefone, nome parecido no mesmo CEP, nome
 * muito parecido na mesma cidade. Só considera empresas ainda sem place_id.
 */
async function acharEmpresa(
  db: Executor,
  item: ItemMaps,
  uf: string,
  cidade: string,
): Promise<{ id: number; tipo: TipoCruzamento; sim: number | null } | null> {
  const porPlace = await db.query<{ id: number }>('SELECT id FROM descoberta.empresas WHERE place_id = $1', [
    item.placeId,
  ]);
  if (porPlace.rows[0]) return { id: porPlace.rows[0].id, tipo: 'place_id', sim: null };

  if (item.telefone) {
    const r = await db.query<{ id: number }>(
      `SELECT id FROM descoberta.empresas
        WHERE uf = $1 AND place_id IS NULL AND $2 = ANY(telefones_receita)
        ORDER BY (cidade = $3) DESC, id LIMIT 1`,
      [uf, item.telefone, cidade],
    );
    if (r.rows[0]) return { id: r.rows[0].id, tipo: 'telefone', sim: null };
  }

  const nome = normalizarNome(item.nome);
  if (!nome) return null;

  if (item.cep) {
    const r = await db.query<Candidato>(
      `SELECT id, greatest(similarity(nome_busca, $1), similarity(coalesce(razao_busca, ''), $1)) AS sim
         FROM descoberta.empresas
        WHERE cep = $2 AND place_id IS NULL
        ORDER BY sim DESC LIMIT 1`,
      [nome, item.cep],
    );
    const c = r.rows[0];
    if (c && c.sim >= SIMILARIDADE_COM_CEP) return { id: c.id, tipo: 'nome_cep', sim: c.sim };
  }

  const r = await db.query<Candidato>(
    `SELECT id, greatest(similarity(nome_busca, $1), similarity(coalesce(razao_busca, ''), $1)) AS sim
       FROM descoberta.empresas
      WHERE uf = $2 AND cidade = $3 AND place_id IS NULL
        AND (nome_busca % $1 OR razao_busca % $1)
      ORDER BY sim DESC LIMIT 1`,
    [nome, uf, cidade],
  );
  const c = r.rows[0];
  if (c && c.sim >= SIMILARIDADE_SO_CIDADE) return { id: c.id, tipo: 'nome_cidade', sim: c.sim };
  return null;
}

/**
 * Grava um resultado do Maps na base de empresas: casa com uma empresa
 * existente ou cria uma nova, atualiza os dados do Maps e liga à campanha.
 */
export async function cruzarResultado(
  pool: Pool,
  campanha: CampanhaDescoberta,
  busca: { cidade: string; uf: string },
  resultadoId: number,
  item: ItemMaps,
): Promise<{ tipo: TipoCruzamento; empresaId: number | null }> {
  return comTransacao(pool, async (db) => {
    if (temPalavraNegativa(item, campanha.palavras_negativas)) {
      await db.query(`UPDATE descoberta.maps_resultados SET cruzamento = 'descartado' WHERE id = $1`, [
        resultadoId,
      ]);
      return { tipo: 'descartado' as const, empresaId: null };
    }

    const uf = item.uf ?? busca.uf;
    const cidade = normalizarCidade(item.cidade ?? busca.cidade);
    const achada = await acharEmpresa(db, item, uf, cidade);

    let empresaId: number;
    let tipo: TipoCruzamento;
    if (achada) {
      empresaId = achada.id;
      tipo = achada.tipo;
    } else {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO descoberta.empresas (nome, cidade, uf, cep) VALUES ($1, $2, $3, $4) RETURNING id`,
        [item.nome, cidade, uf, item.cep],
      );
      empresaId = rows[0]!.id;
      tipo = 'novo';
    }

    await db.query(
      `UPDATE descoberta.empresas SET
         place_id = $2, maps_nome = $3, maps_categoria = $4, maps_endereco = $5, maps_nota = $6,
         maps_avaliacoes = $7, maps_site = $8, maps_telefone = $9, maps_url = $10, maps_fechada = $11,
         maps_em = now(),
         nome = $3, -- o nome no Maps é o que a loja usa com o cliente
         lat = CASE WHEN geo_fonte IS DISTINCT FROM 'manual' AND $12::float8 IS NOT NULL THEN $12 ELSE lat END,
         lng = CASE WHEN geo_fonte IS DISTINCT FROM 'manual' AND $13::float8 IS NOT NULL THEN $13 ELSE lng END,
         geo_fonte = CASE WHEN geo_fonte IS DISTINCT FROM 'manual' AND $12::float8 IS NOT NULL THEN 'maps' ELSE geo_fonte END,
         sinal_entrega = CASE WHEN $14::boolean IS NULL THEN sinal_entrega ELSE $14 END,
         sinal_entrega_fonte = CASE WHEN $14::boolean IS NULL THEN sinal_entrega_fonte ELSE 'maps' END
       WHERE id = $1`,
      [
        empresaId,
        item.placeId,
        item.nome,
        item.categoria,
        item.endereco,
        item.nota,
        item.avaliacoes,
        item.site,
        item.telefone,
        item.url,
        item.fechada,
        item.lat,
        item.lng,
        item.entrega,
      ],
    );

    await db.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem) VALUES ($1, $2, 'maps')
       ON CONFLICT (campanha_id, empresa_id) DO UPDATE
         SET origem = CASE WHEN descoberta.campanha_empresas.origem = 'cnpj' THEN 'ambos'
                           ELSE descoberta.campanha_empresas.origem END`,
      [campanha.id, empresaId],
    );

    await db.query(
      'UPDATE descoberta.maps_resultados SET empresa_id = $2, cruzamento = $3, similaridade = $4 WHERE id = $1',
      [resultadoId, empresaId, tipo, achada?.sim ?? null],
    );
    return { tipo, empresaId };
  });
}
