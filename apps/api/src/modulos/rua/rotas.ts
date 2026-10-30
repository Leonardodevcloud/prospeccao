import { comTransacao } from '@prospeccao/db';
import {
  AppError,
  chegadaVisita,
  conclusaoVisita,
  configRoteiro,
  diaEmSaoPaulo,
  ETAPA_DO_RESULTADO,
  haversineKm,
  ORDEM_ETAPA,
  proximoPassoSugerido,
  RAIO_CHEGADA_METROS,
  RESULTADOS_VISITA,
  ROTULO_RESULTADO,
  roteiroMontado,
  somarDiasUteis,
} from '@prospeccao/shared';
import express, { type Request, Router } from 'express';
import { z } from 'zod';
import { conta, usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import * as funil from '../funil/repositorio.js';
import { notificar } from '../notificacoes/repositorio.js';
import { filtrarCandidatos, planejar } from './planejar.js';
import * as repo from './repositorio.js';

/**
 * Vendas na rua:
 *  - planejar o dia (computador): os leads da campanha no mapa, o roteiro sugerido, montar à mão,
 *    salvar e mandar para o celular do vendedor;
 *  - no celular: o roteiro de hoje, o check-in, a foto da fachada e o registro da visita (que vai
 *    para o histórico e move o funil);
 *  - o acompanhamento do gestor (visitas da equipe).
 */

/** Foto da fachada: o celular já reduz antes de mandar; 6 MB é folga. */
const LIMITE_FOTO = 6 * 1024 * 1024;

const ehAdmin = () => usuarioAtual()?.papel === 'admin';

/** De quem é o roteiro: quem não é administrador só planeja o próprio dia. */
async function vendedorDoPedido(deps: DepsApi, pedido: number | undefined) {
  const eu = usuarioAtual()!;
  const id = pedido ?? eu.id;
  if (id !== eu.id && !ehAdmin())
    throw AppError.proibido('Só o administrador monta o roteiro de outra pessoa.');
  const v = await repo.vendedor(deps.pool, id);
  if (!v) throw AppError.naoEncontrado('Vendedor');
  return v;
}

/** A visita é do roteiro de quem está mexendo (o administrador pode mexer em todas). */
async function paradaDoPedido(deps: DepsApi, req: Request) {
  const p = await repo.parada(deps.pool, idDaRota(req));
  if (!p) throw AppError.naoEncontrado('Visita');
  if (p.vendedorId !== usuarioAtual()!.id && !ehAdmin())
    throw AppError.proibido('Esta visita é do roteiro de outra pessoa.');
  return p;
}

const filtrosPontos = z.object({
  campanhaId: z.coerce.number().int().positive().optional(),
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  vendedorId: z.coerce.number().int().positive().optional(),
});

const lerRoteiro = z.object({
  vendedorId: z.coerce.number().int().positive().optional(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const pedidoPasso = z.object({
  resultado: z.enum(RESULTADOS_VISITA),
  anotacao: z.string().trim().max(4000).nullable().default(null),
});

const respostaPassoIa = z.object({
  texto: z.string().trim().min(3).max(120),
  dias_uteis: z.number().int().min(0).max(30),
});

export function rotasRua(deps: DepsApi): Router {
  const r = Router();
  const { pool, log } = deps;

  /** O que está ligado: caminho pelas ruas, fotos, voz e IA. */
  r.get('/estado', async (_req, res) => {
    const s = await deps.servicos(conta());
    res.json({
      rotas: !!s.rotas,
      enderecos: !!s.geocodificar,
      fotos: !!deps.reunioes?.armazenamento,
      voz: !!deps.assistente?.voz,
      ia: !!s.assistente,
    });
  });

  r.get('/partidas', async (_req, res) => {
    res.json(await repo.partidas(pool));
  });

  /** Endereço digitado como ponto de partida. */
  r.post('/endereco', async (req, res) => {
    const { endereco } = corpo(req, z.object({ endereco: z.string().trim().min(4).max(200) }));
    const { geocodificar } = await deps.servicos(conta());
    if (!geocodificar)
      throw new AppError(
        503,
        'indisponivel',
        'A busca de endereços não está ligada. Escolha uma base ou use a sua localização.',
      );
    const p = await geocodificar(endereco).catch(() => null);
    if (!p) throw AppError.invalido('Não achei esse endereço. Confira a rua, o número e a cidade.');
    res.json({ rotulo: endereco, ...p });
  });

  /** Leads da campanha com localização, para o mapa. */
  r.get('/pontos', async (req, res) => {
    const f = consulta(req, filtrosPontos);
    res.json(
      await repo.leadsComLocal(pool, {
        campanhaId: f.campanhaId ?? null,
        dia: f.dia ?? null,
        vendedorId: f.vendedorId ?? usuarioAtual()!.id,
      }),
    );
  });

  /** Sugere o dia: os melhores leads que cabem, na ordem que anda menos. Não salva. */
  r.post('/sugerir', async (req, res) => {
    const c = corpo(req, configRoteiro);
    const v = await vendedorDoPedido(deps, c.vendedorId);
    const { leads } = await repo.leadsComLocal(pool, {
      campanhaId: c.campanhaId,
      dia: c.dia,
      vendedorId: v.id,
    });
    const candidatos = filtrarCandidatos(leads, c);
    res.json(await planejar(await deps.servicos(conta()), log, c, candidatos, { tipo: 'sugerir' }));
  });

  /** Recalcula a lista montada à mão (adicionou, tirou, mudou a ordem). Não salva. */
  r.post('/recalcular', async (req, res) => {
    const d = corpo(req, roteiroMontado);
    await vendedorDoPedido(deps, d.config.vendedorId);
    const leads = await repo.leadsPorId(pool, d.empresaIds);
    res.json(
      await planejar(await deps.servicos(conta()), log, d.config, leads, {
        tipo: 'montado',
        otimizar: d.otimizar,
      }),
    );
  });

  /** Roteiro salvo de alguém num dia (para abrir o planejamento como estava). */
  r.get('/roteiros', async (req, res) => {
    const f = consulta(req, lerRoteiro);
    const v = await vendedorDoPedido(deps, f.vendedorId);
    res.json(await repo.roteiro(pool, { vendedorId: v.id, dia: f.dia }));
  });

  /** Salva o roteiro do dia (e, se pedido, avisa o vendedor no celular). */
  r.put('/roteiros', async (req, res) => {
    const d = corpo(req, roteiroMontado);
    const c = d.config;
    const v = await vendedorDoPedido(deps, c.vendedorId);
    if (!d.empresaIds.length) throw AppError.invalido('O roteiro está vazio: ponha ao menos uma visita.');
    const leads = await repo.leadsPorId(pool, d.empresaIds);
    if (!leads.length) throw AppError.invalido('Nenhum desses leads tem localização para entrar no roteiro.');
    const plano = await planejar(await deps.servicos(conta()), log, c, leads, {
      tipo: 'montado',
      otimizar: d.otimizar,
    });
    const id = await comTransacao(pool, (tx) =>
      repo.gravar(
        tx,
        {
          vendedorId: v.id,
          dia: c.dia,
          campanhaId: c.campanhaId,
          partida: c.partida,
          inicio: c.inicio,
          fim: c.fim,
          minutosVisita: c.minutosVisita,
          almoco: c.almoco,
          km: plano.km,
          minutosRota: plano.minutosRota,
          calculo: plano.calculo,
          tracado: plano.tracado,
          filtros: { faixas: c.faixas, situacoes: c.situacoes, raioKm: c.raioKm, maxParadas: c.maxParadas },
          enviar: d.enviar,
          criadoPor: usuarioAtual()!.id,
        },
        plano.paradas.map((p) => ({
          empresaId: p.empresaId,
          ordem: p.ordem,
          chegada: p.chegada,
          kmTrecho: p.kmTrecho,
          minutosTrecho: p.minutosTrecho,
          almocoAntes: p.almocoAntes,
        })),
      ),
    );
    if (d.enviar && v.id !== usuarioAtual()!.id) {
      const dia = new Date(`${c.dia}T12:00:00Z`).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC',
      });
      await notificar(pool, v.id, {
        tipo: 'tarefa',
        titulo: `Seu roteiro de ${dia}: ${plano.paradas.length} visitas`,
        texto: `Saída às ${c.inicio} de ${c.partida.rotulo}. ${plano.km.toLocaleString('pt-BR')} km no total.`,
        link: '/rua',
      }).catch((erro) => log.warn({ err: erro }, 'rua: aviso do roteiro falhou'));
    }
    res.json(await repo.roteiro(pool, { id }));
  });

  r.delete('/roteiros/:id', async (req, res) => {
    const id = idDaRota(req);
    const atual = await repo.roteiro(pool, { id });
    if (!atual) throw AppError.naoEncontrado('Roteiro');
    if (atual.vendedorId !== usuarioAtual()!.id && !ehAdmin()) throw AppError.proibido();
    if (!(await repo.apagar(pool, id)))
      throw AppError.conflito(
        'Este roteiro já tem visitas registradas: tire só as que ainda não aconteceram.',
      );
    res.status(204).end();
  });

  /** O roteiro de hoje de quem está logado (a tela do celular). */
  r.get('/hoje', async (_req, res) => {
    res.json(await repo.roteiro(pool, { vendedorId: usuarioAtual()!.id, dia: diaEmSaoPaulo() }));
  });

  /** Check-in: hora e (se o celular deixou) o local, com a distância até o endereço do lead. */
  r.post('/paradas/:id/chegada', async (req, res) => {
    const p = await paradaDoPedido(deps, req);
    if (p.situacao === 'feita') throw AppError.conflito('Esta visita já foi registrada.');
    const c = corpo(req, chegadaVisita);
    const distanciaM =
      c.lat != null && c.lng != null && p.lat != null && p.lng != null
        ? Math.round(haversineKm({ lat: c.lat, lng: c.lng }, { lat: p.lat, lng: p.lng }) * 1000)
        : null;
    await repo.registrarChegada(pool, p.id, { lat: c.lat, lng: c.lng, distanciaM });
    res.json({ distanciaM, noEndereco: distanciaM != null && distanciaM <= RAIO_CHEGADA_METROS });
  });

  /** Próximo passo sugerido para o resultado (lê a anotação com a IA quando dá). */
  r.post('/sugestao-passo', async (req, res) => {
    const d = corpo(req, pedidoPasso);
    const padrao = proximoPassoSugerido(d.resultado);
    if (!padrao) return void res.json(null);
    const s = await deps.servicos(conta());
    if (!s.assistente || !d.anotacao || d.anotacao.length < 15)
      return void res.json({ ...padrao, fonte: 'padrao' });
    try {
      const bruto = await s.assistente({
        sistema:
          'Você ajuda um vendedor que acabou de visitar um cliente. Pela anotação da visita, diga o próximo passo ' +
          'dele em poucas palavras (verbo no infinitivo, até 8 palavras, sem nome de pessoa) e em quantos dias ' +
          'úteis a partir de hoje (0 = hoje). Se a anotação disser um prazo ("até sexta", "semana que vem"), use. ' +
          `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' })}. ` +
          'Responda só com JSON: {"texto": "...", "dias_uteis": 1}',
        mensagens: [
          {
            papel: 'user',
            conteudo: `Resultado: ${ROTULO_RESULTADO[d.resultado]}.\nAnotação: ${d.anotacao}`,
          },
        ],
        temperatura: 0.2,
        maxTokens: 120,
        timeoutMs: 12_000,
        raciocinio: 'desligado',
      });
      const j = respostaPassoIa.parse(JSON.parse(bruto.replace(/^```(json)?|```$/g, '').trim()));
      res.json({ texto: j.texto, dia: somarDiasUteis(diaEmSaoPaulo(), j.dias_uteis), fonte: 'ia' });
    } catch (erro) {
      log.warn({ err: erro }, 'rua: sugestão do próximo passo pela IA falhou');
      res.json({ ...padrao, fonte: 'padrao' });
    }
  });

  /**
   * Conclui a visita: entra no histórico do lead, o funil avança conforme o resultado (nunca volta)
   * e o próximo passo fica marcado.
   */
  r.post('/paradas/:id/concluir', async (req, res) => {
    const p = await paradaDoPedido(deps, req);
    if (p.situacao === 'feita') throw AppError.conflito('Esta visita já foi registrada.');
    const c = corpo(req, conclusaoVisita);
    const autor = usuarioAtual()!.nome;
    const texto = [`Visita: ${ROTULO_RESULTADO[c.resultado]}.`, c.anotacao].filter(Boolean).join('\n');
    const { etapa: atual } = await funil.registrarAtividade(
      pool,
      p.empresaId,
      { tipo: 'visita', direcao: 'enviada', texto, contato: null },
      autor,
    );
    const alvo = ETAPA_DO_RESULTADO[c.resultado];
    const avanca = alvo && ORDEM_ETAPA[alvo] > ORDEM_ETAPA[atual] && ORDEM_ETAPA[atual] < ORDEM_ETAPA.ganho;
    const passo =
      c.proximoPasso && c.resultado !== 'sem_interesse'
        ? {
            proximaAcao: c.proximoPasso,
            proximaAcaoEm: c.proximoPassoEm
              ? new Date(`${c.proximoPassoEm}T09:00:00-03:00`).toISOString()
              : null,
          }
        : {};
    if (avanca || Object.keys(passo).length)
      await funil.atualizar(
        pool,
        p.empresaId,
        {
          ...(avanca ? { etapa: alvo } : {}),
          ...(alvo === 'perdido' && avanca ? { motivo: 'Sem interesse (visita)' } : {}),
          ...passo,
        },
        autor,
      );
    await repo.concluir(pool, p.id, {
      resultado: c.resultado,
      anotacao: c.anotacao,
      proximoPasso: c.resultado === 'sem_interesse' ? null : c.proximoPasso,
      proximoPassoEm: c.resultado === 'sem_interesse' ? null : c.proximoPassoEm,
    });
    res.json({ etapa: avanca ? alvo : atual });
  });

  r.post('/paradas/:id/pular', async (req, res) => {
    const p = await paradaDoPedido(deps, req);
    if (p.situacao === 'feita') throw AppError.conflito('Esta visita já foi registrada.');
    await repo.mudarSituacao(pool, p.id, 'pulada');
    res.status(204).end();
  });

  /** Desfaz o "pular" (a visita volta para a lista). */
  r.post('/paradas/:id/reabrir', async (req, res) => {
    const p = await paradaDoPedido(deps, req);
    if (p.situacao !== 'pulada') throw AppError.conflito('Só dá para voltar uma visita pulada.');
    await repo.mudarSituacao(pool, p.id, 'pendente');
    res.status(204).end();
  });

  /** Foto da fachada (o celular manda já reduzida, em JPEG). */
  r.post(
    '/paradas/:id/foto',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: LIMITE_FOTO }),
    async (req, res) => {
      const p = await paradaDoPedido(deps, req);
      const arm = deps.reunioes?.armazenamento;
      if (!arm)
        throw new AppError(
          503,
          'indisponivel',
          'O armazenamento de arquivos não está ligado: a foto não pode ser guardada.',
        );
      if (!Buffer.isBuffer(req.body) || req.body.byteLength < 500) throw AppError.invalido('Envie a foto.');
      const tipo = req.get('content-type') ?? 'image/jpeg';
      const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg';
      const chave = `rua/${conta()}/${p.id}-${Date.now()}.${ext}`;
      await arm.enviar(chave, new Uint8Array(req.body), tipo);
      await repo.definirFoto(pool, p.id, chave);
      if (p.fotoChave) await arm.apagar([p.fotoChave]).catch(() => undefined);
      res.status(201).json({ ok: true });
    },
  );

  r.get('/paradas/:id/foto', async (req, res) => {
    const p = await paradaDoPedido(deps, req);
    const arm = deps.reunioes?.armazenamento;
    if (!p.fotoChave || !arm) throw AppError.naoEncontrado('Foto');
    res.json({ url: await arm.urlAssinada(p.fotoChave, { segundos: 3600 }) });
  });

  /** Visitas da equipe (o administrador vê todo mundo; os outros, só as próprias). */
  r.get('/equipe', async (req, res) => {
    const { periodo } = consulta(
      req,
      z.object({ periodo: z.enum(['hoje', 'semana', 'mes']).default('hoje') }),
    );
    res.json(await repo.equipe(pool, periodo, ehAdmin() ? null : usuarioAtual()!.id));
  });

  return r;
}
