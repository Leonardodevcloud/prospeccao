import { randomBytes } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import {
  AppError,
  achatarEnvio,
  aprenderCampos,
  CAMPO_ISCA,
  type CampoSite,
  type FormularioSiteEntrada,
  leadDoEnvio,
} from '@prospeccao/shared';
import { comConta, contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { temRecurso } from '../../recursos.js';
import { aposCriar, conferirDestino, criarOuJuntar } from './leads.js';

/**
 * Formulários do site: cada um tem um endereço público (/v1/entrada/<chave>) que recebe o envio
 * como vier (JSON, formulário HTML, Elementor, RD Station, Typeform…). O primeiro envio ensina os
 * campos; o administrador confere para onde cada um vai.
 */

type Deps = Pick<DepsApi, 'pool' | 'filas'>;

interface Linha {
  id: number;
  conta_id: number;
  nome: string;
  chave: string;
  ligado: boolean;
  campos: CampoSite[];
  etapa_id: number | null;
  responsavel_id: number | null;
  etiquetas: string[];
  boas_vindas: string | null;
  avisar: boolean;
  redirecionar: string | null;
}

export async function listar(db: Executor) {
  const { rows } = await db.query(
    `SELECT f.id::int, f.nome, f.chave, f.ligado, f.campos, f.etapa_id AS "etapaId", f.responsavel_id AS "responsavelId",
            f.etiquetas, f.boas_vindas AS "boasVindas", f.avisar, f.redirecionar, f.criado_em AS "criadoEm",
            f.ultimo_envio_em AS "ultimoEnvioEm",
            coalesce(s.leads, 0)::int AS "leads30", coalesce(s.robos, 0)::int AS "robos7",
            coalesce(s.erros, 0)::int AS "erros7", coalesce(s.envios7, 0)::int AS "envios7"
       FROM comercial.formularios_site f
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE e.resultado IN ('lead', 'duplicado')) AS leads,
                count(*) FILTER (WHERE e.resultado = 'robo' AND e.recebido_em > now() - interval '7 days') AS robos,
                count(*) FILTER (WHERE e.resultado = 'erro' AND e.recebido_em > now() - interval '7 days') AS erros,
                count(*) FILTER (WHERE e.resultado IN ('lead', 'duplicado') AND e.recebido_em > now() - interval '7 days') AS envios7
           FROM comercial.formulario_envios e
          WHERE e.formulario_id = f.id AND e.recebido_em > now() - interval '30 days'
       ) s ON true
      WHERE f.conta_id = ${contaSql()}
      ORDER BY f.criado_em`,
  );
  return rows;
}

export async function criar(db: Executor, nome: string): Promise<number> {
  const chave = `f_${randomBytes(9).toString('base64url')}`;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.formularios_site (conta_id, nome, chave) VALUES (${contaSql()}, $1, $2) RETURNING id::int`,
    [nome, chave],
  );
  return rows[0]!.id;
}

export async function salvar(db: Executor, id: number, d: FormularioSiteEntrada): Promise<void> {
  await conferirDestino(db, { etapaId: d.etapaId, responsavelId: d.responsavelId });
  // Quem salvou conferiu: nenhum campo fica marcado como novo.
  const campos = d.campos.map(({ novo: _novo, ...c }) => c);
  const { rowCount } = await db.query(
    `UPDATE comercial.formularios_site SET nome = $2, ligado = $3, campos = $4, etapa_id = $5, responsavel_id = $6,
            etiquetas = $7, boas_vindas = $8, avisar = $9, redirecionar = $10
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [
      id,
      d.nome,
      d.ligado,
      JSON.stringify(campos),
      d.etapaId ?? null,
      d.responsavelId ?? null,
      d.etiquetas,
      d.boasVindas?.trim() || null,
      d.avisar,
      d.redirecionar ?? null,
    ],
  );
  if (!rowCount) throw AppError.naoEncontrado('Formulário');
}

export async function apagar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.formularios_site WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Formulário');
}

export async function envios(db: Executor, id: number) {
  const { rows } = await db.query(
    `SELECT e.id::int, e.recebido_em AS "recebidoEm", e.resultado, e.erro, e.empresa_id::int AS "empresaId",
            coalesce(em.maps_nome, em.nome) AS lead, e.dados
       FROM comercial.formulario_envios e
       LEFT JOIN descoberta.empresas em ON em.id = e.empresa_id
      WHERE e.formulario_id = $1 AND e.conta_id = ${contaSql()}
      ORDER BY e.recebido_em DESC LIMIT 30`,
    [id],
  );
  return rows;
}

/* ───────────────────────────── Receber o envio ───────────────────────────── */

const porIp = new Map<string, { minuto: number; n: number }>();
const LIMITE_POR_IP = 10;

export interface ResultadoEnvio {
  resultado: 'lead' | 'duplicado' | 'robo' | 'erro' | 'desligado';
  empresaId: number | null;
  redirecionar: string | null;
  mensagem?: string;
}

/** O envio de um formulário (sem login: a chave do endereço diz a conta). */
export async function receber(
  deps: Deps,
  chave: string,
  corpo: unknown,
  ip: string,
): Promise<ResultadoEnvio> {
  const { pool } = deps;
  const { rows } = await pool.query<Linha>(
    `SELECT id::int, conta_id, nome, chave, ligado, campos, etapa_id, responsavel_id, etiquetas, boas_vindas, avisar, redirecionar
       FROM comercial.formularios_site WHERE chave = $1`,
    [chave],
  );
  const f = rows[0];
  if (!f) throw AppError.naoEncontrado('Formulário');

  // Mais de 10 envios por minuto do mesmo IP no mesmo formulário: robô.
  const minuto = Math.floor(Date.now() / 60_000);
  const k = `${f.id}|${ip}`;
  const p = porIp.get(k);
  const n = p && p.minuto === minuto ? p.n + 1 : 1;
  porIp.set(k, { minuto, n });
  if (porIp.size > 5000) porIp.clear();

  return comConta(f.conta_id, async () => {
    const dados = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const guardar = async (r: ResultadoEnvio['resultado'], empresaId: number | null, erro?: string) => {
      await pool.query(
        `INSERT INTO comercial.formulario_envios (formulario_id, conta_id, dados, resultado, empresa_id, erro, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          f.id,
          f.conta_id,
          JSON.stringify(dados).slice(0, 20_000),
          r,
          empresaId,
          erro ?? null,
          ip.slice(0, 60),
        ],
      );
      return { resultado: r, empresaId, redirecionar: f.redirecionar, mensagem: erro };
    };
    const isca = dados[CAMPO_ISCA];
    if (n > LIMITE_POR_IP || (typeof isca === 'string' && isca.trim())) return guardar('robo', null);
    const recebidos = achatarEnvio(dados).filter((c) => c.chave !== CAMPO_ISCA);
    if (!recebidos.length) return guardar('erro', null, 'O envio chegou vazio.');
    const campos = aprenderCampos(f.campos, recebidos);
    await pool.query(
      'UPDATE comercial.formularios_site SET campos = $2, ultimo_envio_em = now() WHERE id = $1',
      [f.id, JSON.stringify(campos)],
    );
    if (!f.ligado) return guardar('desligado', null);
    if (!(await temRecurso(pool, 'api')))
      return guardar('erro', null, 'A API e os formulários não estão no plano da conta.');
    const l = leadDoEnvio(recebidos, campos);
    if (!l.telefone && !l.email && !l.contato && !l.empresa)
      return guardar('erro', null, 'Sem nome, telefone nem e-mail: não dá para criar o lead.');
    const origem = [`Formulário do site: ${f.nome}`, l.origem].filter(Boolean).join(' · ');
    try {
      const { empresaId, novo } = await criarOuJuntar(
        deps,
        {
          empresa: l.empresa || l.contato || l.email || 'Contato do site',
          contato: l.contato,
          cargo: l.cargo,
          telefone: l.telefone,
          email: l.email,
          cnpj: l.cnpj,
          cidade: l.cidade,
          site: l.site,
          observacao: [l.anotacao, origem].filter(Boolean).join('\n'),
        },
        { etapaId: f.etapa_id, responsavelId: f.responsavel_id, etiquetas: f.etiquetas },
        'Formulário do site',
        `Preencheu de novo o formulário “${f.nome}”.`,
      );
      await aposCriar(pool, empresaId, {
        novo,
        boasVindas: f.boas_vindas,
        contato: l.contato,
        avisar: f.avisar,
        titulo: `${novo ? 'Lead novo' : 'Contato de novo'} do site: ${l.contato ?? l.empresa ?? l.email ?? 'sem nome'}`,
        texto: origem,
      });
      return guardar(novo ? 'lead' : 'duplicado', empresaId);
    } catch (e) {
      return guardar('erro', null, (e as Error).message.slice(0, 300));
    }
  });
}
