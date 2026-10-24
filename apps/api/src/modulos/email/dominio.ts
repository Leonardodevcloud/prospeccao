import type { Executor } from '@prospeccao/db';
import {
  apagarDominio,
  criarDominio,
  type DominioResend,
  lerDominio,
  type RegistroDns,
  registroDmarc,
  verificarDominio,
} from '@prospeccao/integrations/email';
import { AppError } from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import { conta, contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';

/**
 * Domínio de e-mail do cliente, sem depender do suporte: a conta do Resend é da plataforma; o
 * cliente cadastra o domínio dele, copia os registros para o DNS, confere e escolhe o remetente.
 */

/** Operações de domínio no Resend da plataforma (os testes trocam por um simulado). */
export interface ServicoDominios {
  criar(nome: string): Promise<DominioResend>;
  ler(id: string): Promise<DominioResend>;
  verificar(id: string): Promise<void>;
  apagar(id: string): Promise<void>;
}

export function servicoDominiosResend(apiKey: string | null | undefined): ServicoDominios | null {
  if (!apiKey) return null;
  const cfg = { apiKey };
  return {
    criar: (nome) => criarDominio(cfg, nome),
    ler: (id) => lerDominio(cfg, id),
    verificar: (id) => verificarDominio(cfg, id),
    apagar: (id) => apagarDominio(cfg, id),
  };
}

/** Provedores de e-mail pessoal: não dá para cadastrar (o domínio não é do cliente). */
const PESSOAIS =
  /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|uol|bol|terra|ig|globo|globomail|zipmail|r7|protonmail|proton)\.(com|com\.br|me)(\.br)?$/;

export const dominioEntrada = z.object({
  dominio: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) =>
      d
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .replace(/^.*@/, ''),
    )
    .pipe(
      z
        .string()
        .max(200)
        .regex(
          /^(?=.{4,200}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/,
          'Informe só o domínio, como loja.com.br (sem http, sem www e sem e-mail).',
        )
        .refine(
          (d) => !PESSOAIS.test(d),
          'Use o domínio da sua empresa (Gmail, Hotmail e afins não servem).',
        ),
    ),
});

const remetenteEntrada = z.object({
  remetente: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
});

interface LinhaDominio {
  dominio: string;
  resend_id: string;
  situacao: 'pendente' | 'verificado' | 'falhou';
  registros: RegistroDns[];
  remetente: string | null;
  conferido_em: string | null;
  verificado_em: string | null;
}

async function ler(db: Executor): Promise<LinhaDominio | null> {
  const { rows } = await db.query<LinhaDominio>(
    `SELECT dominio, resend_id, situacao, registros, remetente, conferido_em, verificado_em
       FROM cadastro.dominios_email WHERE conta_id = ${contaSql()}`,
  );
  return rows[0] ?? null;
}

async function guardar(db: Executor, d: DominioResend): Promise<void> {
  await db.query(
    `UPDATE cadastro.dominios_email
        SET situacao = $1, registros = $2, conferido_em = now(),
            verificado_em = CASE WHEN $1 = 'verificado' THEN coalesce(verificado_em, now()) ELSE NULL END
      WHERE conta_id = ${contaSql()}`,
    [d.situacao, JSON.stringify(registrosParaTela(d))],
  );
}

/** Os registros do Resend mais o DMARC (recomendado), com os nomes como se digita no DNS. */
function registrosParaTela(d: DominioResend): RegistroDns[] {
  const lista = d.registros.map((r) => ({ ...r, nome: nomeRelativo(r.nome, d.nome) }));
  if (!lista.some((r) => r.nome === '_dmarc')) lista.push(registroDmarc(d.nome));
  return lista;
}

/** O Resend às vezes devolve o nome completo (send.loja.com.br); no painel do DNS vai só "send". */
function nomeRelativo(nome: string, dominio: string): string {
  const n = nome.replace(/\.$/, '');
  if (n === dominio) return '@';
  return n.endsWith(`.${dominio}`) ? n.slice(0, -dominio.length - 1) : n;
}

function paraTela(l: LinhaDominio | null) {
  if (!l) return null;
  return {
    dominio: l.dominio,
    situacao: l.situacao,
    registros: l.registros,
    remetente: l.remetente,
    conferidoEm: l.conferido_em,
    verificadoEm: l.verificado_em,
  };
}

export function rotasDominioEmail(deps: DepsApi): Router {
  const { pool, log, credenciais } = deps;
  const r = Router();
  const servico = () => deps.dominiosEmail ?? servicoDominiosResend(credenciais.ambiente.resendKey);

  /** O que a tela precisa: o domínio (se houver) e se a conta pode cadastrar um. */
  async function tela() {
    const s = await deps.servicos(conta());
    let linha = await ler(pool);
    const dominios = servico();
    // Enquanto não verificou, confere de novo no Resend (no máximo a cada minuto).
    if (
      linha &&
      dominios &&
      linha.situacao !== 'verificado' &&
      (!linha.conferido_em || Date.now() - new Date(linha.conferido_em).getTime() > 60_000)
    ) {
      try {
        await guardar(pool, await dominios.ler(linha.resend_id));
        linha = await ler(pool);
        if (linha?.situacao === 'verificado') credenciais.invalidar(conta());
      } catch (erro) {
        log.warn({ err: erro, conta: conta() }, 'e-mail: não consegui conferir o domínio no Resend');
      }
    }
    return {
      dominio: paraTela(linha),
      // Conta com o Resend próprio (cadastrado pelo master) não usa o domínio da plataforma.
      contaPropria: s.origem.resend === 'conta',
      disponivel: !!dominios,
      emUso: !!linha && linha.situacao === 'verificado' && !!linha.remetente && s.origem.resend !== 'conta',
    };
  }

  r.get('/', async (_req, res) => {
    res.json(await tela());
  });

  r.post('/', exigirAdmin, async (req, res) => {
    const { dominio } = corpo(req, dominioEntrada);
    const dominios = servico();
    if (!dominios)
      throw AppError.invalido(
        'O envio de e-mail não está disponível agora. Fale com o suporte do Prospect Team.',
      );
    if (await ler(pool)) throw AppError.conflito('Sua conta já tem um domínio. Remova o atual para trocar.');
    const { rows: outro } = await pool.query(
      `SELECT 1 FROM cadastro.dominios_email WHERE lower(dominio) = $1`,
      [dominio],
    );
    if (outro.length)
      throw AppError.conflito('Este domínio já está em uso em outra conta. Fale com o suporte.');
    let d: DominioResend;
    try {
      d = await dominios.criar(dominio);
    } catch (erro) {
      log.warn({ err: erro, dominio }, 'e-mail: Resend recusou o domínio');
      throw AppError.invalido(
        /already|exist|registered/i.test(String((erro as Error).message))
          ? 'Este domínio já está cadastrado em outro lugar. Fale com o suporte do Prospect Team.'
          : 'Não consegui cadastrar o domínio agora. Confira se ele está certo e tente de novo.',
      );
    }
    await pool.query(
      `INSERT INTO cadastro.dominios_email (conta_id, dominio, resend_id, situacao, registros, remetente, conferido_em)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, now())`,
      [d.nome, d.id, d.situacao, JSON.stringify(registrosParaTela(d)), `comercial@${d.nome}`],
    );
    res.status(201).json(await tela());
  });

  /** "Já configurei o DNS": pede ao Resend para conferir agora e devolve o que achou. */
  r.post('/verificar', exigirAdmin, async (_req, res) => {
    const linha = await ler(pool);
    const dominios = servico();
    if (!linha || !dominios) throw AppError.naoEncontrado('Domínio');
    try {
      await dominios.verificar(linha.resend_id);
    } catch (erro) {
      log.warn({ err: erro, conta: conta() }, 'e-mail: falha ao pedir a verificação do domínio');
    }
    await guardar(pool, await dominios.ler(linha.resend_id));
    credenciais.invalidar(conta());
    res.json(await tela());
  });

  r.put('/remetente', exigirAdmin, async (req, res) => {
    const { remetente } = corpo(req, remetenteEntrada);
    const linha = await ler(pool);
    if (!linha) throw AppError.naoEncontrado('Domínio');
    if (!remetente.endsWith(`@${linha.dominio}`))
      throw AppError.invalido(`O remetente precisa ser do seu domínio: algo@${linha.dominio}.`);
    await pool.query(`UPDATE cadastro.dominios_email SET remetente = $1 WHERE conta_id = ${contaSql()}`, [
      remetente,
    ]);
    credenciais.invalidar(conta());
    res.json(await tela());
  });

  r.delete('/', exigirAdmin, async (_req, res) => {
    const linha = await ler(pool);
    if (!linha) throw AppError.naoEncontrado('Domínio');
    await servico()
      ?.apagar(linha.resend_id)
      .catch((erro) =>
        log.warn({ err: erro, conta: conta() }, 'e-mail: não consegui apagar o domínio no Resend'),
      );
    await pool.query(`DELETE FROM cadastro.dominios_email WHERE conta_id = ${contaSql()}`);
    credenciais.invalidar(conta());
    res.json(await tela());
  });

  return r;
}
