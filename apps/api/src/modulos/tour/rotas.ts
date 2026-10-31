import { createHash } from 'node:crypto';
import { AppError, falaDaCena } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { gerarFala, lerConfigVoz } from '../assistente/voz.js';

/**
 * Tour do sistema (a volta guiada que o Argos narra). As cenas e as falas ficam no shared
 * (cenasDoTour); aqui ficam o "já vi" de cada pessoa e os áudios, gerados com a voz do Argos uma vez
 * e guardados no banco (todo mundo ouve o mesmo arquivo).
 */
export function rotasTour(deps: DepsApi): Router {
  const r = Router();
  const { pool, log } = deps;
  const fala = deps.assistente?.fala ?? null;

  r.get('/', async (_req, res) => {
    const cfg = await lerConfigVoz(pool);
    // Sem a voz do servidor, o navegador fala na mesma velocidade escolhida para o Argos.
    res.json({ vozServidor: !!fala, velocidade: cfg.velocidade });
  });

  r.post('/visto', async (req, res) => {
    await pool.query('UPDATE cadastro.usuarios SET tour_visto_em = now() WHERE id = $1', [req.usuario!.id]);
    res.json({ ok: true });
  });

  // O áudio de uma cena (só as falas do tour: o servidor não fala texto que venha de fora).
  r.get('/audio/:cena', async (req, res) => {
    const texto = falaDaCena(String(req.params.cena ?? ''), String(req.query.v ?? '-'));
    if (!texto) throw AppError.naoEncontrado('Essa cena do tour');
    if (!fala) throw new AppError(503, 'indisponivel', 'A voz do servidor não está ligada.');
    const cfg = await lerConfigVoz(pool);
    const chave = createHash('sha256').update(`${cfg.voz}|${cfg.velocidade}|${texto}`).digest('hex');
    const { rows } = await pool.query<{ audio: Buffer }>(
      'SELECT audio FROM cadastro.tour_audios WHERE chave = $1',
      [chave],
    );
    let audio = rows[0]?.audio ?? null;
    if (!audio) {
      try {
        audio = Buffer.from(await gerarFala(fala, texto, cfg));
      } catch (erro) {
        log.warn({ erro: (erro as Error).message }, 'tour: falha ao gerar a voz');
        throw new AppError(503, 'indisponivel', 'Não consegui gerar a voz agora.');
      }
      await pool.query(
        'INSERT INTO cadastro.tour_audios (chave, audio) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING',
        [chave, audio],
      );
    }
    res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400' });
    res.send(audio);
  });

  return r;
}
