import type { Pool } from '@prospeccao/db';
import { type Logger, montarEmail } from '@prospeccao/shared';
import type { ResolverServicos } from '../../servicos.js';

/**
 * E-mails da plataforma para quem está testando ou assinou (confirmar o cadastro, fim do teste,
 * pagamento): saem pelo Resend da conta principal, com a marca do Prospect Team.
 */

export interface DepsEmailSistema {
  pool: Pool;
  log: Logger;
  servicos: ResolverServicos;
}

export async function mandarEmailSistema(
  deps: DepsEmailSistema,
  e: { para: string; nome: string; empresa: string; assunto: string; corpo: string; chave: string },
): Promise<boolean> {
  const { rows } = await deps.pool.query<{ id: number }>('SELECT id FROM cadastro.contas WHERE principal');
  const principal = rows[0];
  if (!principal) return false;
  const { email } = await deps.servicos(principal.id);
  if (!email) return false;
  const m = montarEmail(
    { assunto: e.assunto, corpo: e.corpo },
    { nome: e.nome.trim().split(/\s+/)[0] ?? '', empresa: e.empresa },
    {
      marca: {
        nome: 'Prospect Team',
        estilo: 'cartao',
        corPrimaria: '#0b6b63',
        corFundo: '#f4f4f5',
        corTexto: '#1f2933',
        corCabecalho: '#ffffff',
      },
    },
  );
  try {
    await email.enviar({
      de: { nome: 'Prospect Team', email: email.remetente },
      para: e.para,
      assunto: m.assunto,
      html: m.html,
      texto: m.texto,
      chave: e.chave,
    });
    return true;
  } catch (erro) {
    deps.log.error({ err: erro, para: e.para }, 'assinatura: o e-mail não saiu');
    return false;
  }
}
