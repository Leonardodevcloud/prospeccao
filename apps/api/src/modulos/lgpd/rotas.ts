import { chaveTitular, comTransacao } from '@prospeccao/db';
import { AppError, esquecerTitular } from '@prospeccao/shared';
import { type RequestHandler, Router } from 'express';
import { conta, contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';

/**
 * LGPD na unidade (administrador ou gestor):
 *  - exportar os dados da unidade (portabilidade, fim de contrato);
 *  - esquecer um titular que pediu: a negociação, as conversas e os contatos guardados na
 *    organização saem, e a empresa não volta por campanha, importação ou cadastro à mão.
 */

/** A leitura (diretoria) não leva os dados para fora. */
const semLeitura: RequestHandler = (req, _res, next) =>
  next(req.usuario?.papelOrganizacao === 'leitura' ? AppError.proibido() : undefined);

export function rotasLgpd({ pool, log }: DepsApi): Router {
  const r = Router();
  r.use(exigirAdmin, semLeitura);

  r.get('/exportar', async (req, res) => {
    const C = contaSql();
    const consultas: Record<string, string> = {
      unidade: `SELECT c.id, c.nome, o.nome AS organizacao, c.criado_em FROM cadastro.contas c
                  JOIN cadastro.organizacoes o ON o.id = c.organizacao_id WHERE c.id = ${C}`,
      pessoas: `SELECT id, nome, email, papel, ativo, telefone, ultimo_acesso, criado_em
                  FROM cadastro.usuarios WHERE conta_id = ${C}`,
      leads: `SELECT e.id, e.nome, e.razao_social, e.cnpj, e.cidade, e.uf, ce.campanha_id, ce.origem, ce.liberado_em
                FROM descoberta.campanha_empresas ce JOIN descoberta.empresas e ON e.id = ce.empresa_id
               WHERE ce.conta_id = ${C} AND ce.liberado_em IS NOT NULL`,
      negociacoes: `SELECT empresa_id, etapa, etapa_desde, responsavel_id, valor_mensal, motivo, proxima_acao,
                           proxima_acao_em, criado_em FROM comercial.oportunidades WHERE conta_id = ${C}`,
      atividades: `SELECT empresa_id, tipo, direcao, texto, contato, de_etapa, para_etapa, autor, criado_em
                     FROM comercial.atividades WHERE conta_id = ${C} ORDER BY criado_em LIMIT 500000`,
      mensagens: `SELECT empresa_id, telefone, direcao, origem, texto, status, criado_em
                    FROM comercial.mensagens WHERE conta_id = ${C} ORDER BY criado_em LIMIT 500000`,
      contatos: `SELECT empresa_id, canal, valor, fontes, status, criado_em
                   FROM enriquecimento.contatos WHERE conta_id = ${C}`,
      possiveisDecisores: `SELECT empresa_id, nome, cargo, fontes, criado_em
                             FROM enriquecimento.pessoas WHERE conta_id = ${C}`,
      tarefas: `SELECT empresa_id, tipo, titulo, descricao, inicio, fim, concluida_em, criado_em
                FROM comercial.tarefas WHERE conta_id = ${C}`,
    };
    const saida: Record<string, unknown> = { geradoEm: new Date().toISOString() };
    for (const [k, sql] of Object.entries(consultas)) {
      // Tabela que mudou de forma não derruba a exportação inteira.
      saida[k] = await pool
        .query(sql)
        .then((x) => x.rows)
        .catch((erro: Error) => ({ erro: erro.message.slice(0, 200) }));
    }
    log.info({ conta: conta(), usuario: req.usuario?.id }, 'lgpd: dados da unidade exportados');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dados-unidade-${conta()}.json"`);
    res.send(JSON.stringify(saida, null, 2));
  });

  r.get('/supressoes', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.empresa_id AS "empresaId", e.nome, e.cnpj, s.motivo, s.pedido_por AS "pedidoPor", s.criado_em AS "criadoEm"
         FROM cadastro.supressoes s JOIN descoberta.empresas e ON e.id = s.empresa_id
        WHERE s.organizacao_id = (SELECT organizacao_id FROM cadastro.contas WHERE id = ${contaSql()})
        ORDER BY s.criado_em DESC LIMIT 500`,
    );
    res.json(rows);
  });

  /** Titular pediu para ser esquecido: apaga o que a organização guardou dele e trava a volta. */
  r.post('/esquecer', async (req, res) => {
    const d = corpo(req, esquecerTitular);
    const C = contaSql();
    const autor = req.usuario!.nome;
    await comTransacao(pool, async (tx) => {
      const { rows } = await tx.query<{ org: number }>(
        `SELECT c.organizacao_id AS org FROM cadastro.contas c WHERE c.id = ${C}
            AND EXISTS (SELECT 1 FROM descoberta.campanha_empresas ce WHERE ce.conta_id = c.id AND ce.empresa_id = $1)`,
        [d.empresaId],
      );
      if (!rows[0]) throw AppError.naoEncontrado('Empresa');
      const org = rows[0].org;
      // O que identifica o titular (CNPJ, telefones, e-mails), guardado só como hash para barrar a volta.
      const { rows: ids } = await tx.query<{ v: string }>(
        `SELECT cnpj AS v FROM descoberta.empresas WHERE id = $1 AND cnpj IS NOT NULL
         UNION SELECT valor FROM enriquecimento.contatos WHERE empresa_id = $1 AND canal IN ('telefone', 'whatsapp', 'email')
         UNION SELECT telefone FROM comercial.mensagens WHERE empresa_id = $1 AND telefone IS NOT NULL`,
        [d.empresaId],
      );
      const chaves = [...new Set(ids.map((x) => chaveTitular(x.v.replace(/^55(?=\d{10,11}$)/, ''))))];
      const unidades = `(SELECT id FROM cadastro.contas WHERE organizacao_id = ${Number(org)})`;
      // Em todas as unidades da organização: negociação (atividades, tarefas e contatos da negociação
      // vão junto), conversas, contatos e pessoas guardados só por ela, e os vínculos com as listas.
      await tx.query(`DELETE FROM comercial.mensagens WHERE conta_id IN ${unidades} AND empresa_id = $1`, [
        d.empresaId,
      ]);
      await tx.query(
        `DELETE FROM comercial.oportunidades WHERE conta_id IN ${unidades} AND empresa_id = $1`,
        [d.empresaId],
      );
      await tx.query(
        `DELETE FROM enriquecimento.contatos WHERE conta_id IN ${unidades} AND empresa_id = $1`,
        [d.empresaId],
      );
      await tx.query(`DELETE FROM enriquecimento.pessoas WHERE conta_id IN ${unidades} AND empresa_id = $1`, [
        d.empresaId,
      ]);
      await tx.query(
        `DELETE FROM descoberta.campanha_empresas WHERE conta_id IN ${unidades} AND empresa_id = $1`,
        [d.empresaId],
      );
      await tx.query(
        `INSERT INTO cadastro.supressoes (organizacao_id, empresa_id, motivo, pedido_por, chaves)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organizacao_id, empresa_id) DO UPDATE SET chaves = EXCLUDED.chaves`,
        [org, d.empresaId, d.motivo ?? null, d.pedidoPor ?? null, chaves],
      );
    });
    log.info({ conta: conta(), empresa: d.empresaId, autor }, 'lgpd: titular esquecido');
    res.json({ ok: true });
  });

  return r;
}
