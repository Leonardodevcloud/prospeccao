import { Badge, Button, EmptyState } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { fmtQuando, formatarTelefone } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

/** Pedidos de demonstração que chegaram pelo formulário do site institucional. */

type StatusPedido = 'novo' | 'atendido' | 'descartado';

interface PedidoSite {
  id: number;
  nome: string;
  empresa: string;
  whatsapp: string | null;
  email: string | null;
  nicho: string | null;
  plano: string | null;
  canal: 'whatsapp' | 'email' | 'formulario';
  status: StatusPedido;
  empresaId: number | null;
  erroLead: string | null;
  criadoEm: string;
}

interface DadosSite {
  config: { whatsapp: string | null; email: string | null };
  pedidos: PedidoSite[];
}

const ROTULO_STATUS: Record<StatusPedido, string> = {
  novo: 'Novo',
  atendido: 'Atendido',
  descartado: 'Descartado',
};

const ROTULO_CANAL: Record<PedidoSite['canal'], string> = {
  whatsapp: 'foi para o WhatsApp',
  email: 'foi para o e-mail',
  formulario: 'só o formulário',
};

export function useNovosDoSite(ativo: boolean) {
  return useQuery({
    queryKey: ['master', 'site', 'novos'],
    queryFn: () => api<{ novos: number }>('/master/site/novos'),
    enabled: ativo,
    refetchInterval: 60_000,
  });
}

/** `naContaPrincipal`: o master está na própria conta, então o lead abre no funil dele. */
export function PedidosSite(props: { naContaPrincipal: boolean }) {
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['master', 'site'], queryFn: () => api<DadosSite>('/master/site') });
  const [filtro, setFiltro] = useState<StatusPedido | 'todos'>('novo');
  const mudar = useMutation({
    mutationFn: (v: { id: number; status: StatusPedido }) =>
      api(`/master/site/pedidos/${v.id}`, { metodo: 'PATCH', corpo: { status: v.status } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['master', 'site'] }),
  });

  const pedidos = q.data?.pedidos ?? [];
  const visiveis = pedidos.filter((p) => filtro === 'todos' || p.status === filtro);
  const contagem = (s: StatusPedido) => pedidos.filter((p) => p.status === s).length;

  return (
    <div className="pilha" style={{ gap: 20 }}>
      {q.data && <ContatoDoSite inicial={q.data.config} />}

      <section className="pilha" style={{ gap: 12 }}>
        <div className="pedidos-site__topo">
          <h3 style={{ margin: 0 }}>Pedidos de demonstração</h3>
          <fieldset className="segmentos" aria-label="Filtrar pedidos">
            {(['novo', 'atendido', 'descartado', 'todos'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className="segmento"
                aria-pressed={filtro === s}
                data-ativo={filtro === s || undefined}
                onClick={() => setFiltro(s)}
              >
                {s === 'todos' ? `Todos (${pedidos.length})` : `${ROTULO_STATUS[s]}s (${contagem(s)})`}
              </button>
            ))}
          </fieldset>
        </div>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Cada pedido também entra como lead na coluna inicial do funil da sua conta, com o que a pessoa
          escreveu na observação, e avisa no sino.
        </p>
        <ErroDaApi erro={q.error ?? mudar.error} />
        {q.isPending ? (
          <div className="esqueleto" />
        ) : !visiveis.length ? (
          <div className="pp-panel">
            <EmptyState
              icone="inbox"
              titulo={filtro === 'novo' ? 'Nenhum pedido novo' : 'Nenhum pedido aqui'}
              texto="Quando alguém preencher “Agendar demonstração” no site, o pedido aparece aqui."
            />
          </div>
        ) : (
          <ul className="pedidos-site">
            {visiveis.map((p) => (
              <li key={p.id} className="pedidos-site__item">
                <div className="pedidos-site__cabeca">
                  <div>
                    <strong>{p.empresa}</strong>
                    <span className="quieto"> · {p.nome}</span>
                  </div>
                  <Badge
                    tone={p.status === 'novo' ? 'brand' : p.status === 'atendido' ? 'outline' : 'neutral'}
                  >
                    {ROTULO_STATUS[p.status]}
                  </Badge>
                </div>
                <div className="pedidos-site__dados">
                  {p.whatsapp && (
                    <a href={`https://wa.me/55${p.whatsapp}`} target="_blank" rel="noopener noreferrer">
                      {formatarTelefone(p.whatsapp)}
                    </a>
                  )}
                  {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
                  {p.plano && <span>Plano: {p.plano}</span>}
                  <span className="quieto">
                    {fmtQuando(p.criadoEm)} · {ROTULO_CANAL[p.canal]}
                  </span>
                </div>
                {p.nicho && <p className="pedidos-site__nicho">Vende para: {p.nicho}</p>}
                {p.erroLead && <Mensagem tipo="aviso">Não entrou no funil: {p.erroLead}</Mensagem>}
                <div className="pedidos-site__acoes">
                  {p.empresaId &&
                    (props.naContaPrincipal ? (
                      <Link className="link-botao" to={`/funil?empresa=${p.empresaId}`}>
                        Abrir no funil
                      </Link>
                    ) : (
                      <span className="quieto" style={{ fontSize: 13 }}>
                        No funil da sua conta
                      </span>
                    ))}
                  {p.status !== 'atendido' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="check"
                      disabled={mudar.isPending}
                      onClick={() => mudar.mutate({ id: p.id, status: 'atendido' })}
                    >
                      Marcar atendido
                    </Button>
                  )}
                  {p.status !== 'descartado' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="x"
                      disabled={mudar.isPending}
                      onClick={() => mudar.mutate({ id: p.id, status: 'descartado' })}
                    >
                      Descartar
                    </Button>
                  )}
                  {p.status !== 'novo' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={mudar.isPending}
                      onClick={() => mudar.mutate({ id: p.id, status: 'novo' })}
                    >
                      Voltar para novos
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** WhatsApp e e-mail que o botão do site abre com a mensagem pronta. */
function ContatoDoSite(props: { inicial: DadosSite['config'] }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    whatsapp: props.inicial.whatsapp ? formatarTelefone(props.inicial.whatsapp.slice(2)) : '',
    email: props.inicial.email ?? '',
  });
  const [salvo, setSalvo] = useState(false);
  const salvar = useMutation({
    mutationFn: () =>
      api('/master/site/config', {
        metodo: 'PUT',
        corpo: { whatsapp: f.whatsapp || null, email: f.email || null },
      }),
    onSuccess: () => {
      setSalvo(true);
      cliente.invalidateQueries({ queryKey: ['master', 'site'] });
    },
  });
  return (
    <form
      className="pp-panel form"
      style={{ padding: 16 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <h3 style={{ margin: 0 }}>Contato que o site mostra</h3>
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Depois de enviar o formulário, a pessoa vai para este WhatsApp (ou e-mail) com a mensagem pronta. Sem
        nenhum dos dois, o pedido chega só aqui e no funil.
      </p>
      <div className="form__duas">
        <div className="campo">
          <label htmlFor="site-whats">WhatsApp do comercial</label>
          <input
            id="site-whats"
            className="filtro"
            inputMode="tel"
            placeholder="(71) 99999-1234"
            value={f.whatsapp}
            onChange={(e) => {
              setSalvo(false);
              setF({ ...f, whatsapp: e.target.value });
            }}
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
            onChange={(e) => {
              setSalvo(false);
              setF({ ...f, email: e.target.value });
            }}
          />
        </div>
      </div>
      <ErroDaApi erro={salvar.error} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button variant="primary" type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar contato'}
        </Button>
        {salvo && <span className="quieto">Salvo. O site usa em até 5 minutos.</span>}
      </div>
    </form>
  );
}
