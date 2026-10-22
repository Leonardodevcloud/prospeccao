import { comTransacao, type Executor, INICIO_MES_SP_TS, type Pool } from '@prospeccao/db';
import { type Plano, planoEfetivo } from '@prospeccao/shared';
import type { Coletor } from './coletor.js';

/** Leituras de outros domínios (só views) e escritas no schema enriquecimento. */

export interface EmpresaEnriquecer {
  id: number;
  nome: string;
  razao_social: string | null;
  cnpj: string | null;
  cnpj_basico: string | null;
  porte: string | null;
  data_abertura: string | null;
  cidade: string;
  uf: string;
  telefones_receita: string[];
  email_receita: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  place_id: string | null;
  maps_url: string | null;
  maps_categoria: string | null;
  maps_nota: number | null;
  maps_avaliacoes: number | null;
  maps_site: string | null;
  maps_telefone: string | null;
  maps_fechada: boolean | null;
  sinal_entrega: boolean | null;
}

export interface CampanhaEnriquecer {
  id: number;
  nome: string;
  status: string;
  nicho_nome: string;
  cargos_alvo: string[];
  conta_nome: string | null;
  oferta: string | null;
}

export interface Socio {
  nome: string;
  tipo: string;
  qualificacao: string;
  prioridade: number;
  data_entrada: string | null;
}

export async function obterEmpresa(
  db: Executor,
  empresaId: number,
  campanhaId: number,
): Promise<EmpresaEnriquecer | null> {
  const { rows } = await db.query<EmpresaEnriquecer>(
    `SELECT id, nome, razao_social, cnpj, cnpj_basico, porte, data_abertura, cidade, uf, telefones_receita,
            email_receita, logradouro, numero, bairro, cep, place_id, maps_url, maps_categoria, maps_nota::float8 AS maps_nota, maps_avaliacoes, maps_site,
            maps_telefone, maps_fechada, sinal_entrega
       FROM descoberta.v_empresas_campanha
      WHERE id = $1 AND campanha_id = $2`,
    [empresaId, campanhaId],
  );
  return rows[0] ?? null;
}

export async function obterCampanha(db: Executor, id: number): Promise<CampanhaEnriquecer | null> {
  const { rows } = await db.query<CampanhaEnriquecer>(
    `SELECT v.id, v.nome, v.status, v.nicho_nome, v.cargos_alvo, ct.nome AS conta_nome, ca.sobre_empresa AS oferta
       FROM cadastro.v_campanhas_enriquecimento v
       JOIN cadastro.campanhas c ON c.id = v.id
       JOIN cadastro.contas ct ON ct.id = c.conta_id
       LEFT JOIN comercial.config_agente ca ON ca.conta_id = c.conta_id
      WHERE v.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function obterSocios(db: Executor, cnpjBasico: string): Promise<Socio[]> {
  const { rows } = await db.query<Socio>(
    `SELECT nome, tipo, qualificacao, prioridade, data_entrada
       FROM base_cnpj.v_socios
      WHERE cnpj_basico = $1 AND tipo <> 'pj'
      ORDER BY prioridade, data_entrada NULLS LAST
      LIMIT 10`,
    [cnpjBasico],
  );
  return rows;
}

/** Enriquecida há menos de N dias? Evita gastar de novo com a mesma empresa. */
export async function enriquecidaRecentemente(
  db: Executor,
  empresaId: number,
  dias: number,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM enriquecimento.leads
      WHERE empresa_id = $1 AND status = 'concluido' AND concluido_em > now() - make_interval(days => $2)`,
    [empresaId, dias],
  );
  return rows.length > 0;
}

export async function iniciar(db: Executor, empresaId: number, campanhaId: number) {
  await db.query(
    `INSERT INTO enriquecimento.leads (empresa_id, campanha_id, status, iniciado_em, tentativas)
     VALUES ($1, $2, 'rodando', now(), 1)
     ON CONFLICT (empresa_id) DO UPDATE
        SET campanha_id = EXCLUDED.campanha_id, status = 'rodando', iniciado_em = now(),
            tentativas = enriquecimento.leads.tentativas + 1, erro = NULL`,
    [empresaId, campanhaId],
  );
  await db.query('DELETE FROM enriquecimento.etapas WHERE empresa_id = $1', [empresaId]);
}

export type NomeEtapa =
  | 'base_paga'
  | 'receita'
  | 'maps'
  | 'site'
  | 'google'
  | 'instagram'
  | 'ia'
  | 'linkedin'
  | 'places'
  | 'whatsapp';
export type StatusEtapa = 'encontrado' | 'sem_resultado' | 'pulada' | 'erro';

export async function registrarEtapa(
  db: Executor,
  empresaId: number,
  ordem: number,
  etapa: NomeEtapa,
  status: StatusEtapa,
  detalhe: string,
  url: string | null = null,
) {
  await db.query(
    `INSERT INTO enriquecimento.etapas (empresa_id, ordem, etapa, status, detalhe, url)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [empresaId, ordem, etapa, status, detalhe.slice(0, 500), url],
  );
}

export interface Conclusao {
  faixa: 'A' | 'B' | 'C';
  score: number;
  motivo: string;
  resumo: string | null;
  entrega: boolean | null;
  cnpjAchado: string | null;
  site: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedinEmpresa: string | null;
  mapsAberto: boolean | null;
  /** Dados do Google achados pelo enriquecimento (busca por nome e endereço). */
  maps?: {
    nota: number | null;
    avaliacoes: number | null;
    categoria: string | null;
    url: string | null;
  } | null;
}

/**
 * Grava a rodada inteira numa transação: troca pessoas e contatos automáticos pelos novos
 * (os cadastrados à mão ficam) e fecha o lead com a nota.
 */
export async function concluir(pool: Pool, empresaId: number, coletor: Coletor, c: Conclusao) {
  await comTransacao(pool, async (tx) => {
    await tx.query(`DELETE FROM enriquecimento.contatos WHERE empresa_id = $1 AND fonte <> 'manual'`, [
      empresaId,
    ]);
    await tx.query(
      `DELETE FROM enriquecimento.pessoas p WHERE empresa_id = $1
          AND NOT EXISTS (SELECT 1 FROM enriquecimento.contatos c WHERE c.pessoa_id = p.id)`,
      [empresaId],
    );

    const ids = new Map<string, number>();
    for (const p of coletor.pessoas.values()) {
      const { rows } = await tx.query<{ id: number }>(
        `INSERT INTO enriquecimento.pessoas
           (empresa_id, nome, cargo, papel, decisor, prioridade, desde, linkedin_url, fontes, url_origem,
            evidencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (empresa_id, nome_chave) DO UPDATE
            SET cargo = coalesce(EXCLUDED.cargo, enriquecimento.pessoas.cargo),
                papel = EXCLUDED.papel, decisor = EXCLUDED.decisor, prioridade = EXCLUDED.prioridade,
                desde = coalesce(EXCLUDED.desde, enriquecimento.pessoas.desde),
                linkedin_url = coalesce(EXCLUDED.linkedin_url, enriquecimento.pessoas.linkedin_url),
                fontes = EXCLUDED.fontes, url_origem = EXCLUDED.url_origem,
                evidencia = coalesce(EXCLUDED.evidencia, enriquecimento.pessoas.evidencia)
         RETURNING id`,
        [
          empresaId,
          p.nome,
          p.cargo,
          p.papel,
          p.decisor,
          p.prioridade,
          p.desde,
          p.linkedin,
          [...p.fontes],
          p.urlOrigem,
          p.evidencia,
        ],
      );
      if (rows[0]) ids.set(p.nome, rows[0].id);
    }

    for (const ct of coletor.contatos.values()) {
      await tx.query(
        `INSERT INTO enriquecimento.contatos
           (empresa_id, pessoa_id, canal, valor, rotulo, fonte, fontes, url_origem, confianca, status,
            whatsapp, verificado_em, principal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::boolean, CASE WHEN $11::boolean IS NOT NULL THEN now() END, $12)
         ON CONFLICT (empresa_id, canal, valor) DO NOTHING`,
        [
          empresaId,
          ct.pessoa ? (ids.get(ct.pessoa) ?? null) : null,
          ct.canal,
          ct.valor,
          ct.rotulo,
          ct.fonte,
          [...ct.fontes],
          ct.urlOrigem,
          ct.confianca,
          ct.status,
          ct.whatsapp,
          ct.principal,
        ],
      );
    }

    await tx.query(
      `UPDATE enriquecimento.leads
          SET status = 'concluido', concluido_em = now(), erro = NULL,
              faixa = $2, score = $3, motivo = $4, resumo = $5, entrega = $6, cnpj_achado = $7,
              site_url = $8, instagram = $9, facebook = $10, linkedin_empresa = $11, maps_aberto = $12,
              maps_nota = $13, maps_avaliacoes = $14, maps_categoria = $15, maps_url = $16
        WHERE empresa_id = $1`,
      [
        empresaId,
        c.faixa,
        c.score,
        c.motivo,
        c.resumo,
        c.entrega,
        c.cnpjAchado,
        c.site,
        c.instagram,
        c.facebook,
        c.linkedinEmpresa,
        c.mapsAberto,
        c.maps?.nota ?? null,
        c.maps?.avaliacoes ?? null,
        c.maps?.categoria ?? null,
        c.maps?.url ?? null,
      ],
    );
  });
}

export async function marcarErro(db: Executor, empresaId: number, erro: string) {
  await db.query(
    `UPDATE enriquecimento.leads SET status = 'erro', erro = $2, concluido_em = now() WHERE empresa_id = $1`,
    [empresaId, erro.slice(0, 500)],
  );
}

/**
 * Reserva `n` pedidos do Google Places dentro da cota GRÁTIS do mês (somando o que a descoberta
 * já usou). Devolve false quando não cabe: aí o enriquecimento usa o Serper e não paga o Google.
 * Conta para mais quando a segunda tentativa (razão social) não acontece: nunca para menos.
 */
export async function reservarPlacesGratis(pool: Pool, n: number, contaId: number): Promise<boolean> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // A cota é da chave do Google de cada conta.
    await cliente.query(`SELECT pg_advisory_xact_lock(hashtext('enriquecimento.uso_places:' || $1))`, [
      contaId,
    ]);
    const { rows } = await cliente.query<{ franquia: number; usados: number }>(
      `SELECT coalesce((SELECT franquia_mensal FROM cadastro.v_config_places WHERE conta_id = $1), 1000)::int AS franquia,
              (coalesce((SELECT pedidos FROM descoberta.v_uso_places_mes
                          WHERE conta_id = $1 AND mes = descoberta.mes_places()), 0)
               + coalesce((SELECT pedidos FROM enriquecimento.uso_places
                            WHERE conta_id = $1 AND mes = descoberta.mes_places()), 0))::int
                AS usados`,
      [contaId],
    );
    const { franquia = 1000, usados = 0 } = rows[0] ?? {};
    if (usados + n > franquia) {
      await cliente.query('ROLLBACK');
      return false;
    }
    await cliente.query(
      `INSERT INTO enriquecimento.uso_places (conta_id, mes, pedidos) VALUES ($2, descoberta.mes_places(), $1)
       ON CONFLICT (conta_id, mes) DO UPDATE SET pedidos = enriquecimento.uso_places.pedidos + EXCLUDED.pedidos`,
      [n, contaId],
    );
    await cliente.query('COMMIT');
    return true;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

/** Uma consulta à base paga (para o custo aparecer no relatório). */
export async function registrarUsoBasePaga(
  db: Executor,
  empresaId: number,
  provedor: string,
  custoBrl: number,
  achados: number,
): Promise<void> {
  await db.query(
    `INSERT INTO enriquecimento.uso_base_paga (empresa_id, provedor, custo_brl, achados) VALUES ($1, $2, $3, $4)`,
    [empresaId, provedor, custoBrl, achados],
  );
}

/** Seu retorno sobre esta empresa (view publicada pelo comercial). */
export async function feedbackDaEmpresa(
  db: Executor,
  empresaId: number,
): Promise<{ invalidos: Set<string>; naoDecisores: Set<string> }> {
  const { rows } = await db
    .query<{ tipo: string; valor: string }>(
      'SELECT tipo, valor FROM comercial.v_feedback WHERE empresa_id = $1',
      [empresaId],
    )
    .catch(() => ({ rows: [] as { tipo: string; valor: string }[] }));
  return {
    invalidos: new Set(rows.filter((r) => r.tipo === 'numero_errado').map((r) => r.valor)),
    naoDecisores: new Set(rows.filter((r) => r.tipo === 'nao_decisor').map((r) => r.valor)),
  };
}

/** Em quantas empresas (CNPJ básico) da base cada telefone aparece. */
export async function empresasPorTelefone(db: Executor, numeros: string[]): Promise<Map<string, number>> {
  const saida = new Map<string, number>();
  for (const n of numeros.slice(0, 6)) {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(DISTINCT cnpj_basico)::int AS n
         FROM (SELECT cnpj_basico FROM base_cnpj.v_estabelecimentos WHERE telefones @> ARRAY[$1]::text[] LIMIT 200) x`,
      [n],
    );
    saida.set(n, rows[0]?.n ?? 0);
  }
  return saida;
}

/* ───────────── Limite de leads do plano ───────────── */

/**
 * A conta chegou no limite de leads enriquecidos do mês? Refazer um lead que já foi enriquecido
 * neste mês não conta de novo. Conta sem plano não tem limite.
 */
export async function semVagaDeLeads(db: Executor, contaId: number, empresaId: number): Promise<boolean> {
  const { rows } = await db.query<{
    plano: Plano | null;
    limite_usuarios: number | null;
    limite_leads_mes: number | null;
    modulos: string[];
    usados: number;
    ja_conta: boolean;
  }>(
    `SELECT c.plano, c.limite_usuarios, c.limite_leads_mes, c.modulos,
            (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
              WHERE ca.conta_id = c.id AND l.status = 'concluido' AND l.concluido_em >= ${INICIO_MES_SP_TS})::int AS usados,
            EXISTS (SELECT 1 FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
                     WHERE l.empresa_id = $2 AND ca.conta_id = c.id AND l.status = 'concluido'
                       AND l.concluido_em >= ${INICIO_MES_SP_TS}) AS ja_conta
       FROM cadastro.contas c WHERE c.id = $1`,
    [contaId, empresaId],
  );
  const r = rows[0];
  if (!r?.plano || r.ja_conta) return false;
  const { leadsMes } = planoEfetivo({
    plano: r.plano,
    limiteUsuarios: r.limite_usuarios,
    limiteLeadsMes: r.limite_leads_mes,
    modulos: r.modulos,
    mensalidadeManual: null,
  });
  return leadsMes != null && r.usados >= leadsMes;
}

/** O lead espera o limite do plano (volta para a fila quando o mês virar ou o plano aumentar). */
export async function aguardarLimite(db: Executor, empresaId: number, campanhaId: number): Promise<void> {
  await db.query(
    `INSERT INTO enriquecimento.leads (empresa_id, campanha_id, status)
     VALUES ($1, $2, 'limite')
     ON CONFLICT (empresa_id) DO UPDATE SET campanha_id = EXCLUDED.campanha_id, status = 'limite'
      WHERE enriquecimento.leads.status <> 'concluido'`,
    [empresaId, campanhaId],
  );
}
