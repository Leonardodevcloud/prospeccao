import type { Executor, Pool } from '@prospeccao/db';
import { IDENTIDADE_MENU, type SessaoMenu } from '@prospeccao/integrations/telefonia';
import {
  type Logger,
  TEXTO_OPCAO_INVALIDA,
  type TelefoniaConfigEntrada,
  textoChamandoGrupo,
  textoDoMenu,
} from '@prospeccao/shared';
import type { DepsTelefonia } from './servico.js';

/**
 * Menu de voz das recebidas: "Para a loja Centro, digite 1…". Quem ligou escolhe e toca só para
 * quem é daquele grupo (o dono do lead primeiro, se ele for do grupo). Sem tecla depois de duas
 * vezes, tecla errada duas vezes ou o menu falhou: toca para todo mundo, como sem menu.
 */

export interface GrupoMenu {
  id: number;
  nome: string;
}

/** Quanto espera a tecla depois de terminar de falar as opções. */
export const ESPERA_TECLA_MS = 6_000;
const VEZES = 2;

const falados = new Map<string, Promise<Uint8Array>>();

/** O áudio de uma frase (a mesma frase vem do cache). */
function falado(deps: DepsTelefonia, texto: string): Promise<Uint8Array> {
  let a = falados.get(texto);
  if (!a) {
    if (falados.size > 200) falados.clear();
    a = deps.fala!.falar(texto, { voz: 'marin', velocidade: 1.05 });
    a.catch(() => falados.delete(texto));
    falados.set(texto, a);
  }
  return a;
}

/** Saiu do menu: começa a tocar no CRM (para o grupo escolhido ou, sem grupo, para todos). */
export async function liberar(
  db: Executor,
  id: number,
  grupo: GrupoMenu | null,
  toqueDono: number,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE comercial.ligacoes l
        SET situacao = 'tocando', grupo_id = $2, tocando_desde = now(),
            time_desde = now() + make_interval(secs => CASE
              WHEN l.dono_id IS NOT NULL AND ($2::int IS NULL OR EXISTS (
                SELECT 1 FROM cadastro.grupo_membros m WHERE m.grupo_id = $2 AND m.usuario_id = l.dono_id))
              THEN $3::int ELSE 0 END)
      WHERE l.id = $1 AND l.situacao = 'menu'`,
    [id, grupo?.id ?? null, toqueDono],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Conduz o menu na sala (roda solto: a ligação já está gravada como "menu"). */
export async function conduzirMenu(
  pool: Pool,
  deps: DepsTelefonia,
  log: Logger,
  p: { id: number; sala: string; chamador: string; grupos: GrupoMenu[]; cfg: TelefoniaConfigEntrada },
): Promise<void> {
  const { servico, menu } = deps;
  if (!servico || !menu || !deps.fala) {
    await liberar(pool, p.id, null, p.cfg.toqueDono);
    return;
  }
  let sessao: SessaoMenu | null = null;
  let liberou = false;
  try {
    const [opcoes, invalida] = await Promise.all([
      falado(deps, textoDoMenu(p.cfg.menuSaudacao, p.grupos)),
      falado(deps, TEXTO_OPCAO_INVALIDA),
    ]);
    sessao = await menu.entrar({
      url: servico.urlCliente,
      token: await servico.acesso({ sala: p.sala, identidade: IDENTIDADE_MENU, nome: 'Menu' }),
      chamador: p.chamador,
    });
    let grupo: GrupoMenu | null = null;
    for (let vez = 0; vez < VEZES && !grupo; vez++) {
      const r = await sessao.perguntar(opcoes, ESPERA_TECLA_MS);
      // Desligou no menu: o aviso do LiveKit ("saiu") encerra como perdida.
      if ('desligou' in r) return;
      if ('tecla' in r) {
        grupo = /^[1-9]$/.test(r.tecla) ? (p.grupos[Number(r.tecla) - 1] ?? null) : null;
        if (!grupo && (await sessao.falar(invalida)) === 'desligou') return;
      }
    }
    liberou = await liberar(pool, p.id, grupo, p.cfg.toqueDono);
    if (!liberou) return;
    if ((await sessao.falar(await falado(deps, textoChamandoGrupo(grupo?.nome ?? null)))) === 'desligou')
      return;
    // Tom de chamada até alguém atender (o siga-me e a perdida vêm da rodada das recebidas).
    await sessao.chamar((p.cfg.toqueEntrada + 40) * 1000);
  } catch (e) {
    log.warn({ err: e, ligacao: p.id }, 'ligações: menu de voz falhou, tocando para todos');
    if (!liberou) await liberar(pool, p.id, null, p.cfg.toqueDono).catch(() => undefined);
  } finally {
    await sessao?.sair().catch(() => undefined);
  }
}
