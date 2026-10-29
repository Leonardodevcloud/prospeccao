import {
  AppError,
  type ConfigVozDTO,
  conversaAtualizar,
  dividirFala,
  perguntaAssistente,
  type RespostaAssistenteDTO,
  textoParaFalar,
  vozAssistente,
} from '@prospeccao/shared';
import express, { type Request, Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { agenteArgos } from './agente.js';
import * as conversas from './conversas.js';
import { montarMapa } from './mapa.js';
import {
  type ConfigVoz,
  falaEmCurso,
  gerarFala,
  LIMITE_AUDIO_BYTES,
  type ProvedorFala,
  type ProvedorTranscricao,
  prepararFala,
  VOZES_FALA,
} from './voz.js';

/** O que o Argos precisa além do resto da api (montado em main.ts; sem isso, ele explica o que falta). */
export interface DepsAssistente {
  /** Papel só leitura no banco (null: não foi possível criar; o Argos responde sem dados). */
  leitura: import('@prospeccao/db').Pool | null;
  chave: string | null;
  voz: ProvedorTranscricao | null;
  fala: ProvedorFala | null;
  raciocinio: 'desligado' | 'baixo' | 'alto';
  /** Por que os dados não estão ligados (para o log e para o master). */
  erro: string | null;
}

const VOZ_PADRAO: ConfigVoz = { voz: 'marin', velocidade: 1.12 };
let vozGuardada: { em: number; cfg: ConfigVoz } | null = null;

/** Telas que o Argos pode abrir. */
const TELAS: Record<string, { destino: string; rotulo: string }> = {
  hoje: { destino: '/hoje', rotulo: 'Meu dia' },
  campanhas: { destino: '/campanhas', rotulo: 'Campanhas' },
  leads: { destino: '/', rotulo: 'Leads' },
  funil: { destino: '/funil', rotulo: 'Funil' },
  conversas: { destino: '/conversas', rotulo: 'Conversas' },
  email: { destino: '/email', rotulo: 'E-mail' },
  relatorios: { destino: '/relatorios', rotulo: 'Relatórios' },
  equipe: { destino: '/equipe', rotulo: 'Equipe' },
  plano: { destino: '/plano', rotulo: 'Meu plano' },
  organizacao: { destino: '/organizacao', rotulo: 'Painel da organização' },
  plataforma: { destino: '/plataforma', rotulo: 'Painel da plataforma' },
  mapa: { destino: '/argos/mapa', rotulo: 'Mapa do conhecimento' },
  argos: { destino: '/argos', rotulo: 'Argos' },
};

export function rotasAssistente(deps: DepsApi): Router {
  const r = Router();
  const a = deps.assistente ?? null;
  const { pool, log } = deps;

  async function configVoz(): Promise<ConfigVoz> {
    if (vozGuardada && Date.now() - vozGuardada.em < 30_000) return vozGuardada.cfg;
    const { rows } = await pool.query<{ valor: string }>(
      `SELECT valor FROM cadastro.plataforma WHERE chave = 'argos_voz'`,
    );
    let cfg = VOZ_PADRAO;
    try {
      const v = rows[0] ? (JSON.parse(rows[0].valor) as Partial<ConfigVoz>) : {};
      cfg = {
        voz: (VOZES_FALA as readonly string[]).includes(String(v.voz)) ? String(v.voz) : VOZ_PADRAO.voz,
        velocidade: typeof v.velocidade === 'number' ? v.velocidade : VOZ_PADRAO.velocidade,
      };
    } catch {
      /* valor estragado: fica o padrão */
    }
    vozGuardada = { em: Date.now(), cfg };
    return cfg;
  }

  const exigirFala = () => {
    if (!a?.fala)
      throw new AppError(503, 'indisponivel', 'A voz do servidor não está ligada (falta OPENAI_CHAVE).');
    return a.fala;
  };

  r.post('/', async (req, res) => {
    const { texto, historico: doNavegador, falar, conversaId, via } = corpo(req, perguntaAssistente);
    const u = req.usuario!;
    // Conversa guardada: o contexto vem do histórico dela (e confere que é da própria pessoa).
    const historico = conversaId ? await conversas.historico(pool, u.id, conversaId) : doNavegador;
    const servicos = await deps.servicos(u.contaId);
    if (!servicos.assistente)
      throw new AppError(
        503,
        'indisponivel',
        'O Argos precisa da IA ligada nesta conta. Peça ao administrador da plataforma para configurar a IA.',
      );
    const resposta = await agenteArgos(
      {
        pool,
        leitura: a?.leitura ?? null,
        chave: a?.chave ?? null,
        conversar: servicos.assistente,
        raciocinio: a?.raciocinio ?? 'desligado',
        log,
      },
      u,
      texto,
      historico,
    );
    let acao: RespostaAssistenteDTO['acao'] = null;
    if (resposta.abrir) {
      const [tipo, alvo] = resposta.abrir.includes(':')
        ? (resposta.abrir.split(':', 2) as [string, string])
        : [null, resposta.abrir];
      const tela = tipo ? undefined : TELAS[alvo.toLowerCase()];
      if (tela) acao = { ...tela, automatica: true };
      else if (tipo === 'empresa' && /^\d+$/.test(alvo))
        acao = { destino: `/funil?empresa=${alvo}`, rotulo: 'Abrir a ficha', automatica: true };
    }
    if (!acao && resposta.tarefa) acao = { destino: '/hoje', rotulo: 'Ver no Meu dia', automatica: false };
    const saida: RespostaAssistenteDTO = {
      texto,
      fala: resposta.fala,
      detalhe: resposta.dados ? null : resposta.analise,
      acao,
      dados: resposta.dados,
      aguardaResposta: resposta.confirmar,
      tempos: resposta.tempos,
    };
    // Guarda no histórico da pessoa (falhar aqui não tira a resposta dela).
    saida.conversaId = await conversas
      .guardar(pool, {
        usuarioId: u.id,
        contaId: u.contaId,
        conversaId: conversaId ?? null,
        pergunta: texto,
        resposta: saida,
        via,
      })
      .catch((erro: Error) => {
        log.warn({ erro: erro.message }, 'argos: não consegui guardar a conversa');
        return conversaId ?? null;
      });
    // A interface vai falar: já começa a gerar a voz do 1º trecho.
    const primeiro = falar && a?.fala ? dividirFala(resposta.fala)[0] : null;
    if (primeiro && a?.fala) {
      const id = prepararFala(a.fala, primeiro, await configVoz(), u.id, (erro) =>
        log.warn({ erro: erro.message }, 'argos: falha ao gerar a voz'),
      );
      saida.voz = { id, texto: primeiro };
    }
    res.json(saida);
  });

  /* ───────────── Histórico (só a própria pessoa) ───────────── */

  r.get('/conversas', async (req, res) => {
    const busca = typeof req.query.busca === 'string' ? req.query.busca : null;
    res.json(await conversas.listar(pool, req.usuario!.id, busca));
  });

  r.get('/conversas/:id', async (req, res) => {
    res.json(await conversas.abrir(pool, req.usuario!.id, idDaRota(req)));
  });

  r.patch('/conversas/:id', async (req, res) => {
    const { titulo } = corpo(req, conversaAtualizar);
    await conversas.renomear(pool, req.usuario!.id, idDaRota(req), titulo);
    res.status(204).end();
  });

  r.delete('/conversas/:id', async (req, res) => {
    await conversas.apagar(pool, req.usuario!.id, idDaRota(req));
    res.status(204).end();
  });

  /* ───────────── Mapa do conhecimento (mesmo escopo das respostas) ───────────── */

  r.get('/mapa', async (req, res) => {
    if (!a?.leitura || !a.chave)
      throw new AppError(
        503,
        'indisponivel',
        'O mapa precisa do acesso aos dados do Argos, que não está ligado agora.',
      );
    const unidade = Number(req.query.unidade);
    res.json(
      await montarMapa(
        pool,
        a.leitura,
        a.chave,
        req.usuario!,
        Number.isInteger(unidade) && unidade > 0 ? unidade : null,
      ),
    );
  });

  r.post(
    '/transcrever',
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: LIMITE_AUDIO_BYTES }),
    async (req, res) => {
      if (!a?.voz)
        throw new AppError(
          503,
          'indisponivel',
          'A voz ainda não está ligada (falta GROQ_CHAVE). Enquanto isso, digite.',
        );
      if (!Buffer.isBuffer(req.body)) throw AppError.invalido('Envie o áudio gravado.');
      const audio = new Uint8Array(req.body);
      if (audio.byteLength < 1200) throw AppError.invalido('O áudio ficou curto demais. Fale de novo.');
      try {
        res.json({ texto: (await a.voz.transcrever(audio, req.get('content-type') ?? 'audio/webm')).trim() });
      } catch (erro) {
        log.warn({ erro: (erro as Error).message }, 'argos: falha na transcrição');
        throw new AppError(503, 'indisponivel', 'Não consegui entender o áudio agora. Tente de novo.');
      }
    },
  );

  r.get('/voz', async (_req, res) => {
    const cfg = await configVoz();
    const dto: ConfigVozDTO = {
      disponivel: !!a?.fala,
      ouvir: !!a?.voz,
      dados: !!a?.leitura,
      voz: cfg.voz,
      velocidade: cfg.velocidade,
      vozes: VOZES_FALA,
    };
    res.json(dto);
  });

  r.put('/voz', async (req, res) => {
    if (!req.usuario?.master)
      throw new AppError(403, 'proibido', 'Só o administrador da plataforma escolhe a voz.');
    const d = corpo(req, vozAssistente);
    if (!(VOZES_FALA as readonly string[]).includes(d.voz)) throw AppError.invalido('Essa voz não existe.');
    const velocidade = Math.min(1.5, Math.max(0.8, Math.round(d.velocidade * 100) / 100));
    await pool.query(
      `INSERT INTO cadastro.plataforma (chave, valor) VALUES ('argos_voz', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [JSON.stringify({ voz: d.voz, velocidade })],
    );
    vozGuardada = null;
    res.json({ voz: d.voz, velocidade });
  });

  // Áudio inteiro (amostra da voz e reserva do iPhone).
  r.post('/falar', async (req, res) => {
    const fala = exigirFala();
    const d = corpo(
      req,
      textoParaFalar.extend({
        voz: z.string().max(30).optional(),
        velocidade: z.number().min(0.8).max(1.5).optional(),
      }),
    );
    const base = await configVoz();
    // Ouvir outra voz antes de escolher é coisa do master.
    const teste = req.usuario?.master && (d.voz || d.velocidade);
    const cfg = teste
      ? {
          voz: (VOZES_FALA as readonly string[]).includes(d.voz ?? '') ? d.voz! : base.voz,
          velocidade: d.velocidade ?? base.velocidade,
        }
      : base;
    try {
      const audio = await gerarFala(fala, d.texto, cfg);
      res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600' });
      res.send(Buffer.from(audio));
    } catch (erro) {
      log.warn({ erro: (erro as Error).message }, 'argos: falha ao gerar a voz');
      throw new AppError(503, 'indisponivel', 'Não consegui gerar a voz agora.');
    }
  });

  // Começa a gerar e devolve o id; o áudio sai em fluxo em GET /assistente/falar/:id.
  r.post('/falar/preparar', async (req, res) => {
    const fala = exigirFala();
    const { texto } = corpo(req, textoParaFalar);
    const id = prepararFala(fala, texto, await configVoz(), req.usuario!.id, (erro) =>
      log.warn({ erro: erro.message }, 'argos: falha ao gerar a voz'),
    );
    res.json({ id });
  });

  // O áudio de uma fala preparada, entregue enquanto é gerado (só para quem pediu).
  r.get('/falar/:id', (req: Request, res) => {
    const id = String(req.params.id ?? '');
    const f = /^[0-9a-f-]{36}$/.test(id) ? falaEmCurso(id) : null;
    if (!f || f.usuarioId !== req.usuario?.id) throw AppError.naoEncontrado('Essa fala');
    if (f.falhou && !f.pedacos.length)
      throw new AppError(503, 'indisponivel', 'Não consegui gerar a voz agora.');
    res
      .status(200)
      .set({ 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    res.flushHeaders();
    let enviados = 0;
    const enviar = () => {
      while (enviados < f.pedacos.length) res.write(Buffer.from(f.pedacos[enviados++]!));
      if (f.terminou) {
        f.avisar.delete(enviar);
        res.end();
      }
    };
    f.avisar.add(enviar);
    req.on('close', () => f.avisar.delete(enviar));
    enviar();
  });

  return r;
}
