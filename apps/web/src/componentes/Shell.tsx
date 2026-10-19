import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, ErroApi, ROTULO_PAPEL_USUARIO } from '../api';
import { useAgentePendente } from '../paginas/Agente';
import { temAtividade, useAtividade } from '../paginas/Atividade';
import { useFollowupsPendentes } from '../paginas/Funil';
import { useMeuDiaResumo } from '../paginas/MeuDia';
import { BotaoAvisos, PainelAvisos, useAvisos, useAvisosNoNavegador } from './Avisos';
import { MinhaConta } from './MinhaConta';
import { Dono, useSessao } from './Sessao';

/** Itens do menu; "admin" só aparece para o administrador. */
const ITENS: { para: string; rotulo: string; icone: string; fim?: boolean; admin?: boolean }[] = [
  { para: '/hoje', rotulo: 'Meu dia', icone: 'calendar' },
  { para: '/conversas', rotulo: 'Conversas', icone: 'message-circle' },
  { para: '/funil', rotulo: 'Funil', icone: 'kanban' },
  { para: '/', rotulo: 'Leads', icone: 'users', fim: true },
  { para: '/agente', rotulo: 'Agente', icone: 'bot' },
  { para: '/relatorios', rotulo: 'Relatórios', icone: 'trending-up' },
  { para: '/equipe', rotulo: 'Equipe', icone: 'id-card' },
  { para: '/campanhas', rotulo: 'Campanhas', icone: 'layers' },
  { para: '/atividade', rotulo: 'Atividade', icone: 'clock', admin: true },
  { para: '/nichos', rotulo: 'Nichos', icone: 'store', admin: true },
  { para: '/base-cnpj', rotulo: 'Base CNPJ', icone: 'landmark', admin: true },
];

/** Conversas com mensagem não lida (para o menu). */
function useConversasNaoLidas() {
  return useQuery({
    queryKey: ['conversas', 'resumo'],
    queryFn: () => api<{ naoLidas: number }>('/conversas/resumo'),
    refetchInterval: 15_000,
  });
}

/** Estrutura das telas logadas: navegação + conteúdo. Sem sessão, manda para o login. */
export function Shell() {
  const local = useLocation();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const sessao = useSessao();
  const [conta, setConta] = useState(false);
  const [avisosAbertos, setAvisosAbertos] = useState(false);
  const avisos = useAvisos();
  useAvisosNoNavegador(avisos.data?.itens, avisos.data?.naoLidas ?? 0);
  const naoLidas = useConversasNaoLidas().data?.naoLidas ?? 0;
  const doDia = useMeuDiaResumo().data ?? 0;
  // Ponto pulsando em "Atividade" enquanto o motor trabalha, em qualquer tela.
  const ativo = temAtividade(useAtividade(60_000).data);
  const pendentes = useFollowupsPendentes().data?.pendentes ?? 0;
  const doAgente = useAgentePendente().data ?? 0;
  const sair = useMutation({
    mutationFn: () => api('/auth/logout', { metodo: 'POST' }),
    onSettled: () => {
      cliente.clear();
      navegar('/login');
    },
  });

  if (sessao.error instanceof ErroApi && sessao.error.status === 401) {
    return <Navigate to={`/login?voltar=${encodeURIComponent(local.pathname + local.search)}`} replace />;
  }
  if (sessao.isPending) return null;

  return (
    <div className="app">
      <nav className="nav" aria-label="Navegação principal">
        <div className="nav__marca">
          <span className="nav__logo" aria-hidden="true">
            P
          </span>
          Prospecção
        </div>
        {ITENS.filter((i) => !i.admin || sessao.data?.papel === 'admin').map((i) => (
          <NavLink key={i.para} to={i.para} end={i.fim} className="nav__link">
            <Icon name={i.icone} size={16} />
            {i.rotulo}
            {i.para === '/hoje' && doDia > 0 && (
              <span className="nav__conta" title="Tarefas e follow-ups atrasados ou para hoje">
                {doDia}
              </span>
            )}
            {i.para === '/conversas' && naoLidas > 0 && (
              <span className="nav__conta nav__conta--marca" title="Conversas com mensagem não lida">
                {naoLidas}
              </span>
            )}
            {i.para === '/funil' && pendentes > 0 && (
              <span className="nav__conta" title="Follow-ups vencidos ou para hoje">
                {pendentes}
              </span>
            )}
            {i.para === '/agente' && doAgente > 0 && (
              <span className="nav__conta" title="Mensagens para revisar e leads que a IA passou para você">
                {doAgente}
              </span>
            )}
            {i.para === '/atividade' && ativo && (
              <span className="vivo nav__vivo" role="img" aria-label="trabalhando agora" />
            )}
          </NavLink>
        ))}
        <div className="nav__rodape">
          <div className="nav__eu">
            <button
              type="button"
              className="nav__conta-botao"
              onClick={() => setConta(true)}
              title="Minha conta"
            >
              <Dono id={sessao.data?.id ?? null} nome={sessao.data?.nome ?? null} tamanho={28} rotulo="" />
              <span className="nav__eu-texto">
                <b>{sessao.data?.nome}</b>
                <span>{sessao.data ? ROTULO_PAPEL_USUARIO[sessao.data.papel] : ''}</span>
              </span>
            </button>
            <BotaoAvisos naoLidas={avisos.data?.naoLidas ?? 0} aoAbrir={() => setAvisosAbertos(true)} />
          </div>
          <Button variant="ghost" size="sm" icon="log-out" onClick={() => sair.mutate()}>
            Sair
          </Button>
        </div>
      </nav>
      <main className="conteudo">
        <Outlet />
      </main>
      {conta && <MinhaConta aoFechar={() => setConta(false)} />}
      {avisosAbertos && <PainelAvisos aoFechar={() => setAvisosAbertos(false)} />}
    </div>
  );
}
