import type { Executor, Pool } from '@prospeccao/db';
import { IDENTIDADE_SIGA_ME } from '@prospeccao/integrations/telefonia';
import { AppError, formatarTelefone, type Logger, normalizarTelefone } from '@prospeccao/shared';
import { comConta, contaSql, usuarioAtual } from '../../contexto.js';
import * as agenda from '../agenda/repositorio.js';
import { leadPorTelefone } from '../agente/repositorio.js';
import { notificar } from '../notificacoes/repositorio.js';
import { config, type DepsTelefonia, encerrar, numeros, temModulo } from './servico.js';

/**
 * Ligações recebidas. O provedor manda a ligação para o LiveKit, que abre uma sala "lig-in-…" com
 * quem ligou (a pessoa ouve chamando até alguém entrar). O CRM reconhece o lead pelo número, toca
 * primeiro para o dono dele e, depois de alguns segundos, para o time (os navegadores conferem a
 * cada poucos segundos). Ninguém atendeu: siga-me para o celular do dono ou ligação perdida (aviso
 * e tarefa de retorno).
 */

/** O LiveKit avisou que alguém ligou (participante sip_… entrou na sala lig-in-…). */
export async function receber(
  pool: Pool,
  deps: DepsTelefonia,
  log: Logger,
  sala: string,
  identidade: string,
): Promise<void> {
  if (!deps.servico) return;
  const quem = await deps.servico.chamador(sala, identidade);
  const para = normalizarTelefone(quem?.para);
  const de = normalizarTelefone(quem?.de) ?? (quem?.de ?? '').replace(/\D/g, '').slice(-11);
  if (!para) {
    log.warn({ sala }, 'ligações: recebida sem o número chamado');
    return;
  }
  const { rows } = await pool.query<{ conta_id: number }>(
    `SELECT conta_id FROM comercial.telefonia_numeros WHERE numero = $1 AND ativo LIMIT 1`,
    [para],
  );
  const contaId = rows[0]?.conta_id;
  if (!contaId) {
    log.warn({ sala, para }, 'ligações: número chamado não é de nenhuma conta');
    await deps.servico.encerrar(sala).catch(() => undefined);
    return;
  }
  await comConta(contaId, async () => {
    const cfg = await config(pool);
    if (!cfg.receber || !(await temModulo(pool))) {
      await deps.servico?.encerrar(sala).catch(() => undefined);
      return;
    }
    const lead = de ? await leadPorTelefone(pool, de) : null;
    let dono: number | null = null;
    if (lead) {
      const { rows: o } = await pool.query<{ r: number | null }>(
        `SELECT o.responsavel_id AS r FROM comercial.oportunidades o
           JOIN cadastro.usuarios u ON u.id = o.responsavel_id AND u.ativo
          WHERE o.conta_id = ${contaSql()} AND o.empresa_id = $1`,
        [lead.empresaId],
      );
      dono = o[0]?.r ?? null;
    }
    await pool.query(
      `INSERT INTO comercial.ligacoes
         (conta_id, empresa_id, direcao, telefone, numero_empresa, sala, situacao, gravar, dono_id, time_desde)
       VALUES (${contaSql()}, $1, 'entrada', $2, $3, $4, 'tocando', $5, $6,
               now() + make_interval(secs => $7))
       ON CONFLICT (sala) DO NOTHING`,
      [
        lead?.empresaId ?? null,
        de || 'desconhecido',
        para,
        sala,
        !!deps.armazenamento && cfg.gravar,
        dono,
        dono ? cfg.toqueDono : 0,
      ],
    );
  });
}

/** Ligações tocando para mim agora (as do meu lead já; as outras, depois que passam para o time). */
export async function entrando(db: Executor) {
  const u = usuarioAtual();
  if (!u) return [];
  const { rows } = await db.query(
    `SELECT l.id::int, l.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS lead, l.telefone,
            l.numero_empresa AS "numeroEmpresa", l.iniciada_em AS "iniciadaEm", coalesce(l.dono_id = $1, false) AS meu,
            d.nome AS "donoNome", coalesce(et.nome, o.etapa) AS etapa, o.ultimo_contato_em AS "ultimoContatoEm",
            (SELECT t.inicio FROM comercial.tarefas t WHERE t.conta_id = l.conta_id AND t.empresa_id = l.empresa_id
                AND t.tipo = 'reuniao' AND t.inicio > now() AND t.concluida_em IS NULL ORDER BY t.inicio LIMIT 1) AS "proximaReuniao"
       FROM comercial.ligacoes l
       LEFT JOIN descoberta.empresas e ON e.id = l.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = l.conta_id AND o.empresa_id = l.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN cadastro.usuarios d ON d.id = l.dono_id
      WHERE l.conta_id = ${contaSql()} AND l.direcao = 'entrada' AND l.situacao = 'tocando'
        AND l.iniciada_em > now() - interval '3 minutes'
        AND (l.dono_id = $1 OR l.time_desde <= now())
      ORDER BY l.iniciada_em`,
    [u.id],
  );
  return rows;
}

/** Atender: a primeira pessoa que clica leva a ligação (as outras veem "atendida por outra pessoa"). */
export async function atender(db: Executor, deps: DepsTelefonia, id: number) {
  const u = usuarioAtual();
  if (!u) throw AppError.naoAutorizado();
  if (!deps.servico) throw AppError.invalido('A telefonia não está ligada.');
  const { rows } = await db.query<{
    sala: string;
    telefone: string;
    numero_empresa: string | null;
    empresa_id: number | null;
    gravar: boolean;
    lead: string | null;
  }>(
    `UPDATE comercial.ligacoes l SET usuario_id = $2, situacao = 'em_andamento', atendida_em = now()
      WHERE l.id = $1 AND l.conta_id = ${contaSql()} AND l.direcao = 'entrada' AND l.situacao = 'tocando'
      RETURNING l.sala, l.telefone, l.numero_empresa, l.empresa_id::int, l.gravar,
                (SELECT coalesce(e.maps_nome, e.nome) FROM descoberta.empresas e WHERE e.id = l.empresa_id) AS lead`,
    [id, u.id],
  );
  const l = rows[0];
  if (!l) throw AppError.conflito('Esta ligação já foi atendida ou a pessoa desligou.');
  const cfg = await config(db);
  const identidade = `u${u.id}`;
  return {
    id,
    sala: l.sala,
    url: deps.servico.urlCliente,
    token: await deps.servico.acesso({ sala: l.sala, identidade, nome: u.nome }),
    identidade,
    telefone: l.telefone,
    numeroEmpresa: l.numero_empresa ?? '',
    lead: l.lead,
    empresaId: l.empresa_id,
    gravar: l.gravar,
    aviso: l.gravar ? { texto: cfg.avisoGravacao, falado: !!deps.fala && cfg.avisoFalado } : null,
    direcao: 'entrada' as const,
  };
}

/** O dono não pode atender agora: toca para o time já. */
export async function passarParaTime(db: Executor, id: number): Promise<void> {
  await db.query(
    `UPDATE comercial.ligacoes SET time_desde = now()
      WHERE id = $1 AND conta_id = ${contaSql()} AND direcao = 'entrada' AND situacao = 'tocando'`,
    [id],
  );
}

/** Ninguém atendeu: desliga, avisa e cria a tarefa de retornar. */
export async function perdida(pool: Pool, deps: DepsTelefonia, id: number, motivo: string): Promise<void> {
  const { rows } = await pool.query<{
    sala: string;
    empresa_id: number | null;
    dono_id: number | null;
    telefone: string;
    lead: string | null;
  }>(
    `UPDATE comercial.ligacoes l
        SET situacao = 'encerrada', perdida = true, encerrada_em = now(), duracao_segundos = 0,
            motivo_fim = $2, processamento = 'sem_gravacao'
      WHERE l.id = $1 AND l.situacao IN ('tocando', 'siga_me') AND l.atendida_em IS NULL
      RETURNING l.sala, l.empresa_id::int, l.dono_id, l.telefone,
                (SELECT coalesce(e.maps_nome, e.nome) FROM descoberta.empresas e WHERE e.id = l.empresa_id) AS lead`,
    [id, motivo.slice(0, 120)],
  );
  const l = rows[0];
  if (!l) return;
  await deps.servico?.encerrar(l.sala).catch(() => undefined);
  const quem = l.lead ?? formatarTelefone(l.telefone);
  const avisar: number[] = l.dono_id
    ? [l.dono_id]
    : (
        await pool.query<{ id: number }>(
          `SELECT id FROM cadastro.usuarios WHERE conta_id = ${contaSql()} AND ativo LIMIT 30`,
        )
      ).rows.map((r) => r.id);
  for (const u of avisar)
    await notificar(pool, u, {
      tipo: 'sistema',
      titulo: `Ligação perdida · ${quem}`,
      texto: l.empresa_id ? 'Virou tarefa "Retornar" na sua agenda.' : 'Número que não é de nenhum lead.',
      empresaId: l.empresa_id,
      link: l.empresa_id ? `/funil?empresa=${l.empresa_id}` : '/ligacoes?ver=perdidas',
    }).catch(() => undefined);
  if (l.empresa_id)
    await agenda
      .criar(pool, {
        empresaId: l.empresa_id,
        usuarioId: l.dono_id ?? undefined,
        tipo: 'ligacao',
        titulo: `Retornar a ligação de ${quem}`,
        inicio: new Date().toISOString(),
      })
      .catch(() => undefined);
}

/**
 * A cada poucos segundos: recebidas que tocaram demais sem ninguém atender vão para o celular do
 * dono (siga-me) ou viram perdidas; o siga-me que atendeu conta a duração.
 */
export async function rodadaEntrada(pool: Pool, deps: DepsTelefonia, log: Logger): Promise<void> {
  const { rows } = await pool.query<{
    id: number;
    conta_id: number;
    sala: string;
    situacao: 'tocando' | 'siga_me';
    numero_empresa: string | null;
    dono_telefone: string | null;
    passou: boolean;
    atendida: boolean;
  }>(
    `SELECT l.id::int, l.conta_id, l.sala, l.situacao, l.numero_empresa, d.telefone AS dono_telefone,
            (l.iniciada_em < now() - make_interval(secs => coalesce(t.toque_entrada, 40))) AS passou,
            (l.atendida_em IS NOT NULL) AS atendida
       FROM comercial.ligacoes l
       LEFT JOIN comercial.telefonia_contas t ON t.conta_id = l.conta_id
       LEFT JOIN cadastro.usuarios d ON d.id = l.dono_id AND d.ativo
      WHERE l.direcao = 'entrada' AND l.situacao IN ('tocando', 'siga_me')
      ORDER BY l.iniciada_em LIMIT 50`,
  );
  for (const r of rows)
    await comConta(r.conta_id, async () => {
      if (r.situacao === 'tocando') {
        if (!r.passou) return;
        const cfg = await config(pool);
        const celular = normalizarTelefone(r.dono_telefone);
        if (cfg.sigaMe && celular && deps.servico) {
          try {
            const saida = r.numero_empresa ?? (await numeros(pool))[0]?.numero ?? null;
            await deps.servico.discar({
              sala: r.sala,
              numero: celular,
              de: saida,
              nome: 'Siga-me',
              toqueSegundos: 25,
              identidade: IDENTIDADE_SIGA_ME,
            });
            await pool.query(
              `UPDATE comercial.ligacoes SET situacao = 'siga_me', siga_me = $2, usuario_id = dono_id
                WHERE id = $1 AND situacao = 'tocando'`,
              [r.id, celular],
            );
            return;
          } catch (e) {
            log.warn({ err: e, ligacao: r.id }, 'ligações: siga-me não completou');
          }
        }
        await perdida(pool, deps, r.id, 'ninguém atendeu');
        return;
      }
      // Siga-me: o celular atendeu? Desligou?
      const e = await deps.servico?.estado(r.sala, IDENTIDADE_SIGA_ME).catch(() => 'erro' as const);
      if (e === 'atendida' && !r.atendida)
        await pool.query(`UPDATE comercial.ligacoes SET atendida_em = now() WHERE id = $1`, [r.id]);
      else if (e === null || e === 'encerrada') {
        if (r.atendida) await encerrar(pool, deps, r.id, 'siga-me desligou');
        else await perdida(pool, deps, r.id, 'ninguém atendeu (nem no celular)');
      }
    }).catch((erro) => log.warn({ err: erro, ligacao: r.id }, 'ligações: rodada das recebidas falhou'));
}
