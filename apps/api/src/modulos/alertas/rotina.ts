import { DIA_SP, type Pool, usoIaDoMes } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import type { DepsApi, ServicosConta } from '../../dependencias.js';
import { paraCadaConta } from '../../rotinas.js';
import * as chips from '../agente/chips.js';
import { limiteDoMes } from '../consumo/repositorio.js';
import { conferir, fecharOsOutros } from './repositorio.js';

/**
 * Confere a cada 5 minutos o que costuma quebrar sem ninguém ver e abre (ou fecha) os alertas:
 *  - e-mail: não está saindo, Resend sem chave com fila parada, avisos do Resend não chegam, teto do mês;
 *  - WhatsApp: chip desconectado, mensagens falhando, fila sem WhatsApp configurado, teto do mês;
 *  - IA: teto do mês atingido, falhando muito;
 *  - plataforma (master): worker sem sinal de vida, enriquecimento parado com fila.
 */

const LOCK = 7_301_031;
const INTERVALO_MS = 5 * 60_000;
type Deps = Pick<DepsApi, 'pool' | 'log' | 'servicos'>;

const curto = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').slice(0, 180);

async function conferirEmail(pool: Pool, contaId: number, s: ServicosConta) {
  const C = contaSql();
  const { rows } = await pool.query<{
    ligado: boolean;
    fila: number;
    enviados_1h: number;
    erros_1h: number;
    ultimo_erro: string | null;
    enviados_24h: number;
    webhook_em: string | null;
  }>(
    `SELECT coalesce((SELECT ligado FROM comercial.config_email WHERE conta_id = ${C}), false) AS ligado,
            (SELECT count(*) FROM comercial.envios_email en JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
              WHERE en.conta_id = ${C} AND en.status = 'na_fila' AND en.canal = 'email' AND ce.status = 'enviando')::int AS fila,
            (SELECT count(*) FROM comercial.envios_email WHERE conta_id = ${C} AND status = 'enviado'
                AND canal = 'email' AND enviado_em > now() - interval '1 hour')::int AS enviados_1h,
            (SELECT count(*) FROM comercial.envios_email WHERE conta_id = ${C} AND status = 'erro'
                AND criado_em > now() - interval '1 day' AND coalesce(enviado_em, criado_em) > now() - interval '1 hour')::int AS erros_1h,
            (SELECT erro FROM comercial.envios_email WHERE conta_id = ${C} AND status = 'erro'
              ORDER BY id DESC LIMIT 1) AS ultimo_erro,
            (SELECT count(*) FROM comercial.envios_email WHERE conta_id = ${C} AND status = 'enviado'
                AND canal = 'email' AND enviado_em > now() - interval '1 day')::int AS enviados_24h,
            (SELECT webhook_em FROM comercial.config_email WHERE conta_id = ${C}) AS webhook_em`,
  );
  const r = rows[0]!;
  await conferir(
    pool,
    contaId,
    'email_falhando',
    r.erros_1h >= 3 && r.enviados_1h === 0
      ? {
          titulo: 'Os e-mails não estão saindo',
          texto: `${r.erros_1h} falharam na última hora. Último erro: ${curto(r.ultimo_erro)}`,
          link: '/email?aba=enviados',
        }
      : null,
  );
  await conferir(
    pool,
    contaId,
    'email_sem_resend',
    r.ligado && r.fila > 0 && !s.email
      ? {
          titulo: 'Há e-mails na fila, mas o Resend da conta não está configurado',
          texto: `${r.fila} esperando. O administrador do sistema cadastra a chave e o remetente no painel master.`,
          link: '/email?aba=config',
        }
      : null,
  );
  const webhookMudo =
    s.email?.segredoWebhook &&
    r.enviados_24h >= 5 &&
    (!r.webhook_em || Date.now() - new Date(r.webhook_em).getTime() > 24 * 3600_000);
  await conferir(
    pool,
    contaId,
    'webhook_resend',
    webhookMudo
      ? {
          nivel: 'aviso',
          titulo: 'O Resend não está mandando os avisos (respostas, aberturas, devoluções)',
          texto:
            'Confira o webhook no Resend: o endereço é o desta conta e os eventos de e-mail estão marcados?',
          link: '/email?aba=config',
        }
      : null,
  );
  const teto = await limiteDoMes(pool, 'emails');
  await conferir(
    pool,
    contaId,
    'limite_emails',
    teto.esgotado && r.fila > 0
      ? {
          nivel: 'aviso',
          titulo: `Teto de e-mails do mês atingido (${teto.limite})`,
          texto: `${r.fila} e-mails esperando o mês virar. Para aumentar o limite, fale com a gente.`,
          link: '/email',
        }
      : null,
  );
}

async function conferirWhatsapp(pool: Pool, contaId: number, s: ServicosConta, log: Logger) {
  const C = contaSql();
  const { rows } = await pool.query<{
    fila: number;
    erros_1h: number;
    enviadas_1h: number;
    ultimo_erro: string | null;
  }>(
    `SELECT (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND status = 'aprovada')::int AS fila,
            (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND status = 'erro'
                AND criado_em > now() - interval '1 hour')::int AS erros_1h,
            (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND status = 'enviada'
                AND direcao = 'enviada' AND enviado_em > now() - interval '1 hour')::int AS enviadas_1h,
            (SELECT erro FROM comercial.mensagens WHERE conta_id = ${C} AND status = 'erro'
              ORDER BY id DESC LIMIT 1) AS ultimo_erro`,
  );
  const r = rows[0]!;
  await conferir(
    pool,
    contaId,
    'whatsapp_sem_config',
    r.fila > 0 && !s.whatsapp
      ? {
          titulo: 'Há mensagens de WhatsApp na fila, mas o WhatsApp da conta não está configurado',
          texto: `${r.fila} esperando. O administrador do sistema cadastra a Evolution no painel master.`,
          link: '/agente',
        }
      : null,
  );
  await conferir(
    pool,
    contaId,
    'whatsapp_falhando',
    r.erros_1h >= 3 && r.enviadas_1h === 0
      ? {
          titulo: 'As mensagens de WhatsApp não estão saindo',
          texto: `${r.erros_1h} falharam na última hora. Último erro: ${curto(r.ultimo_erro)}`,
          link: '/agente',
        }
      : null,
  );
  const teto = await limiteDoMes(pool, 'whatsapp');
  await conferir(
    pool,
    contaId,
    'limite_whatsapp',
    teto.esgotado && r.fila > 0
      ? {
          nivel: 'aviso',
          titulo: `Teto de mensagens automáticas de WhatsApp do mês atingido (${teto.limite})`,
          texto: 'As mensagens esperam o mês virar. Para aumentar o limite, fale com a gente.',
          link: '/agente',
        }
      : null,
  );

  // Cada número: está conectado? (lê na Z-API e guarda o estado para a tela)
  const whatsapp = s.whatsapp;
  if (!whatsapp?.estado) {
    await fecharOsOutros(pool, contaId, 'chip:', []);
    return;
  }
  const vistos: string[] = [];
  for (const chip of await chips.emUso(pool, whatsapp, true)) {
    let estado: string;
    try {
      estado = await whatsapp.estado(chip.instancia);
    } catch (erro) {
      estado = erro instanceof Error ? erro.message : String(erro);
      log.warn({ err: erro, chip: chip.instancia }, 'alertas: não consegui ler o estado do chip');
    }
    if (chip.id) await chips.guardarEstado(pool, chip.id, estado);
    const chave = `chip:${chip.instancia.toLowerCase()}`;
    vistos.push(chave);
    await conferir(
      pool,
      contaId,
      chave,
      estado.startsWith('ok')
        ? null
        : {
            titulo: `O chip “${chip.nome}” está desconectado`,
            texto:
              'Abra Agente → Números de WhatsApp e leia o QR Code de novo para voltar a enviar e receber.',
            link: '/agente',
          },
    );
  }
  await fecharOsOutros(pool, contaId, 'chip:', vistos);
}

async function conferirIa(pool: Pool, contaId: number) {
  const { rows } = await pool.query<{ chamadas: number; erros: number; bloqueadas: number }>(
    `SELECT coalesce(sum(chamadas), 0)::int AS chamadas, coalesce(sum(erros), 0)::int AS erros,
            coalesce(sum(bloqueadas), 0)::int AS bloqueadas
       FROM cadastro.consumo_ia WHERE conta_id = $1 AND dia = ${DIA_SP}`,
    [contaId],
  );
  const r = rows[0]!;
  const { limite, usado } = await usoIaDoMes(pool, contaId);
  await conferir(
    pool,
    contaId,
    'limite_ia',
    limite != null && usado >= limite
      ? {
          nivel: 'aviso',
          titulo: `A IA chegou ao teto do mês (${limite} chamadas)`,
          texto:
            'Sem IA, as respostas de e-mail são lidas por regra, a abertura do e-mail sai vazia e o agente passa os leads para a equipe.',
          link: null,
        }
      : null,
  );
  await conferir(
    pool,
    contaId,
    'ia_falhando',
    r.erros >= 5 && r.erros > r.chamadas / 2
      ? {
          titulo: 'A IA está falhando',
          texto: `${r.erros} de ${r.chamadas} chamadas falharam hoje. Confira a chave e o saldo do provedor.`,
          link: null,
        }
      : null,
  );
}

/** Problemas da plataforma: só o master vê. */
async function conferirPlataforma(pool: Pool) {
  const { rows } = await pool.query<{ nome: string; visto_em: string; parado: boolean }>(
    `SELECT nome, visto_em, visto_em < now() - interval '10 minutes' AS parado FROM cadastro.servicos_vivos`,
  );
  for (const s of rows)
    await conferir(
      pool,
      null,
      `servico:${s.nome}`,
      s.parado
        ? {
            titulo: `O serviço ${s.nome} parou de dar sinal`,
            texto: `Último sinal ${new Date(s.visto_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Confira o deploy e os logs no Railway.`,
            link: '/atividade',
          }
        : null,
    );
  const { rows: enriq } = await pool
    .query<{ fila: number; feitos: number; pausado: boolean | null }>(
      `SELECT (SELECT count(*) FROM fila.job WHERE name = 'enriquecimento.solicitar'
               AND state IN ('created', 'retry') AND created_on < now() - interval '1 hour')::int AS fila,
            (SELECT count(*) FROM enriquecimento.leads WHERE concluido_em > now() - interval '1 hour')::int AS feitos,
            (SELECT pausado FROM enriquecimento.servico WHERE id = 1) AS pausado`,
    )
    .catch(() => ({ rows: [] as { fila: number; feitos: number; pausado: boolean | null }[] }));
  const e = enriq[0];
  await conferir(
    pool,
    null,
    'enriquecimento_parado',
    e && e.fila > 0 && e.feitos === 0 && !e.pausado
      ? {
          titulo: 'O enriquecimento parou com leads na fila',
          texto: `${e.fila} leads esperando há mais de uma hora e nenhum terminou. Confira o worker-enriquecimento.`,
          link: '/atividade',
        }
      : null,
  );
}

export async function verificarSaude(deps: Deps): Promise<void> {
  const cliente = await deps.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      await paraCadaConta(deps.pool, deps.log, 'alertas', async (contaId) => {
        const s = await deps.servicos(contaId);
        await conferirEmail(deps.pool, contaId, s);
        await conferirWhatsapp(deps.pool, contaId, s, deps.log);
        await conferirIa(deps.pool, contaId);
      });
      await conferirPlataforma(deps.pool);
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    deps.log.error({ err: erro }, 'alertas: verificação falhou');
  } finally {
    cliente.release();
  }
}

/** Primeira verificação 1 minuto depois de subir (os workers já deram sinal), depois a cada 5. */
export function iniciarAlertas(deps: Deps): () => void {
  const primeiro = setTimeout(() => void verificarSaude(deps), 60_000);
  const t = setInterval(() => void verificarSaude(deps), INTERVALO_MS);
  primeiro.unref();
  t.unref();
  return () => {
    clearTimeout(primeiro);
    clearInterval(t);
  };
}
