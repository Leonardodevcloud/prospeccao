import type { Executor } from '@prospeccao/db';
import type { PassoInicial, PrimeirosPassosDTO } from '@prospeccao/shared';
import { Router } from 'express';
import { conta, contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { planoDaConta } from '../plano/repositorio.js';

/**
 * Primeiros passos: o caminho de um cliente novo até a primeira conversa com lead. Cada passo é
 * conferido nos dados de verdade (não é um "marcar como feito"); só aparecem os passos dos módulos
 * contratados.
 */

interface Contagens {
  whatsapp: boolean;
  nichos: number;
  campanhas: number;
  noFunil: number;
  sobreEmpresa: number;
  conhecimento: number;
  emails: number;
  pessoas: number;
  fechado: string | null;
}

async function contar(db: Executor): Promise<Contagens> {
  const C = contaSql();
  const { rows } = await db.query<Contagens>(
    `SELECT EXISTS (SELECT 1 FROM comercial.chips WHERE conta_id = ${C} AND estado LIKE 'ok%') AS whatsapp,
            (SELECT count(*)::int FROM cadastro.nichos WHERE conta_id = ${C}) AS nichos,
            (SELECT count(*)::int FROM cadastro.campanhas WHERE conta_id = ${C} AND iniciada_em IS NOT NULL) AS campanhas,
            (SELECT count(*)::int FROM comercial.oportunidades WHERE conta_id = ${C} AND etapa <> 'descartado') AS "noFunil",
            coalesce((SELECT length(trim(sobre_empresa)) FROM comercial.config_agente WHERE conta_id = ${C}), 0) AS "sobreEmpresa",
            (SELECT count(*)::int FROM comercial.conhecimento WHERE conta_id = ${C} AND status = 'ativo') AS conhecimento,
            (SELECT count(*)::int FROM comercial.campanhas_email WHERE conta_id = ${C}) AS emails,
            (SELECT count(*)::int FROM cadastro.usuarios WHERE conta_id = ${C} AND ativo AND papel IN ('admin', 'sdr', 'closer')) AS pessoas,
            (SELECT primeiros_passos_fechado_em FROM cadastro.contas WHERE id = ${C}) AS fechado`,
  );
  return rows[0]!;
}

export async function primeirosPassos(db: Executor): Promise<PrimeirosPassosDTO> {
  const [c, plano] = await Promise.all([contar(db), planoDaConta(db, conta())]);
  // Sem plano (conta principal), todos os módulos valem.
  const modulos = new Set<string>(plano.plano ? plano.modulos : ['whatsapp', 'agente_ia', 'email']);
  const passos: PassoInicial[] = [];
  const passo = (p: PassoInicial) => passos.push(p);
  if (modulos.has('whatsapp'))
    passo({
      id: 'whatsapp',
      titulo: 'Conecte seu WhatsApp',
      texto: 'Leia o QR Code com o celular do número que vai falar com os leads.',
      link: '/agente',
      feito: c.whatsapp,
    });
  passo({
    id: 'nicho',
    titulo: 'Crie um nicho',
    texto: 'Quem você quer encontrar: o tipo de empresa, os termos do Google e o que fica de fora.',
    link: '/nichos',
    feito: c.nichos > 0,
  });
  passo({
    id: 'campanha',
    titulo: 'Rode a primeira campanha',
    texto: 'Escolha o nicho e as cidades. O sistema acha as empresas, cruza com o CNPJ e dá a nota.',
    link: '/campanhas',
    feito: c.campanhas > 0,
  });
  passo({
    id: 'funil',
    titulo: 'Mande os melhores leads para o funil',
    texto: 'Na lista de leads, filtre pela nota A e mande para "A abordar".',
    link: '/',
    feito: c.noFunil > 0,
  });
  if (modulos.has('agente_ia'))
    passo({
      id: 'ia',
      titulo: 'Ensine a IA de atendimento',
      texto: 'O que a empresa faz, o que vende e o que ela nunca pode dizer. Ela só fala o que está lá.',
      link: '/agente',
      feito: c.sobreEmpresa >= 80 && c.conhecimento > 0,
    });
  if (modulos.has('email'))
    passo({
      id: 'email',
      titulo: 'Prepare a sequência de e-mail',
      texto: 'Identidade visual, o texto e os passos. Teste antes de ligar.',
      link: '/email',
      feito: c.emails > 0,
    });
  passo({
    id: 'equipe',
    titulo: 'Convide a equipe',
    texto: 'Cada pessoa com o seu papel. Os leads se dividem entre quem estiver no rodízio.',
    link: '/equipe',
    feito: c.pessoas > 1,
  });
  const feitos = passos.filter((p) => p.feito).length;
  return { passos, feitos, total: passos.length, fechado: !!c.fechado, concluido: feitos === passos.length };
}

export function rotasInicio({ pool }: DepsApi): Router {
  const r = Router();
  r.get('/primeiros-passos', async (_req, res) => {
    res.json(await primeirosPassos(pool));
  });
  /** O administrador fecha a lista (e pode abrir de novo). */
  r.post('/primeiros-passos/fechar', exigirAdmin, async (_req, res) => {
    await pool.query(
      `UPDATE cadastro.contas SET primeiros_passos_fechado_em = now() WHERE id = ${contaSql()}`,
    );
    res.json(await primeirosPassos(pool));
  });
  r.post('/primeiros-passos/abrir', exigirAdmin, async (_req, res) => {
    await pool.query(
      `UPDATE cadastro.contas SET primeiros_passos_fechado_em = NULL WHERE id = ${contaSql()}`,
    );
    res.json(await primeirosPassos(pool));
  });
  return r;
}
