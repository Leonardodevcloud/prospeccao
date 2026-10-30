import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import {
  type Alcance,
  api,
  type DesempenhoUsuario,
  type PapelUsuario,
  ROTULO_PAPEL_USUARIO,
  type Equipe as TEquipe,
  type UsuarioEquipe,
} from '../api';
import { linkWhatsapp } from '../componentes/Cadencia';
import { Drawer } from '../componentes/Drawer';
import { ForaDoPlano } from '../componentes/ForaDoPlano';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { Dono, useEhAdmin, useEquipe, useRecurso, useSessao } from '../componentes/Sessao';
import { fmtNumero, fmtQuando, fmtReais, formatarTelefone } from '../formatar';

const PAPEIS: PapelUsuario[] = ['sdr', 'closer', 'admin'];
const DICA_PAPEL: Record<PapelUsuario, string> = {
  sdr: 'Prospecta: aborda, faz follow-up e marca reunião.',
  closer: 'Fecha: faz a reunião, manda proposta e fecha contrato.',
  admin: 'Tudo, mais configurar campanhas, cadência, IA e equipe.',
};

/** Unidade toda ou só a própria base (o administrador sempre vê tudo). */
function EscolherAlcance(props: {
  id: string;
  papel: PapelUsuario;
  valor: Alcance;
  aoMudar: (a: Alcance) => void;
}) {
  const emEquipe = useRecurso('equipe');
  if (props.papel === 'admin')
    return (
      <p className="campo__dica" style={{ margin: 0 }}>
        Administrador vê a unidade toda.
      </p>
    );
  // "Só a própria base" é do trabalho em equipe: fora do plano, todo mundo vê a unidade toda.
  if (!emEquipe && props.valor !== 'proprios')
    return (
      <p className="campo__dica" style={{ margin: 0 }}>
        Vê a unidade toda. "Só a própria base" vem a partir do plano Time.
      </p>
    );
  const opcoes: { v: Alcance; titulo: string; dica: string }[] = [
    {
      v: 'unidade',
      titulo: 'A unidade toda',
      dica: 'todos os leads, conversas e números da unidade',
    },
    {
      v: 'proprios',
      titulo: 'Só a própria base',
      dica: 'só os leads em que é a responsável, em todas as telas (funil, conversas, agenda, relatórios, Argos)',
    },
  ];
  return (
    <fieldset className="opcoes">
      <legend>O que vê</legend>
      {opcoes.map((o) => (
        <label key={o.v} className="opcao">
          <input
            type="radio"
            name={props.id}
            checked={props.valor === o.v}
            onChange={() => props.aoMudar(o.v)}
          />
          <span>
            <b>{o.titulo}</b> <span className="quieto">· {o.dica}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Barra de meta: "12 de 30". */
function Meta(props: { valor: number; meta: number; rotulo: string }) {
  const pct = props.meta > 0 ? Math.min(100, Math.round((props.valor / props.meta) * 100)) : 0;
  const bateu = props.meta > 0 && props.valor >= props.meta;
  return (
    <div className="meta" title={`${props.rotulo}: ${props.valor} de ${props.meta}`}>
      <span className="meta__numeros">
        <b>{fmtNumero(props.valor)}</b>
        {props.meta > 0 && <span className="quieto"> / {fmtNumero(props.meta)}</span>}
      </span>
      {props.meta > 0 && (
        <span className="meta__trilho" aria-hidden="true">
          <span className="meta__barra" data-bateu={bateu || undefined} style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}

function Desempenho() {
  const completos = useRecurso('relatorios');
  const [dias, setDias] = useState('30');
  const q = useQuery({
    queryKey: ['equipe', 'desempenho', dias],
    queryFn: () => api<DesempenhoUsuario[]>(`/equipe/desempenho?dias=${dias}`),
    refetchInterval: 60_000,
    enabled: completos,
  });
  if (!completos)
    return (
      <section className="pilha" style={{ gap: 12 }}>
        <h2 className="subtitulo">Desempenho</h2>
        <ForaDoPlano recurso="relatorios" compacto />
      </section>
    );
  return (
    <section className="pilha" style={{ gap: 12 }}>
      <div className="topo-secao">
        <h2 className="subtitulo">Desempenho</h2>
        <label className="pp-sr" htmlFor="desemp-dias">
          Período
        </label>
        <select id="desemp-dias" className="filtro" value={dias} onChange={(e) => setDias(e.target.value)}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="0">Desde o começo</option>
        </select>
      </div>
      <ErroDaApi erro={q.error} />
      <div className="pp-tablewrap">
        <table className="pp-table tabela-equipe">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th title="Contatos feitos hoje (WhatsApp, ligação, e-mail, visita) e a meta do dia">
                Contatos hoje
              </th>
              <th title="Contatos no período; entre parênteses, mensagens que a IA mandou pelos leads dela">
                No período
              </th>
              <th title="Leads da pessoa que responderam no período">Responderam</th>
              <th title="Reuniões marcadas neste mês e a meta">Reuniões no mês</th>
              <th title="Contratos fechados neste mês e a meta">Ganhos no mês</th>
              <th>Valor ganho</th>
              <th title="Leads abertos com a pessoa; atrasados = próximo passo vencido">Leads abertos</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending ? (
              <tr>
                <td colSpan={8}>
                  <div className="esqueleto" />
                </td>
              </tr>
            ) : (
              q.data?.map((u, i) => (
                <tr key={u.id}>
                  <td>
                    <span className="pessoa">
                      <span className="pessoa__posicao mono">{i + 1}</span>
                      <Dono id={u.id} nome={u.nome} tamanho={26} />
                      <span>
                        <b>{u.nome}</b>
                        <span className="quieto pessoa__papel">{ROTULO_PAPEL_USUARIO[u.papel]}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <Meta valor={u.contatosHoje} meta={u.metas.abordagensDia} rotulo="Contatos hoje" />
                  </td>
                  <td className="mono">
                    {fmtNumero(u.contatos)}
                    {u.pelaIa > 0 && <span className="quieto"> (+{fmtNumero(u.pelaIa)} IA)</span>}
                  </td>
                  <td className="mono">{fmtNumero(u.respostas)}</td>
                  <td>
                    <Meta valor={u.reunioesMes} meta={u.metas.reunioesMes} rotulo="Reuniões no mês" />
                  </td>
                  <td>
                    <Meta valor={u.ganhosMes} meta={u.metas.ganhosMes} rotulo="Ganhos no mês" />
                  </td>
                  <td className="mono">{u.valorGanho ? `${fmtReais(u.valorGanho)}/mês` : '—'}</td>
                  <td className="mono">
                    {fmtNumero(u.abertos)}
                    {u.atrasados > 0 && (
                      <Badge tone="danger">
                        {fmtNumero(u.atrasados)} atrasado{u.atrasados === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="nota-rodape">
        Contato conta para quem fez; reunião e ganho contam para quem moveu o lead (se foi a IA, para o dono
        do lead naquele momento).
      </p>
    </section>
  );
}

/** Link do convite pronto para mandar. */
export function LinkConvite(props: {
  link: string;
  nome: string;
  telefone?: string | null;
  dias: number;
  /** Nome da conta (empresa) para a mensagem; sem ele, a conta de quem está logado. */
  conta?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const sessao = useSessao();
  const conta = props.conta ?? sessao.data?.conta?.nome;
  const texto = `Oi, ${props.nome.split(' ')[0]}! Seu acesso ao Prospect Team${conta ? ` da ${conta}` : ''}: crie sua senha neste link (vale ${props.dias} dias): ${props.link}`;
  return (
    <div className="pilha" style={{ gap: 8 }}>
      <Mensagem tipo="ok">
        Link criado. Mande para {props.nome.split(' ')[0]}: com ele, a pessoa cria a senha e já entra.
      </Mensagem>
      <div className="copiar">
        <input
          className="filtro mono"
          readOnly
          value={props.link}
          aria-label="Link do convite"
          onFocus={(e) => e.target.select()}
        />
        <Button
          icon={copiado ? 'check' : 'copy'}
          onClick={() => {
            void navigator.clipboard?.writeText(props.link);
            setCopiado(true);
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      {props.telefone && (
        <div>
          <Button
            icon="message-circle"
            href={linkWhatsapp(props.telefone, texto)}
            target="_blank"
            rel="noreferrer"
          >
            Mandar pelo WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}

function Convidar(props: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    nome: '',
    email: '',
    papel: 'sdr' as PapelUsuario,
    telefone: '',
    alcance: 'unidade' as Alcance,
  });
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number; convite: string; diasValidade: number }>('/equipe', { metodo: 'POST', corpo: f }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['equipe'] }),
  });
  return (
    <Drawer titulo="Convidar pessoa" barra="Equipe" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {criar.data ? (
          <div className="pilha" style={{ gap: 16 }}>
            <LinkConvite
              link={criar.data.convite}
              nome={f.nome}
              telefone={f.telefone}
              dias={criar.data.diasValidade}
            />
            <div className="acoes">
              <Button variant="primary" onClick={props.aoFechar}>
                Concluir
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  criar.reset();
                  setF({ nome: '', email: '', papel: f.papel, telefone: '', alcance: f.alcance });
                }}
              >
                Convidar mais alguém
              </Button>
            </div>
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
              <label htmlFor="conv-nome">Nome</label>
              <input
                id="conv-nome"
                className="filtro"
                required
                maxLength={80}
                value={f.nome}
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="conv-email">E-mail (é o login)</label>
              <input
                id="conv-email"
                className="filtro"
                type="email"
                required
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </div>
            <fieldset className="opcoes">
              <legend>Papel</legend>
              {PAPEIS.map((p) => (
                <label key={p} className="opcao">
                  <input
                    type="radio"
                    name="conv-papel"
                    checked={f.papel === p}
                    onChange={() => setF({ ...f, papel: p })}
                  />
                  <span>
                    <b>{ROTULO_PAPEL_USUARIO[p]}</b> <span className="quieto">· {DICA_PAPEL[p]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <EscolherAlcance
              id="conv-alcance"
              papel={f.papel}
              valor={f.alcance}
              aoMudar={(alcance) => setF({ ...f, alcance })}
            />
            <div className="campo">
              <label htmlFor="conv-tel">WhatsApp (opcional)</label>
              <input
                id="conv-tel"
                className="filtro"
                inputMode="tel"
                placeholder="71 99999-0000"
                value={f.telefone}
                onChange={(e) => setF({ ...f, telefone: e.target.value })}
              />
              <span className="campo__dica">Para mandar o convite e os avisos de reunião.</span>
            </div>
            <ErroDaApi erro={criar.error} />
            <div className="acoes">
              <Button
                type="submit"
                variant="primary"
                icon="user-plus"
                disabled={criar.isPending || !f.nome || !f.email}
              >
                Criar convite
              </Button>
              <Button variant="ghost" onClick={props.aoFechar}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </div>
    </Drawer>
  );
}

function EditarPessoa(props: { u: UsuarioEquipe; aoFechar: () => void }) {
  const emEquipe = useRecurso('equipe');
  const { u } = props;
  const cliente = useQueryClient();
  const [f, setF] = useState({
    nome: u.nome,
    papel: u.papel,
    telefone: u.telefone ? formatarTelefone(u.telefone) : '',
    recebeLeads: u.recebeLeads,
    alcance: u.alcance,
    metas: u.metas,
  });
  const salvar = useMutation({
    mutationFn: (corpo: object) => api<TEquipe>(`/equipe/${u.id}`, { metodo: 'PATCH', corpo }),
    onSuccess: (d) => {
      cliente.setQueryData(['equipe'], d);
      cliente.invalidateQueries({ queryKey: ['equipe'] });
    },
  });
  const convite = useMutation({
    mutationFn: () =>
      api<{ convite: string; diasValidade: number }>(`/equipe/${u.id}/convite`, { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['equipe'] }),
  });
  const [confirmarLink, setConfirmarLink] = useState(false);
  const meta = (campo: keyof UsuarioEquipe['metas'], v: string) =>
    setF({ ...f, metas: { ...f.metas, [campo]: Math.max(0, Number(v.replace(/\D/g, '')) || 0) } });

  return (
    <Drawer titulo={u.nome} barra="Equipe" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        <div className="pilha" style={{ gap: 20 }}>
          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              salvar.mutate(f, { onSuccess: props.aoFechar });
            }}
          >
            <p className="quieto" style={{ margin: 0 }}>
              {u.email} · {u.ultimoAcesso ? `último acesso ${fmtQuando(u.ultimoAcesso)}` : 'ainda não entrou'}
            </p>
            <div className="campo">
              <label htmlFor="pes-nome">Nome</label>
              <input
                id="pes-nome"
                className="filtro"
                maxLength={80}
                value={f.nome}
                onChange={(e) => setF({ ...f, nome: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="pes-papel">Papel</label>
              <select
                id="pes-papel"
                className="filtro"
                value={f.papel}
                onChange={(e) => setF({ ...f, papel: e.target.value as PapelUsuario })}
              >
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>
                    {ROTULO_PAPEL_USUARIO[p]}
                  </option>
                ))}
              </select>
              <span className="campo__dica">{DICA_PAPEL[f.papel]}</span>
            </div>
            <EscolherAlcance
              id="pes-alcance"
              papel={f.papel}
              valor={f.alcance}
              aoMudar={(alcance) => setF({ ...f, alcance })}
            />
            <div className="campo">
              <label htmlFor="pes-tel">WhatsApp</label>
              <input
                id="pes-tel"
                className="filtro"
                inputMode="tel"
                value={f.telefone}
                onChange={(e) => setF({ ...f, telefone: e.target.value })}
              />
            </div>
            {emEquipe && (
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={f.recebeLeads}
                  onChange={(e) => setF({ ...f, recebeLeads: e.target.checked })}
                />
                Entra no rodízio de leads {f.papel === 'closer' ? '(reuniões marcadas)' : '(leads novos)'}
              </label>
            )}
            <h3 className="subtitulo">Metas</h3>
            {!emEquipe && <ForaDoPlano recurso="equipe" compacto />}
            <div className="metas-campos" hidden={!emEquipe}>
              <div className="campo">
                <label htmlFor="meta-ab">Contatos por dia</label>
                <input
                  id="meta-ab"
                  className="filtro"
                  inputMode="numeric"
                  value={f.metas.abordagensDia}
                  onChange={(e) => meta('abordagensDia', e.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="meta-re">Reuniões por mês</label>
                <input
                  id="meta-re"
                  className="filtro"
                  inputMode="numeric"
                  value={f.metas.reunioesMes}
                  onChange={(e) => meta('reunioesMes', e.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="meta-ga">Ganhos por mês</label>
                <input
                  id="meta-ga"
                  className="filtro"
                  inputMode="numeric"
                  value={f.metas.ganhosMes}
                  onChange={(e) => meta('ganhosMes', e.target.value)}
                />
              </div>
            </div>
            <ErroDaApi erro={salvar.error} />
            <div className="acoes">
              <Button type="submit" variant="primary" disabled={salvar.isPending}>
                Salvar
              </Button>
              <Button variant="ghost" onClick={props.aoFechar}>
                Cancelar
              </Button>
            </div>
          </form>

          <section className="pilha" style={{ gap: 8 }}>
            <h3 className="subtitulo">Acesso</h3>
            {convite.data ? (
              <LinkConvite
                link={convite.data.convite}
                nome={u.nome}
                telefone={u.telefone}
                dias={convite.data.diasValidade}
              />
            ) : confirmarLink ? (
              <div className="confirmar">
                <span>
                  Gerar um link novo para {u.nome.split(' ')[0]} criar a senha? A senha atual deixa de valer.
                </span>
                <div className="acoes">
                  <Button size="sm" variant="primary" onClick={() => convite.mutate()}>
                    Gerar link
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmarLink(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="acoes">
                <Button
                  size="sm"
                  icon="link"
                  onClick={() => (u.convitePendente ? convite.mutate() : setConfirmarLink(true))}
                >
                  {u.convitePendente ? 'Gerar link do convite de novo' : 'Esqueceu a senha: gerar link'}
                </Button>
                <Button
                  size="sm"
                  variant={u.ativo ? 'ghost' : 'secondary'}
                  disabled={salvar.isPending}
                  onClick={() => salvar.mutate({ ativo: !u.ativo }, { onSuccess: props.aoFechar })}
                >
                  {u.ativo ? 'Desativar acesso' : 'Reativar acesso'}
                </Button>
              </div>
            )}
            {u.ativo && (
              <span className="campo__dica">
                Desativar tira o acesso na hora; os {fmtNumero(u.leadsAbertos)} leads abertos dele ficam sem
                dono para você redistribuir.
              </span>
            )}
            <ErroDaApi erro={convite.error} />
          </section>
        </div>
      </div>
    </Drawer>
  );
}

function Distribuicao(props: { equipe: TEquipe }) {
  const cliente = useQueryClient();
  const [d, setD] = useState(props.equipe.distribuicao);
  useEffect(() => setD(props.equipe.distribuicao), [props.equipe.distribuicao]);
  const salvar = useMutation({
    mutationFn: (corpo: TEquipe['distribuicao']) => api('/equipe/distribuicao', { metodo: 'PUT', corpo }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['equipe'] }),
  });
  const distribuir = useMutation({
    mutationFn: () => api<{ distribuidos: number }>('/equipe/distribuir', { metodo: 'POST' }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['equipe'] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
    },
  });
  const mudar = (novo: TEquipe['distribuicao']) => {
    setD(novo);
    salvar.mutate(novo);
  };
  const sdrs = props.equipe.usuarios.filter((u) => u.ativo && u.recebeLeads && u.papel === 'sdr').length;
  const closers = props.equipe.usuarios.filter(
    (u) => u.ativo && u.recebeLeads && u.papel === 'closer',
  ).length;
  return (
    <section className="pilha" style={{ gap: 12 }}>
      <h2 className="subtitulo">Como os leads são divididos</h2>
      <div className="grade-distribuicao">
        <fieldset className="opcoes">
          <legend>Lead novo no funil</legend>
          <label className="opcao">
            <input
              type="radio"
              name="dist-sdr"
              checked={d.sdr === 'rodizio'}
              onChange={() => mudar({ ...d, sdr: 'rodizio' })}
            />
            <span>
              Rodízio entre os SDRs <span className="quieto">({sdrs} recebendo)</span>
            </span>
          </label>
          <label className="opcao">
            <input
              type="radio"
              name="dist-sdr"
              checked={d.sdr === 'manual'}
              onChange={() => mudar({ ...d, sdr: 'manual' })}
            />
            Fica com quem mandou para o funil
          </label>
        </fieldset>
        <fieldset className="opcoes">
          <legend>Reunião marcada</legend>
          <label className="opcao">
            <input
              type="radio"
              name="dist-closer"
              checked={d.closer === 'rodizio'}
              onChange={() => mudar({ ...d, closer: 'rodizio' })}
            />
            <span>
              Passa para um closer, em rodízio <span className="quieto">({closers} recebendo)</span>
            </span>
          </label>
          <label className="opcao">
            <input
              type="radio"
              name="dist-closer"
              checked={d.closer === 'mesmo'}
              onChange={() => mudar({ ...d, closer: 'mesmo' })}
            />
            Continua com o SDR que marcou
          </label>
          <label className="opcao">
            <input
              type="radio"
              name="dist-closer"
              checked={d.closer === 'manual'}
              onChange={() => mudar({ ...d, closer: 'manual' })}
            />
            Eu passo à mão
          </label>
        </fieldset>
      </div>
      {d.sdr === 'rodizio' && sdrs === 0 && (
        <Mensagem tipo="aviso">
          Ninguém com papel SDR está recebendo leads: o lead novo fica com quem mandou para o funil.
        </Mensagem>
      )}
      {props.equipe.semDono > 0 && (
        <div className="confirmar">
          <span>
            {fmtNumero(props.equipe.semDono)}{' '}
            {props.equipe.semDono === 1 ? 'lead aberto está' : 'leads abertos estão'} sem dono.
          </span>
          <div className="acoes">
            <Button
              size="sm"
              variant="primary"
              icon="users"
              disabled={distribuir.isPending}
              onClick={() => distribuir.mutate()}
            >
              Distribuir em rodízio
            </Button>
          </div>
        </div>
      )}
      {distribuir.data && (
        <Mensagem tipo="ok">{fmtNumero(distribuir.data.distribuidos)} leads distribuídos.</Mensagem>
      )}
      <ErroDaApi erro={salvar.error ?? distribuir.error} />
    </section>
  );
}

export function Equipe() {
  const emEquipe = useRecurso('equipe');
  const q = useEquipe();
  const admin = useEhAdmin();
  const [convidando, setConvidando] = useState(false);
  const [editando, setEditando] = useState<UsuarioEquipe | null>(null);
  const ativos = q.data?.usuarios.filter((u) => u.ativo) ?? [];
  const inativos = q.data?.usuarios.filter((u) => !u.ativo) ?? [];

  return (
    <>
      <div className="topo">
        <div>
          <h1>Equipe</h1>
          <p>
            {fmtNumero(ativos.length)} {ativos.length === 1 ? 'pessoa' : 'pessoas'}
            {q.data?.semDono ? ` · ${fmtNumero(q.data.semDono)} leads sem dono` : ''}
          </p>
        </div>
        {admin && (
          <div className="acoes">
            <Button
              variant="ghost"
              icon="file-down"
              href="/api/lgpd/exportar"
              title="Todos os dados desta unidade em um arquivo (LGPD: portabilidade, fim de contrato)"
            >
              Exportar dados
            </Button>
            <Button variant="primary" icon="user-plus" onClick={() => setConvidando(true)}>
              Convidar pessoa
            </Button>
          </div>
        )}
      </div>

      <div className="pilha" style={{ gap: 32 }}>
        <Desempenho />

        <section className="pilha" style={{ gap: 12 }}>
          <h2 className="subtitulo">Pessoas</h2>
          <ErroDaApi erro={q.error} />
          <ul className="pessoas">
            {[...ativos, ...inativos].map((u) => (
              <li key={u.id} className="pessoa-linha" data-inativo={!u.ativo || undefined}>
                <Dono id={u.id} nome={u.nome} tamanho={32} />
                <div className="pessoa-linha__corpo">
                  <b>{u.nome}</b>
                  <span className="quieto">
                    {u.email}
                    {u.telefone ? ` · ${formatarTelefone(u.telefone)}` : ''}
                  </span>
                </div>
                <div className="pessoa-linha__selos">
                  <Badge tone={u.papel === 'admin' ? 'brand' : 'neutral'}>
                    {ROTULO_PAPEL_USUARIO[u.papel]}
                  </Badge>
                  {!u.ativo && <Badge tone="outline">Desativado</Badge>}
                  {u.ativo && u.convitePendente && <Badge tone="warning">Convite pendente</Badge>}
                  {u.ativo && !u.recebeLeads && u.papel !== 'admin' && (
                    <Badge tone="outline">Fora do rodízio</Badge>
                  )}
                  {u.ativo && u.alcance === 'proprios' && u.papel !== 'admin' && (
                    <Badge tone="outline">Só a própria base</Badge>
                  )}
                  <span className="quieto mono" title="Leads abertos">
                    <Icon name="kanban" size={12} /> {fmtNumero(u.leadsAbertos)}
                  </span>
                </div>
                {admin && (
                  <Button size="sm" variant="ghost" onClick={() => setEditando(u)}>
                    Editar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {admin &&
          q.data &&
          (emEquipe ? <Distribuicao equipe={q.data} /> : <ForaDoPlano recurso="equipe" compacto />)}
      </div>

      {convidando && <Convidar aoFechar={() => setConvidando(false)} />}
      {editando && <EditarPessoa u={editando} aoFechar={() => setEditando(null)} />}
    </>
  );
}
