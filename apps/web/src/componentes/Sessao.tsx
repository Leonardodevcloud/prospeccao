import { useQuery } from '@tanstack/react-query';
import { api, type Equipe, type Sessao } from '../api';
import { iniciais } from '../formatar';

/** Quem está logado (a mesma consulta que o menu usa). */
export function useSessao() {
  return useQuery({ queryKey: ['sessao'], queryFn: () => api<Sessao>('/auth/eu'), staleTime: 60_000 });
}

/** Administra a unidade (o gestor da organização também); a leitura (diretoria) só olha. */
export function useEhAdmin(): boolean {
  const s = useSessao().data;
  return s?.papel === 'admin' && s.papelOrganizacao !== 'leitura';
}

/** Acesso só de leitura (diretoria): vê tudo, não altera nada. Botões de ação nem aparecem. */
export function useSoLeitura(): boolean {
  return useSessao().data?.papelOrganizacao === 'leitura';
}

/** Vê só a própria base (escolha do gestor na Equipe): os leads dos colegas não aparecem. */
export function useSoPropriaBase(): boolean {
  return !!useSessao().data?.soPropriaBase;
}

/** Telas que a leitura abre; as outras são de trabalho (prospectar, mandar mensagem, configurar). */
export const TELAS_DA_LEITURA = [
  '/',
  '/argos',
  '/argos/mapa',
  '/organizacao',
  '/organizacao/gestao',
  '/funil',
  '/conversas',
  '/reunioes',
  '/rua',
  '/relatorios',
  '/plano',
  '/auditoria',
  '/ajuda',
];

/** Quem administra a plataforma: só ele vê chaves, webhooks e o que é técnico. */
export function useEhMaster(): boolean {
  return !!useSessao().data?.master;
}

/** Pessoas da equipe (para escolher responsável, filtrar). */
export function useEquipe() {
  return useQuery({ queryKey: ['equipe'], queryFn: () => api<Equipe>('/equipe'), staleTime: 60_000 });
}

/** Cor estável por pessoa (o mesmo vendedor tem sempre a mesma cor no quadro). */
const CORES = ['#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#be185d', '#4d7c0f', '#a16207', '#4338ca'];
export function corDaPessoa(id: number | null | undefined): string {
  return id ? (CORES[id % CORES.length] as string) : '#94a3b8';
}

/** Bolinha com as iniciais do dono do lead. */
export function Dono(props: { id: number | null; nome: string | null; tamanho?: number; rotulo?: string }) {
  const t = props.tamanho ?? 22;
  return (
    <span
      className="dono"
      title={props.rotulo ?? (props.nome ? `Responsável: ${props.nome}` : 'Sem responsável')}
      style={{
        width: t,
        height: t,
        fontSize: Math.round(t * 0.42),
        background: props.nome ? corDaPessoa(props.id) : 'transparent',
        borderStyle: props.nome ? 'solid' : 'dashed',
      }}
    >
      {props.nome ? iniciais(props.nome) : '?'}
      <span className="pp-sr">
        {props.rotulo ?? (props.nome ? `Responsável: ${props.nome}` : 'Sem responsável')}
      </span>
    </span>
  );
}
