import { cifrar, decifrar, type Executor, type Pool } from '@prospeccao/db';
import { AppError, ETAPAS_META, type Logger } from '@prospeccao/shared';
import { comConta, contaSql } from '../../contexto.js';
import { temRecurso } from '../../recursos.js';
import { ErroMeta } from './meta.js';
import { chaveDeCifra, meta } from './servico.js';

/**
 * Devolver as vendas para a Meta (API de Conversões, leads de CRM). Cada lead que veio de formulário
 * de anúncio tem o id do cadastro na Meta; quando ele anda no funil (respondeu, reunião, proposta,
 * cliente), a etapa vai para o conjunto de dados (pixel) do cliente. Assim a Meta aprende quem
 * compra, não só quem preenche. O token é o que o cliente gera no Gerenciador de Eventos.
 */

interface Config {
  ligado: boolean;
  dataset: string | null;
  token: string | null;
}

async function config(db: Executor): Promise<Config | null> {
  const { rows } = await db.query<{
    capi_ligado: boolean;
    capi_dataset: string | null;
    capi_token_cifrado: string | null;
  }>(
    `SELECT capi_ligado, capi_dataset, capi_token_cifrado FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`,
  );
  const l = rows[0];
  if (!l) return null;
  const chave = chaveDeCifra();
  let token: string | null = null;
  if (l.capi_token_cifrado && chave)
    try {
      token = decifrar(chave, l.capi_token_cifrado);
    } catch {
      token = null;
    }
  return { ligado: l.capi_ligado, dataset: l.capi_dataset, token };
}

/** O que a tela mostra (sem o token). */
export async function situacaoConversoes(db: Executor) {
  const { rows } = await db.query(
    `SELECT capi_ligado AS ligado, capi_dataset AS dataset, capi_token_cifrado IS NOT NULL AS "temToken",
            capi_erro AS erro, capi_erro_em AS "erroEm"
       FROM comercial.instagram_contas WHERE conta_id = ${contaSql()}`,
  );
  const { rows: porEtapa } = await db.query<{ etapa: string; enviados: number; pendentes: number }>(
    `SELECT etapa, count(*) FILTER (WHERE enviado_em IS NOT NULL)::int AS enviados,
            count(*) FILTER (WHERE enviado_em IS NULL)::int AS pendentes
       FROM comercial.meta_eventos WHERE conta_id = ${contaSql()} AND criado_em > now() - interval '30 days'
      GROUP BY etapa`,
  );
  const { rows: ultimos } = await db.query(
    `SELECT me.id::int, me.empresa_id::int AS "empresaId", e.nome, me.etapa, me.evento, me.enviado_em AS "enviadoEm", me.erro,
            me.tentativas
       FROM comercial.meta_eventos me LEFT JOIN descoberta.empresas e ON e.id = me.empresa_id
      WHERE me.conta_id = ${contaSql()}
      ORDER BY coalesce(me.enviado_em, me.criado_em) DESC, me.id DESC
      LIMIT 15`,
  );
  return {
    ...(rows[0] ?? { ligado: false, dataset: null, temToken: false, erro: null, erroEm: null }),
    etapas: ETAPAS_META.map((e) => {
      const x = porEtapa.find((p) => p.etapa === e.id);
      return { ...e, enviados: x?.enviados ?? 0, pendentes: x?.pendentes ?? 0 };
    }),
    ultimos,
  };
}

export async function salvarConversoes(
  db: Executor,
  d: { ligado: boolean; dataset?: string | null; token?: string | null },
): Promise<void> {
  const chave = chaveDeCifra();
  const atual = await config(db);
  const dataset = d.dataset ?? atual?.dataset ?? null;
  const novoToken = d.token?.trim() || null;
  if (novoToken && !chave)
    throw AppError.invalido('Configure CHAVE_CREDENCIAIS na api para guardar o token.');
  if (d.ligado && (!dataset || !(novoToken || atual?.token)))
    throw AppError.invalido('Informe o ID do conjunto de dados e o token para ligar.');
  await db.query(
    `INSERT INTO comercial.instagram_contas (conta_id, capi_ligado, capi_dataset, capi_token_cifrado)
     VALUES (${contaSql()}, $1, $2, $3)
     ON CONFLICT (conta_id) DO UPDATE SET capi_ligado = EXCLUDED.capi_ligado, capi_dataset = EXCLUDED.capi_dataset,
       capi_token_cifrado = coalesce(EXCLUDED.capi_token_cifrado, instagram_contas.capi_token_cifrado),
       capi_erro = NULL, capi_erro_em = NULL, atualizado_em = now()`,
    [d.ligado, dataset, novoToken && chave ? cifrar(chave, novoToken) : null],
  );
}

/**
 * Manda um evento de teste com o código da aba "Testar eventos" do Gerenciador de Eventos (aparece
 * lá na hora e não conta para os anúncios). Usa o cadastro de anúncio mais recente.
 */
export async function testarConversoes(db: Executor, codigo: string): Promise<{ recebidos: number }> {
  const m = meta();
  if (!m) throw AppError.invalido('A integração com a Meta ainda não foi liberada na plataforma.');
  const c = await config(db);
  if (!c?.dataset || !c.token)
    throw AppError.invalido('Salve o ID do conjunto de dados e o token antes de testar.');
  const { rows } = await db.query<{ leadgen_id: string }>(
    `SELECT leadgen_id FROM comercial.instagram_cadastros WHERE conta_id = ${contaSql()} ORDER BY criado_em DESC LIMIT 1`,
  );
  if (!rows[0])
    throw AppError.invalido(
      'O teste precisa de pelo menos um cadastro de formulário de anúncio recebido pelo CRM.',
    );
  try {
    const recebidos = await m.enviarEventos(
      c.dataset,
      c.token,
      [{ nome: 'Lead', em: Math.floor(Date.now() / 1000), leadId: rows[0].leadgen_id }],
      codigo,
    );
    return { recebidos };
  } catch (e) {
    throw AppError.invalido(`A Meta recusou: ${(e as Error).message}`);
  }
}

/** A ordem de cada etapa do funil para a Meta (perdido e descartado não avançam). */
const ORDEM_SQL = `CASE o.etapa WHEN 'respondeu' THEN 1 WHEN 'reuniao' THEN 2 WHEN 'proposta' THEN 3 WHEN 'ganho' THEN 4
                   WHEN 'perdido' THEN -1 WHEN 'descartado' THEN -1 ELSE 0 END`;

/** Cria as etapas que faltam e manda as pendentes (uma conta; o motor chama a cada minuto). */
export async function enviarConversoes(pool: Pool, log: Logger): Promise<number> {
  const c = await config(pool);
  const m = meta();
  if (!c?.ligado || !c.dataset || !c.token || !m) return 0;
  if (!(await temRecurso(pool, 'instagram'))) return 0;
  const etapas = ETAPAS_META.map((e, i) => `('${e.id}', '${e.evento.replace(/'/g, "''")}', ${i})`).join(', ');
  // Cada etapa alcançada vira um evento (uma vez por lead). As que o lead pulou entram juntas, um
  // segundo antes uma da outra, para a Meta receber na ordem.
  await pool.query(
    `INSERT INTO comercial.meta_eventos (conta_id, empresa_id, leadgen_id, etapa, evento, evento_em)
     SELECT ${contaSql()}, x.empresa_id, x.leadgen_id, et.id, et.evento,
            CASE WHEN et.ordem = 0 THEN greatest(x.cadastro_em, now() - interval '6 days')
                 ELSE now() - make_interval(secs => 5 - et.ordem) END
       FROM (SELECT DISTINCT ON (c.empresa_id) c.empresa_id, c.leadgen_id, c.criado_em AS cadastro_em, ${ORDEM_SQL} AS ordem
               FROM comercial.instagram_cadastros c
               JOIN comercial.oportunidades o ON o.conta_id = c.conta_id AND o.empresa_id = c.empresa_id
              WHERE c.conta_id = ${contaSql()} AND c.empresa_id IS NOT NULL AND c.criado_em > now() - interval '120 days'
              ORDER BY c.empresa_id, c.criado_em) x
       JOIN (VALUES ${etapas}) AS et (id, evento, ordem) ON et.ordem <= x.ordem
     ON CONFLICT (conta_id, empresa_id, etapa) DO NOTHING`,
  );
  const { rows: fila } = await pool.query<{
    id: number;
    evento: string;
    evento_em: Date;
    leadgen_id: string;
  }>(
    `SELECT id::int, evento, evento_em, leadgen_id FROM comercial.meta_eventos
      WHERE conta_id = ${contaSql()} AND enviado_em IS NULL AND tentativas < 8
        AND (tentativas = 0 OR criado_em < now() - make_interval(mins => tentativas * tentativas))
      ORDER BY evento_em, id LIMIT 500`,
  );
  if (!fila.length) return 0;
  // A Meta só aceita eventos dos últimos 7 dias.
  const limite = Date.now() - 6.5 * 86_400_000;
  try {
    await m.enviarEventos(
      c.dataset,
      c.token,
      fila.map((e) => ({
        nome: e.evento,
        em: Math.floor(Math.max(e.evento_em.getTime(), limite) / 1000),
        leadId: e.leadgen_id,
      })),
    );
    await pool.query(
      `UPDATE comercial.meta_eventos SET enviado_em = now(), erro = NULL WHERE id = ANY($1::bigint[])`,
      [fila.map((e) => e.id)],
    );
    await pool.query(
      `UPDATE comercial.instagram_contas SET capi_erro = NULL, capi_erro_em = NULL
        WHERE conta_id = ${contaSql()} AND capi_erro IS NOT NULL`,
    );
    return fila.length;
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await pool.query(
      `UPDATE comercial.meta_eventos SET tentativas = tentativas + 1, erro = $2 WHERE id = ANY($1::bigint[])`,
      [fila.map((x) => x.id), msg],
    );
    const tokenRuim = e instanceof ErroMeta && (e.tokenInvalido || e.semPermissao);
    await pool.query(
      `UPDATE comercial.instagram_contas SET capi_erro = $1, capi_erro_em = now() WHERE conta_id = ${contaSql()}`,
      [tokenRuim ? 'A Meta recusou o token: gere um novo no Gerenciador de Eventos e salve de novo.' : msg],
    );
    log.warn({ err: e }, 'meta: envio das conversões falhou');
    return 0;
  }
}

/** A cada minuto, nas contas com a devolução ligada. */
export function iniciarConversoes(deps: { pool: Pool; log: Logger }): () => void {
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const { rows } = await deps.pool.query<{ conta_id: number }>(
        `SELECT ic.conta_id FROM comercial.instagram_contas ic JOIN cadastro.contas c ON c.id = ic.conta_id
          WHERE ic.capi_ligado AND c.ativa`,
      );
      for (const { conta_id } of rows)
        await comConta(conta_id, () => enviarConversoes(deps.pool, deps.log)).catch((e) =>
          deps.log.warn({ err: e, conta: conta_id }, 'meta: conversões falharam nesta conta'),
        );
    } finally {
      rodando = false;
    }
  };
  const t = setInterval(() => void rodar(), 60_000);
  t.unref();
  return () => clearInterval(t);
}
