import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { type Alerta, api, ErroApi, ROTULO_PAPEL_QUALQUER, ROTULO_PAPEL_USUARIO } from '../api';
import { useAgentePendente } from '../paginas/Agente';
import { temAtividade, useAtividade } from '../paginas/Atividade';
import { useVisaoEmail } from '../paginas/Email';
import { useFollowupsPendentes } from '../paginas/Funil';
import { useMeuDiaResumo } from '../paginas/MeuDia';
import { useEntrarNaUnidade, useOrganizacao } from '../paginas/Organizacao';
import { useNovosPedidos } from '../paginas/Vendas';
import { BotaoAvisos, PainelAvisos, useAvisos, useAvisosNoNavegador } from './Avisos';
import { AceitarTermos, DuasEtapasObrigatoria, useAplicarMarca } from './ContaSegura';
import { Logo } from './Marca';
import { MinhaConta } from './MinhaConta';
import { Dono, useSessao } from './Sessao';

/**
 * Itens do menu, na ordem do trabalho: o dia, achar os leads (prospecção), vender e acompanhar
 * (gestão). "admin" só aparece para o administrador e "master" só para quem administra a plataforma.
 */
const ITENS: {
  para: string;
  rotulo: string;
  icone: string;
  /** Título do grupo (aparece antes do primeiro item visível do grupo). */
  secao?: 'Prospecção' | 'Vendas' | 'Gestão' | 'Plataforma';
  fim?: boolean;
  admin?: boolean;
  master?: boolean;
  /** Só aparece em conta com plano (cliente). */
  comPlano?: boolean;
  /** Só aparece se a conta tem algum destes módulos no plano. */
  modulos?: ('whatsapp' | 'agente_ia' | 'email')[];
  /** Só para o gestor e a leitura da organização. */
  organizacao?: boolean;
}[] = [
  { para: '/hoje', rotulo: 'Meu dia', icone: 'calendar' },
  { para: '/campanhas', rotulo: 'Campanhas', icone: 'layers', secao: 'Prospecção' },
  { para: '/nichos', rotulo: 'Nichos', icone: 'store', secao: 'Prospecção', admin: true },
  { para: '/', rotulo: 'Leads', icone: 'users', secao: 'Prospecção', fim: true },
  { para: '/atividade', rotulo: 'Atividade', icone: 'clock', secao: 'Prospecção', admin: true },
  { para: '/funil', rotulo: 'Funil', icone: 'kanban', secao: 'Vendas' },
  { para: '/conversas', rotulo: 'Conversas', icone: 'message-circle', secao: 'Vendas' },
  { para: '/email', rotulo: 'E-mail', icone: 'mail', secao: 'Vendas', modulos: ['email'] },
  { para: '/agente', rotulo: 'Agente', icone: 'bot', secao: 'Vendas', modulos: ['whatsapp', 'agente_ia'] },
  {
    para: '/organizacao',
    rotulo: 'Painel da organização',
    icone: 'layout-dashboard',
    secao: 'Gestão',
    organizacao: true,
    fim: true,
  },
  {
    para: '/organizacao/gestao',
    rotulo: 'Unidades e pessoas',
    icone: 'building-2',
    secao: 'Gestão',
    organizacao: true,
  },
  { para: '/relatorios', rotulo: 'Relatórios', icone: 'trending-up', secao: 'Gestão' },
  { para: '/equipe', rotulo: 'Equipe', icone: 'id-card', secao: 'Gestão' },
  { para: '/plano', rotulo: 'Meu plano', icone: 'badge-check', secao: 'Gestão', comPlano: true },
  { para: '/auditoria', rotulo: 'Auditoria', icone: 'list-filter', secao: 'Gestão', admin: true },
  {
    para: '/plataforma',
    rotulo: 'Painel da plataforma',
    icone: 'layout-dashboard',
    secao: 'Plataforma',
    master: true,
    fim: true,
  },
];

/** Menu do painel da plataforma (só o master): o negócio, não a prospecção de uma conta. */
const ITENS_PLATAFORMA: { para: string; rotulo: string; icone: string; secao?: string; fim?: boolean }[] = [
  { para: '/plataforma', rotulo: 'Visão geral', icone: 'layout-dashboard', fim: true },
  { para: '/plataforma/vendas', rotulo: 'Vendas', icone: 'kanban', secao: 'Comercial' },
  { para: '/plataforma/clientes', rotulo: 'Clientes', icone: 'building-2', secao: 'Clientes' },
  { para: '/plataforma/consumo', rotulo: 'Consumo e custos', icone: 'trending-up', secao: 'Clientes' },
  { para: '/plataforma/operacao', rotulo: 'Operação', icone: 'activity', secao: 'Sistema' },
  { para: '/base-cnpj', rotulo: 'Base CNPJ', icone: 'landmark', secao: 'Sistema' },
];

/** Telas do painel da plataforma (menu próprio). */
export const ehTelaDaPlataforma = (caminho: string) =>
  caminho.startsWith('/plataforma') || caminho.startsWith('/base-cnpj') || caminho.startsWith('/master');

/** O que está quebrado (e-mail não sai, chip caiu…): a faixa no topo, para o administrador. */
function FaixaAlertas(props: { plataforma: boolean }) {
  const admin = useSessao().data?.papel === 'admin';
  const navegar = useNavigate();
  const q = useQuery({
    queryKey: ['alertas'],
    queryFn: () => api<Alerta[]>('/alertas'),
    enabled: admin,
    refetchInterval: 60_000,
  });
  // Os da plataforma ficam na tela Operação do painel; no CRM, só os da conta.
  const itens = props.plataforma ? [] : (q.data ?? []).filter((a) => a.contaId !== null);
  if (!admin || !itens.length) return null;
  return (
    <ul className="faixa-alertas" aria-label="Alertas">
      {itens.map((a) => (
        <li key={a.id} className="faixa-alerta" data-nivel={a.nivel}>
          <span className="faixa-alerta__icone">
            <Icon name={a.nivel === 'erro' ? 'circle-x' : 'circle-help'} size={16} />
          </span>
          <span className="faixa-alerta__texto">
            <b>{a.titulo}</b>
            {a.contaId === null && <span className="quieto"> · plataforma</span>}
            {a.texto && <span className="faixa-alerta__detalhe">{a.texto}</span>}
          </span>
          {a.link && (
            <Button size="sm" variant="ghost" onClick={() => navegar(a.link!)}>
              Ver
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Gestor e leitura: troca de unidade direto no menu. */
function TrocarUnidade() {
  const sessao = useSessao();
  const org = useOrganizacao(true);
  const entrar = useEntrarNaUnidade();
  const unidades = org.data?.unidades.filter((u) => u.ativa) ?? [];
  if (unidades.length < 2) return null;
  return (
    <div className="nav__unidade">
      <label htmlFor="nav-unidade" className="nav__secao">
        Unidade
      </label>
      <select
        id="nav-unidade"
        className="filtro"
        value={sessao.data?.conta.id}
        disabled={entrar.isPending}
        onChange={(e) => entrar.mutate(Number(e.target.value))}
      >
        {unidades.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nome}
          </option>
        ))}
      </select>
    </div>
  );
}

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
  const respostasEmail = useVisaoEmail().data?.resumo.respostasNaoLidas ?? 0;
  // Ponto pulsando em "Atividade" enquanto o motor trabalha, em qualquer tela.
  const ativo = temAtividade(useAtividade(60_000).data);
  const pendentes = useFollowupsPendentes().data?.pendentes ?? 0;
  const doAgente = useAgentePendente().data ?? 0;
  const pedidosNovos = useNovosPedidos(!!sessao.data?.master).data?.novos ?? 0;
  useAplicarMarca();
  const marca = sessao.data?.marca;
  const voltar = useMutation({
    mutationFn: () => api('/master/sair', { metodo: 'POST' }),
    onSuccess: () => {
      // Tudo que estava na tela era da outra conta.
      cliente.clear();
      navegar('/plataforma/clientes');
    },
  });
  const voltarUnidade = useMutation({
    mutationFn: () => api('/organizacao/voltar', { metodo: 'POST' }),
    onSuccess: () => {
      cliente.clear();
      navegar('/organizacao');
    },
  });
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
  // A organização exige duas etapas e a pessoa ainda não configurou: só essa tela.
  if (sessao.data?.duasEtapas.exigido && !sessao.data.duasEtapas.ativo) return <DuasEtapasObrigatoria />;
  const plataforma =
    !!sessao.data?.master && !sessao.data.foraDaPropria && ehTelaDaPlataforma(local.pathname);

  return (
    <div className="app">
      <nav className="nav" aria-label="Navegação principal">
        {marca?.logo || marca?.nome ? (
          <div className="nav__marca nav__marca--cliente">
            {marca.logo ? (
              <img className="nav__logo-cliente" src={`/api${marca.logo}`} alt={marca.nome ?? 'Logo'} />
            ) : (
              <Logo tamanho={30} />
            )}
            <span className="nav__marca-texto">
              {marca.nome ?? sessao.data?.organizacao?.nome}
              {sessao.data?.conta && <span className="nav__conta-nome">{sessao.data.conta.nome}</span>}
            </span>
          </div>
        ) : (
          <div className="nav__marca">
            <Logo tamanho={30} />
            <span className="nav__marca-texto">
              Prospect Team
              {sessao.data?.conta && <span className="nav__conta-nome">{sessao.data.conta.nome}</span>}
            </span>
          </div>
        )}
        {plataforma && (
          <>
            {ITENS_PLATAFORMA.map((i, n) => (
              <Fragment key={i.para}>
                {i.secao && i.secao !== ITENS_PLATAFORMA[n - 1]?.secao && (
                  <span className="nav__secao">{i.secao}</span>
                )}
                <NavLink to={i.para} end={i.fim} className="nav__link">
                  <Icon name={i.icone} size={16} />
                  {i.rotulo}
                  {i.para === '/plataforma/vendas' && pedidosNovos > 0 && (
                    <span className="nav__conta nav__conta--marca" title="Pedidos de demonstração novos">
                      {pedidosNovos}
                    </span>
                  )}
                </NavLink>
              </Fragment>
            ))}
            <div className="nav__trocar">
              <span className="nav__secao">Seu CRM</span>
              <NavLink to="/hoje" className="nav__link">
                <Icon name="users" size={16} />
                Usar o CRM ({sessao.data?.conta.nome})
              </NavLink>
            </div>
          </>
        )}
        {!plataforma && sessao.data?.papelOrganizacao && (sessao.data.organizacao?.unidades ?? 0) > 1 && (
          <TrocarUnidade />
        )}
        {!plataforma &&
          ITENS.filter((i) =>
            i.master
              ? !!sessao.data?.master
              : i.organizacao
                ? !!sessao.data?.papelOrganizacao
                : (!i.admin || sessao.data?.papel === 'admin') &&
                  (!i.comPlano || !!sessao.data?.conta.plano) &&
                  (!i.modulos || i.modulos.some((m) => sessao.data?.conta.modulos?.includes(m) ?? true)),
          ).map((i, n, visiveis) => (
            <Fragment key={i.para}>
              {i.secao && i.secao !== visiveis[n - 1]?.secao && <span className="nav__secao">{i.secao}</span>}
              <NavLink to={i.para} end={i.fim} className="nav__link">
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
                {i.para === '/email' && respostasEmail > 0 && (
                  <span className="nav__conta nav__conta--marca" title="Respostas de e-mail não lidas">
                    {respostasEmail}
                  </span>
                )}
                {i.para === '/funil' && pendentes > 0 && (
                  <span className="nav__conta" title="Follow-ups vencidos ou para hoje">
                    {pendentes}
                  </span>
                )}
                {i.para === '/agente' && doAgente > 0 && (
                  <span
                    className="nav__conta"
                    title="Mensagens para revisar e leads que a IA passou para você"
                  >
                    {doAgente}
                  </span>
                )}
                {i.para === '/plataforma' && pedidosNovos > 0 && (
                  <span className="nav__conta nav__conta--marca" title="Pedidos de demonstração novos">
                    {pedidosNovos}
                  </span>
                )}
                {i.para === '/atividade' && ativo && (
                  <span className="vivo nav__vivo" role="img" aria-label="trabalhando agora" />
                )}
              </NavLink>
            </Fragment>
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
                <span>
                  {sessao.data
                    ? sessao.data.papelOrganizacao
                      ? ROTULO_PAPEL_QUALQUER[sessao.data.papelOrganizacao]
                      : ROTULO_PAPEL_USUARIO[sessao.data.papel]
                    : ''}
                </span>
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
        {sessao.data?.foraDaPropria &&
          (sessao.data.master ? (
            <div className="faixa-conta" role="status">
              <Icon name="building-2" size={16} />
              <span>
                Você está na conta <b>{sessao.data.conta.nome}</b>
                {sessao.data.organizacao && sessao.data.organizacao.nome !== sessao.data.conta.nome
                  ? ` (${sessao.data.organizacao.nome})`
                  : ''}{' '}
                como administrador. O que fizer aqui vale para ela.
              </span>
              <Button size="sm" variant="ghost" disabled={voltar.isPending} onClick={() => voltar.mutate()}>
                Voltar para a minha conta
              </Button>
            </div>
          ) : (
            <div className="faixa-conta" role="status">
              <Icon name="building-2" size={16} />
              <span>
                Você está na unidade <b>{sessao.data.conta.nome}</b>.
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={voltarUnidade.isPending}
                onClick={() => voltarUnidade.mutate()}
              >
                Voltar para a minha unidade
              </Button>
            </div>
          ))}
        {sessao.data?.papelOrganizacao === 'leitura' && (
          <div className="faixa-conta faixa-conta--leitura" role="status">
            <Icon name="circle-help" size={16} />
            <span>Acesso só de leitura: você vê tudo, mas não altera nada.</span>
          </div>
        )}
        <FaixaAlertas plataforma={plataforma} />
        <Outlet />
      </main>
      {conta && <MinhaConta aoFechar={() => setConta(false)} />}
      {sessao.data && !sessao.data.termos.aceitos && <AceitarTermos versao={sessao.data.termos.versao} />}
      {avisosAbertos && <PainelAvisos aoFechar={() => setAvisosAbertos(false)} />}
    </div>
  );
}
