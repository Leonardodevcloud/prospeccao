import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, ErroApi } from '../api';
import { useAgentePendente } from '../paginas/Agente';
import { temAtividade, useAtividade } from '../paginas/Atividade';
import { useFollowupsPendentes } from '../paginas/Funil';

const ITENS = [
  { para: '/', rotulo: 'Leads', icone: 'users', fim: true },
  { para: '/funil', rotulo: 'Funil', icone: 'kanban' },
  { para: '/agente', rotulo: 'Agente', icone: 'bot' },
  { para: '/relatorios', rotulo: 'Relatórios', icone: 'trending-up' },
  { para: '/campanhas', rotulo: 'Campanhas', icone: 'layers' },
  { para: '/atividade', rotulo: 'Atividade', icone: 'clock' },
  { para: '/nichos', rotulo: 'Nichos', icone: 'store' },
  { para: '/base-cnpj', rotulo: 'Base CNPJ', icone: 'landmark' },
];

/** Estrutura das telas logadas: navegação + conteúdo. Sem sessão, manda para o login. */
export function Shell() {
  const local = useLocation();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const sessao = useQuery({ queryKey: ['sessao'], queryFn: () => api<{ email: string }>('/auth/eu') });
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
        {ITENS.map((i) => (
          <NavLink key={i.para} to={i.para} end={i.fim} className="nav__link">
            <Icon name={i.icone} size={16} />
            {i.rotulo}
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
          <span className="nav__usuario" title={sessao.data?.email}>
            {sessao.data?.email}
          </span>
          <Button variant="ghost" size="sm" icon="arrow-right" onClick={() => sair.mutate()}>
            Sair
          </Button>
        </div>
      </nav>
      <main className="conteudo">
        <Outlet />
      </main>
    </div>
  );
}
