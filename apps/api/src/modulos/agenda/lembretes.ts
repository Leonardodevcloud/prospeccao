import { montarMensagem } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import type { DepsApi, WhatsappConta } from '../../dependencias.js';
import { paraCadaConta } from '../../rotinas.js';
import { chipParaEquipe, emUso as chipsEmUso } from '../agente/chips.js';
import * as agente from '../agente/repositorio.js';
import { dadosDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
import { notificar } from '../notificacoes/repositorio.js';
import { obterConfig } from './repositorio.js';

/**
 * Lembretes da agenda (a cada minuto, uma instância por vez):
 *  - para o lead, pelo WhatsApp, X minutos antes da reunião (confirma o horário);
 *  - para o vendedor, na tela (e no WhatsApp dele, se configurado), antes da reunião ou na hora
 *    da tarefa.
 */

const LOCK = 7_301_027;
type Deps = Pick<DepsApi, 'pool' | 'log' | 'servicos'>;

const fmtHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtDia = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
});
const diaSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

/** "hoje às 15h", "amanhã às 9h30", "dia 21/10 às 10h". */
export function quando(inicio: Date, agora = new Date()): string {
  const h = fmtHora.format(inicio).replace(':00', 'h').replace(':', 'h');
  const d = diaSP.format(inicio);
  const hoje = diaSP.format(agora);
  const amanha = diaSP.format(new Date(agora.getTime() + 86_400_000));
  if (d === hoje) return `hoje às ${h}`;
  if (d === amanha) return `amanhã às ${h}`;
  return `dia ${fmtDia.format(inicio)} às ${h}`;
}

async function lembrarLeads(deps: Deps, whatsapp: WhatsappConta | null): Promise<number> {
  const cfg = await obterConfig(deps.pool);
  if (!cfg.lembreteLead || !whatsapp) return 0;
  const C = contaSql();
  const { rows } = await deps.pool.query<{ id: number; empresa_id: number; inicio: Date }>(
    `UPDATE comercial.tarefas t SET lembrete_lead_em = now()
      WHERE t.id IN (
        SELECT id FROM comercial.tarefas
         WHERE conta_id = ${C} AND concluida_em IS NULL AND lembrete_lead_em IS NULL AND empresa_id IS NOT NULL
           AND tipo IN ('reuniao', 'visita') AND inicio > now()
           AND inicio - make_interval(mins => $1) <= now()
           -- marcada já dentro da janela do lembrete (ex.: para daqui a 1 h): não manda
           AND criado_em < inicio - make_interval(mins => $1)
         LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING t.id::int, t.empresa_id::int, t.inicio`,
    [cfg.lembreteLeadMinutos],
  );
  let n = 0;
  for (const t of rows) {
    try {
      const l = await dadosDoLead(deps.pool, t.empresa_id);
      if (!l.telefone) continue;
      const texto = montarMensagem(
        cfg.textoLembreteLead.replace(/\{quando\}/g, quando(new Date(t.inicio))),
        l.variaveis,
      );
      // Pelo chip do lead (o número com que ele já conversa).
      const chip = await chipParaEquipe(deps.pool, t.empresa_id, await chipsEmUso(deps.pool, whatsapp));
      const r = await whatsapp.enviar(l.telefone, texto, chip?.instancia);
      await agente.criarMensagem(deps.pool, {
        chipId: chip?.id ?? null,
        empresaId: t.empresa_id,
        direcao: 'enviada',
        texto,
        telefone: l.telefone,
        status: 'enviada',
        origem: 'cadencia',
        idExterno: r.idExterno,
        nota: 'Lembrete da reunião',
      });
      await funil.registrarAtividade(
        deps.pool,
        t.empresa_id,
        { tipo: 'whatsapp', direcao: 'enviada', texto, contato: l.telefone },
        'lembrete',
      );
      n++;
    } catch (erro) {
      deps.log.warn({ err: erro, tarefa: t.id }, 'agenda: lembrete para o lead falhou');
    }
  }
  return n;
}

async function lembrarEquipe(deps: Deps, whatsapp: WhatsappConta | null): Promise<number> {
  const cfg = await obterConfig(deps.pool);
  const C = contaSql();
  const { rows } = await deps.pool.query<{
    id: number;
    usuario_id: number;
    tipo: string;
    titulo: string;
    inicio: Date;
    local: string | null;
    empresa_id: number | null;
    telefone: string | null;
  }>(
    `UPDATE comercial.tarefas t SET lembrete_usuario_em = now()
       FROM cadastro.usuarios u
      WHERE u.id = t.usuario_id AND u.ativo AND t.id IN (
        SELECT id FROM comercial.tarefas
         WHERE conta_id = ${C} AND concluida_em IS NULL AND lembrete_usuario_em IS NULL AND usuario_id IS NOT NULL
           AND inicio > now() - interval '1 hour'
           AND inicio - CASE WHEN tipo IN ('reuniao', 'visita') THEN make_interval(mins => $1)
                             ELSE interval '0' END <= now()
         LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING t.id::int, t.usuario_id, t.tipo, t.titulo, t.inicio, t.local, t.empresa_id::int, u.telefone`,
    [cfg.lembreteUsuarioMinutos],
  );
  for (const t of rows) {
    const inicio = new Date(t.inicio);
    const titulo = `${t.titulo}: ${quando(inicio)}`;
    await notificar(deps.pool, t.usuario_id, {
      tipo: t.tipo === 'reuniao' || t.tipo === 'visita' ? 'reuniao' : 'tarefa',
      titulo,
      texto: t.local,
      empresaId: t.empresa_id,
    });
    if (cfg.lembreteUsuarioWhatsapp && t.telefone && whatsapp)
      await whatsapp
        .enviar(t.telefone, `📅 ${titulo}${t.local ? `\n${t.local}` : ''}`)
        .catch((erro) =>
          deps.log.warn({ err: erro, tarefa: t.id }, 'agenda: aviso no WhatsApp do vendedor falhou'),
        );
  }
  return rows.length;
}

export async function rodarLembretes(deps: Deps): Promise<void> {
  const cliente = await deps.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      await paraCadaConta(deps.pool, deps.log, 'agenda', async (conta) => {
        const { whatsapp } = await deps.servicos(conta);
        await lembrarLeads(deps, whatsapp);
        await lembrarEquipe(deps, whatsapp);
      });
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    deps.log.error({ err: erro }, 'agenda: rodada de lembretes falhou');
  } finally {
    cliente.release();
  }
}

export function iniciarLembretes(deps: Deps): () => void {
  const t = setInterval(() => void rodarLembretes(deps), 60_000);
  t.unref();
  return () => clearInterval(t);
}
