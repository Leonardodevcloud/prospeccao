import { custosPlataformaEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

const GRAVIDADE = { parado: 0, pouco_uso: 1, no_limite: 2, novo: 3, ok: 4 } as const;

/** Painel da plataforma (só o master): visão geral, clientes com consumo e custo, operação. */
export function rotasPlataforma({ pool, filas, credenciais }: DepsApi): Router {
  const r = Router();

  /** Visão geral: receita, saúde dos clientes, vendas e o que está quebrado. */
  r.get('/visao', async (_req, res) => {
    const [{ clientes, custos }, vendas, op, tamanhos] = await Promise.all([
      repo.clientes(pool, credenciais),
      repo.resumoVendas(pool),
      repo.operacao(pool),
      filas.tamanhos().catch(() => ({}) as Record<string, number>),
    ]);
    const pagantes = clientes.filter((c) => !c.principal && c.ativa && c.plano);
    const mrr = pagantes.reduce((s, c) => s + (c.mensalidade ?? 0), 0);
    const custo = clientes.filter((c) => c.ativa).reduce((s, c) => s + c.custo.total, 0);
    const mesSp = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    const inicioMes = new Date(`${mesSp}-01T03:00:00Z`);
    const porPlano = new Map<string, { clientes: number; receita: number }>();
    for (const c of pagantes) {
      const k = c.plano ?? 'sem';
      const v = porPlano.get(k) ?? { clientes: 0, receita: 0 };
      v.clientes++;
      v.receita += c.mensalidade ?? 0;
      porPlano.set(k, v);
    }
    res.json({
      receita: {
        mrr,
        clientesAtivos: pagantes.length,
        ticketMedio: pagantes.length ? mrr / pagantes.length : 0,
        novosNoMes: clientes.filter((c) => !c.principal && c.ativa && new Date(c.criadoEm) >= inicioMes)
          .length,
        canceladosNoMes: clientes.filter(
          (c) => !c.principal && c.desativadaEm && new Date(c.desativadaEm) >= inicioMes,
        ).length,
        porPlano: [...porPlano.entries()].map(([plano, v]) => ({ plano, ...v })),
        custoEstimado: Math.round(custo * 100) / 100,
        margemEstimada:
          Math.round(
            (mrr - clientes.filter((c) => !c.principal && c.ativa).reduce((s, c) => s + c.custo.total, 0)) *
              100,
          ) / 100,
        custoContaPrincipal: clientes.find((c) => c.principal)?.custo.total ?? 0,
      },
      atencao: clientes
        .filter((c) => !c.principal && c.ativa && c.saude !== 'ok')
        // O que pede ação primeiro: parado, usando pouco, no limite (vender mais); novo por último.
        .sort((a, b) => GRAVIDADE[a.saude] - GRAVIDADE[b.saude])
        .map((c) => ({
          id: c.id,
          contaId: c.unidades[0]?.id ?? null,
          nome: c.nome,
          saude: c.saude,
          texto: c.saudeTexto,
          mensalidade: c.mensalidade,
        })),
      vendas,
      operacao: {
        alertas: op.alertas.length,
        alertasErro: op.alertas.filter((a) => a.nivel === 'erro').length,
        filaEnriquecimento: op.enriquecimento?.na_fila ?? 0,
        erros24h: op.enriquecimento?.erros24h ?? 0,
        parciais24h: op.enriquecimento?.parciais24h ?? 0,
        filas: tamanhos,
      },
      custos,
    });
  });

  r.get('/clientes', async (_req, res) => {
    res.json(await repo.clientes(pool, credenciais));
  });

  r.get('/custos', async (_req, res) => {
    res.json(await repo.lerCustos(pool));
  });
  r.put('/custos', async (req, res) => {
    const c = corpo(req, custosPlataformaEntrada);
    await repo.salvarCustos(pool, c, req.usuario!.id);
    res.json(await repo.lerCustos(pool));
  });

  r.get('/operacao', async (_req, res) => {
    const [op, tamanhos] = await Promise.all([
      repo.operacao(pool),
      filas.tamanhos().catch(() => ({}) as Record<string, number>),
    ]);
    res.json({ ...op, filas: tamanhos });
  });

  return r;
}
