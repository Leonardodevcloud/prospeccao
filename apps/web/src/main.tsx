import '@prospeccao/ui/estilos.css';
import './app.css';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { ErroApi } from './api';
import { ErroDaTela } from './componentes/ErroDaTela';
import { Shell } from './componentes/Shell';
import { Agente } from './paginas/Agente';
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
import { Relatorios } from './paginas/Relatorios';
import { EsqueciSenha, RedefinirSenha } from './paginas/Senha';

// Tema claro sempre (preferência da operação).
document.documentElement.setAttribute('data-theme', 'light');

const roteador = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/convite/:token', element: <Convite /> },
  { path: '/esqueci', element: <EsqueciSenha /> },
  { path: '/redefinir/:token', element: <RedefinirSenha /> },
  {
    path: '/',
    element: <Shell />,
    errorElement: <ErroDaTela />,
    children: [
      { index: true, element: <Leads /> },
      { path: 'hoje', element: <MeuDia /> },
      { path: 'conversas', element: <Conversas /> },
      { path: 'equipe', element: <Equipe /> },
      { path: 'plano', element: <MeuPlano /> },
      { path: 'email', element: <Email /> },
      { path: 'funil', element: <Funil /> },
      { path: 'relatorios', element: <Relatorios /> },
      { path: 'agente', element: <Agente /> },
      { path: 'campanhas', element: <Campanhas /> },
      { path: 'atividade', element: <Atividade /> },
      { path: 'nichos', element: <Nichos /> },
      { path: 'base-cnpj', element: <BaseCnpj /> },
      { path: 'master', element: <Master /> },
      { path: 'auditoria', element: <Auditoria /> },
      { path: 'configuracoes', element: <Navigate to="/base-cnpj" replace /> },
    ],
  },
]);

const cliente = new QueryClient({
  queryCache: new QueryCache({
    onError: (erro) => {
      // Sessão expirada em qualquer tela: volta para o login.
      if (erro instanceof ErroApi && erro.status === 401 && location.pathname !== '/login') {
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
