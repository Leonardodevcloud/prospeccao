import {
  AppError,
  melhorarEntrada,
  porteiroEntrada,
  previaPorteiroEntrada,
  versoesEntrada,
} from '@prospeccao/shared';
import { Router } from 'express';
import { exigirVisivel } from '../../base.js';
import { conta, contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { chipParaEquipe, emUso as chipsEmUso } from '../agente/chips.js';
import * as alertas from '../alertas/repositorio.js';
import * as regras from './regras.js';

/** Porteiro do WhatsApp: todos veem como está o número; o administrador configura e libera. */
export function rotasPorteiro(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();

  r.get('/', async (_req, res) => {
    res.json(await regras.painel(pool));
  });

  r.put('/', exigirAdmin, async (req, res) => {
    await regras.salvarConfig(pool, corpo(req, porteiroEntrada));
    res.json(await regras.painel(pool));
  });

  /** O aviso enquanto escreve: o que acontece se mandar este texto agora para este contato. */
  r.post('/previa', async (req, res) => {
    const d = corpo(req, previaPorteiroEntrada);
    await exigirVisivel(pool, d.empresaId);
    const { whatsapp } = await deps.servicos(conta());
    const chip = whatsapp
      ? await chipParaEquipe(pool, d.empresaId, await chipsEmUso(pool, whatsapp)).catch(() => null)
      : null;
    res.json(await regras.previa(pool, { empresaId: d.empresaId, chipId: chip?.id ?? null, texto: d.texto }));
  });

  /** Versões de uma mensagem pronta, escritas pela IA (todos os planos, com a IA ligada). */
  r.post('/versoes', async (req, res) => {
    const d = corpo(req, versoesEntrada);
    const ia = (await deps.servicos(conta())).porteiro;
    if (!ia?.versoes) throw AppError.invalido('A IA não está ligada nesta conta: escreva as versões à mão.');
    const versoes = await ia.versoes({ texto: d.texto, evitar: d.evitar, quantas: d.quantas });
    if (!versoes.length)
      throw AppError.invalido('A IA não conseguiu versões boas agora. Tente de novo ou escreva à mão.');
    res.json({ versoes });
  });

  /** "Melhorar com IA" na caixa de escrever: corrigir, mais claro, mais cordial, mais curto. */
  r.post('/melhorar', async (req, res) => {
    const d = corpo(req, melhorarEntrada);
    const ia = (await deps.servicos(conta())).porteiro;
    if (!ia?.melhorar) throw AppError.invalido('A IA não está ligada nesta conta.');
    const texto = await ia.melhorar(d.texto, d.modo);
    if (!texto)
      throw AppError.invalido('A IA não conseguiu melhorar sem mudar números ou links. Tente de novo.');
    res.json({ texto });
  });

  /** Tira a pausa dos contatos novos antes da hora (os sinais contam de novo a partir de agora). */
  r.post('/numeros/:id/liberar', exigirAdmin, async (req, res) => {
    const id = idDaRota(req);
    const { rowCount } = await pool.query(
      `UPDATE comercial.chips SET frios_ate = now() WHERE id = $1 AND conta_id = ${contaSql()} AND frios_ate > now()`,
      [id],
    );
    if (rowCount) {
      await alertas.fechar(pool, conta(), `porteiro:${id}`);
      await regras.registrar(pool, {
        tipo: 'risco',
        chipId: id,
        empresaId: null,
        detalhe: `Liberado à mão por ${req.usuario?.nome ?? 'administrador'}.`,
      });
    }
    res.json(await regras.painel(pool));
  });

  return r;
}
