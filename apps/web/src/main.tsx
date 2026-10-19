import '@prospeccao/ui/estilos.css';
import './app.css';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ErroApi } from './api';
import { Shell } from './componentes/Shell';
import { Atividade } from './paginas/Atividade';
import { Campanhas } from './paginas/Campanhas';
import { Configuracoes } from './paginas/Configuracoes';
import { Leads } from './paginas/Leads';
import { Login } from './paginas/Login';
import { Nichos } from './paginas/Nichos';

// Tema claro/escuro acompanha o sistema operacional (os tokens escuros ficam em [data-theme="dark"]).
const escuro = window.matchMedia('(prefers-color-scheme: dark)');
const aplicarTema = () =>
  document.documentElement.setAttribute('data-theme', escuro.matches ? 'dark' : 'light');
aplicarTema();
escuro.addEventListener('change', aplicarTema);

const roteador = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Leads /> },
      { path: 'campanhas', element: <Campanhas /> },
      { path: 'atividade', element: <Atividade /> },
      { path: 'nichos', element: <Nichos /> },
      { path: 'configuracoes', element: <Configuracoes /> },
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
