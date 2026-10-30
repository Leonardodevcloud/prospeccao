import { ArgosPagina } from './paginas/ArgosPagina';
import { MapaConhecimento } from './paginas/MapaConhecimento';
import '@prospeccao/ui/estilos.css';
import './app.css';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { ErroApi } from './api';
import { ErroDaTela } from './componentes/ErroDaTela';
import { Shell } from './componentes/Shell';
import { Agente } from './paginas/Agente';
import { Ajuda } from './paginas/Ajuda';
import { Atividade } from './paginas/Atividade';
import { Auditoria } from './paginas/Auditoria';
import { BaseCnpj } from './paginas/BaseCnpj';
import { Campanhas } from './paginas/Campanhas';
import { Conversas } from './paginas/Conversas';
import { Convite } from './paginas/Convite';
import { Email } from './paginas/Email';
import { Equipe } from './paginas/Equipe';
import { Funil } from './paginas/Funil';
import { Leads } from './paginas/Leads';
import { Login } from './paginas/Login';
import { Master } from './paginas/Master';
import { MeuDia } from './paginas/MeuDia';
import { MeuPlano } from './paginas/MeuPlano';
import { Nichos } from './paginas/Nichos';
import { Organizacao } from './paginas/Organizacao';
import { PainelGestor } from './paginas/PainelGestor';
import { PlataformaConsumo, PlataformaOperacao, PlataformaVisao } from './paginas/Plataforma';
import { Relatorios } from './paginas/Relatorios';
import { ReuniaoDetalhe } from './paginas/ReuniaoDetalhe';
import { Reunioes } from './paginas/Reunioes';
import { EsqueciSenha, RedefinirSenha } from './paginas/Senha';
import { PlataformaVendas } from './paginas/Vendas';

// Tema claro sempre (preferência da operação).
document.documentElement.setAttribute('data-theme', 'light');

/** Endereço antigo do painel master (links salvos e avisos): vai para Clientes. */
function ParaClientes() {
  const { search } = useLocation();
  return <Navigate to={`/plataforma/clientes${search}`} replace />;
}

const roteador = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/convite/:token', element: <Convite /> },
  { path: '/esqueci', element: <EsqueciSenha /> },
  { path: '/redefinir/:token', element: <RedefinirSenha /> },
  // Link da reunião por vídeo (o convidado não tem login). O vídeo só carrega aqui.
  {
    path: '/r/:codigo',
    lazy: async () => ({ Component: (await import('./reuniao/PaginaReuniao')).PaginaReuniao }),
  },
  // O que a gravação da reunião filma (o LiveKit abre esta página com o acesso de quem grava).
  {
    path: '/gravacao',
    lazy: async () => ({ Component: (await import('./reuniao/Gravacao')).PaginaGravacao }),
  },
  {
    path: '/',
    element: <Shell />,
    errorElement: <ErroDaTela />,
    children: [
      { index: true, element: <Leads /> },
      { path: 'hoje', element: <MeuDia /> },
      { path: 'conversas', element: <Conversas /> },
      { path: 'equipe', element: <Equipe /> },
      { path: 'argos', element: <ArgosPagina /> },
      { path: 'argos/mapa', element: <MapaConhecimento /> },
      { path: 'organizacao', element: <PainelGestor /> },
      { path: 'organizacao/gestao', element: <Organizacao /> },
      { path: 'plano', element: <MeuPlano /> },
      { path: 'email', element: <Email /> },
      { path: 'funil', element: <Funil /> },
      { path: 'relatorios', element: <Relatorios /> },
      { path: 'reunioes', element: <Reunioes /> },
      { path: 'reunioes/:id', element: <ReuniaoDetalhe /> },
      // Vendas na rua (o mapa só carrega aqui).
      { path: 'rua', lazy: async () => ({ Component: (await import('./paginas/NaRua')).NaRua }) },
      { path: 'rua/visita/:id', lazy: async () => ({ Component: (await import('./rua/Visita')).Visita }) },
      { path: 'agente', element: <Agente /> },
      { path: 'campanhas', element: <Campanhas /> },
      { path: 'atividade', element: <Atividade /> },
      { path: 'nichos', element: <Nichos /> },
      { path: 'base-cnpj', element: <BaseCnpj /> },
      { path: 'master', element: <ParaClientes /> },
      { path: 'plataforma', element: <PlataformaVisao /> },
      { path: 'plataforma/vendas', element: <PlataformaVendas /> },
      { path: 'plataforma/clientes', element: <Master /> },
      { path: 'plataforma/consumo', element: <PlataformaConsumo /> },
      { path: 'plataforma/operacao', element: <PlataformaOperacao /> },
      { path: 'auditoria', element: <Auditoria /> },
      { path: 'ajuda', element: <Ajuda /> },
      { path: 'ajuda/:artigo', element: <Ajuda /> },
      { path: 'configuracoes', element: <Navigate to="/base-cnpj" replace /> },
    ],
  },
]);

const cliente = new QueryClient({
  queryCache: new QueryCache({
    onError: (erro) => {
      // Sessão expirada em qualquer tela: volta para o login.
      // (Na sala de reunião pelo link, o convidado não tem login: nada de mandar para o login.)
      if (
        erro instanceof ErroApi &&
        erro.status === 401 &&
        location.pathname !== '/login' &&
        !location.pathname.startsWith('/r/') &&
        location.pathname !== '/gravacao'
      ) {
        roteador.navigate(`/login?voltar=${encodeURIComponent(location.pathname + location.search)}`);
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (tentativas, erro) => !(erro instanceof ErroApi && erro.status < 500) && tentativas < 2,
    },
  },
});

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker: notificações no celular (e o sistema pode ser instalado como app).
if ('serviceWorker' in navigator && import.meta.env.PROD)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });

// Gravação de reunião que não terminou de subir (a aba fechou no meio): sobe em segundo plano.
if ('indexedDB' in window && location.pathname !== '/gravacao')
  window.addEventListener('load', () => {
    setTimeout(() => {
      void import('./reuniao/envio').then((m) => m.retomarEnviosPendentes()).catch(() => undefined);
    }, 4000);
  });
