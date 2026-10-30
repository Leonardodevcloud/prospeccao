import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { useSessao } from './Sessao';

/*
 * CRM de demonstração: uma conta separada, com dados fictícios, para o master apresentar o sistema.
 * Não é cliente, não entra no financeiro e as campanhas dela nunca buscam empresas de verdade.
 */

/** Entra no CRM de demonstração (cria os dados na primeira vez). */
export function useAbrirDemonstracao() {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  return useMutation({
    mutationFn: () => api<{ contaId: number }>('/master/plataforma/demonstracao/entrar', { metodo: 'POST' }),
    onSuccess: () => {
      // Tudo que estava na tela era de outra conta.
      cliente.clear();
      navegar('/hoje');
    },
  });
}

/** Apaga e gera de novo os dados fictícios (volta tudo ao ponto de partida). */
export function useRecriarDemonstracao(aoTerminar?: () => void) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api('/master/plataforma/demonstracao/recriar', { metodo: 'POST' }),
    onSuccess: () => {
      // Dentro da demonstração, a tela inteira mudou; no painel, só o cartão.
      if (sessaoEmCache(cliente)?.conta.demonstracao) cliente.clear();
      else cliente.invalidateQueries({ queryKey: ['master'] });
      aoTerminar?.();
    },
  });
}

const sessaoEmCache = (c: ReturnType<typeof useQueryClient>) =>
  c.getQueryData<{ conta: { demonstracao?: boolean } }>(['sessao']);

/** Cartão no menu do painel da plataforma. */
export function CartaoDemonstracao() {
  const abrir = useAbrirDemonstracao();
  return (
    <div className="nav__demo">
      <b>CRM de demonstração</b>
      <span>O CRM com dados fictícios para mostrar o sistema aos clientes.</span>
      <Button size="sm" variant="secondary" disabled={abrir.isPending} onClick={() => abrir.mutate()}>
        {abrir.isPending ? 'Abrindo…' : 'Abrir a demonstração'}
      </Button>
    </div>
  );
}

/** Faixa no topo do CRM enquanto o master está na demonstração. */
export function FaixaDemonstracao() {
  const sessao = useSessao();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const recriar = useRecriarDemonstracao(() => navegar('/hoje'));
  const voltar = useMutation({
    mutationFn: () => api('/master/sair', { metodo: 'POST' }),
    onSuccess: () => {
      cliente.clear();
      navegar('/plataforma');
    },
  });
  if (!sessao.data?.conta.demonstracao) return null;
  return (
    <div className="faixa-conta faixa-conta--demo" role="status">
      <Icon name="play" size={16} />
      <span>
        <b>CRM de demonstração.</b> Os dados são fictícios. O que você mexer aqui não afeta nenhum cliente.
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={recriar.isPending}
        title="Apaga o que foi mexido e gera os dados de exemplo de novo"
        onClick={() => recriar.mutate()}
      >
        {recriar.isPending ? 'Recriando…' : 'Recriar os dados'}
      </Button>
      <Button size="sm" variant="primary" disabled={voltar.isPending} onClick={() => voltar.mutate()}>
        Voltar ao painel da plataforma
      </Button>
    </div>
  );
}
