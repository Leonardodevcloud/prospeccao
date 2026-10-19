import { AppError, importacaoEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';

/**
 * Importações da base de CNPJ. A API só lê (view publicada) e pede uma
 * importação pela fila: quem cria o registro e escreve é o worker-cnpj.
 */
export function rotasImportacoes({ pool, filas, log }: DepsApi): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, mes, status, motivo, ufs, cnaes, etapa, linhas_lidas AS "linhasLidas",
              estabelecimentos, empresas, socios, erro, criado_em AS "criadoEm",
              iniciado_em AS "iniciadoEm", concluido_em AS "concluidoEm"
         FROM base_cnpj.importacoes ORDER BY criado_em DESC LIMIT 20`,
    );
    res.json(rows);
  });

  r.post('/cnpj', async (req, res) => {
    const { mes } = corpo(req, importacaoEntrada);
    const { rows } = await pool.query(`SELECT status FROM base_cnpj.v_ultima_importacao`);
    if (rows[0] && ['na_fila', 'rodando'].includes(rows[0].status)) {
      throw AppError.conflito('Já existe uma importação em andamento.');
    }
    const jobId = await filas.publicar('cnpj.importar', { mes, motivo: 'manual' });
    if (!jobId) throw AppError.conflito('Já existe uma importação na fila.');
    log.info({ mes: mes ?? 'mais recente' }, 'importação da base de CNPJ pedida');
    res.status(202).json({ mensagem: 'Importação na fila. Acompanhe o andamento nesta tela.' });
  });

  return r;
}
