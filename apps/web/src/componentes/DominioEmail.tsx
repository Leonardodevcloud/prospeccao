import { Badge, Button, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtQuando } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

type Situacao = 'pendente' | 'verificado' | 'falhou';

interface RegistroDns {
  finalidade: string;
  tipo: string;
  nome: string;
  valor: string;
  prioridade: number | null;
  ttl: string | null;
  situacao: Situacao;
}

export interface TelaDominio {
  dominio: {
    dominio: string;
    situacao: Situacao;
    registros: RegistroDns[];
    remetente: string | null;
    conferidoEm: string | null;
    verificadoEm: string | null;
  } | null;
  contaPropria: boolean;
  disponivel: boolean;
  emUso: boolean;
}

const SITUACAO: Record<Situacao, { tom: 'brand' | 'warning' | 'danger'; texto: string }> = {
  verificado: { tom: 'brand', texto: 'Verificado' },
  pendente: { tom: 'warning', texto: 'Aguardando o DNS' },
  falhou: { tom: 'danger', texto: 'Não encontrado' },
};

function Copiar(props: { valor: string; rotulo: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={ok ? 'check' : 'copy'}
      aria-label={`Copiar ${props.rotulo}`}
      title={`Copiar ${props.rotulo}`}
      onClick={() => {
        void navigator.clipboard?.writeText(props.valor);
        setOk(true);
        setTimeout(() => setOk(false), 2000);
      }}
    />
  );
}

function Registro(props: { r: RegistroDns; dmarc: boolean }) {
  const { r } = props;
  const s = SITUACAO[r.situacao];
  return (
    <li className="dns-registro">
      <div className="dns-registro__topo">
        <b>{r.finalidade}</b>
        {props.dmarc ? (
          <Badge tone="outline">Recomendado</Badge>
        ) : (
          <Badge tone={s.tom}>{r.situacao === 'verificado' ? 'Encontrado' : s.texto}</Badge>
        )}
      </div>
      <dl className="dns-registro__campos">
        <div>
          <dt>Tipo</dt>
          <dd className="mono">{r.tipo}</dd>
        </div>
        <div>
          <dt>Nome / Host</dt>
          <dd className="mono">
            <span className="dns-texto">{r.nome}</span>
            <Copiar valor={r.nome} rotulo="o nome" />
          </dd>
        </div>
        {r.prioridade != null && (
          <div>
            <dt>Prioridade</dt>
            <dd className="mono">{r.prioridade}</dd>
          </div>
        )}
        <div className="dns-registro__valor">
          <dt>Valor / Conteúdo</dt>
          <dd className="mono">
            <span className="dns-texto">{r.valor}</span>
            <Copiar valor={r.valor} rotulo="o valor" />
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * Domínio de e-mail da conta: o próprio cliente cadastra, vê os registros de DNS, confere e escolhe
 * o remetente. Sem depender do suporte.
 */
export function DominioEmail() {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['email', 'dominio'],
    queryFn: () => api<TelaDominio>('/email/dominio'),
    // Enquanto o DNS não verifica, a tela confere sozinha de vez em quando.
    refetchInterval: (r) =>
      r.state.data?.dominio && r.state.data.dominio.situacao !== 'verificado' ? 60_000 : false,
  });
  const [dominio, setDominio] = useState('');
  const [usuario, setUsuario] = useState('');
  const [apagar, setApagar] = useState(false);
  const d = q.data?.dominio ?? null;
  useEffect(() => {
    setUsuario(d?.remetente?.split('@')[0] ?? 'comercial');
  }, [d?.remetente]);
  const atualizar = (t: TelaDominio) => {
    cliente.setQueryData(['email', 'dominio'], t);
    cliente.invalidateQueries({ queryKey: ['email'] });
  };
  const cadastrar = useMutation({
    mutationFn: () => api<TelaDominio>('/email/dominio', { metodo: 'POST', corpo: { dominio } }),
    onSuccess: atualizar,
  });
  const verificar = useMutation({
    mutationFn: () => api<TelaDominio>('/email/dominio/verificar', { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  const remetente = useMutation({
    mutationFn: () =>
      api<TelaDominio>('/email/dominio/remetente', {
        metodo: 'PUT',
        corpo: { remetente: `${usuario.trim()}@${d?.dominio}` },
      }),
    onSuccess: atualizar,
  });
  const remover = useMutation({
    mutationFn: () => api<TelaDominio>('/email/dominio', { metodo: 'DELETE' }),
    onSuccess: (t) => {
      setApagar(false);
      atualizar(t);
    },
  });

  if (q.isPending) return <div className="esqueleto" style={{ height: 120 }} />;
  const t = q.data;
  if (!t) return <ErroDaApi erro={q.error} />;
  if (t.contaPropria)
    return (
      <Panel titulo="Domínio de e-mail">
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          O envio de e-mail desta conta já está configurado pelo suporte do Prospect Team.
        </p>
      </Panel>
    );

  return (
    <Panel
      titulo="Domínio de e-mail"
      acoes={d ? <Badge tone={SITUACAO[d.situacao].tom}>{SITUACAO[d.situacao].texto}</Badge> : undefined}
    >
      {!t.disponivel && (
        <Mensagem tipo="aviso">
          O cadastro de domínio não está disponível agora. Fale com o suporte do Prospect Team.
        </Mensagem>
      )}

      {t.disponivel && !d && (
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            cadastrar.mutate();
          }}
        >
          <p style={{ margin: 0 }}>
            Os e-mails saem com o domínio da sua empresa (ex.: comercial@suaempresa.com.br). Cadastre o
            domínio, copie 3 ou 4 registros para o DNS e pronto: não precisa de conta em nenhum serviço de
            e-mail.
          </p>
          <div className="campo" style={{ maxWidth: 420 }}>
            <label htmlFor="dom-nome">Domínio da sua empresa</label>
            <input
              id="dom-nome"
              className="filtro"
              placeholder="contato.suaempresa.com.br"
              value={dominio}
              onChange={(e) => setDominio(e.target.value)}
              autoComplete="off"
            />
            <span className="campo__dica">
              Dica: use um subdomínio só para prospecção (como <b>contato.</b>suaempresa.com.br). Assim o
              e-mail do dia a dia da empresa fica protegido.
            </span>
          </div>
          <ErroDaApi erro={cadastrar.error} />
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={cadastrar.isPending || dominio.trim().length < 4}
            >
              {cadastrar.isPending ? 'Cadastrando…' : 'Cadastrar domínio'}
            </Button>
          </div>
        </form>
      )}

      {d && d.situacao !== 'verificado' && (
        <div className="pilha" style={{ gap: 12 }}>
          <ol className="passos">
            <li>
              Entre no painel onde o domínio <b>{d.dominio}</b> está (Registro.br, GoDaddy, Hostinger,
              Cloudflare…) e abra a parte de <b>DNS</b> ou <b>Zona DNS</b>.
            </li>
            <li>Crie cada registro abaixo, copiando o tipo, o nome e o valor exatamente como estão.</li>
            <li>
              Volte aqui e clique em “Já configurei, conferir”. O DNS costuma levar de minutos a algumas
              horas.
            </li>
          </ol>
          <ul className="dns-lista">
            {d.registros.map((r) => (
              <Registro key={`${r.tipo}-${r.nome}`} r={r} dmarc={r.nome === '_dmarc'} />
            ))}
          </ul>
          {d.situacao === 'falhou' && (
            <Mensagem tipo="aviso">
              Os registros ainda não apareceram no DNS. Confira se o nome e o valor estão iguais (alguns
              painéis já completam o domínio sozinhos: nesse caso use só a primeira parte do nome) e confira
              de novo.
            </Mensagem>
          )}
          <ErroDaApi erro={verificar.error} />
          <div className="acoes">
            <Button
              variant="primary"
              icon="check"
              disabled={verificar.isPending}
              onClick={() => verificar.mutate()}
            >
              {verificar.isPending ? 'Conferindo…' : 'Já configurei, conferir'}
            </Button>
            {d.conferidoEm && <span className="quieto">conferido {fmtQuando(d.conferidoEm)}</span>}
          </div>
        </div>
      )}

      {d && d.situacao === 'verificado' && (
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            remetente.mutate();
          }}
        >
          <Mensagem tipo="ok">
            Domínio verificado{d.verificadoEm ? ` ${fmtQuando(d.verificadoEm)}` : ''}. Os e-mails saem por{' '}
            <b>{d.remetente}</b>.
          </Mensagem>
          <div className="campo" style={{ maxWidth: 420 }}>
            <label htmlFor="dom-remetente">Remetente</label>
            <div className="remetente-dominio">
              <input
                id="dom-remetente"
                className="filtro"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value.replace(/[\s@]/g, '').toLowerCase())}
              />
              <span className="mono">@{d.dominio}</span>
            </div>
            <span className="campo__dica">
              O nome que aparece para o lead, a assinatura e o logo ficam na aba Identidade visual.
            </span>
          </div>
          <ErroDaApi erro={remetente.error} />
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={remetente.isPending || !usuario || `${usuario}@${d.dominio}` === d.remetente}
            >
              Salvar remetente
            </Button>
          </div>
        </form>
      )}

      {d && (
        <div className="acoes">
          {apagar ? (
            <>
              <Button
                variant="danger"
                size="sm"
                disabled={remover.isPending}
                onClick={() => remover.mutate()}
              >
                Remover {d.dominio}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setApagar(false)}>
                Manter
              </Button>
              <span className="quieto">Os e-mails param de sair até você cadastrar outro domínio.</span>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setApagar(true)}>
              Trocar ou remover o domínio
            </Button>
          )}
          <ErroDaApi erro={remover.error} />
        </div>
      )}
    </Panel>
  );
}
