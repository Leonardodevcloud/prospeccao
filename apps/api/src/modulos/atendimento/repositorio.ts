import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import {
  type CriteriosAvaliados,
  inicioDaSemana,
  intervaloDaSemana,
  type NotaAtendimento,
  oQueMaisPesou,
  type PainelAtendimento,
  type ResumoVendedor,
  resumirVendedor,
} from '@prospeccao/shared/atendimento';
import { contaSql } from '../../contexto.js';

/** As notas de atendimento (leitura e correção do gestor). Tudo dentro da conta da sessão. */

interface LinhaNota {
  id: string;
  tipo: 'conversa' | 'ligacao';
  empresa_id: string | null;
  empresa: string | null;
  ligacao_id: string | null;
  usuario_id: number | null;
  vendedor: string | null;
  inicio_em: Date;
  fim_em: Date;
  nota_ia: string;
  criterios: CriteriosAvaliados;
  primeira_resposta_min: number | null;
  media_resposta_min: number | null;
  gestor_nota: string | null;
  gestor_motivo: string | null;
  gestor: string | null;
  gestor_em: Date | null;
  avaliado_em: Date;
}

const SELECT_NOTA = `
  SELECT n.id, n.tipo, n.empresa_id, coalesce(e.maps_nome, e.nome) AS empresa, n.ligacao_id, n.usuario_id,
         u.nome AS vendedor, n.inicio_em, n.fim_em, n.nota_ia, n.criterios, n.primeira_resposta_min,
         n.media_resposta_min, n.gestor_nota, n.gestor_motivo, g.nome AS gestor, n.gestor_em, n.avaliado_em
    FROM comercial.atendimento_notas n
    LEFT JOIN descoberta.empresas e ON e.id = n.empresa_id
    LEFT JOIN cadastro.usuarios u ON u.id = n.usuario_id
    LEFT JOIN cadastro.usuarios g ON g.id = n.gestor_id`;

function nota(l: LinhaNota): NotaAtendimento {
  const ia = Number(l.nota_ia);
  const gestor = l.gestor_nota == null ? null : Number(l.gestor_nota);
  return {
    id: Number(l.id),
    tipo: l.tipo,
    empresaId: l.empresa_id == null ? null : Number(l.empresa_id),
    empresa: l.empresa,
    ligacaoId: l.ligacao_id == null ? null : Number(l.ligacao_id),
    usuarioId: l.usuario_id,
    vendedor: l.vendedor,
    inicioEm: l.inicio_em.toISOString(),
    fimEm: l.fim_em.toISOString(),
    nota: gestor ?? ia,
    notaIa: ia,
    criterios: l.criterios ?? {},
    primeiraRespostaMin: l.primeira_resposta_min,
    mediaRespostaMin: l.media_resposta_min,
    correcao:
      gestor == null
        ? null
        : {
            nota: gestor,
            motivo: l.gestor_motivo ?? '',
            por: l.gestor,
            em: (l.gestor_em ?? l.avaliado_em).toISOString(),
          },
    avaliadoEm: l.avaliado_em.toISOString(),
  };
}

/** As notas de um período (de quem, de que grupo). */
export async function notasDoPeriodo(
  db: Executor,
  de: Date,
  ate: Date,
  f: { usuarioId?: number | null; grupoId?: number | null } = {},
): Promise<NotaAtendimento[]> {
  const valores: unknown[] = [de, ate];
  const where = [`n.conta_id = ${contaSql()}`, 'n.fim_em >= $1', 'n.fim_em < $2', 'n.usuario_id IS NOT NULL'];
  if (f.usuarioId) {
    valores.push(f.usuarioId);
    where.push(`n.usuario_id = $${valores.length}`);
  }
  if (f.grupoId) {
    valores.push(f.grupoId);
    where.push(
      `n.usuario_id IN (SELECT gm.usuario_id FROM cadastro.grupo_membros gm
                          JOIN cadastro.grupos_atendimento ga ON ga.id = gm.grupo_id
                         WHERE ga.conta_id = ${contaSql()} AND ga.id = $${valores.length})`,
    );
  }
  const { rows } = await db.query<LinhaNota>(
    `${SELECT_NOTA} WHERE ${where.join(' AND ')} ORDER BY n.fim_em DESC LIMIT 5000`,
    valores,
  );
  return rows.map(nota);
}

/** As notas de um lead (o painel da conversa). Quem não é gestor vê só as próprias. */
export async function notasDoLead(
  db: Executor,
  empresaId: number,
  soDe: number | null,
): Promise<NotaAtendimento[]> {
  const valores: unknown[] = [empresaId];
  let filtro = '';
  if (soDe) {
    valores.push(soDe);
    filtro = ' AND n.usuario_id = $2';
  }
  const { rows } = await db.query<LinhaNota>(
    `${SELECT_NOTA} WHERE n.conta_id = ${contaSql()} AND n.empresa_id = $1${filtro} ORDER BY n.fim_em DESC LIMIT 20`,
    valores,
  );
  return rows.map(nota);
}

export async function umaNota(db: Executor, id: number): Promise<NotaAtendimento> {
  const { rows } = await db.query<LinhaNota>(
    `${SELECT_NOTA} WHERE n.conta_id = ${contaSql()} AND n.id = $1`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Nota');
  return nota(rows[0]);
}

/** O gestor corrige a nota (a da IA fica guardada). */
export async function corrigir(
  db: Executor,
  id: number,
  d: { nota: number; motivo: string },
  gestorId: number,
): Promise<NotaAtendimento> {
  const { rowCount } = await db.query(
    `UPDATE comercial.atendimento_notas
        SET gestor_nota = $2, gestor_motivo = $3, gestor_id = $4, gestor_em = now()
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, Math.round(d.nota * 10) / 10, d.motivo, gestorId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Nota');
  return umaNota(db, id);
}

/** Quem é a pessoa e o grupo (loja) dela. */
async function pessoas(db: Executor): Promise<Map<number, { nome: string; grupo: string | null }>> {
  const { rows } = await db.query<{ id: number; nome: string; grupo: string | null }>(
    `SELECT u.id, u.nome,
            (SELECT ga.nome FROM cadastro.grupo_membros gm JOIN cadastro.grupos_atendimento ga ON ga.id = gm.grupo_id
              WHERE gm.usuario_id = u.id AND ga.conta_id = u.conta_id ORDER BY ga.ordem, ga.id LIMIT 1) AS grupo
       FROM cadastro.usuarios u WHERE u.conta_id = ${contaSql()}`,
  );
  return new Map(rows.map((r) => [r.id, { nome: r.nome, grupo: r.grupo }]));
}

export async function grupos(db: Executor): Promise<{ id: number; nome: string }[]> {
  const { rows } = await db.query<{ id: number; nome: string }>(
    `SELECT id, nome FROM cadastro.grupos_atendimento WHERE conta_id = ${contaSql()} ORDER BY ordem, id`,
  );
  return rows;
}

const semanaAnterior = (segunda: string) =>
  inicioDaSemana(new Date(intervaloDaSemana(segunda).de.getTime() - 86_400_000));

/** O painel do gestor: a equipe na semana, o que mais pesou e cada vendedor. */
export async function painel(
  db: Executor,
  segunda: string,
  grupoId: number | null,
): Promise<PainelAtendimento> {
  const { de, ate } = intervaloDaSemana(segunda);
  const antes = intervaloDaSemana(semanaAnterior(segunda));
  const [notas, anteriores, quem, gs] = await Promise.all([
    notasDoPeriodo(db, de, ate, { grupoId }),
    notasDoPeriodo(db, antes.de, antes.ate, { grupoId }),
    pessoas(db),
    grupos(db),
  ]);
  const ids = [...new Set(notas.map((n) => n.usuarioId!))];
  const vendedores = ids
    .map((id) =>
      resumirVendedor(
        { usuarioId: id, nome: quem.get(id)?.nome ?? 'Sem nome', grupo: quem.get(id)?.grupo ?? null },
        notas.filter((n) => n.usuarioId === id),
        anteriores.filter((n) => n.usuarioId === id),
      ),
    )
    .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0));
  const equipe = resumirVendedor({ usuarioId: 0, nome: 'Equipe', grupo: null }, notas, anteriores);
  return {
    semana: segunda,
    equipe: {
      nota: equipe.nota,
      notaAnterior: equipe.notaAnterior,
      atendimentos: equipe.atendimentos,
      conversas: equipe.conversas,
      ligacoes: equipe.ligacoes,
      primeiraRespostaMin: equipe.primeiraRespostaMin,
      proximoPassoPct: equipe.proximoPassoPct,
    },
    pesou: oQueMaisPesou(notas),
    vendedores,
    grupos: gs,
  };
}

/** O resumo de uma pessoa na semana, com a nota das 4 semanas até ela. */
export async function resumo(
  db: Executor,
  usuarioId: number,
  segunda: string,
): Promise<{ semana: string; resumo: ResumoVendedor; semanas: { semana: string; nota: number | null }[] }> {
  const quem = (await pessoas(db)).get(usuarioId);
  if (!quem) throw AppError.naoEncontrado('Pessoa');
  const { de, ate } = intervaloDaSemana(segunda);
  const quatro = intervaloDaSemana(semanaAnterior(semanaAnterior(semanaAnterior(segunda))));
  const todas = await notasDoPeriodo(db, quatro.de, ate, { usuarioId });
  const daSemana = todas.filter((n) => new Date(n.fimEm) >= de);
  const antes = intervaloDaSemana(semanaAnterior(segunda));
  const anteriores = todas.filter((n) => new Date(n.fimEm) >= antes.de && new Date(n.fimEm) < antes.ate);
  const semanas: { semana: string; nota: number | null }[] = [];
  for (let s = inicioDaSemana(quatro.de), i = 0; i < 4; i++) {
    const r = intervaloDaSemana(s);
    const ns = todas.filter((n) => new Date(n.fimEm) >= r.de && new Date(n.fimEm) < r.ate);
    semanas.push({
      semana: s,
      nota: ns.length ? Math.round((ns.reduce((t, n) => t + n.nota, 0) / ns.length) * 10) / 10 : null,
    });
    s = inicioDaSemana(r.ate);
  }
  return {
    semana: segunda,
    resumo: resumirVendedor({ usuarioId, nome: quem.nome, grupo: quem.grupo }, daSemana, anteriores),
    semanas,
  };
}
