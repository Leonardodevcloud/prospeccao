import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { type Alerta, api, ErroApi, ROTULO_PAPEL_QUALQUER, ROTULO_PAPEL_USUARIO } from '../api';
import { useAgentePendente } from '../paginas/Agente';
import { temAtividade, useAtividade } from '../paginas/Atividade';
import { useVisaoEmail } from '../paginas/Email';
import { useFollowupsPendentes } from '../paginas/Funil';
import { useMeuDiaResumo } from '../paginas/MeuDia';
import { useEntrarNaUnidade, useOrganizacao } from '../paginas/Organizacao';
import { useNovosPedidos } from '../paginas/Vendas';
import { ChamadaEntrando } from '../telefone/ChamadaEntrando';
import { PainelLigacao } from '../telefone/PainelLigacao';
import { BotaoAvisos, PainelAvisos, useAvisos, useAvisosNoNavegador } from './Avisos';
import { Argos } from './argos/Argos';
import { conversa as conversaArgos } from './argos/conversa';
import { AceitarTermos, DuasEtapasObrigatoria, useAplicarMarca } from './ContaSegura';
import { CartaoDemonstracao, FaixaDemonstracao } from './Demonstracao';
import { ForaDoPlano, recursoDaTela } from './ForaDoPlano';
import { Logo, TecnologiaProspectTeam } from './Marca';
import {
  BarraDeBaixo,
  type ContextoMenu,
  FolhaMais,
  MENU_CRM,
  MENU_PLATAFORMA,
  MenuLateral,
  type Selo,
} from './Menu';
import { MinhaConta } from './MinhaConta';
import { Dono, TELAS_DA_LEITURA, useSessao } from './Sessao';

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
  // "Mais" do celular (a folha com todas as telas).
  const [mais, setMais] = useState(false);
  const fecharMais = useCallback(() => setMais(false), []);
  const avisos = useAvisos();
  useAvisosNoNavegador(avisos.data?.itens, avisos.data?.naoLidas ?? 0);
  const naoLidas = useConversasNaoLidas().data?.naoLidas ?? 0;
  const doDia = useMeuDiaResumo().data ?? 0;
  const respostasEmail = useVisaoEmail().data?.resumo.respostasNaoLidas ?? 0;
  // Ponto pulsando em "Atividade" enquanto o motor trabalha, em qualquer tela.
  const recursos = sessao.data?.conta.recursos ?? [];
  const ativo = temAtividade(useAtividade(60_000, recursos.includes('relatorios')).data);
  const pendentes = useFollowupsPendentes().data?.pendentes ?? 0;
  const doAgente = useAgentePendente().data ?? 0;
  const pedidosNovos = useNovosPedidos(!!sessao.data?.master).data?.novos ?? 0;
  useAplicarMarca();
  const marca = sessao.data?.marca;
  // Menu na cor secundária (a empresa liga em Marca): usa a logo para fundo escuro; sem ela, a
  // logo para fundo claro vai numa plaquinha branca.
  const menuEscuro = !!marca?.menuEscuro && !!marca.corSecundaria;
  const logoDoMenu = menuEscuro ? (marca?.logoEscuro ?? marca?.logo ?? null) : (marca?.logo ?? null);
  const logoNaPlaca = menuEscuro && !marca?.logoEscuro && !!marca?.logo;
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
      conversaArgos.limpar();
      navegar('/login');
    },
  });

  if (sessao.error instanceof ErroApi && sessao.error.status === 401) {
    return <Navigate to={`/login?voltar=${encodeURIComponent(local.pathname + local.search)}`} replace />;
  }
  if (sessao.isPending) return null;
  // A organização exige duas etapas e a pessoa ainda não configurou: só essa tela.
  if (sessao.data?.duasEtapas.exigido && !sessao.data.duasEtapas.ativo) return <DuasEtapasObrigatoria />;
  // O master na própria conta só tem o painel da plataforma (a conta dele não é CRM de uso): o CRM
  // ele vê pelo CRM de demonstração ou entrando na conta de um cliente.
  const soPainel = !!sessao.data?.master && !sessao.data.foraDaPropria;
  if (soPainel && !ehTelaDaPlataforma(local.pathname) && !local.pathname.startsWith('/ajuda'))
    return <Navigate to="/plataforma" replace />;
  const plataforma = soPainel;
  const soLeitura = sessao.data?.papelOrganizacao === 'leitura';
  // Tela de um recurso que o plano não tem: no lugar dela, o cartão de como liberar.
  const recursoTela = plataforma ? null : recursoDaTela(local.pathname);
  const telaFora = recursoTela && !recursos.includes(recursoTela) ? recursoTela : null;
  // A leitura só abre as telas de acompanhar; as de trabalho levam ao painel da organização.
  if (soLeitura && !TELAS_DA_LEITURA.includes(local.pathname) && !local.pathname.startsWith('/reunioes/'))
    return <Navigate to="/organizacao" replace />;

  const papel = sessao.data
    ? sessao.data.papelOrganizacao
      ? ROTULO_PAPEL_QUALQUER[sessao.data.papelOrganizacao]
      : ROTULO_PAPEL_USUARIO[sessao.data.papel]
    : '';
  const selos: Record<string, Selo> = {
    '/hoje': { n: doDia, titulo: 'Tarefas e follow-ups atrasados ou para hoje' },
    '/conversas': { n: naoLidas, marca: true, titulo: 'Conversas com mensagem não lida' },
    '/email': { n: respostasEmail, marca: true, titulo: 'Respostas de e-mail não lidas' },
    '/funil': { n: pendentes, titulo: 'Follow-ups vencidos ou para hoje' },
    '/agente': { n: doAgente, titulo: 'Mensagens para revisar e leads que a IA passou para você' },
    '/plataforma': { n: pedidosNovos, marca: true, titulo: 'Pedidos de demonstração novos' },
    '/plataforma/vendas': { n: pedidosNovos, marca: true, titulo: 'Pedidos de demonstração novos' },
    '/atividade': { vivo: ativo },
  };
  const ctxMenu: ContextoMenu = {
    entradas: plataforma ? MENU_PLATAFORMA : MENU_CRM,
    plataforma,
    visivel: (i) =>
      plataforma
        ? true
        : soLeitura
          ? TELAS_DA_LEITURA.includes(i.para)
          : i.master
            ? !!sessao.data?.master
            : i.organizacao
              ? !!sessao.data?.papelOrganizacao
              : (!i.admin || sessao.data?.papel === 'admin') &&
                (!i.comPlano || !!sessao.data?.conta.plano) &&
                (!i.modulos || i.modulos.some((m) => sessao.data?.conta.modulos?.includes(m) ?? true)),
    temRecurso: (r) => plataforma || recursos.includes(r),
    selo: (para) => selos[para] ?? null,
  };

  /** Marca no topo do menu (e, compacta, na barra de cima do celular). */
  const marcaDoMenu = (compacta = false) => {
    const escura = menuEscuro && !compacta;
    const logo = compacta ? (marca?.logo ?? null) : logoDoMenu;
    if (logo)
      return (
        <div className={`nav__marca nav__marca--logo${compacta ? ' nav__marca--compacta' : ''}`}>
          <span className={`nav__logo-larga${escura && logoNaPlaca ? ' nav__logo-larga--placa' : ''}`}>
            <img src={`/api${logo}`} alt={marca?.nome ?? sessao.data?.organizacao?.nome ?? 'Logo'} />
          </span>
          {!compacta && sessao.data?.conta && (
            <span className="nav__conta-nome">{sessao.data.conta.nome}</span>
          )}
        </div>
      );
    return (
      <div className={`nav__marca${compacta ? ' nav__marca--compacta' : ''}`}>
        {marca?.icone ? (
          <img className="nav__logo-cliente" src={`/api${marca.icone}`} alt="" />
        ) : (
          <Logo tamanho={compacta ? 26 : 30} escuro={escura} />
        )}
        <span className="nav__marca-texto">
          {marca?.nome || marca?.icone ? (marca.nome ?? sessao.data?.organizacao?.nome) : 'Prospect Team'}
          <span className="nav__conta-nome">
            {plataforma ? 'Painel da plataforma' : (sessao.data?.conta.nome ?? '')}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className="app">
      <header className="barra-topo">
        {marcaDoMenu(true)}
        <span className="barra-topo__espaco" />
        <BotaoAvisos naoLidas={avisos.data?.naoLidas ?? 0} aoAbrir={() => setAvisosAbertos(true)} />
        <button type="button" className="barra-topo__eu" onClick={() => setConta(true)} title="Minha conta">
          <Dono id={sessao.data?.id ?? null} nome={sessao.data?.nome ?? null} tamanho={30} rotulo="" />
        </button>
      </header>
      <nav className={`nav${menuEscuro ? ' nav--escura' : ''}`} aria-label="Navegação principal">
        {marcaDoMenu()}
        {!plataforma && sessao.data?.papelOrganizacao && (sessao.data.organizacao?.unidades ?? 0) > 1 && (
          <TrocarUnidade />
        )}
        <MenuLateral ctx={ctxMenu} />
        {plataforma && <CartaoDemonstracao />}
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
                <span>{papel}</span>
              </span>
            </button>
          </div>
          <div className="nav__icones">
            <NavLink to="/ajuda" className="nav__icone" title="Ajuda" aria-label="Ajuda">
              <Icon name="circle-help" size={18} />
            </NavLink>
            <BotaoAvisos naoLidas={avisos.data?.naoLidas ?? 0} aoAbrir={() => setAvisosAbertos(true)} />
            <button
              type="button"
              className="nav__icone"
              title="Sair"
              aria-label="Sair"
              onClick={() => sair.mutate()}
            >
              <Icon name="log-out" size={18} />
            </button>
          </div>
          {/* Com a marca do cliente, o Prospect Team fica só aqui, discreto. */}
          {!plataforma && marca && <TecnologiaProspectTeam className="nav__tecnologia" />}
        </div>
      </nav>
      <BarraDeBaixo ctx={ctxMenu} maisAberto={mais} aoMais={() => setMais((x) => !x)} />
      {mais && (
        <FolhaMais
          ctx={ctxMenu}
          aoFechar={fecharMais}
          topo={
            plataforma ? (
              <CartaoDemonstracao />
            ) : sessao.data?.papelOrganizacao && (sessao.data.organizacao?.unidades ?? 0) > 1 ? (
              <TrocarUnidade />
            ) : null
          }
          rodape={
            <>
              <NavLink to="/ajuda" className="folha-mais__acao">
                <Icon name="circle-help" size={18} />
                Ajuda
              </NavLink>
              <button
                type="button"
                className="folha-mais__acao"
                onClick={() => {
                  fecharMais();
                  setConta(true);
                }}
              >
                <Icon name="user-round" size={18} />
                Minha conta
              </button>
              <button
                type="button"
                className="folha-mais__acao folha-mais__acao--sair"
                onClick={() => sair.mutate()}
              >
                <Icon name="log-out" size={18} />
                Sair
              </button>
              {!plataforma && marca && <TecnologiaProspectTeam className="folha-mais__tecnologia" />}
            </>
          }
        />
      )}
      <main className="conteudo">
        <FaixaDemonstracao />
        {sessao.data?.foraDaPropria &&
          !sessao.data.conta.demonstracao &&
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
        {telaFora ? <ForaDoPlano recurso={telaFora} /> : <Outlet />}
      </main>
      {conta && <MinhaConta aoFechar={() => setConta(false)} />}
      {sessao.data && !sessao.data.termos.aceitos && <AceitarTermos versao={sessao.data.termos.versao} />}
      {/* Argos: o assistente (segundo cérebro), em qualquer tela. Só vê o que a pessoa pode ver. */}
      {/* Na tela do Argos ele já está na página: o botão flutuante sai (senão os dois ouviriam o Espaço). */}
      {sessao.data?.termos.aceitos &&
        !plataforma &&
        local.pathname !== '/argos' &&
        recursos.includes('argos') && <Argos dono={`${sessao.data.id}-${sessao.data.conta.id}`} />}
      {avisosAbertos && <PainelAvisos aoFechar={() => setAvisosAbertos(false)} />}
      {/* A ligação em curso fica por cima de qualquer tela (dá para navegar durante a ligação). */}
      {!plataforma && <PainelLigacao />}
      {!plataforma && <ChamadaEntrando />}
    </div>
  );
}
