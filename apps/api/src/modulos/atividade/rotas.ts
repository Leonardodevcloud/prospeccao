import { jobsAbertos } from '@prospeccao/queue';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';

/**
 * O que o motor está fazendo agora: importação de CNPJ (com a próxima tentativa, se falhou),
 * buscas no Maps e o tamanho de cada fila. Só leitura; a tela consulta a cada poucos segundos.
 */
export function rotasAtividade({ pool, filas }: DepsApi): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    const [importacao, agendadas, buscas, tamanhos] = await Promise.all([
      pool.query(
        `SELECT id, mes, status, motivo, ufs, etapa, linhas_lidas AS "linhasLidas",
                estabelecimentos, empresas, socios, erro, criado_em AS "criadoEm",
                iniciado_em AS "iniciadoEm", concluido_em AS "concluidoEm"
           FROM base_cnpj.importacoes ORDER BY criado_em DESC LIMIT 1`,
      ),
      jobsAbertos(pool, 'cnpj.importar', 1).catch(() => []),
      pool.query(
        `SELECT b.id, b.campanha_id AS "campanhaId", c.nome AS campanha, b.cidade, b.uf, b.termo,
                b.status, b.itens, b.erro, b.verificacoes,
                b.criado_em AS "criadoEm", b.iniciado_em AS "iniciadoEm", b.concluido_em AS "concluidoEm"
           FROM descoberta.buscas_maps b
           LEFT JOIN cadastro.campanhas c ON c.id = b.campanha_id
          ORDER BY (b.status IN ('rodando', 'pendente')) DESC,
                   coalesce(b.concluido_em, b.iniciado_em, b.criado_em) DESC
          LIMIT 40`,
      ),
      // Contagem direta na tabela da fila: inclui os que esperam nova tentativa depois de uma falha.
      pool
        .query<{ name: string; n: number }>(
          `SELECT name, count(*)::int AS n FROM fila.job
            WHERE state IN ('created', 'retry', 'active') GROUP BY name`,
        )
        .then((r) => Object.fromEntries(r.rows.map((x) => [x.name, x.n])))
        .catch(() => filas.tamanhos()),
    ]);

    // Busca "pendente" sem tarefa na fila não vai andar sozinha (falhou de vez ou a campanha pausou).
    const comTarefa = await pool
      .query<{ id: string }>(
        `SELECT DISTINCT data ->> 'buscaId' AS id FROM fila.job
          WHERE name IN ('maps.buscar', 'maps.coletar') AND state IN ('created', 'retry', 'active')`,
      )
      .then((r) => new Set(r.rows.map((x) => Number(x.id))))
      .catch(() => null);
    for (const b of buscas.rows) {
      b.parada =
        comTarefa != null && (b.status === 'pendente' || b.status === 'rodando') && !comTarefa.has(b.id);
    }
    const emAndamento = buscas.rows.filter((b) => b.status === 'rodando' || b.status === 'pendente').length;
    res.json({
      agora: new Date().toISOString(),
      importacao: importacao.rows[0] ?? null,
      importacaoAgendada: agendadas[0] ?? null,
      buscas: buscas.rows,
      buscasEmAndamento: emAndamento,
      filas: tamanhos,
    });
  });

  return r;
}
