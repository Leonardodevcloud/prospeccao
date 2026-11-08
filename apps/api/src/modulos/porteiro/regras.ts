import type { Executor, Pool } from '@prospeccao/db';
import {
  AppError,
  type CodigoPorteiro,
  type DetalhesPorteiro,
  MIN_PALAVRAS_REPETICAO,
  PORTEIRO_PADRAO,
  type PorteiroEntrada,
  palavrasDoTexto,
  SEMELHANCA_REPETICAO,
  semelhanca,
} from '@prospeccao/shared';
import { contaSql, usuarioAtual } from '../../contexto.js';
import { tetoDeAquecimento } from '../agente/chips.js';
import { HOJE_SP } from '../agente/repositorio.js';

/**
 * Porteiro do WhatsApp: antes de a equipe mandar uma mensagem pelo número da conta, confere o que
 * mais derruba número (sobretudo em API não oficial): o mesmo texto indo para muita gente em pouco
 * tempo, contatos novos demais no dia e em sequência rápida, e o número em pausa por sinal de risco.
 * Responder quem já conversa só passa pela conferência de texto repetido.
 */

export async function config(db: Executor): Promise<PorteiroEntrada> {
  const { rows } = await db.query<PorteiroEntrada>(
    `SELECT ativo, repetidas_contatos AS "repetidasContatos", repetidas_janela_min AS "repetidasJanelaMin",
            repetidas_acao AS "repetidasAcao", novos_dia AS "novosDia", novos_intervalo_seg AS "novosIntervaloSeg",
            pausar_risco AS "pausarRisco"
       FROM comercial.porteiro WHERE conta_id = ${contaSql()}`,
  );
  return rows[0] ?? PORTEIRO_PADRAO;
}

export async function salvarConfig(db: Executor, c: PorteiroEntrada): Promise<void> {
  await db.query(
    `INSERT INTO comercial.porteiro
       (conta_id, ativo, repetidas_contatos, repetidas_janela_min, repetidas_acao, novos_dia, novos_intervalo_seg, pausar_risco)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conta_id) DO UPDATE SET ativo = $1, repetidas_contatos = $2, repetidas_janela_min = $3,
       repetidas_acao = $4, novos_dia = $5, novos_intervalo_seg = $6, pausar_risco = $7, atualizado_em = now()`,
    [
      c.ativo,
      c.repetidasContatos,
      c.repetidasJanelaMin,
      c.repetidasAcao,
      c.novosDia,
      c.novosIntervaloSeg,
      c.pausarRisco,
    ],
  );
}

export async function registrar(
  db: Executor,
  e: { tipo: string; chipId: number | null; empresaId: number | null; detalhe: string },
): Promise<void> {
  await db
    .query(
      `INSERT INTO comercial.porteiro_eventos (conta_id, chip_id, usuario_id, empresa_id, tipo, detalhe)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5)`,
      [e.chipId, usuarioAtual()?.id ?? null, e.empresaId, e.tipo, e.detalhe.slice(0, 500)],
    )
    .catch(() => undefined);
}

async function segurar(
  db: Executor,
  codigo: CodigoPorteiro,
  mensagem: string,
  detalhes: Omit<DetalhesPorteiro, 'porteiro'>,
  e: { chipId: number | null; empresaId: number },
): Promise<never> {
  await registrar(db, {
    tipo: codigo.replace('porteiro_', ''),
    chipId: e.chipId,
    empresaId: e.empresaId,
    detalhe: mensagem,
  });
  throw new AppError(409, codigo, mensagem, { detalhes: { porteiro: true, ...detalhes } });
}

/** Contatos novos do número: os leads cuja primeira mensagem (de qualquer lado) saiu por ele. */
async function novosDoChip(db: Executor, chipId: number): Promise<{ hoje: number; ultima: Date | null }> {
  const C = contaSql();
  const { rows } = await db.query<{ hoje: number; ultima: Date | null }>(
    `WITH primeiras AS (
       SELECT m.empresa_id, min(coalesce(m.enviado_em, m.criado_em)) AS em
         FROM comercial.mensagens m
        WHERE m.conta_id = ${C} AND m.chip_id = $1 AND m.direcao = 'enviada' AND m.status = 'enviada'
          AND coalesce(m.enviado_em, m.criado_em) > now() - interval '2 days'
        GROUP BY m.empresa_id)
     SELECT count(*) FILTER (WHERE p.em >= ${HOJE_SP})::int AS hoje, max(p.em) AS ultima
       FROM primeiras p
      WHERE NOT EXISTS (SELECT 1 FROM comercial.mensagens a
                         WHERE a.conta_id = ${C} AND a.empresa_id = p.empresa_id
                           AND a.status IN ('enviada', 'recebida') AND coalesce(a.enviado_em, a.criado_em) < p.em)`,
    [chipId],
  );
  return rows[0] ?? { hoje: 0, ultima: null };
}

/** Limite de contatos novos hoje deste número (o do porteiro, ou o do aquecimento se for menor). */
async function limiteDoChip(
  db: Executor,
  chipId: number,
  cfg: PorteiroEntrada,
): Promise<{ nome: string; limite: number; friosAte: Date | null; friosMotivo: string | null } | null> {
  const { rows } = await db.query<{
    nome: string;
    aquecer: boolean;
    dias: number;
    frios_ate: Date | null;
    frios_motivo: string | null;
  }>(
    `SELECT nome, aquecer, extract(day FROM now() - ativado_em)::int AS dias,
            CASE WHEN frios_ate > now() THEN frios_ate END AS frios_ate, frios_motivo
       FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [chipId],
  );
  const c = rows[0];
  if (!c) return null;
  const teto = c.aquecer ? tetoDeAquecimento(c.dias) : null;
  return {
    nome: c.nome,
    limite: teto != null ? Math.min(cfg.novosDia, teto) : cfg.novosDia,
    friosAte: c.frios_ate,
    friosMotivo: c.frios_motivo,
  };
}

/** Meia-noite de amanhã em Brasília (quando o limite do dia volta). */
async function amanha(db: Executor): Promise<string> {
  const { rows } = await db.query<{ em: Date }>(`SELECT ${HOJE_SP} + interval '1 day' AS em`);
  return new Date(rows[0]!.em).toISOString();
}

/**
 * Confere antes de mandar. Lança 409 com o código do porteiro (a tela mostra o que fazer); passa
 * sem fazer nada com o porteiro desligado.
 */
export async function conferirEnvio(
  db: Executor,
  p: { empresaId: number; chipId: number | null; texto: string | null; mesmoAssim?: boolean },
): Promise<void> {
  const cfg = await config(db);
  if (!cfg.ativo) return;
  const C = contaSql();
  const alvo = { chipId: p.chipId, empresaId: p.empresaId };

  // 1. Contato novo (nunca houve mensagem com este lead): pausa, limite do dia e espera.
  const { rows: h } = await db.query<{ conversou: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM comercial.mensagens WHERE conta_id = ${C} AND empresa_id = $1
                       AND status IN ('enviada', 'recebida')) AS conversou`,
    [p.empresaId],
  );
  if (!h[0]?.conversou && p.chipId) {
    const chip = await limiteDoChip(db, p.chipId, cfg);
    if (chip) {
      if (chip.friosAte)
        await segurar(
          db,
          'porteiro_pausado',
          `O número “${chip.nome}” está sem abordar contatos novos até ${hora(chip.friosAte)} (${chip.friosMotivo ?? 'sinal de risco'}). Responder quem já conversa continua normal.`,
          { liberaEm: chip.friosAte.toISOString() },
          alvo,
        );
      const uso = await novosDoChip(db, p.chipId);
      if (uso.hoje >= chip.limite)
        await segurar(
          db,
          'porteiro_limite',
          `O número “${chip.nome}” já abordou ${chip.limite} contatos novos hoje, o limite para não arriscar o número. Amanhã libera; responder quem já conversa continua normal.`,
          { limite: chip.limite, liberaEm: await amanha(db) },
          alvo,
        );
      if (uso.ultima && cfg.novosIntervaloSeg > 0) {
        const falta = Math.ceil(
          (new Date(uso.ultima).getTime() + cfg.novosIntervaloSeg * 1000 - Date.now()) / 1000,
        );
        if (falta > 0)
          await segurar(
            db,
            'porteiro_espera',
            `Espere ${falta} s para abordar outro contato novo por este número (mensagens em sequência rápida para quem nunca conversou parecem disparo).`,
            { segundos: falta, liberaEm: new Date(Date.now() + falta * 1000).toISOString() },
            alvo,
          );
      }
    }
  }

  // 2. O mesmo texto para muitos contatos dentro da janela.
  if (!p.texto) return;
  const palavras = palavrasDoTexto(p.texto);
  if (new Set(palavras).size < MIN_PALAVRAS_REPETICAO) return;
  const { rows: antes } = await db.query<{ empresa_id: string; texto: string; em: Date }>(
    `SELECT empresa_id, texto, coalesce(enviado_em, criado_em) AS em
       FROM comercial.mensagens
      WHERE conta_id = ${C} AND direcao = 'enviada' AND status = 'enviada' AND empresa_id <> $1
        AND ($2::int IS NULL OR chip_id = $2 OR chip_id IS NULL)
        AND coalesce(enviado_em, criado_em) > now() - make_interval(mins => $3)
      ORDER BY id DESC LIMIT 1500`,
    [p.empresaId, p.chipId, cfg.repetidasJanelaMin],
  );
  // Por lead, a última vez que recebeu um texto parecido (é quando ele sai da janela).
  const parecidas = new Map<string, number>();
  for (const m of antes)
    if (semelhanca(palavras, palavrasDoTexto(m.texto)) >= SEMELHANCA_REPETICAO)
      parecidas.set(m.empresa_id, Math.max(parecidas.get(m.empresa_id) ?? 0, new Date(m.em).getTime()));
  const n = parecidas.size;
  if (n + 1 < cfg.repetidasContatos) return;
  if (cfg.repetidasAcao === 'avisar' && p.mesmoAssim) {
    await registrar(db, {
      tipo: 'mesmo_assim',
      ...alvo,
      detalhe: `Mandou mesmo assim o texto que já tinha ido para ${n} contatos: “${p.texto.slice(0, 200)}”`,
    });
    return;
  }
  // Libera quando sair da janela gente bastante para este envio ficar abaixo do limite.
  const tempos = [...parecidas.values()].sort((a, b) => a - b);
  const sai = tempos[n - cfg.repetidasContatos + 1] ?? tempos[0]!;
  await segurar(
    db,
    'porteiro_repetida',
    `Esta mensagem já foi, igual ou quase igual, para ${n} ${n === 1 ? 'contato' : 'contatos'} ${janela(cfg.repetidasJanelaMin)}. O mesmo texto para muita gente é o que mais derruba número no WhatsApp: varie as palavras (a IA ajuda) ou espere.`,
    {
      contatos: n,
      janelaMin: cfg.repetidasJanelaMin,
      podeForcar: cfg.repetidasAcao === 'avisar',
      liberaEm: new Date(sai + cfg.repetidasJanelaMin * 60_000).toISOString(),
    },
    alvo,
  );
}

const janela = (min: number) =>
  min % 60 === 0
    ? min === 60
      ? 'na última hora'
      : `nas últimas ${min / 60} horas`
    : `nos últimos ${min} minutos`;

const hora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

/** O que a tela do porteiro mostra: a configuração, cada número hoje e o que foi segurado. */
export async function painel(pool: Pool) {
  const cfg = await config(pool);
  const C = contaSql();
  const { rows: chips } = await pool.query<{ id: number; nome: string }>(
    `SELECT id, nome FROM comercial.chips WHERE conta_id = ${C} AND ativo ORDER BY id`,
  );
  const numeros = [];
  for (const c of chips) {
    const l = await limiteDoChip(pool, c.id, cfg);
    const uso = await novosDoChip(pool, c.id);
    numeros.push({
      id: c.id,
      nome: c.nome,
      novosHoje: uso.hoje,
      limiteHoje: l?.limite ?? cfg.novosDia,
      friosAte: l?.friosAte ? l.friosAte.toISOString() : null,
      friosMotivo: l?.friosAte ? l.friosMotivo : null,
    });
  }
  const { rows: eventos } = await pool.query(
    `SELECT e.id::int, e.tipo, e.detalhe, e.criado_em AS "criadoEm", e.empresa_id::int AS "empresaId",
            coalesce(emp.maps_nome, emp.nome) AS lead, u.nome AS usuario, ch.nome AS numero
       FROM comercial.porteiro_eventos e
       LEFT JOIN descoberta.empresas emp ON emp.id = e.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = e.usuario_id
       LEFT JOIN comercial.chips ch ON ch.id = e.chip_id
      WHERE e.conta_id = ${C} AND e.criado_em > now() - interval '7 days'
      ORDER BY e.id DESC LIMIT 30`,
  );
  const { rows: hoje } = await pool.query<{ tipo: string; n: number }>(
    `SELECT tipo, count(*)::int AS n FROM comercial.porteiro_eventos
      WHERE conta_id = ${C} AND criado_em >= ${HOJE_SP} GROUP BY tipo`,
  );
  return { config: cfg, numeros, eventos, hoje: Object.fromEntries(hoje.map((h) => [h.tipo, h.n])) };
}
