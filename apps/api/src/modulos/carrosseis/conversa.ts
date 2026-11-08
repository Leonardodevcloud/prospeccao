import type { Executor, Pool } from '@prospeccao/db';
import { conversarComOTime } from '@prospeccao/integrations/carrosseis';
import { AppError, type Logger } from '@prospeccao/shared';
import {
  type ConversaEntrada,
  type EstadoCarrossel,
  instrucaoDaConversa,
  type MensagemConversa,
  textoDoDossie,
  textoDoPedido,
} from '@prospeccao/shared/carrosseis-time';
import { comConta, conta, contaSql, usuarioAtual } from '../../contexto.js';
import * as cerebro from './cerebro.js';
import * as repo from './repositorio.js';
import type { CarrosseisIa } from './time.js';

/**
 * A conversa com o time de IA dentro do editor. A pessoa pede (um slide, o carrossel inteiro ou a
 * legenda) e o time responde com a proposta: os slides e a legenda como ficariam. Nada muda no
 * carrossel aqui: a tela mostra a proposta e a pessoa aplica (a tela troca e salva) ou descarta.
 * O time responde em segundo plano (pode levar até um minuto); a tela pergunta a cada 2 segundos.
 */

/** Sem resposta em 5 minutos (a api reiniciou no meio): vira erro e a pessoa pede de novo. */
const MINUTOS_SEM_RESPOSTA = 5;

interface LinhaConversa {
  id: string;
  autor: 'pessoa' | 'time';
  texto: string;
  alcance: MensagemConversa['alcance'];
  slide_id: string | null;
  situacao: MensagemConversa['situacao'];
  proposta: MensagemConversa['proposta'];
  mudancas: MensagemConversa['mudancas'];
  avisos: string[];
  criado_em: Date;
}

const mensagem = (l: LinhaConversa): MensagemConversa => ({
  id: Number(l.id),
  autor: l.autor,
  texto: l.texto,
  alcance: l.alcance,
  slideId: l.slide_id,
  situacao: l.situacao,
  proposta: l.proposta,
  mudancas: l.mudancas ?? [],
  avisos: l.avisos ?? [],
  criadoEm: l.criado_em.toISOString(),
});

/** As últimas 40 mensagens do carrossel, na ordem. */
export async function historico(db: Executor, carrosselId: number): Promise<MensagemConversa[]> {
  await db.query(
    `UPDATE comercial.carrossel_conversa
        SET situacao = 'erro', texto = 'O time não conseguiu responder. Peça de novo.', respondido_em = now()
      WHERE conta_id = ${contaSql()} AND carrossel_id = $1 AND situacao = 'pensando'
        AND criado_em < now() - interval '${MINUTOS_SEM_RESPOSTA} minutes'`,
    [carrosselId],
  );
  const { rows } = await db.query<LinhaConversa>(
    `SELECT * FROM (
       SELECT * FROM comercial.carrossel_conversa
        WHERE conta_id = ${contaSql()} AND carrossel_id = $1 ORDER BY id DESC LIMIT 40
     ) x ORDER BY id`,
    [carrosselId],
  );
  return rows.map(mensagem);
}

/** As respostas que estão sendo escritas agora (os testes esperam por elas). */
const emAndamento = new Set<Promise<void>>();
export async function esperarRespostas(): Promise<void> {
  while (emAndamento.size) await Promise.all([...emAndamento]);
}

/** A pessoa pediu: grava o pedido e a resposta "pensando" e põe o time para trabalhar. */
export async function pedir(
  pool: Pool,
  ia: CarrosseisIa | null,
  log: Logger,
  carrosselId: number,
  d: ConversaEntrada,
): Promise<{ pessoa: MensagemConversa; time: MensagemConversa }> {
  if (!ia) throw new AppError(503, 'indisponivel', 'O time de IA ainda não foi ligado na plataforma.');
  const c = await repo.carrossel(pool, carrosselId);
  if (c.situacao === 'publicado' || c.situacao === 'agendado')
    throw new AppError(409, 'travado', 'Este carrossel não pode mais ser mudado.');
  const abertas = await pool.query<{ situacao: string }>(
    `SELECT situacao FROM comercial.carrossel_conversa
      WHERE conta_id = ${contaSql()} AND carrossel_id = $1
        AND (situacao = 'proposta'
             OR (situacao = 'pensando' AND criado_em > now() - interval '${MINUTOS_SEM_RESPOSTA} minutes'))
      LIMIT 1`,
    [carrosselId],
  );
  if (abertas.rows[0])
    throw new AppError(
      409,
      'ocupado',
      abertas.rows[0].situacao === 'pensando'
        ? 'O time ainda está respondendo o pedido anterior.'
        : 'Aplique ou descarte a proposta aberta antes de pedir outra coisa.',
    );
  const usuario = usuarioAtual()?.id ?? null;
  const ins = await pool.query<LinhaConversa>(
    `INSERT INTO comercial.carrossel_conversa (conta_id, carrossel_id, autor, texto, alcance, slide_id, situacao, usuario_id)
     VALUES (${contaSql()}, $1, 'pessoa', $2, $3, $4, NULL, $5),
            (${contaSql()}, $1, 'time', '', $3, $4, 'pensando', NULL)
     RETURNING *`,
    [carrosselId, textoDoPedido(d), d.alcance, d.alcance === 'slide' ? d.slideId : null, usuario],
  );
  const [pessoa, time] = ins.rows.sort((a, b) => Number(a.id) - Number(b.id)) as [
    LinhaConversa,
    LinhaConversa,
  ];
  const contaId = conta();
  const p = comConta(contaId, () => responder(pool, ia, contaId, Number(time.id), carrosselId, d))
    .catch(async (erro) => {
      log.warn({ err: erro, conta: contaId, carrossel: carrosselId }, 'carrosséis: a conversa falhou');
      const e = erro as AppError;
      await pool
        .query(
          `UPDATE comercial.carrossel_conversa SET situacao = 'erro', texto = $2, respondido_em = now() WHERE id = $1`,
          [
            time.id,
            /HTTP 4(01|03)/.test(e.message ?? '')
              ? 'A chave do time de IA foi recusada. Fale com a gente.'
              : 'O time não conseguiu responder agora. Peça de novo em instantes.',
          ],
        )
        .catch(() => undefined);
    })
    .finally(() => {
      emAndamento.delete(p);
    });
  emAndamento.add(p);
  return { pessoa: mensagem(pessoa), time: mensagem(time) };
}

const hojeSp = () =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(new Date());

async function responder(
  db: Executor,
  ia: CarrosseisIa,
  contaId: number,
  timeId: number,
  carrosselId: number,
  d: ConversaEntrada,
): Promise<void> {
  const c = await repo.carrossel(db, carrosselId);
  const rel = c.relatorio;
  const [cb, empresa, { identidade }, fotos, anteriores] = await Promise.all([
    cerebro.cerebro(db),
    cerebro.nomeDaEmpresa(db),
    repo.identidade(db),
    repo.fotos(db),
    historico(db, carrosselId),
  ]);
  const divulgar = rel?.divulgarId ? await cerebro.divulgar(db, rel.divulgarId).catch(() => null) : null;
  const pedido = {
    objetivo: rel?.objetivo ?? ('ensinar' as const),
    chamada: rel?.chamada ?? ('salvar' as const),
    palavra: rel?.palavra ?? '',
    assunto: rel?.assunto ?? c.titulo,
  };
  const atual: EstadoCarrossel = { slides: d.slides, legenda: d.legenda };
  const r = await conversarComOTime(ia.cliente(db, contaId), {
    empresa,
    dossieTexto: textoDoDossie(cb.dossie, empresa),
    fontes: await cerebro.fontesParaOsFatos(db, {
      dossie: cb.dossie,
      empresa,
      divulgar,
      assunto: pedido.assunto,
    }),
    identidade,
    estilo: d.estilo,
    divulgar,
    fotos: fotos.map((f) => ({ id: f.id, nome: f.nome })),
    hoje: hojeSp(),
    pedido,
    atual,
    alcance: d.alcance,
    slideId: d.alcance === 'slide' ? d.slideId : null,
    instrucao: instrucaoDaConversa(d),
    historico: anteriores
      .filter((m) => m.id < timeId - 1 && m.texto && m.situacao !== 'erro')
      .map((m) => ({ autor: m.autor, texto: m.texto })),
  });
  const depois = { ...r.depois, slides: await repo.conferirFotos(db, r.depois.slides) };
  await db.query(
    `UPDATE comercial.carrossel_conversa
        SET texto = $2, situacao = $3, proposta = $4, mudancas = $5, avisos = $6, respondido_em = now()
      WHERE id = $1 AND situacao = 'pensando'`,
    [
      timeId,
      r.resposta,
      r.mudancas.length ? 'proposta' : null,
      r.mudancas.length ? JSON.stringify({ antes: atual, depois }) : null,
      JSON.stringify(r.mudancas),
      JSON.stringify(r.avisos),
    ],
  );
}

/** Aplicar ou descartar a proposta; desfazer (depois de aplicar) a fecha e a tela volta o "antes". */
export async function decidir(
  db: Executor,
  carrosselId: number,
  id: number,
  acao: 'aplicar' | 'descartar' | 'desfazer',
): Promise<MensagemConversa> {
  const de = acao === 'desfazer' ? 'aplicada' : 'proposta';
  const para = acao === 'aplicar' ? 'aplicada' : acao === 'descartar' ? 'descartada' : 'desfeita';
  const { rows } = await db.query<LinhaConversa>(
    `UPDATE comercial.carrossel_conversa SET situacao = $4
      WHERE id = $1 AND conta_id = ${contaSql()} AND carrossel_id = $2 AND autor = 'time' AND situacao = $3
      RETURNING *`,
    [id, carrosselId, de, para],
  );
  if (!rows[0]) {
    const existe = await db.query(
      `SELECT 1 FROM comercial.carrossel_conversa WHERE id = $1 AND conta_id = ${contaSql()} AND carrossel_id = $2`,
      [id, carrosselId],
    );
    if (!existe.rows[0]) throw AppError.naoEncontrado('Mensagem');
    throw new AppError(409, 'decidida', 'Essa proposta já foi decidida. Atualize a tela.');
  }
  return mensagem(rows[0]);
}
