import { Badge, Button, EmptyState, Panel, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  api,
  type Organizacao as DadosOrganizacao,
  type PapelQualquer,
  type PessoaOrganizacao,
  ROTULO_PAPEL_QUALQUER,
  type UnidadeOrganizacao,
} from '../api';
import { Drawer } from '../componentes/Drawer';
import { ForaDoPlano } from '../componentes/ForaDoPlano';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { ROTULO_PLANO } from '../componentes/PlanoConta';
import { useRecurso, useSessao } from '../componentes/Sessao';
import { fmtNumero, fmtQuando } from '../formatar';
import { LinkConvite } from './Equipe';

/**
 * Organização (o cliente com várias unidades): o gestor vê as unidades e as pessoas, divide a
 * cota de leads, convida, move e desativa gente, e entra em qualquer unidade. A leitura só olha.
 */

const PAPEIS: PapelQualquer[] = ['gestor', 'leitura', 'admin', 'sdr', 'closer'];

export function useOrganizacao(ativo = true) {
  return useQuery({
    queryKey: ['organizacao'],
    queryFn: () => api<DadosOrganizacao>('/organizacao'),
    enabled: ativo,
  });
}

/** Troca de unidade (o sistema todo passa a mostrar a escolhida). */
export function useEntrarNaUnidade() {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  return useMutation({
    mutationFn: (id: number) => api(`/organizacao/unidades/${id}/entrar`, { metodo: 'POST' }),
    onSuccess: () => {
      // Tudo que estava na tela era da outra unidade.
      cliente.clear();
      navegar('/hoje');
    },
  });
}

export function Organizacao() {
  const sessao = useSessao();
  const daOrganizacao = !!sessao.data?.papelOrganizacao || !!sessao.data?.master;
  const leitura = sessao.data?.papelOrganizacao === 'leitura';
  const q = useOrganizacao(daOrganizacao);
  const entrar = useEntrarNaUnidade();
  const [novaUnidade, setNovaUnidade] = useState(false);
  const variasUnidades = useRecurso('unidades');
  const [unidade, setUnidade] = useState<UnidadeOrganizacao | null>(null);
  const [convidar, setConvidar] = useState(false);
  const [pessoa, setPessoa] = useState<PessoaOrganizacao | null>(null);
  const [filtroUnidade, setFiltroUnidade] = useState<number | 'todas'>('todas');

  if (sessao.data && !daOrganizacao) return <Navigate to="/" replace />;
  const d = q.data;
  const p = d?.plano;
  const ativas = d?.unidades.filter((u) => u.ativa) ?? [];
  const cotas = ativas.reduce((s, u) => s + (u.cotaLeadsMes ?? 0), 0);
  const pessoas = (d?.pessoas ?? []).filter(
    (x) => filtroUnidade === 'todas' || x.unidadeId === filtroUnidade,
  );

  return (
    <>
      <div className="topo">
        <div>
          <h1>Unidades e pessoas</h1>
          <p>
            {d ? `${d.organizacao.nome}: a` : 'A'}s unidades, as pessoas de cada uma e a cota de leads do mês.
            Entre numa unidade para trabalhar nela
            {leitura ? '' : ' ou para configurar'}.
          </p>
        </div>
        {!leitura && (
          <div className="acoes">
            <Button variant="ghost" icon="user-plus" onClick={() => setConvidar(true)}>
              Convidar pessoa
            </Button>
            {variasUnidades && (
              <Button variant="primary" icon="plus" onClick={() => setNovaUnidade(true)}>
                Nova unidade
              </Button>
            )}
          </div>
        )}
      </div>
      {leitura && (
        <p className="aviso-linha">Seu acesso é só de leitura: você vê tudo, mas não altera nada.</p>
      )}
      <ErroDaApi erro={q.error ?? entrar.error} />
      {!d || !p ? (
        <div className="esqueleto" />
      ) : (
        <>
          <div className="kpis">
            <Stat rotulo="Plano" valor={p.plano ? ROTULO_PLANO[p.plano] : 'Sem plano'} />
            <Stat rotulo="Unidades ativas" valor={fmtNumero(ativas.length)} />
            <Stat
              rotulo="Pessoas com acesso"
              valor={
                <>
                  {fmtNumero(p.uso.usuarios)}
                  {p.usuarios != null && <span className="quieto"> / {fmtNumero(p.usuarios)}</span>}
                </>
              }
            />
            <Stat
              rotulo="Leads enriquecidos no mês"
              valor={
                <>
                  {fmtNumero(p.uso.leadsMes)}
                  {p.leadsMes != null && <span className="quieto"> / {fmtNumero(p.leadsMes)}</span>}
                </>
              }
              delta={
                p.leadsMes != null && cotas > 0
                  ? `${fmtNumero(cotas)} em cotas · ${fmtNumero(Math.max(0, p.leadsMes - cotas))} livres`
                  : undefined
              }
            />
          </div>

          <Panel titulo="Unidades" contagem={d.unidades.length} className="org-painel">
            <div className="pp-tablewrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Unidade</th>
                    <th title="Leads enriquecidos no mês / cota da unidade">Leads no mês</th>
                    <th>Pessoas</th>
                    <th>No funil</th>
                    <th>Ganhos no mês</th>
                    <th>Último acesso</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {d.unidades.map((u) => (
                    <tr key={u.id} data-inativo={!u.ativa || undefined}>
                      <td>
                        <b>{u.nome}</b>{' '}
                        {sessao.data?.conta.id === u.id && <Badge tone="outline">Você está aqui</Badge>}
                        {!u.ativa && <Badge tone="danger">Desativada</Badge>}
                      </td>
                      <td
                        className="mono"
                        data-alerta={
                          u.cotaLeadsMes != null && u.leadsMes >= u.cotaLeadsMes
                            ? 'cheio'
                            : u.cotaLeadsMes != null && u.leadsMes >= u.cotaLeadsMes * 0.9
                              ? 'quase'
                              : undefined
                        }
                      >
                        {fmtNumero(u.leadsMes)}
                        <span className="quieto">
                          {' '}
                          / {u.cotaLeadsMes != null ? fmtNumero(u.cotaLeadsMes) : 'sem cota'}
                        </span>
                        {u.leadsEsperando > 0 && (
                          <div className="quieto" style={{ fontSize: 12 }}>
                            {fmtNumero(u.leadsEsperando)} esperando
                          </div>
                        )}
                      </td>
                      <td className="mono">{fmtNumero(u.pessoas)}</td>
                      <td className="mono">{fmtNumero(u.noFunil)}</td>
                      <td className="mono">{fmtNumero(u.ganhosMes)}</td>
                      <td className="quieto">{u.ultimoAcesso ? fmtQuando(u.ultimoAcesso) : 'nunca'}</td>
                      <td>
                        <div className="org-acoes">
                          {u.ativa && sessao.data?.conta.id !== u.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="arrow-right"
                              disabled={entrar.isPending}
                              onClick={() => entrar.mutate(u.id)}
                            >
                              Entrar
                            </Button>
                          )}
                          {!leitura && (
                            <Button size="sm" variant="ghost" icon="settings" onClick={() => setUnidade(u)}>
                              Editar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            titulo="Pessoas"
            contagem={d.pessoas.filter((x) => x.ativo).length}
            className="org-painel"
            acoes={
              <select
                className="filtro"
                aria-label="Filtrar por unidade"
                value={filtroUnidade}
                onChange={(e) =>
                  setFiltroUnidade(e.target.value === 'todas' ? 'todas' : Number(e.target.value))
                }
              >
                <option value="todas">Todas as unidades</option>
                {d.unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            }
          >
            {!pessoas.length ? (
              <EmptyState icone="users" titulo="Ninguém aqui" texto="Convide as pessoas desta unidade." />
            ) : (
              <div className="pp-tablewrap">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Pessoa</th>
                      <th>Papel</th>
                      <th>Unidade</th>
                      <th>Leads abertos</th>
                      <th>Último acesso</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {pessoas.map((x) => (
                      <tr key={x.id} data-inativo={!x.ativo || undefined}>
                        <td>
                          <b>{x.nome}</b>
                          <div className="quieto" style={{ fontSize: 12 }}>
                            {x.email}
                          </div>
                        </td>
                        <td>
                          {ROTULO_PAPEL_QUALQUER[x.papel]}{' '}
                          {!x.ativo && <Badge tone="danger">Desativado</Badge>}
                          {x.ativo && x.convitePendente && <Badge tone="warning">Convite pendente</Badge>}
                          {x.ativo && !x.convitePendente && x.duasEtapas && (
                            <span title="Verificação em duas etapas ligada">
                              <Badge tone="outline">2 etapas</Badge>
                            </span>
                          )}
                        </td>
                        <td>
                          {x.papel === 'gestor' || x.papel === 'leitura' ? (
                            <span className="quieto">Todas</span>
                          ) : (
                            x.unidadeNome
                          )}
                        </td>
                        <td className="mono">{fmtNumero(x.leadsAbertos)}</td>
                        <td className="quieto">{x.ultimoAcesso ? fmtQuando(x.ultimoAcesso) : 'nunca'}</td>
                        <td>
                          {!leitura && (
                            <Button size="sm" variant="ghost" icon="settings" onClick={() => setPessoa(x)}>
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {!leitura && <SegurancaEMarca dados={d} />}
          <p className="nota-rodape">
            Uma empresa é trabalhada por uma unidade só: se outra unidade já tem a empresa, ela aparece como
            “da unidade X” e não entra no funil de novo. Gestor e leitura veem todas as unidades; as outras
            pessoas, só a delas.
          </p>
        </>
      )}
      {novaUnidade && d && <FormUnidade dados={d} aoFechar={() => setNovaUnidade(false)} />}
      {unidade && d && <FormUnidade dados={d} unidade={unidade} aoFechar={() => setUnidade(null)} />}
      {convidar && d && <ConvidarPessoa dados={d} aoFechar={() => setConvidar(false)} />}
      {pessoa && d && <EditarPessoa dados={d} pessoa={pessoa} aoFechar={() => setPessoa(null)} />}
    </>
  );
}

function FormUnidade(props: { dados: DadosOrganizacao; unidade?: UnidadeOrganizacao; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const u = props.unidade;
  const [nome, setNome] = useState(u?.nome ?? '');
  const [cota, setCota] = useState(u?.cotaLeadsMes != null ? String(u.cotaLeadsMes) : '');
  const salvar = useMutation({
    mutationFn: (extra?: { ativa: boolean }) => {
      const corpo = { nome, cotaLeadsMes: cota.trim() ? Number(cota.replace(/\D/g, '')) : null, ...extra };
      return u
        ? api(`/organizacao/unidades/${u.id}`, { metodo: 'PATCH', corpo })
        : api('/organizacao/unidades', { metodo: 'POST', corpo });
    },
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['organizacao'] });
      cliente.invalidateQueries({ queryKey: ['sessao'] });
      props.aoFechar();
    },
  });
  const p = props.dados.plano;
  const outras = props.dados.unidades
    .filter((x) => x.ativa && x.id !== u?.id)
    .reduce((s, x) => s + (x.cotaLeadsMes ?? 0), 0);
  return (
    <Drawer titulo={u ? `Unidade ${u.nome}` : 'Nova unidade'} barra="Organização" aoFechar={props.aoFechar}>
      <form
        className="drawer__corpo form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          salvar.mutate(undefined);
        }}
      >
        {!u && (
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            A unidade nasce com os funis SDR e Closer, as mensagens e os e-mails modelo prontos. Depois é só
            convidar as pessoas dela e conectar o WhatsApp.
          </p>
        )}
        <div className="campo">
          <label htmlFor="un-nome">Nome</label>
          <input
            id="un-nome"
            className="filtro"
            maxLength={80}
            placeholder="Ex.: Regional Nordeste, Filial Recife"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="un-cota">Cota de leads por mês</label>
          <input
            id="un-cota"
            className="filtro"
            inputMode="numeric"
            placeholder="Sem cota: usa o que sobrar da organização"
            value={cota}
            onChange={(e) => setCota(e.target.value)}
          />
          <span className="campo__dica">
            {p.leadsMes != null
              ? `O plano tem ${fmtNumero(p.leadsMes)} leads por mês; ${fmtNumero(outras)} já estão em cotas das outras unidades.`
              : 'O plano não tem limite de leads.'}
          </span>
        </div>
        <ErroDaApi erro={salvar.error} />
        <div className="acoes">
          <Button variant="primary" type="submit" disabled={salvar.isPending || nome.trim().length < 2}>
            {salvar.isPending ? 'Salvando…' : u ? 'Salvar' : 'Criar unidade'}
          </Button>
          {u && (
            <Button
              variant="ghost"
              disabled={salvar.isPending}
              onClick={() => {
                if (
                  u.ativa &&
                  !window.confirm(
                    `Desativar a unidade ${u.nome}? As pessoas dela perdem o acesso; os dados ficam guardados.`,
                  )
                )
                  return;
                salvar.mutate({ ativa: !u.ativa });
              }}
            >
              {u.ativa ? 'Desativar unidade' : 'Reativar unidade'}
            </Button>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function ConvidarPessoa(props: { dados: DadosOrganizacao; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const ativas = props.dados.unidades.filter((u) => u.ativa);
  const [f, setF] = useState({
    nome: '',
    email: '',
    papel: 'sdr' as PapelQualquer,
    unidadeId: ativas[0]?.id ?? 0,
  });
  const criar = useMutation({
    mutationFn: () =>
      api<{ convite: string; diasValidade: number }>('/organizacao/pessoas', { metodo: 'POST', corpo: f }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['organizacao'] }),
  });
  const daOrganizacao = f.papel === 'gestor' || f.papel === 'leitura';
  return (
    <Drawer titulo="Convidar pessoa" barra="Organização" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {criar.data ? (
          <div className="pilha" style={{ gap: 16 }}>
            <LinkConvite
              link={criar.data.convite}
              nome={f.nome}
              dias={criar.data.diasValidade}
              conta={props.dados.organizacao.nome}
            />
            <Button variant="ghost" onClick={props.aoFechar}>
              Fechar
            </Button>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              criar.mutate();
            }}
          >
            <div className="campo">
              <label htmlFor="cp-nome">Nome</label>
              <input
                id="cp-nome"
                className="filtro"
                maxLength={80}
                value={f.nome}
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="cp-email">E-mail</label>
              <input
                id="cp-email"
                className="filtro"
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </div>
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="cp-papel">Papel</label>
                <select
                  id="cp-papel"
                  className="filtro"
                  value={f.papel}
                  onChange={(e) => setF({ ...f, papel: e.target.value as PapelQualquer })}
                >
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_PAPEL_QUALQUER[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="cp-unidade">{daOrganizacao ? 'Unidade de entrada' : 'Unidade'}</label>
                <select
                  id="cp-unidade"
                  className="filtro"
                  value={f.unidadeId}
                  onChange={(e) => setF({ ...f, unidadeId: Number(e.target.value) })}
                >
                  {ativas.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <span className="campo__dica">
              {daOrganizacao
                ? 'Gestor e leitura veem todas as unidades; a unidade escolhida é só onde a pessoa começa.'
                : 'A pessoa só vê a unidade dela.'}
            </span>
            <ErroDaApi erro={criar.error} />
            <Button variant="primary" type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Criando…' : 'Gerar convite'}
            </Button>
          </form>
        )}
      </div>
    </Drawer>
  );
}

function EditarPessoa(props: { dados: DadosOrganizacao; pessoa: PessoaOrganizacao; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const sessao = useSessao();
  const x = props.pessoa;
  const [papel, setPapel] = useState<PapelQualquer>(x.papel);
  const [unidadeId, setUnidadeId] = useState(x.unidadeId);
  const [transferir, setTransferir] = useState<string>('');
  const eu = sessao.data?.id === x.id;
  const colegas = props.dados.pessoas.filter(
    (p) =>
      p.ativo &&
      p.id !== x.id &&
      p.unidadeId === x.unidadeId &&
      p.papel !== 'gestor' &&
      p.papel !== 'leitura',
  );
  const salvar = useMutation({
    mutationFn: (extra: Record<string, unknown>) =>
      api(`/organizacao/pessoas/${x.id}`, {
        metodo: 'PATCH',
        corpo: { ...extra, transferirPara: transferir ? Number(transferir) : null },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['organizacao'] });
      props.aoFechar();
    },
  });
  const convite = useMutation({
    mutationFn: () =>
      api<{ convite: string; diasValidade: number }>(`/organizacao/pessoas/${x.id}/convite`, {
        metodo: 'POST',
      }),
  });
  const saiDaUnidade = unidadeId !== x.unidadeId;
  const zerar = useMutation({
    mutationFn: () => api(`/organizacao/pessoas/${x.id}/zerar-duas-etapas`, { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['organizacao'] }),
  });
  return (
    <Drawer titulo={x.nome} barra="Organização" aoFechar={props.aoFechar}>
      <div className="drawer__corpo form">
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          {x.email} · {fmtNumero(x.leadsAbertos)} leads abertos
        </p>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="ep-papel">Papel</label>
            <select
              id="ep-papel"
              className="filtro"
              disabled={eu}
              value={papel}
              onChange={(e) => setPapel(e.target.value as PapelQualquer)}
            >
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAPEL_QUALQUER[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="ep-unidade">Unidade</label>
            <select
              id="ep-unidade"
              className="filtro"
              value={unidadeId}
              onChange={(e) => setUnidadeId(Number(e.target.value))}
            >
              {props.dados.unidades
                .filter((u) => u.ativa)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
            </select>
          </div>
        </div>
        {x.leadsAbertos > 0 && (saiDaUnidade || x.ativo) && (
          <div className="campo">
            <label htmlFor="ep-transferir">
              {saiDaUnidade
                ? 'Os leads abertos ficam na unidade com'
                : 'Se desativar, os leads abertos vão para'}
            </label>
            <select
              id="ep-transferir"
              className="filtro"
              value={transferir}
              onChange={(e) => setTransferir(e.target.value)}
            >
              <option value="">Ninguém: entram no rodízio da unidade</option>
              {colegas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        {eu && <Mensagem tipo="aviso">Você não pode mudar o próprio papel nem se desativar.</Mensagem>}
        {x.duasEtapas && !eu && (
          <div className="campo">
            <span className="campo__dica">
              Perdeu o celular? Zere a verificação em duas etapas: a pessoa sai de todos os aparelhos e
              configura de novo no próximo acesso.
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={zerar.isPending}
              onClick={() => {
                if (window.confirm(`Zerar a verificação em duas etapas de ${x.nome}?`)) zerar.mutate();
              }}
            >
              Zerar duas etapas
            </Button>
            {zerar.isSuccess && (
              <Mensagem tipo="ok">Pronto: ela configura de novo no próximo acesso.</Mensagem>
            )}
          </div>
        )}
        <ErroDaApi erro={salvar.error ?? convite.error} />
        {convite.data && (
          <LinkConvite
            link={convite.data.convite}
            nome={x.nome}
            dias={convite.data.diasValidade}
            conta={props.dados.organizacao.nome}
          />
        )}
        <div className="acoes">
          <Button
            variant="primary"
            disabled={salvar.isPending}
            onClick={() =>
              salvar.mutate({
                ...(papel !== x.papel ? { papel } : {}),
                ...(saiDaUnidade ? { unidadeId } : {}),
                ...(papel === x.papel && !saiDaUnidade ? { nome: x.nome } : {}),
              })
            }
          >
            Salvar
          </Button>
          {x.convitePendente && x.ativo && (
            <Button variant="ghost" disabled={convite.isPending} onClick={() => convite.mutate()}>
              Novo link de convite
            </Button>
          )}
          {!eu && (
            <Button
              variant="ghost"
              disabled={salvar.isPending}
              onClick={() => {
                if (x.ativo && !window.confirm(`Desativar ${x.nome}? A pessoa perde o acesso na hora.`))
                  return;
                salvar.mutate({ ativo: !x.ativo });
              }}
            >
              {x.ativo ? 'Desativar' : 'Reativar'}
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/** Segurança (exigir duas etapas) e marca do cliente (nome, cor e logo no sistema e no PDF). */
function SegurancaEMarca(props: { dados: DadosOrganizacao }) {
  const cliente = useQueryClient();
  const seguro = useRecurso('seguranca');
  const comMarca = useRecurso('marca');
  const o = props.dados.organizacao;
  const [nome, setNome] = useState(o.marca.nome ?? '');
  const [cor, setCor] = useState(o.marca.cor ?? '#0b6b63');
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const seguranca = useMutation({
    mutationFn: (exigir: boolean) =>
      api('/organizacao/seguranca', { metodo: 'PUT', corpo: { exigirDuasEtapas: exigir } }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['organizacao'] });
      cliente.invalidateQueries({ queryKey: ['sessao'] });
    },
  });
  const salvar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => api('/organizacao/marca', { metodo: 'PUT', corpo }),
    onSuccess: () => {
      setLogo(undefined);
      cliente.invalidateQueries({ queryKey: ['organizacao'] });
      cliente.invalidateQueries({ queryKey: ['sessao'] });
    },
  });
  const logoAtual = useSessao().data?.marca?.logo;
  const comDuas = props.dados.pessoas.filter((p) => p.ativo && p.duasEtapas).length;
  const ativas = props.dados.pessoas.filter((p) => p.ativo).length;
  return (
    <div className="grade-relatorio org-painel">
      <Panel titulo="Segurança">
        <div className="pilha" style={{ gap: 12 }}>
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            {comDuas} de {ativas} pessoas ativas usam verificação em duas etapas (senha + código do app do
            celular).
          </p>
          {!seguro && !o.exigirDuasEtapas && <ForaDoPlano recurso="seguranca" compacto />}
          <label className="opcao" hidden={!seguro && !o.exigirDuasEtapas}>
            <input
              type="checkbox"
              checked={o.exigirDuasEtapas}
              disabled={seguranca.isPending}
              onChange={(e) => seguranca.mutate(e.target.checked)}
            />
            <span>
              Exigir verificação em duas etapas de todo mundo
              <span className="campo__dica" style={{ display: 'block' }}>
                Quem ainda não configurou só consegue usar o sistema depois de configurar. Ligue primeiro na
                sua conta (Minha conta).
              </span>
            </span>
          </label>
          <ErroDaApi erro={seguranca.error} />
          <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
            Também valem para todos: senha com pelo menos 8 caracteres, letras e números; bloqueio após
            tentativas erradas; cada login vira uma sessão que a pessoa pode encerrar; e o histórico de
            acessos e alterações fica em Auditoria.
          </p>
        </div>
      </Panel>
      <Panel titulo="Marca da empresa">
        {!comMarca && <ForaDoPlano recurso="marca" compacto />}
        <form
          hidden={!comMarca}
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            salvar.mutate({ nome: nome.trim() || null, cor, ...(logo !== undefined ? { logo } : {}) });
          }}
        >
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            O nome, a cor e o logo aparecem no menu de todas as unidades e no relatório em PDF.
          </p>
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="mc-nome">Nome no sistema</label>
              <input
                id="mc-nome"
                className="filtro"
                maxLength={60}
                placeholder={o.nome}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor="mc-cor">Cor principal</label>
              <div className="copiar">
                <input
                  id="mc-cor"
                  type="color"
                  className="cor-marca"
                  value={cor}
                  onChange={(e) => setCor(e.target.value)}
                />
                <input
                  className="filtro mono"
                  aria-label="Cor em hexadecimal"
                  value={cor}
                  maxLength={7}
                  onChange={(e) => setCor(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="campo">
            <label htmlFor="mc-logo">Logo (PNG ou JPG, até 300 KB)</label>
            <div className="logo-marca">
              {logo ? (
                <img src={logo} alt="Logo novo" />
              ) : o.marca.logo && logo !== null ? (
                <img src={`/api${logoAtual ?? '/organizacao/marca/logo'}`} alt="Logo atual" />
              ) : (
                <span className="quieto" style={{ fontSize: 12 }}>
                  Sem logo
                </span>
              )}
              <input
                id="mc-logo"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  setErroArquivo(null);
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 300 * 1024) {
                    setErroArquivo('Logo grande demais: use uma imagem de até 300 KB.');
                    return;
                  }
                  const leitor = new FileReader();
                  leitor.onload = () => setLogo(String(leitor.result));
                  leitor.readAsDataURL(f);
                }}
              />
              {(o.marca.logo || logo) && (
                <Button size="sm" variant="ghost" onClick={() => setLogo(null)}>
                  Tirar logo
                </Button>
              )}
            </div>
          </div>
          {erroArquivo && <Mensagem tipo="erro">{erroArquivo}</Mensagem>}
          <ErroDaApi erro={salvar.error} />
          {salvar.isSuccess && <Mensagem tipo="ok">Marca salva.</Mensagem>}
          <div className="acoes">
            <Button variant="primary" type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? 'Salvando…' : 'Salvar marca'}
            </Button>
            {(o.marca.cor || o.marca.nome || o.marca.logo) && (
              <Button
                variant="ghost"
                disabled={salvar.isPending}
                onClick={() => {
                  setNome('');
                  setCor('#0b6b63');
                  salvar.mutate({ nome: null, cor: null, logo: null });
                }}
              >
                Voltar ao padrão
              </Button>
            )}
          </div>
        </form>
      </Panel>
    </div>
  );
}
