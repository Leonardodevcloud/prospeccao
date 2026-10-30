import { distribuicaoEntrada, usuarioAtualizar, usuarioNovo } from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { conta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import {
  conversasDaIaNoMes,
  exigirRecurso,
  foraDoPlano,
  horasDeReuniaoNoMes,
  numerosDeWhatsapp,
  temRecurso,
} from '../../recursos.js';
import { consumoDaConta } from '../consumo/repositorio.js';
import { planoDaConta } from '../plano/repositorio.js';
import * as repo from './repositorio.js';

/** Endereço da tela (para o link do convite): a origem do navegador ou a primeira configurada. */
function enderecoDoApp(req: Request, origens: string[]): string {
  const origem = req.get('origin');
  if (origem && origens.includes(origem.toLowerCase())) return origem;
  return origens[0] ?? '';
}

export function rotasEquipe({ pool, origens }: DepsApi): Router {
  const r = Router();
  const link = (req: Request, token: string) => `${enderecoDoApp(req, origens)}/convite/${token}`;

  /** O plano da conta: o que está contratado e quanto já foi usado no mês. */
  r.get('/plano', async (req, res) => {
    const [p, c, horas, conversas, numeros] = await Promise.all([
      planoDaConta(pool, conta()),
      consumoDaConta(pool, conta()),
      horasDeReuniaoNoMes(pool),
      conversasDaIaNoMes(pool),
      numerosDeWhatsapp(pool),
    ]);
    const admin = req.usuario?.papel === 'admin';
    res.json({
      ...p,
      // O preço e o detalhe do cálculo ficam com o administrador da conta.
      mensalidade: admin ? p.mensalidade : null,
      itens: admin ? p.itens : [],
      mensalidadeCalculada: null,
      mensalidadeManual: null,
      consumo: {
        emails: { enviados: c.emails.enviados, limite: c.limites.emailsMes },
        whatsapp: { automaticas: c.whatsapp.automaticas, limite: c.limites.whatsappMes },
        // Franquias do plano (organização toda): horas de reunião, conversas da IA e números.
        horasReuniao: { usadas: Math.round(horas * 10) / 10, limite: p.horasReuniao },
        conversasIa: { usadas: conversas, limite: p.conversasIa },
        numerosWhatsapp: { usados: numeros.usados, limite: p.numerosWhatsapp },
      },
    });
  });

  r.get('/', async (_req, res) => {
    res.json(await repo.listar(pool));
  });

  r.get('/desempenho', async (req, res) => {
    await exigirRecurso(pool, 'relatorios');
    const { dias } = consulta(req, z.object({ dias: z.coerce.number().int().min(0).max(3650).default(30) }));
    res.json(await repo.desempenho(pool, dias));
  });

  r.post('/', exigirAdmin, async (req, res) => {
    const novo = corpo(req, usuarioNovo);
    if (novo.alcance === 'proprios') await exigirRecurso(pool, 'equipe');
    const { id, token } = await repo.criar(pool, novo);
    res.status(201).json({ id, convite: link(req, token), diasValidade: repo.DIAS_CONVITE });
  });

  r.patch('/:id', exigirAdmin, async (req, res) => {
    const d = corpo(req, usuarioAtualizar);
    // "Só a própria base" e metas são do trabalho em equipe (plano Time em diante): sem ele, a
    // própria base é recusada e as metas ficam como estão.
    if (!(await temRecurso(pool, 'equipe'))) {
      if (d.alcance === 'proprios') throw await foraDoPlano(pool, 'equipe');
      delete d.metas;
    }
    await repo.atualizar(pool, idDaRota(req), d);
    res.json(await repo.listar(pool));
  });

  r.post('/:id/convite', exigirAdmin, async (req, res) => {
    const token = await repo.novoConvite(pool, idDaRota(req));
    res.json({ convite: link(req, token), diasValidade: repo.DIAS_CONVITE });
  });

  r.put('/distribuicao', exigirAdmin, async (req, res) => {
    await exigirRecurso(pool, 'equipe');
    await repo.salvarDistribuicao(pool, corpo(req, distribuicaoEntrada));
    res.json({ ok: true });
  });

  r.post('/distribuir', exigirAdmin, async (_req, res) => {
    await exigirRecurso(pool, 'equipe');
    res.json({ distribuidos: await repo.distribuirSemDono(pool) });
  });

  return r;
}
