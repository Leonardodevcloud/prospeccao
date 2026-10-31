import { DIAS_AVISO_VENCIMENTO, DIAS_GUARDA_ARQUIVADA, DIAS_TESTE } from '@prospeccao/shared/assinatura';
import { Button, Icon } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { fmtNumero } from '../formatar';
import type { ResumoAssinatura } from '../paginas/Assinar';
import { Modal } from './Drawer';
import { useEhAdmin, useSessao } from './Sessao';

/** WhatsApp do time do Prospect Team (dúvidas sobre o teste e a assinatura). */
export const WHATSAPP_PROSPECT = 'https://wa.me/5571993635290';

const DIA = 86_400_000;
const diasAte = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DIA));
const diaMes = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Bahia' });
const diaSemana = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Bahia' }).replace('.', '');

/**
 * A faixa do topo: dias e leads do teste; para o administrador, quantos dias faltam para o plano
 * vencer (7 dias antes); venceu (3 dias normais); só leitura; renovação desligada. Em dia, nada.
 */
export function FaixaAssinatura() {
  const s = useSessao().data;
  const admin = useEhAdmin();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const a = s?.assinatura;
  if (!s || !a || s.master || s.foraDaPropria || a.situacao === 'arquivada') return null;
  const naTela = pathname.startsWith('/plano/');
  const botao = (rotulo: string, para: string) =>
    admin && !naTela ? (
      <Button size="sm" className="faixa-assinatura__botao" onClick={() => navegar(para)}>
        {rotulo}
      </Button>
    ) : null;

  if (a.situacao === 'teste') {
    const dias = a.testeAte ? diasAte(a.testeAte) : 0;
    const pct = a.leadsLimite ? Math.min(100, Math.round((a.leadsUsados / a.leadsLimite) * 100)) : 0;
    return (
      <div className="faixa-assinatura" data-tom={dias <= 1 ? 'urgente' : undefined} role="status">
        <span className="faixa-assinatura__texto">
          <b>Teste grátis</b> ·{' '}
          {dias === 0 ? (
            <b>termina hoje</b>
          ) : (
            <>
              faltam <b>{dias === 1 ? '1 dia' : `${dias} dias`}</b>
            </>
          )}
          {a.testeAte ? ` (até ${diaSemana(a.testeAte)}, ${diaMes(a.testeAte)})` : ''}
        </span>
        {a.leadsLimite != null && (
          <span className="faixa-assinatura__leads">
            {fmtNumero(a.leadsUsados)} de {fmtNumero(a.leadsLimite)} leads
            <span className="faixa-assinatura__barra" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          </span>
        )}
        {a.esperandoPagamento ? (
          <>
            <span className="faixa-assinatura__texto">Assinatura esperando o pagamento.</span>
            {botao('Pagar', '/plano/pagar')}
          </>
        ) : (
          botao('Assinar', '/plano/assinar')
        )}
      </div>
    );
  }
  if (a.situacao === 'ativa') {
    // Só para o administrador, nos 7 dias antes de vencer.
    if (!admin || !a.renovar || !a.acessoAte) return null;
    const dias = diasAte(a.acessoAte);
    if (dias > DIAS_AVISO_VENCIMENTO) return null;
    return (
      <div className="faixa-assinatura" data-tom={dias <= 1 ? 'urgente' : 'aviso'} role="status">
        <Icon name="clock" size={16} />
        <span className="faixa-assinatura__texto">
          <b>
            {dias === 0
              ? 'O plano vence hoje'
              : dias === 1
                ? 'O plano vence amanhã'
                : `O plano vence em ${dias} dias`}
          </b>{' '}
          ({diaSemana(a.acessoAte)}, {diaMes(a.acessoAte)}).{' '}
          {a.esperandoPagamento
            ? 'A mensalidade seguinte já está disponível: com Pix, libera na hora.'
            : 'A mensalidade seguinte aparece em instantes em Meu plano.'}
        </span>
        {botao('Pagar agora', '/plano/pagar')}
      </div>
    );
  }
  if (a.situacao === 'atrasada')
    return (
      <div className="faixa-assinatura" data-tom="urgente" role="status">
        <Icon name="clock" size={16} />
        <span className="faixa-assinatura__texto">
          <b>O plano venceu{a.acessoAte ? ` em ${diaMes(a.acessoAte)}` : ''}.</b>{' '}
          {a.toleranciaAte
            ? `Tudo continua funcionando até ${diaMes(a.toleranciaAte)}; depois, a conta fica só leitura até o pagamento.`
            : 'Pague para a conta não ficar só leitura.'}
          {!admin ? ' Avise quem administra a conta.' : ''}
        </span>
        {botao('Pagar agora', '/plano/pagar')}
      </div>
    );
  if (a.situacao === 'cancelada')
    return admin ? (
      <div className="faixa-assinatura" data-tom="aviso" role="status">
        <span className="faixa-assinatura__texto">
          <b>Renovação desligada.</b>
          {a.acessoAte ? ` O plano vale até ${diaMes(a.acessoAte)}; depois, a conta fica só leitura.` : ''}
        </span>
        {botao('Voltar a renovar', '/plano')}
      </div>
    ) : null;
  // Só leitura: o teste acabou sem assinar, ou o mês pago venceu sem pagamento.
  return (
    <div className="faixa-assinatura" data-tom="leitura" role="status">
      <Icon name="lock" size={16} />
      <span className="faixa-assinatura__texto">
        {a.jaPagou ? (
          <>
            <b>Conta só leitura: o plano venceu{a.acessoAte ? ` em ${diaMes(a.acessoAte)}` : ''}.</b> Vocês
            veem e exportam os leads e os contatos, mas não dá para mexer. Pagando, volta na hora.
          </>
        ) : (
          <>
            <b>O teste acabou.</b> Você vê tudo, mas não dá para mexer.
            {a.soLeituraAte ? ` Assine até ${diaMes(a.soLeituraAte)} para continuar de onde parou.` : ''}
          </>
        )}
        {!admin ? ' Fale com quem administra a conta.' : ''}
      </span>
      {a.esperandoPagamento ? botao('Pagar', '/plano/pagar') : botao('Assinar', '/plano/assinar')}
    </div>
  );
}

const CHAVE_VISTO = 'pt-fim-teste-visto';

/** O teste acabou sem assinar: o resumo do que a empresa fez e o convite para assinar (uma vez por dia). */
export function FimDoTeste() {
  const s = useSessao().data;
  const admin = useEhAdmin();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const a = s?.assinatura;
  const hoje = new Date().toISOString().slice(0, 10);
  const chave = `${CHAVE_VISTO}-${s?.conta.id ?? 0}`;
  const [visto, setVisto] = useState(() => {
    try {
      return localStorage.getItem(chave) === hoje;
    } catch {
      return false;
    }
  });
  const aberto =
    !!s &&
    !!a &&
    a.situacao === 'so_leitura' &&
    !a.jaPagou &&
    !s.master &&
    !s.foraDaPropria &&
    s.termos.aceitos &&
    !visto &&
    !pathname.startsWith('/plano/');
  const resumo = useQuery({
    queryKey: ['assinatura'],
    queryFn: () => api<ResumoAssinatura>('/assinatura'),
    enabled: aberto,
  });
  if (!aberto) return null;
  const fechar = () => {
    try {
      localStorage.setItem(chave, hoje);
    } catch {
      /* sem guardar: aparece de novo na próxima vez */
    }
    setVisto(true);
  };
  const f = resumo.data?.feito;
  return (
    <Modal
      titulo={`Os ${DIAS_TESTE} dias de teste acabaram`}
      aoFechar={fechar}
      rodape={
        <>
          <Button variant="ghost" onClick={fechar}>
            Só olhar
          </Button>
          <Button href={WHATSAPP_PROSPECT} target="_blank" rel="noopener noreferrer">
            Falar com a gente
          </Button>
          {admin && (
            <Button
              variant="primary"
              onClick={() => {
                fechar();
                navegar('/plano/assinar');
              }}
            >
              Assinar agora
            </Button>
          )}
        </>
      }
    >
      <div className="pilha" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>
          {f ? (
            <>
              Em {DIAS_TESTE} dias, a {s.conta.nome} encontrou <b>{fmtNumero(f.leads)} leads</b>, levou{' '}
              <b>{fmtNumero(f.funil)}</b> para o funil e marcou{' '}
              <b>{f.reunioes === 1 ? '1 reunião' : `${fmtNumero(f.reunioes)} reuniões`}</b>.{' '}
            </>
          ) : null}
          Assinando, tudo continua aqui, do jeito que está.
          {!admin && ' Quem administra a conta pode assinar em Meu plano.'}
        </p>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Sem assinar, a conta fica só para leitura
          {a.soLeituraAte ? ` até ${diaMes(a.soLeituraAte)}` : ''} e depois é arquivada (os dados ficam
          guardados por {DIAS_GUARDA_ARQUIVADA} dias).
        </p>
      </div>
    </Modal>
  );
}
