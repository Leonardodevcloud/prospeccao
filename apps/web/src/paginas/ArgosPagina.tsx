import type { ConversaArgosDTO, MemoriaArgosDTO, TrocaArgosDTO } from '@prospeccao/shared/assistente';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Argos } from '../componentes/argos/Argos';
import { conversa, useConversaAtual } from '../componentes/argos/conversa';
import { ErroDaApi } from '../componentes/Formulario';
import { useSessao } from '../componentes/Sessao';

/**
 * A tela do Argos: a apresentação com o holograma (na primeira vez ou numa conversa nova), a
 * conversa por voz e por texto e, ao lado, o histórico da pessoa (só ela vê o dela).
 */

const SUGESTOES = {
  master: [
    'Como estão os clientes da plataforma neste mês?',
    'Qual unidade mais ganhou negócios neste mês?',
    'Quanto a IA foi usada nesta semana, por cliente?',
    'Quais pedidos do site ainda não viraram demonstração?',
  ],
  organizacao: [
    'Compare as unidades neste mês',
    'Quem da equipe mais avançou nesta semana?',
    'Como está o funil da organização?',
    'Quais follow-ups estão atrasados?',
  ],
  unidade: [
    'Como está meu funil hoje?',
    'Quais follow-ups estão atrasados?',
    'Como foram minhas campanhas?',
    'Quantas empresas do meu nicho existem na minha cidade?',
  ],
};

function grupoDa(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((inicio(hoje) - inicio(d)) / 86_400_000);
  if (dias <= 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  if (dias < 7) return 'Nesta semana';
  if (dias < 31) return 'Neste mês';
  return 'Antes';
}

const hora = (iso: string) => {
  const d = new Date(iso);
  const dias = Math.round((Date.now() - d.getTime()) / 86_400_000);
  return dias < 1
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
};

export function ArgosPagina() {
  const sessao = useSessao();
  const s = sessao.data;
  if (!s) return null;
  const sugestoes = s.master
    ? SUGESTOES.master
    : s.papelOrganizacao
      ? SUGESTOES.organizacao
      : SUGESTOES.unidade;
  return (
    <div className="argos-tela">
      <HistoricoArgos />
      <div className="argos-tela__principal">
        <Argos
          dono={`${s.id}-${s.conta.id}`}
          modo="pagina"
          nome={s.nome.split(' ')[0]}
          sugestoes={sugestoes}
        />
      </div>
    </div>
  );
}

function HistoricoArgos() {
  const cliente = useQueryClient();
  const atual = useConversaAtual();
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<{ id: number; titulo: string } | null>(null);
  const [apagando, setApagando] = useState<number | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['argos', 'conversas', busca.trim()],
    queryFn: () =>
      api<ConversaArgosDTO[]>(
        `/assistente/conversas${busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ''}`,
      ),
  });
  const abrir = useMutation({
    mutationFn: (id: number) =>
      api<{ id: number; titulo: string; trocas: TrocaArgosDTO[] }>(`/assistente/conversas/${id}`),
    onSuccess: (c) => conversa.carregar(c.id, c.titulo, c.trocas),
  });
  const renomear = useMutation({
    mutationFn: (e: { id: number; titulo: string }) =>
      api(`/assistente/conversas/${e.id}`, { metodo: 'PATCH', corpo: { titulo: e.titulo } }),
    onSuccess: () => {
      setEditando(null);
      cliente.invalidateQueries({ queryKey: ['argos', 'conversas'] });
    },
  });
  const apagar = useMutation({
    mutationFn: (id: number) => api(`/assistente/conversas/${id}`, { metodo: 'DELETE' }),
    onSuccess: (_r, id) => {
      setApagando(null);
      if (conversa.atual() === id) conversa.limpar();
      cliente.invalidateQueries({ queryKey: ['argos', 'conversas'] });
    },
  });

  const lista = q.data ?? [];
  const grupos: { nome: string; itens: ConversaArgosDTO[] }[] = [];
  for (const c of lista) {
    const g = grupoDa(c.atualizadoEm);
    const ultimo = grupos.at(-1);
    if (ultimo?.nome === g) ultimo.itens.push(c);
    else grupos.push({ nome: g, itens: [c] });
  }
  const salvarNome = (e: FormEvent) => {
    e.preventDefault();
    if (editando?.titulo.trim()) renomear.mutate({ id: editando.id, titulo: editando.titulo.trim() });
  };

  return (
    <aside className="argos-historico" aria-label="Conversas com o Argos">
      <div className="argos-historico__topo">
        <h2>Conversas</h2>
        <Button size="sm" icon="plus" onClick={() => conversa.limpar()}>
          Nova conversa
        </Button>
      </div>
      <label className="argos-historico__busca">
        <Icon name="search" size={14} />
        <span className="pp-sr">Buscar nas conversas</span>
        <input
          type="search"
          placeholder="Buscar nas conversas"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </label>
      <ErroDaApi erro={q.error ?? abrir.error ?? renomear.error ?? apagar.error} />
      <div className="argos-historico__lista">
        {q.isPending ? (
          <div className="esqueleto" />
        ) : !lista.length ? (
          <p className="argos-historico__vazio">
            {busca.trim()
              ? 'Nenhuma conversa com esse termo.'
              : 'Suas conversas com o Argos aparecem aqui. Comece falando ou escrevendo ao lado.'}
          </p>
        ) : (
          grupos.map((g) => (
            <section key={g.nome} className="argos-historico__grupo">
              <h3>{g.nome}</h3>
              <ul>
                {g.itens.map((c) => (
                  <li
                    key={c.id}
                    className="argos-historico__item"
                    aria-current={c.id === atual ? 'true' : undefined}
                  >
                    {editando?.id === c.id ? (
                      <form className="argos-historico__renomear" onSubmit={salvarNome}>
                        <label htmlFor={`argos-nome-${c.id}`} className="pp-sr">
                          Nome da conversa
                        </label>
                        <input
                          id={`argos-nome-${c.id}`}
                          className="filtro"
                          value={editando.titulo}
                          maxLength={120}
                          onChange={(e) => setEditando({ id: c.id, titulo: e.target.value })}
                        />
                        <div className="acoes">
                          <Button size="sm" variant="primary" type="submit" disabled={renomear.isPending}>
                            Salvar nome
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </form>
                    ) : apagando === c.id ? (
                      <div className="argos-historico__confirmar">
                        <span>Apagar “{c.titulo}”? Não dá para desfazer.</span>
                        <div className="acoes">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={apagar.isPending}
                            onClick={() => apagar.mutate(c.id)}
                          >
                            Apagar conversa
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setApagando(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="argos-historico__abrir"
                          onClick={() => {
                            setMenu(null);
                            abrir.mutate(c.id);
                          }}
                        >
                          <span className="argos-historico__titulo">{c.titulo}</span>
                          <span className="argos-historico__meta">
                            {c.trocas} {c.trocas === 1 ? 'troca' : 'trocas'} · {hora(c.atualizadoEm)}
                            {c.unidade ? ` · ${c.unidade}` : ''}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="botao-icone argos-historico__mais"
                          aria-label={`Opções da conversa ${c.titulo}`}
                          aria-expanded={menu === c.id}
                          onClick={() => setMenu(menu === c.id ? null : c.id)}
                        >
                          <Icon name="ellipsis" size={16} />
                        </button>
                        {menu === c.id && (
                          <div className="argos-historico__menu">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setMenu(null);
                                setEditando({ id: c.id, titulo: c.titulo });
                              }}
                            >
                              Renomear
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="trash-2"
                              onClick={() => {
                                setMenu(null);
                                setApagando(c.id);
                              }}
                            >
                              Apagar
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <MemoriaArgos />
      <p className="argos-historico__nota">
        Suas conversas e a memória ficam só com você. Apague quando quiser.
      </p>
    </aside>
  );
}

/** O que o Argos lembra desta pessoa: ela vê, apaga e acrescenta (também dá para pedir na conversa). */
function MemoriaArgos() {
  const cliente = useQueryClient();
  const [texto, setTexto] = useState('');
  const q = useQuery({
    queryKey: ['argos', 'memorias'],
    queryFn: () => api<MemoriaArgosDTO[]>('/assistente/memorias'),
  });
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['argos', 'memorias'] });
  const guardar = useMutation({
    mutationFn: () => api('/assistente/memorias', { metodo: 'POST', corpo: { texto: texto.trim() } }),
    onSuccess: () => {
      setTexto('');
      atualizar();
    },
  });
  const esquecer = useMutation({
    mutationFn: (id: number) => api(`/assistente/memorias/${id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const lista = q.data ?? [];
  return (
    <details className="argos-memoria">
      <summary>
        <Icon name="circle-help" size={14} aria-hidden />O que o Argos lembra
        {lista.length ? ` (${lista.length})` : ''}
      </summary>
      <p className="argos-historico__nota" style={{ padding: 0 }}>
        Diga “lembra que…” na conversa ou escreva aqui: metas, apelidos de campanhas, como prefere as
        respostas. <LinkAjuda artigo="argos">Como funciona</LinkAjuda>
      </p>
      {lista.length > 0 && (
        <ul className="argos-memoria__lista">
          {lista.map((m) => (
            <li key={m.id}>
              <span>{m.texto}</span>
              <button
                type="button"
                className="botao-icone"
                aria-label={`Esquecer: ${m.texto}`}
                title="Esquecer"
                disabled={esquecer.isPending}
                onClick={() => esquecer.mutate(m.id)}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="argos-memoria__nova"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (texto.trim().length >= 3) guardar.mutate();
        }}
      >
        <label className="pp-sr" htmlFor="argos-memoria-nova">
          Algo para o Argos lembrar
        </label>
        <input
          id="argos-memoria-nova"
          className="filtro"
          maxLength={300}
          placeholder="Ex.: minha meta é 30 reuniões por mês"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button
          size="sm"
          type="submit"
          variant="ghost"
          disabled={guardar.isPending || texto.trim().length < 3}
        >
          Guardar
        </Button>
      </form>
      <ErroDaApi erro={q.error ?? guardar.error ?? esquecer.error} />
    </details>
  );
}
