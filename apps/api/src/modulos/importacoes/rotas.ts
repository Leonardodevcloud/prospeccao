import { jobsAbertos } from '@prospeccao/queue';
import { AppError, importacaoEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';

/**
 * Importações da base de CNPJ. A API só lê (view publicada) e pede uma
 * importação pela fila: quem cria o registro e escreve é o worker-cnpj.
 */
const HORA_SP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A fila só aceita uma importação por vez: explica qual já está lá e quando roda. */
async function motivoDaFilaOcupada(pool: DepsApi['pool']): Promise<string> {
  const [job] = await jobsAbertos(pool, 'cnpj.importar', 1).catch(() => []);
  if (job?.estado === 'nova_tentativa') {
    return `A importação anterior falhou e tenta de novo sozinha às ${HORA_SP.format(new Date(job.quando))} (tentativa ${job.falhas + 1} de ${job.limiteTentativas + 1}). Não precisa clicar de novo.`;
  }
  if (job?.estado === 'rodando') return 'Já há uma importação rodando. Acompanhe em Atividade.';
  return 'Já existe uma importação na fila; ela começa em instantes.';
}

export function rotasImportacoes({ pool, filas, log }: DepsApi): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, mes, status, motivo, ufs, cnaes, etapa, linhas_lidas AS "linhasLidas",
              cardinality(arquivos_concluidos) AS "arquivosProntos", estabelecimentos, empresas, socios, erro, criado_em AS "criadoEm",
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
    if (!jobId) throw AppError.conflito(await motivoDaFilaOcupada(pool));
    log.info({ mes: mes ?? 'mais recente' }, 'importação da base de CNPJ pedida');
    res.status(202).json({ mensagem: 'Importação na fila. Acompanhe o andamento nesta tela.' });
  });

  return r;
}
