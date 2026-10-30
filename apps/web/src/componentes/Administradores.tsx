import { Badge, Button, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { fmtQuando } from '../formatar';
import { LinkConvite } from '../paginas/Equipe';
import { ErroDaApi } from './Formulario';
import { AcessoUsuario } from './GerenciarCliente';

/*
 * Administradores da plataforma (master): quem vê o painel inteiro (clientes, financeiro,
 * configurações). O do ADMIN_EMAIL é o acesso de emergência e não sai daqui.
 */

interface Administrador {
  id: number;
  nome: string;
  email: string;
  ativo: boolean;
  convitePendente: boolean;
  ultimoAcesso: string | null;
  duasEtapas: boolean;
  doAmbiente: boolean;
  voce: boolean;
}

export function Administradores() {
  const cliente = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState({ nome: '', email: '' });
  const [link, setLink] = useState<{ link: string; nome: string; dias: number } | null>(null);
  const [acesso, setAcesso] = useState<number | null>(null);
  const [tirar, setTirar] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['master', 'administradores'],
    queryFn: () => api<Administrador[]>('/master/administradores'),
  });
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['master', 'administradores'] });
  const criar = useMutation({
    mutationFn: () =>
      api<{ convite: string | null; diasValidade: number }>('/master/administradores', {
        metodo: 'POST',
        corpo: f,
      }),
    onSuccess: (d) => {
      setLink(d.convite ? { link: d.convite, nome: f.nome, dias: d.diasValidade } : null);
      setF({ nome: '', email: '' });
      setNovo(false);
      atualizar();
    },
  });
  const mudar = useMutation({
    mutationFn: (d: { id: number; ativo?: boolean; master?: false }) =>
      api(`/master/administradores/${d.id}`, {
        metodo: 'PATCH',
        corpo: { ativo: d.ativo, master: d.master },
      }),
    onSuccess: () => {
      setTirar(null);
      atualizar();
    },
  });
  const convite = useMutation({
    mutationFn: (a: Administrador) =>
      api<{ convite: string; diasValidade: number }>(`/master/administradores/${a.id}/convite`, {
        metodo: 'POST',
      }).then((d) => ({ ...d, nome: a.nome })),
    onSuccess: (d) => {
      setLink({ link: d.convite, nome: d.nome, dias: d.diasValidade });
      atualizar();
    },
  });

  return (
    <Panel
      titulo="Administradores da plataforma"
      contagem={q.data?.filter((a) => a.ativo).length}
      acoes={
        !novo && (
          <Button size="sm" variant="secondary" icon="plus" onClick={() => setNovo(true)}>
            Novo administrador
          </Button>
        )
      }
    >
      <div className="pilha" style={{ gap: 12 }}>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Quem entra aqui vê e muda tudo: clientes, planos, financeiro, configurações e o CRM de demonstração.
          Dê esse acesso só a quem administra a plataforma com você.
        </p>
        {novo && (
          <form
            className="form caixa"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              criar.mutate();
            }}
          >
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="adm-nome">Nome</label>
                <input
                  id="adm-nome"
                  className="filtro"
                  maxLength={80}
                  value={f.nome}
                  onChange={(e) => setF({ ...f, nome: e.target.value })}
                />
              </div>
              <div className="campo">
                <label htmlFor="adm-email">E-mail</label>
                <input
                  id="adm-email"
                  className="filtro"
                  type="email"
                  value={f.email}
                  onChange={(e) => setF({ ...f, email: e.target.value })}
                />
                <span className="campo__dica">
                  Não pode ser o e-mail de alguém de um cliente. A pessoa recebe um link para criar a senha.
                </span>
              </div>
            </div>
            <ErroDaApi erro={criar.error} />
            <div className="acoes">
              <Button
                type="submit"
                variant="primary"
                disabled={criar.isPending || f.nome.trim().length < 2 || !f.email.includes('@')}
              >
                {criar.isPending ? 'Criando…' : 'Criar e gerar o link'}
              </Button>
              <Button variant="ghost" onClick={() => setNovo(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
        {link && <LinkConvite link={link.link} nome={link.nome} dias={link.dias} />}
        {q.isPending ? (
          <div className="esqueleto" />
        ) : (
          <ul className="usuarios-conta">
            {(q.data ?? []).map((a) => {
              const mexe = !a.voce && !a.doAmbiente;
              return (
                <li key={a.id} data-inativo={!a.ativo || undefined}>
                  <span className="usuarios-conta__quem">
                    <b>{a.nome}</b>
                    <span className="quieto">{a.email}</span>
                  </span>
                  <span className="usuarios-conta__info">
                    {a.voce && <Badge tone="brand">Você</Badge>}
                    {a.doAmbiente && (
                      <span title="O e-mail do ADMIN_EMAIL, configurado no servidor: sempre entra, mesmo que algo dê errado aqui.">
                        <Badge tone="outline">Acesso de emergência</Badge>
                      </span>
                    )}
                    {!a.ativo && <Badge tone="neutral">Desativado</Badge>}
                    {a.ativo && a.convitePendente && <Badge tone="warning">Convite pendente</Badge>}
                    {a.duasEtapas && <Badge tone="outline">Duas etapas</Badge>}
                    {a.ultimoAcesso && <span className="quieto">entrou {fmtQuando(a.ultimoAcesso)}</span>}
                  </span>
                  {mexe && (
                    <span className="usuarios-conta__acoes">
                      {a.ativo && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="link"
                          disabled={convite.isPending}
                          onClick={() => convite.mutate(a)}
                        >
                          {a.convitePendente ? 'Novo convite' : 'Link de nova senha'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="lock"
                        aria-expanded={acesso === a.id}
                        onClick={() => setAcesso(acesso === a.id ? null : a.id)}
                      >
                        E-mail e senha
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={mudar.isPending}
                        onClick={() => mudar.mutate({ id: a.id, ativo: !a.ativo })}
                      >
                        {a.ativo ? 'Desativar' : 'Reativar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setTirar(tirar === a.id ? null : a.id)}
                      >
                        Tirar acesso
                      </Button>
                    </span>
                  )}
                  {acesso === a.id && (
                    <AcessoUsuario
                      usuario={a}
                      aoFechar={() => {
                        setAcesso(null);
                        atualizar();
                      }}
                    />
                  )}
                  {tirar === a.id && (
                    <div className="confirmar" style={{ flex: '1 1 100%' }}>
                      <b>Tirar o acesso de administrador de {a.nome}?</b>
                      <span className="quieto">
                        A pessoa sai do painel na hora. Ela continua na equipe da sua conta (o seu CRM), sem
                        ver clientes, financeiro e configurações. Dá para devolver criando de novo com o mesmo
                        e-mail.
                      </span>
                      <div className="acoes">
                        <Button
                          variant="danger"
                          disabled={mudar.isPending}
                          onClick={() => mudar.mutate({ id: a.id, master: false })}
                        >
                          Tirar o acesso de {a.nome.split(' ')[0]}
                        </Button>
                        <Button variant="ghost" onClick={() => setTirar(null)}>
                          Manter
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ErroDaApi erro={q.error ?? mudar.error ?? convite.error} />
      </div>
    </Panel>
  );
}
