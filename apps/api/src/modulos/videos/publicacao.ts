import type { Executor } from '@prospeccao/db';
import type { ClienteClaude } from '@prospeccao/integrations/carrosseis';
import { escreverTextoDoPost } from '@prospeccao/integrations/videos';
import { directPadrao, type Entrega } from '@prospeccao/shared/carrosseis-publicacao';
import { textoDoDossie } from '@prospeccao/shared/carrosseis-time';
import { contaSql } from '../../contexto.js';
import * as cerebro from '../carrosseis/cerebro.js';
import * as publicacao from '../carrosseis/publicacao.js';
import * as repo from './repositorio.js';

/**
 * O vídeo no Instagram (v131): a redatora escreve o texto do post do Reels e, quando a chamada do
 * fim pede para comentar, reescreve também o direct que ainda é o padrão. A regra, o post e o
 * reconhecimento são os mesmos dos carrosséis (carrosseis/publicacao.ts, com a peça "video").
 */

export const peca = (id: number): publicacao.Peca => ({ tipo: 'video', id });

/** A redatora escreve o texto do post (e salva); devolve se foi ela ou o padrão. */
export async function escreverTexto(
  db: Executor,
  claude: ClienteClaude | null,
  id: number,
): Promise<{ daRedatora: boolean }> {
  const v = await repo.paraPublicar(db, id);
  const empresa = await cerebro.nomeDaEmpresa(db);
  const dossie = (await cerebro.cerebro(db)).dossie;
  const promo = v.divulgarId ? await cerebro.divulgar(db, v.divulgarId).catch(() => null) : null;
  const promocao = promo && promo.tipo === 'promocao' ? promo : null;
  const chamada = v.palavra ? { tipo: 'comente' as const, palavra: v.palavra, texto: '' } : v.opcoes.chamada;
  const r = await escreverTextoDoPost(claude, {
    empresa,
    dossieTexto: textoDoDossie(dossie, empresa),
    titulo: v.titulo,
    assunto: v.opcoes.assunto ?? '',
    fala: v.fala,
    chamada,
    promocao,
  });
  await repo.salvarTextoPost(db, id, { texto: r.texto, hashtags: r.hashtags, daRedatora: r.daRedatora });
  // A regra ainda com o direct padrão: a redatora escreve o dela também (a pessoa confere na aba).
  if (claude && v.palavra) await reescreverDirectPadrao(db, claude, id, v.titulo, v.palavra);
  return { daRedatora: r.daRedatora };
}

async function reescreverDirectPadrao(
  db: Executor,
  claude: ClienteClaude,
  id: number,
  titulo: string,
  palavra: string,
): Promise<void> {
  const { rows } = await db.query<{
    id: number;
    mensagem: string;
    entrega: Entrega | null;
    divulgar_id: number | null;
    botao_link: string | null;
  }>(
    `SELECT id::int, mensagem, entrega, divulgar_id, botao_link FROM comercial.instagram_regras
      WHERE conta_id = ${contaSql()} AND video_id = $1 AND alvo = 'video'`,
    [id],
  );
  const regra = rows[0];
  if (!regra?.entrega) return;
  const promo = regra.divulgar_id ? await cerebro.divulgar(db, regra.divulgar_id).catch(() => null) : null;
  const padrao = directPadrao(regra.entrega, titulo, promo && promo.tipo === 'promocao' ? promo : null);
  if (regra.mensagem.trim() !== padrao.trim()) return;
  const d = await publicacao
    .directDaPeca(db, claude, {
      peca: peca(id),
      palavra,
      entrega: regra.entrega,
      divulgarId: regra.divulgar_id,
      material: regra.botao_link ?? '',
    })
    .catch(() => null);
  if (!d?.daRedatora) return;
  await db.query(
    `UPDATE comercial.instagram_regras SET mensagem = $2, botao_texto = CASE WHEN entrega = 'conversa' THEN NULL ELSE coalesce(nullif($3, ''), botao_texto) END
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [regra.id, d.mensagem, d.botao],
  );
}
