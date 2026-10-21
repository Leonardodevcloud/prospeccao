import { Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type ContatoLead, type ConversaAberta, type NaoIdentificado } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { fmtCidade, fmtHoraSo, fmtNome, fmtQuando, formatarTelefone } from '../formatar';

/**
 * Mensagens de números que não são de nenhum lead: quase sempre a pessoa indicada que escreveu
 * antes de alguém cadastrar o número. Nada se perde: fica aqui até alguém vincular a um lead.
 */

export function useNaoIdentificados() {
  return useQuery({
    queryKey: ['nao-identificados'],
    queryFn: () => api<NaoIdentificado[]>('/conversas/nao-identificados'),
    refetchInterval: 15_000,
  });
}

export function ListaNaoIdentificados(props: { ativo: string | null; aoAbrir: (telefone: string) => void }) {
  const q = useNaoIdentificados();
  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  if (!q.data.length)
    return (
      <p className="quieto inbox__vazia">
        Nenhuma mensagem de número desconhecido. Quando alguém indicado escrever antes de estar no lead, a
        mensagem aparece aqui para você vincular.
      </p>
    );
  return (
    <ul className="conversas">
      {q.data.map((n) => (
        <li key={n.telefone}>
          <button
            type="button"
            className="conversa-item"
            aria-current={props.ativo === n.telefone || undefined}
            onClick={() => props.aoAbrir(n.telefone)}
          >
            <span className="conversa-item__topo">
              <b>{n.nome ? fmtNome(n.nome) : formatarTelefone(n.telefone)}</b>
              <span className="conversa-item__hora conversa-item__hora--nova">{fmtQuando(n.ultimaEm)}</span>
            </span>
            <span className="conversa-item__linha">
              <span className="conversa-item__previa">
                {n.ultimaDirecao === 'enviada' ? 'Você: ' : ''}
                {n.ultima}
              </span>
              <span className="conversa-item__conta">{n.quantidade}</span>
            </span>
            <span className="conversa-item__rodape">
              <span className="mono">{formatarTelefone(n.telefone)}</span>
              {n.indicadoEm && (
                <span className="etiqueta etiqueta--marca">
                  <Icon name="user-plus" size={10} /> indicado em {fmtNome(n.indicadoEm.empresa)}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface LeadAchado {
  empresaId: number;
  nome: string;
  cidade: string | null;
  etapa: string;
}

export function PainelNaoIdentificado(props: {
  telefone: string;
  aoVoltar: () => void;
  aoVinculado: (empresaId: number) => void;
}) {
  const cliente = useQueryClient();
  const q = useNaoIdentificados();
  const n = q.data?.find((x) => x.telefone === props.telefone) ?? null;

  const [lead, setLead] = useState<LeadAchado | null>(null);
  const [busca, setBusca] = useState('');
  const [buscaFeita, setBuscaFeita] = useState('');
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState('');
  const [indicadoPor, setIndicadoPor] = useState('');

  // Número já indicado numa conversa: o lead e o nome já vêm escolhidos.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando muda o número aberto
  useEffect(() => {
    setLead(
      n?.indicadoEm
        ? { empresaId: n.indicadoEm.empresaId, nome: n.indicadoEm.empresa, cidade: null, etapa: '' }
        : null,
    );
    setNome(n?.indicadoEm?.contatoNome ?? n?.nome ?? '');
    setCargo('');
    setIndicadoPor(n?.indicadoEm?.indicadoPorId ? String(n.indicadoEm.indicadoPorId) : '');
  }, [props.telefone, !!n]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaFeita(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const achados = useQuery({
    queryKey: ['leads-para-vincular', buscaFeita],
    queryFn: () => api<LeadAchado[]>(`/conversas/leads?busca=${encodeURIComponent(buscaFeita)}`),
    enabled: buscaFeita.length >= 2 && !lead,
  });
  const pessoasDoLead = useQuery({
    queryKey: ['contatos-lead', lead?.empresaId],
    queryFn: () => api<{ contatos: ContatoLead[] }>(`/conversas/${lead!.empresaId}/contatos`),
    enabled: !!lead,
  });

  const vincular = useMutation({
    mutationFn: () =>
      api<ConversaAberta>(`/conversas/nao-identificados/${props.telefone}/vincular`, {
        metodo: 'POST',
        corpo: {
          empresaId: lead!.empresaId,
          nome: nome.trim(),
          cargo: cargo.trim() || null,
          indicadoPorId: indicadoPor ? Number(indicadoPor) : null,
          conversarCom: true,
        },
      }),
    onSuccess: (c) => {
      cliente.invalidateQueries({ queryKey: ['nao-identificados'] });
      cliente.invalidateQueries({ queryKey: ['conversas'] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
      cliente.setQueryData(['conversa', c.empresaId], c);
      props.aoVinculado(c.empresaId);
    },
  });
  const descartar = useMutation({
    mutationFn: () => api(`/conversas/nao-identificados/${props.telefone}/descartar`, { metodo: 'POST' }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['nao-identificados'] });
      props.aoVoltar();
    },
  });

  if (q.isPending)
    return (
      <div className="chat">
        <div className="esqueleto" />
      </div>
    );
  if (!n)
    return (
      <div className="chat chat--vazio">
        <EmptyState icone="check" titulo="Já resolvido" texto="Este número já foi vinculado ou descartado." />
      </div>
    );

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (lead && nome.trim()) vincular.mutate();
  };
  const indicadores = (pessoasDoLead.data?.contatos ?? []).filter((c) => c.status === 'confirmado');

  return (
    <div className="chat">
      <header className="chat__topo">
        <button
          type="button"
          className="botao-icone chat__voltar"
          aria-label="Voltar para a lista"
          onClick={props.aoVoltar}
        >
          <Icon name="arrow-right" size={18} className="girar-180" />
        </button>
        <div className="chat__quem">
          <span className="chat__nome">{n.nome ? fmtNome(n.nome) : 'Número desconhecido'}</span>
          <span className="chat__sub mono">{formatarTelefone(n.telefone)}</span>
        </div>
        <div className="acoes">
          <Button
            size="sm"
            variant="ghost"
            disabled={descartar.isPending}
            onClick={() => descartar.mutate()}
            title="Some da lista; se escrever de novo, volta"
          >
            Não é de lead (descartar)
          </Button>
        </div>
      </header>
      <div className="bolhas">
        {n.mensagens.map((m) => (
          <div key={m.id} className="bolhas__grupo">
            <div className="bolha" data-lado={m.direcao} data-canal="whatsapp">
              <p className="bolha__texto">{m.texto}</p>
              <span className="bolha__meta">
                <span>{fmtQuando(m.em)}</span>
                <span>{fmtHoraSo(m.em)}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <form className="vincular" onSubmit={enviar}>
        <div className="vincular__titulo">
          <Icon name="link" size={16} />
          <b>Vincular a um lead</b>
          <span className="quieto">
            Vira um contato da negociação e as mensagens vão para a conversa do lead.
          </span>
        </div>
        {n.indicadoEm && lead?.empresaId === n.indicadoEm.empresaId && (
          <p className="vincular__dica">
            Este número foi indicado na conversa com <b>{fmtNome(n.indicadoEm.empresa)}</b>
            {n.indicadoEm.contatoNome ? ` (${n.indicadoEm.contatoNome})` : ''}.
          </p>
        )}
        {lead ? (
          <div className="vincular__lead">
            <span>
              <Icon name="store" size={14} /> <b>{fmtNome(lead.nome)}</b>
              {lead.cidade && <span className="quieto"> · {fmtCidade(lead.cidade)}</span>}
              {lead.etapa && <span className="quieto"> · {lead.etapa}</span>}
            </span>
            <button type="button" className="link-botao" onClick={() => setLead(null)}>
              Trocar
            </button>
          </div>
        ) : (
          <div className="campo">
            <label htmlFor="vincular-busca">Lead</label>
            <input
              id="vincular-busca"
              className="filtro"
              placeholder="Nome da empresa, de um contato ou telefone"
              value={busca}
              autoComplete="off"
              onChange={(e) => setBusca(e.target.value)}
            />
            {achados.data && (
              <ul className="vincular__achados">
                {achados.data.length ? (
                  achados.data.map((l) => (
                    <li key={l.empresaId}>
                      <button type="button" className="vincular__opcao" onClick={() => setLead(l)}>
                        <b>{fmtNome(l.nome)}</b>
                        <span className="quieto">
                          {l.cidade ? ` · ${fmtCidade(l.cidade)}` : ''} · {l.etapa}
                        </span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="quieto vincular__vazio">Nenhum lead do funil com “{buscaFeita}”.</li>
                )}
              </ul>
            )}
          </div>
        )}
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="vincular-nome">Nome da pessoa</label>
            <input
              id="vincular-nome"
              className="filtro"
              required
              maxLength={120}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="vincular-cargo">Cargo ou setor</label>
            <input
              id="vincular-cargo"
              className="filtro"
              maxLength={80}
              placeholder="Compras, gerente, sócio…"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
            />
          </div>
        </div>
        {lead && indicadores.length > 0 && (
          <div className="campo">
            <label htmlFor="vincular-por">Quem indicou</label>
            <select id="vincular-por" value={indicadoPor} onChange={(e) => setIndicadoPor(e.target.value)}>
              <option value="">Ninguém / não sei</option>
              {indicadores.map((c) => (
                <option key={c.id} value={c.id}>
                  {fmtNome(c.nome)}
                  {c.cargo ? ` · ${c.cargo}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <ErroDaApi erro={vincular.error ?? descartar.error} />
        <div className="acoes">
          <Button type="submit" variant="primary" disabled={!lead || !nome.trim() || vincular.isPending}>
            Vincular e abrir a conversa
          </Button>
        </div>
      </form>
    </div>
  );
}
