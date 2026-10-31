import {
  DIAS_TESTE,
  LEADS_TESTE,
  ROTULO_ASSINATURA,
  type SituacaoAssinatura,
} from '@prospeccao/shared/assinatura';
import { ETAPAS_VENDA, type EtapaVenda, ROTULO_ETAPA_VENDA } from '@prospeccao/shared/site';
import { Badge, Button, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { Drawer } from '../componentes/Drawer';
import { ErroDaApi } from '../componentes/Formulario';
import { useSessao } from '../componentes/Sessao';
import { fmtBrl, fmtQuando, formatarTelefone } from '../formatar';
import { NovaConta } from './Master';

/**
 * Vendas da plataforma (painel master): os pedidos de demonstração do site, e os que chegam por
 * outro canal, num quadro próprio até virarem cliente. Não passa pelo CRM da conta principal.
 */

interface Pedido {
  id: number;
  nome: string;
  empresa: string;
  whatsapp: string | null;
  email: string | null;
  nicho: string | null;
  plano: string | null;
  canal: 'whatsapp' | 'email' | 'formulario' | 'teste';
  etapa: EtapaVenda;
  nota: string | null;
  motivoPerda: string | null;
  demonstracaoEm: string | null;
  contaId: number | null;
  contaNome: string | null;
  /** Teste grátis ou assinatura pelo sistema: a situação e o uso (para o comercial ligar na hora certa). */
  assinatura: {
    situacao: SituacaoAssinatura;
    testeAte: string | null;
    valor: number | null;
    forma: string | null;
    plano: string | null;
    leads: number;
    usuarios: number;
    ultimoAcesso: string | null;
    reunioes: number;
  } | null;
  criadoEm: string;
  atualizadoEm: string;
}
interface PedidoDetalhe extends Pedido {
  historico: { id: number; texto: string; autor: string | null; criadoEm: string }[];
}
interface DadosVendas {
  config: { whatsapp: string | null; email: string | null };
  pedidos: Pedido[];
  numeros?: {
    testando: number;
    terminamNaSemana: number;
    ativas: number;
    mrr: number;
    atrasadas: number;
    soLeitura: number;
    testes30: number;
    viraram30: number;
    emAberto: number;
  };
}

const PROXIMA: Partial<Record<EtapaVenda, EtapaVenda>> = {
  novo: 'contato',
  contato: 'demonstracao',
  demonstracao: 'proposta',
  teste: 'proposta',
  proposta: 'cliente',
};

const ORIGEM: Record<Pedido['canal'], string> = {
  whatsapp: 'Site · foi para o WhatsApp',
  email: 'Site · foi para o e-mail',
  formulario: 'Formulário ou cadastro à mão',
  teste: 'Teste grátis pelo site',
};

const DIA = 86_400_000;
const NOME_FORMA: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão' };

/** O uso do teste no cartão: dia do teste, usuários, leads e reuniões (e o alerta de sumiço). */
function UsoDoTeste(props: { a: NonNullable<Pedido['assinatura']> }) {
  const { a } = props;
  const agora = Date.now();
  const fim = a.testeAte ? new Date(a.testeAte).getTime() : agora;
  const dia = Math.min(DIAS_TESTE, Math.max(1, DIAS_TESTE - Math.ceil((fim - agora) / DIA) + 1));
  const restam = Math.ceil((fim - agora) / DIA);
  const semUso = a.ultimoAcesso ? Math.floor((agora - new Date(a.ultimoAcesso).getTime()) / DIA) : null;
  const alerta = restam <= 1 || (semUso != null && semUso >= 2) || !a.ultimoAcesso;
  const pct = Math.min(100, Math.round((a.leads / LEADS_TESTE) * 100));
  return (
    <div className="cartao-venda__teste">
      <span className={alerta ? 'cartao-venda__alerta' : undefined}>
        {restam <= 0 ? 'termina hoje' : restam === 1 ? 'termina amanhã' : `dia ${dia} de ${DIAS_TESTE}`}
        {semUso != null && semUso >= 2
          ? ` · sem uso há ${semUso} dias`
          : !a.ultimoAcesso
            ? ' · ainda não entrou'
            : ` · ${a.usuarios} ${a.usuarios === 1 ? 'usuário' : 'usuários'}`}
      </span>
      <span className="cartao-venda__barra" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span>
        {a.leads} de {LEADS_TESTE} leads
        {a.reunioes ? ` · ${a.reunioes} ${a.reunioes === 1 ? 'reunião' : 'reuniões'}` : ''}
      </span>
    </div>
  );
}

export function useNovosPedidos(ativo: boolean) {
  return useQuery({
    queryKey: ['master', 'site', 'novos'],
    queryFn: () => api<{ novos: number }>('/master/site/novos'),
    enabled: ativo,
    refetchInterval: 60_000,
  });
}

const fmtDemo = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export function PlataformaVendas() {
  const sessao = useSessao();
  const master = !!sessao.data?.master;
  const cliente = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [novo, setNovo] = useState(false);
  const [contato, setContato] = useState(false);
  const q = useQuery({
    queryKey: ['master', 'site'],
    queryFn: () => api<DadosVendas>('/master/site'),
    enabled: master,
    refetchInterval: 60_000,
  });
  const mover = useMutation({
    mutationFn: (v: { id: number; etapa: EtapaVenda }) =>
      api(`/master/site/pedidos/${v.id}`, { metodo: 'PATCH', corpo: { etapa: v.etapa } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['master'] }),
  });
  const abertoId = Number(params.get('pedido')) || null;
  const abrir = (id: number | null) => {
    const p = new URLSearchParams(params);
    id ? p.set('pedido', String(id)) : p.delete('pedido');
    setParams(p, { replace: true });
  };

  if (sessao.data && !master) return <Navigate to="/" replace />;
  const pedidos = q.data?.pedidos ?? [];
  const em = (e: EtapaVenda) => pedidos.filter((p) => p.etapa === e);
  const andamento = pedidos.filter((p) => !['cliente', 'perdido'].includes(p.etapa)).length;
  const n = q.data?.numeros;
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const doMes = (p: Pedido) => new Date(p.atualizadoEm) >= inicioMes;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Vendas</h1>
          <p>
            Quem pediu demonstração ou começou o teste grátis pelo site (e os contatos que você cadastrar) até
            virar cliente. Fica separado do CRM.
          </p>
        </div>
        <div className="acoes">
          <Button variant="ghost" icon="message-circle" onClick={() => setContato(true)}>
            Contato do site
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setNovo(true)}>
            Novo pedido
          </Button>
        </div>
      </div>
      <div className="kpis">
        <Stat rotulo="Novos pedidos" valor={em('novo').length} delta={`${andamento} em andamento`} />
        {n ? (
          <>
            <Stat
              rotulo="Testes em andamento"
              valor={n.testando}
              delta={
                n.terminamNaSemana
                  ? `${n.terminamNaSemana} ${n.terminamNaSemana === 1 ? 'termina' : 'terminam'} esta semana`
                  : undefined
              }
            />
            <Stat
              rotulo="Viraram assinatura (30 dias)"
              valor={n.viraram30}
              delta={
                n.testes30
                  ? `de ${n.testes30} testes · ${Math.round((n.viraram30 / n.testes30) * 100)}%`
                  : undefined
              }
            />
            <Stat rotulo="Assinaturas ativas" valor={n.ativas} delta={`MRR ${fmtBrl(n.mrr)}`} />
            <Stat
              rotulo="Atrasadas"
              valor={n.atrasadas}
              delta={n.emAberto ? `${fmtBrl(n.emAberto)} em aberto` : undefined}
            />
            <Stat rotulo="Só leitura" valor={n.soLeitura} delta="teste venceu ou pagamento parou" />
          </>
        ) : (
          <>
            <Stat rotulo="Viraram cliente no mês" valor={em('cliente').filter(doMes).length} />
            <Stat rotulo="Perdidos no mês" valor={em('perdido').filter(doMes).length} />
          </>
        )}
      </div>
      {q.data && !q.data.config.whatsapp && !q.data.config.email && (
        <p className="aviso-linha">
          O site ainda não tem WhatsApp do comercial: os pedidos chegam aqui, mas a pessoa não é levada para a
          conversa.{' '}
          <button type="button" className="link-botao" onClick={() => setContato(true)}>
            Cadastrar agora
          </button>
        </p>
      )}
      <ErroDaApi erro={q.error ?? mover.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : (
        <div className="quadro-vendas">
          {ETAPAS_VENDA.map((etapa) => (
            <section
              key={etapa}
              className="quadro-vendas__coluna"
              data-etapa={etapa}
              aria-label={ROTULO_ETAPA_VENDA[etapa]}
            >
              <header className="quadro-vendas__cabeca">
                <b>{ROTULO_ETAPA_VENDA[etapa]}</b>
                <span className="mono quieto">{em(etapa).length}</span>
              </header>
              {em(etapa).length === 0 ? (
                <p className="quadro-vendas__vazio">Nenhum pedido aqui</p>
              ) : (
                em(etapa).map((p) => (
                  <article key={p.id} className="cartao-venda">
                    <button type="button" className="cartao-venda__abrir" onClick={() => abrir(p.id)}>
                      <b className="cartao-venda__empresa">{p.empresa}</b>
                      <span className="cartao-venda__contato">{p.nome}</span>
                    </button>
                    <div className="cartao-venda__dados">
                      {p.plano && <Badge tone="outline">{p.plano}</Badge>}
                      {p.whatsapp && <span className="mono">{formatarTelefone(p.whatsapp)}</span>}
                    </div>
                    {p.assinatura?.situacao === 'teste' && <UsoDoTeste a={p.assinatura} />}
                    {p.assinatura && p.assinatura.situacao !== 'teste' && (
                      <span className="cartao-venda__assinatura">
                        <Badge
                          tone={
                            p.assinatura.situacao === 'ativa'
                              ? 'brand'
                              : p.assinatura.situacao === 'atrasada'
                                ? 'danger'
                                : 'outline'
                          }
                        >
                          {ROTULO_ASSINATURA[p.assinatura.situacao]}
                        </Badge>
                        {p.assinatura.valor != null &&
                          (p.assinatura.situacao === 'ativa' || p.assinatura.situacao === 'atrasada') && (
                            <span className="quieto">
                              {fmtBrl(p.assinatura.valor)}
                              {p.assinatura.forma
                                ? ` · ${NOME_FORMA[p.assinatura.forma] ?? p.assinatura.forma}`
                                : ''}
                            </span>
                          )}
                      </span>
                    )}
                    {p.etapa === 'demonstracao' && p.demonstracaoEm && (
                      <span className="cartao-venda__demo">Demonstração {fmtDemo(p.demonstracaoEm)}</span>
                    )}
                    {p.etapa === 'cliente' && p.contaNome && (
                      <span className="quieto" style={{ fontSize: 12 }}>
                        Conta: {p.contaNome}
                      </span>
                    )}
                    {p.etapa === 'perdido' && p.motivoPerda && (
                      <span className="quieto" style={{ fontSize: 12 }}>
                        {p.motivoPerda}
                      </span>
                    )}
                    <div className="cartao-venda__rodape">
                      <span className="quieto">{fmtQuando(p.criadoEm)}</span>
                      {PROXIMA[p.etapa] && PROXIMA[p.etapa] !== 'cliente' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={mover.isPending}
                          title={`Passar para ${ROTULO_ETAPA_VENDA[PROXIMA[p.etapa]!]}`}
                          aria-label={`Passar ${p.empresa} para ${ROTULO_ETAPA_VENDA[PROXIMA[p.etapa]!]}`}
                          onClick={() => mover.mutate({ id: p.id, etapa: PROXIMA[p.etapa]! })}
                        >
                          Avançar →
                        </Button>
                      )}
                      {p.etapa === 'proposta' && (
                        <Button size="sm" variant="ghost" onClick={() => abrir(p.id)}>
                          Fechar →
                        </Button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </section>
          ))}
        </div>
      )}
      {abertoId && <DetalhePedido key={abertoId} id={abertoId} aoFechar={() => abrir(null)} />}
      {novo && (
        <NovoPedido
          aoFechar={() => setNovo(false)}
          aoCriar={(id) => {
            setNovo(false);
            abrir(id);
          }}
        />
      )}
      {contato && q.data && (
        <Drawer titulo="Contato do site" barra="Vendas" aoFechar={() => setContato(false)}>
          <div className="drawer__corpo">
            <ContatoDoSite inicial={q.data.config} aoSalvar={() => setContato(false)} />
          </div>
        </Drawer>
      )}
    </>
  );
}

function DetalhePedido(props: { id: number; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['master', 'pedido', props.id],
    queryFn: () => api<PedidoDetalhe>(`/master/site/pedidos/${props.id}`),
  });
  const [nota, setNota] = useState('');
  const [perda, setPerda] = useState('');
  const [demo, setDemo] = useState('');
  const [criarConta, setCriarConta] = useState(false);
  const atualizar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      api<PedidoDetalhe>(`/master/site/pedidos/${props.id}`, { metodo: 'PATCH', corpo }),
    onSuccess: (p) => {
      cliente.setQueryData(['master', 'pedido', props.id], p);
      cliente.invalidateQueries({ queryKey: ['master', 'site'] });
      cliente.invalidateQueries({ queryKey: ['master', 'visao'] });
    },
  });
  const anotar = useMutation({
    mutationFn: () =>
      api<PedidoDetalhe>(`/master/site/pedidos/${props.id}/notas`, {
        metodo: 'POST',
        corpo: { texto: nota },
      }),
    onSuccess: (p) => {
      setNota('');
      cliente.setQueryData(['master', 'pedido', props.id], p);
      cliente.invalidateQueries({ queryKey: ['master', 'site'] });
    },
  });
  const excluir = useMutation({
    mutationFn: () => api(`/master/site/pedidos/${props.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['master', 'site'] });
      props.aoFechar();
    },
  });
  const p = q.data;
  const texto = p
    ? p.canal === 'teste'
      ? `Olá, ${p.nome.split(' ')[0]}! Aqui é do Prospect Team. Vi que a ${p.empresa} está testando o sistema. Posso te ajudar a montar a primeira campanha?`
      : `Olá, ${p.nome.split(' ')[0]}! Aqui é do Prospect Team. Vi seu pedido de demonstração para a ${p.empresa}. Qual o melhor horário para conversarmos?`
    : '';

  return (
    <Drawer titulo={p?.empresa ?? 'Pedido'} barra="Vendas" aoFechar={props.aoFechar} largo>
      <div className="drawer__corpo pilha" style={{ gap: 20 }}>
        <ErroDaApi erro={q.error ?? atualizar.error ?? anotar.error ?? excluir.error} />
        {!p ? (
          <div className="esqueleto" />
        ) : (
          <>
            <section className="pilha" style={{ gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>{p.empresa}</h2>
              <div className="pedido__linha">
                <Badge tone={p.etapa === 'cliente' ? 'brand' : p.etapa === 'perdido' ? 'danger' : 'outline'}>
                  {ROTULO_ETAPA_VENDA[p.etapa]}
                </Badge>
                <span className="quieto">
                  {ORIGEM[p.canal]} · {fmtQuando(p.criadoEm)}
                </span>
              </div>
              <dl className="pedido__dados">
                <dt>Contato</dt>
                <dd>{p.nome}</dd>
                <dt>WhatsApp</dt>
                <dd>
                  {p.whatsapp ? (
                    <a
                      href={`https://wa.me/55${p.whatsapp}?text=${encodeURIComponent(texto)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {formatarTelefone(p.whatsapp)}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
                {p.email && (
                  <>
                    <dt>E-mail</dt>
                    <dd>
                      <a href={`mailto:${p.email}`}>{p.email}</a>
                    </dd>
                  </>
                )}
                <dt>Vende para</dt>
                <dd>{p.nicho ?? '—'}</dd>
                <dt>Plano de interesse</dt>
                <dd>{p.plano ?? 'Não disse'}</dd>
                {p.contaNome && (
                  <>
                    <dt>Conta no sistema</dt>
                    <dd>{p.contaNome}</dd>
                  </>
                )}
              </dl>
              <div className="acoes">
                {p.whatsapp && (
                  <Button
                    variant="primary"
                    icon="message-circle"
                    href={`https://wa.me/55${p.whatsapp}?text=${encodeURIComponent(texto)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Chamar no WhatsApp
                  </Button>
                )}
                {!p.contaId && p.etapa !== 'perdido' && (
                  <Button variant="ghost" icon="building-2" onClick={() => setCriarConta(true)}>
                    Virou cliente: criar a conta
                  </Button>
                )}
              </div>
            </section>

            <section className="pilha" style={{ gap: 12 }}>
              <h3 style={{ margin: 0 }}>Etapa</h3>
              <div className="segmentos">
                {ETAPAS_VENDA.filter((e) => e !== 'cliente' || p.contaId).map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="segmento"
                    aria-pressed={p.etapa === e}
                    data-ativo={p.etapa === e || undefined}
                    disabled={
                      atualizar.isPending || (e === 'perdido' && p.etapa !== 'perdido' && !perda.trim())
                    }
                    title={e === 'perdido' && !perda.trim() ? 'Escreva o motivo abaixo' : undefined}
                    onClick={() =>
                      atualizar.mutate(
                        e === 'perdido' ? { etapa: e, motivoPerda: perda.trim() } : { etapa: e },
                      )
                    }
                  >
                    {ROTULO_ETAPA_VENDA[e]}
                  </button>
                ))}
              </div>
              {!p.contaId && (
                <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                  “Virou cliente” aparece depois de criar a conta dele.
                </p>
              )}
              <div className="form__duas">
                <div className="campo">
                  <label htmlFor="pv-demo">Demonstração marcada para</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="pv-demo"
                      className="filtro"
                      type="datetime-local"
                      value={demo}
                      onChange={(e) => setDemo(e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      disabled={!demo || atualizar.isPending}
                      onClick={() =>
                        atualizar.mutate({
                          demonstracaoEm: new Date(demo).toISOString(),
                          ...(['novo', 'contato'].includes(p.etapa) ? { etapa: 'demonstracao' } : {}),
                        })
                      }
                    >
                      Marcar
                    </Button>
                  </div>
                  {p.demonstracaoEm && (
                    <span className="campo__dica">Marcada: {fmtDemo(p.demonstracaoEm)}</span>
                  )}
                </div>
                {p.etapa !== 'perdido' && (
                  <div className="campo">
                    <label htmlFor="pv-perda">Motivo, se perdeu</label>
                    <input
                      id="pv-perda"
                      className="filtro"
                      maxLength={300}
                      placeholder="Ex.: achou caro; fechou com outro"
                      value={perda}
                      onChange={(e) => setPerda(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </section>

            <section className="pilha" style={{ gap: 12 }}>
              <h3 style={{ margin: 0 }}>Histórico</h3>
              <form
                className="pedido__nota"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (nota.trim()) anotar.mutate();
                }}
              >
                <label className="pp-sr" htmlFor="pv-nota">
                  Anotação
                </label>
                <input
                  id="pv-nota"
                  className="filtro"
                  maxLength={1000}
                  placeholder="Anote o que aconteceu (ligou, mandou proposta…)"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                />
                <Button variant="ghost" type="submit" disabled={!nota.trim() || anotar.isPending}>
                  Anotar
                </Button>
              </form>
              <ul className="pedido__historico">
                {p.historico.map((h) => (
                  <li key={h.id} className="pedido__evento">
                    <span>{h.texto}</span>
                    <span className="quieto">
                      {h.autor ? `${h.autor} · ` : ''}
                      {fmtQuando(h.criadoEm)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <div>
              <Button
                variant="ghost"
                icon="trash-2"
                disabled={excluir.isPending}
                onClick={() => {
                  if (window.confirm(`Excluir o pedido de ${p.empresa}? O histórico some junto.`))
                    excluir.mutate();
                }}
              >
                Excluir pedido
              </Button>
            </div>
          </>
        )}
      </div>
      {criarConta && p && (
        <NovaConta
          inicial={{
            nome: p.empresa,
            adminNome: p.nome,
            email: p.email,
            plano:
              (['start', 'time', 'escala'] as const).find((x) => x === p.plano?.toLowerCase()) ?? 'start',
            observacoes: p.nicho ? `Vende para: ${p.nicho}` : '',
          }}
          aoFechar={() => setCriarConta(false)}
          aoAbrir={() => setCriarConta(false)}
          aoCriar={(contaId) => atualizar.mutate({ contaId, etapa: 'cliente' })}
        />
      )}
    </Drawer>
  );
}

function NovoPedido(props: { aoFechar: () => void; aoCriar: (id: number) => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    nome: '',
    empresa: '',
    whatsapp: '',
    email: '',
    nicho: '',
    plano: 'Ainda não sei',
    nota: '',
  });
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number }>('/master/site/pedidos', {
        metodo: 'POST',
        corpo: { ...f, email: f.email || null, nicho: f.nicho || null, nota: f.nota || null },
      }),
    onSuccess: (r) => {
      cliente.invalidateQueries({ queryKey: ['master'] });
      props.aoCriar(r.id);
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Drawer titulo="Novo pedido" barra="Vendas" aoFechar={props.aoFechar}>
      <form
        className="drawer__corpo form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          criar.mutate();
        }}
      >
        <div className="campo">
          <label htmlFor="np-empresa">Empresa</label>
          <input
            id="np-empresa"
            className="filtro"
            maxLength={160}
            value={f.empresa}
            onChange={set('empresa')}
          />
        </div>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="np-nome">Contato</label>
            <input id="np-nome" className="filtro" maxLength={120} value={f.nome} onChange={set('nome')} />
          </div>
          <div className="campo">
            <label htmlFor="np-whats">WhatsApp</label>
            <input
              id="np-whats"
              className="filtro"
              inputMode="tel"
              placeholder="(71) 99999-1234"
              value={f.whatsapp}
              onChange={set('whatsapp')}
            />
          </div>
        </div>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="np-email">E-mail</label>
            <input id="np-email" className="filtro" type="email" value={f.email} onChange={set('email')} />
          </div>
          <div className="campo">
            <label htmlFor="np-plano">Plano de interesse</label>
            <select id="np-plano" className="filtro" value={f.plano} onChange={set('plano')}>
              {['Ainda não sei', 'Start', 'Time', 'Escala'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="np-nicho">Para quem vende</label>
          <input id="np-nicho" className="filtro" maxLength={200} value={f.nicho} onChange={set('nicho')} />
        </div>
        <div className="campo">
          <label htmlFor="np-nota">Observação</label>
          <textarea
            id="np-nota"
            className="filtro"
            rows={2}
            maxLength={2000}
            value={f.nota}
            onChange={set('nota')}
          />
        </div>
        <ErroDaApi erro={criar.error} />
        <Button variant="primary" type="submit" disabled={criar.isPending || f.empresa.trim().length < 2}>
          {criar.isPending ? 'Salvando…' : 'Cadastrar pedido'}
        </Button>
      </form>
    </Drawer>
  );
}

/** WhatsApp e e-mail que o botão do site abre com a mensagem pronta. */
export function ContatoDoSite(props: { inicial: DadosVendas['config']; aoSalvar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    whatsapp: props.inicial.whatsapp ? formatarTelefone(props.inicial.whatsapp.slice(2)) : '',
    email: props.inicial.email ?? '',
  });
  const salvar = useMutation({
    mutationFn: () =>
      api('/master/site/config', {
        metodo: 'PUT',
        corpo: { whatsapp: f.whatsapp || null, email: f.email || null },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['master', 'site'] });
      props.aoSalvar();
    },
  });
  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Depois de enviar o formulário do site, a pessoa vai para este WhatsApp (ou e-mail) com a mensagem
        pronta. O pedido cai no quadro de Vendas de qualquer jeito. O site passa a usar em até 5 minutos.
      </p>
      <div className="campo">
        <label htmlFor="site-whats">WhatsApp do comercial</label>
        <input
          id="site-whats"
          className="filtro"
          inputMode="tel"
          placeholder="(71) 99999-1234"
          value={f.whatsapp}
          onChange={(e) => setF({ ...f, whatsapp: e.target.value })}
        />
      </div>
      <div className="campo">
        <label htmlFor="site-email">E-mail do comercial</label>
        <input
          id="site-email"
          className="filtro"
          type="email"
          placeholder="comercial@suaempresa.com.br"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
      </div>
      <ErroDaApi erro={salvar.error} />
      <Button variant="primary" type="submit" disabled={salvar.isPending}>
        {salvar.isPending ? 'Salvando…' : 'Salvar contato'}
      </Button>
    </form>
  );
}
