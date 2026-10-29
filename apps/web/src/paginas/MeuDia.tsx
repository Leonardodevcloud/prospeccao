import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, type ConfigAgenda, type FollowupDoDia, type Tarefa, type MeuDia as TMeuDia } from '../api';
import { EnvioRapido } from '../componentes/Cadencia';
import { Drawer } from '../componentes/Drawer';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { ConectarGoogle } from '../componentes/MinhaConta';
import { PrimeirosPassos } from '../componentes/PrimeirosPassos';
import { Radar } from '../componentes/Radar';
import { useEhAdmin, useEquipe, useSessao } from '../componentes/Sessao';
import { FormTarefa, LinhaTarefa } from '../componentes/Tarefas';
import { fmtCidade, fmtCompromisso, fmtNome, fmtNumero, fmtPrazo, fmtQuando } from '../formatar';

const hojeExtenso = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function saudacao(): string {
  const h = Number(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Contagem leve para o menu: o que está vencido ou é para hoje. */
export function useMeuDiaResumo() {
  return useQuery({
    queryKey: ['meu-dia', 'eu'],
    queryFn: () => api<TMeuDia>('/agenda/meu-dia?usuario=eu'),
    refetchInterval: 60_000,
    select: (d) => d.tarefas.length + d.followups.length,
  });
}

function LinhaFollowup(props: {
  f: FollowupDoDia;
  mostrarDono: boolean;
  aoAbrir: () => void;
  aoMandar: () => void;
}) {
  const { f } = props;
  const prazo = fmtPrazo(f.proximaAcaoEm);
  return (
    <li className="tarefa" data-atrasada={f.atrasado || undefined}>
      <span className="tarefa__icone" data-tipo="followup">
        <Icon name="message-circle" size={14} />
      </span>
      <div className="tarefa__corpo">
        <span className="tarefa__titulo">
          <button type="button" className="link-botao" onClick={props.aoAbrir}>
            {fmtNome(f.nome)}
          </button>
          <span className="quieto"> · {f.proximaAcao ?? 'Follow-up'}</span>
        </span>
        <span className="tarefa__meta">
          <span className="ponto-etapa" style={{ background: f.etapaCor ?? '#94a3b8' }} aria-hidden="true" />
          {f.etapaNome ?? f.etapa}
          {f.cidade && ` · ${fmtCidade(f.cidade)}`}
          {prazo && (
            <>
              {' · '}
              <span className={prazo.tom === 'atrasado' ? 'tarefa__quando--atrasada' : undefined}>
                {prazo.texto}
              </span>
            </>
          )}
          {f.agentePausa && <> · a IA passou para você</>}
          {props.mostrarDono && f.responsavelNome && <> · {f.responsavelNome}</>}
        </span>
      </div>
      <div className="tarefa__acoes">
        <Button
          size="sm"
          variant={f.atrasado ? 'primary' : 'secondary'}
          icon="message-circle"
          onClick={props.aoMandar}
        >
          {f.etapa === 'a_abordar' ? 'Abordar' : 'Mensagem'}
        </Button>
      </div>
    </li>
  );
}

function ConfigLembretes(props: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['agenda', 'config'], queryFn: () => api<ConfigAgenda>('/agenda/config') });
  const [f, setF] = useState<ConfigAgenda | null>(null);
  useEffect(() => {
    if (q.data && !f) setF(q.data);
  }, [q.data, f]);
  const salvar = useMutation({
    mutationFn: () => api<ConfigAgenda>('/agenda/config', { metodo: 'PUT', corpo: f }),
    onSuccess: (d) => {
      cliente.setQueryData(['agenda', 'config'], d);
      props.aoFechar();
    },
  });
  const num = (campo: keyof ConfigAgenda, v: string) =>
    setF((x) => (x ? { ...x, [campo]: Number(v.replace(/\D/g, '')) || 0 } : x));
  return (
    <Drawer titulo="Lembretes da agenda" barra="Meu dia" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {!f ? (
          <div className="esqueleto" />
        ) : (
          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              salvar.mutate();
            }}
          >
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.lembreteLead}
                onChange={(e) => setF({ ...f, lembreteLead: e.target.checked })}
              />
              Mandar lembrete da reunião para o lead pelo WhatsApp
            </label>
            <div className="campo">
              <label htmlFor="lem-min">Quantos minutos antes</label>
              <input
                id="lem-min"
                className="filtro"
                inputMode="numeric"
                value={f.lembreteLeadMinutos}
                onChange={(e) => num('lembreteLeadMinutos', e.target.value)}
              />
              <span className="campo__dica">
                120 = duas horas antes. Reunião marcada em cima da hora não recebe lembrete.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="lem-texto">Mensagem do lembrete</label>
              <textarea
                id="lem-texto"
                rows={3}
                value={f.textoLembreteLead}
                onChange={(e) => setF({ ...f, textoLembreteLead: e.target.value })}
              />
              <span className="campo__dica">
                {'{quando}'} vira "hoje às 15h" ou "amanhã às 10h". Também valem {'{saudacao}'}, {'{nome}'},{' '}
                {'{empresa}'} e {'{remetente}'}.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="lem-usu">Avisar o vendedor quantos minutos antes</label>
              <input
                id="lem-usu"
                className="filtro"
                inputMode="numeric"
                value={f.lembreteUsuarioMinutos}
                onChange={(e) => num('lembreteUsuarioMinutos', e.target.value)}
              />
            </div>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.lembreteUsuarioWhatsapp}
                onChange={(e) => setF({ ...f, lembreteUsuarioWhatsapp: e.target.checked })}
              />
              Avisar também no WhatsApp do vendedor (quem tiver o número cadastrado)
            </label>
            <div className="campo">
              <label htmlFor="lem-dur">Duração padrão da reunião (minutos)</label>
              <input
                id="lem-dur"
                className="filtro"
                inputMode="numeric"
                value={f.duracaoReuniaoMin}
                onChange={(e) => num('duracaoReuniaoMin', e.target.value)}
              />
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
        )}
      </div>
    </Drawer>
  );
}

export function MeuDia() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const sessao = useSessao();
  const admin = useEhAdmin();
  const equipe = useEquipe();
  const quem = params.get('de') ?? 'eu';
  const empresaAberta = params.get('empresa');
  const [nova, setNova] = useState(false);
  const [editando, setEditando] = useState<Tarefa | null>(null);
  const [mensagemPara, setMensagemPara] = useState<FollowupDoDia | null>(null);
  const [lembretes, setLembretes] = useState(false);
  const [google, setGoogle] = useState(false);
  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  const q = useQuery({
    queryKey: ['meu-dia', quem],
    queryFn: () => api<TMeuDia>(`/agenda/meu-dia?usuario=${quem}`),
    refetchInterval: 30_000,
  });
  const d = q.data;
  const atrasadas = d?.tarefas.filter((t) => t.atrasada) ?? [];
  const deHoje = d?.tarefas.filter((t) => !t.atrasada) ?? [];
  const followAtrasados = d?.followups.filter((f) => f.atrasado) ?? [];
  const followHoje = d?.followups.filter((f) => !f.atrasado) ?? [];
  const total = (d?.tarefas.length ?? 0) + (d?.followups.length ?? 0) + (d?.conversas.length ?? 0);
  const todos = quem !== 'eu';
  const abrirLead = (id: number) => mudar({ empresa: String(id) });
  const reunioesHoje = deHoje.filter((t) => t.tipo === 'reuniao' || t.tipo === 'visita').length;

  return (
    <>
      <div className="topo">
        <div>
          <h1>
            {saudacao()}
            {sessao.data && !todos ? `, ${sessao.data.nome.split(' ')[0]}` : ''}
          </h1>
          <p>
            {hojeExtenso.format(new Date())}
            {d &&
              (total === 0
                ? ' · tudo em dia'
                : ` · ${fmtNumero(d.tarefas.length + d.followups.length)} para fazer${reunioesHoje ? `, ${reunioesHoje} ${reunioesHoje === 1 ? 'reunião' : 'reuniões'}` : ''}${d.conversas.length ? `, ${d.conversas.length} ${d.conversas.length === 1 ? 'conversa esperando' : 'conversas esperando'}` : ''}`)}
          </p>
        </div>
        <div className="acoes">
          {(equipe.data?.usuarios.filter((u) => u.ativo).length ?? 0) > 1 && (
            <>
              <label className="pp-sr" htmlFor="dia-de">
                De quem
              </label>
              <select
                id="dia-de"
                className="filtro"
                value={quem}
                onChange={(e) => mudar({ de: e.target.value === 'eu' ? null : e.target.value })}
              >
                <option value="eu">Meu dia</option>
                <option value="todos">Toda a equipe</option>
                {equipe.data?.usuarios
                  .filter((u) => u.ativo && u.id !== sessao.data?.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
              </select>
            </>
          )}
          <Button variant="ghost" icon="calendar" onClick={() => setGoogle(true)}>
            Google Agenda
          </Button>
          {admin && (
            <Button variant="ghost" icon="bell" onClick={() => setLembretes(true)}>
              Lembretes
            </Button>
          )}
          <Button variant="primary" icon="calendar-plus" onClick={() => setNova(true)}>
            Novo compromisso
          </Button>
        </div>
      </div>
      <PrimeirosPassos />

      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : !d ? null : (
        <div className="dia">
          <div className="dia__principal pilha" style={{ gap: 24 }}>
            {d.conversas.length > 0 && (
              <section className="pilha" style={{ gap: 8 }}>
                <h2 className="subtitulo">
                  <Icon name="message-circle" size={16} /> Responderam e esperam você{' '}
                  <span className="quieto">{d.conversas.length}</span>
                </h2>
                <ul className="tarefas">
                  {d.conversas.map((c) => (
                    <li key={c.empresaId} className="tarefa" data-nova>
                      <span className="tarefa__icone" data-tipo="mensagem">
                        <Icon name="message-circle" size={14} />
                      </span>
                      <div className="tarefa__corpo">
                        <span className="tarefa__titulo">{fmtNome(c.nome)}</span>
                        <span className="tarefa__meta">
                          “{c.ultima}” · {fmtQuando(c.ultimaEm)}
                        </span>
                      </div>
                      <div className="tarefa__acoes">
                        <Badge tone="brand">{c.naoLidas}</Badge>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => navegar(`/conversas?lead=${c.empresaId}`)}
                        >
                          Responder
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(quem === 'eu' || quem === 'todos') && (
              <Radar todos={quem === 'todos'} aoAbrirLead={abrirLead} />
            )}

            {(atrasadas.length > 0 || followAtrasados.length > 0) && (
              <section className="pilha" style={{ gap: 8 }}>
                <h2 className="subtitulo subtitulo--atrasado">
                  Atrasados <span className="quieto">{atrasadas.length + followAtrasados.length}</span>
                </h2>
                <ul className="tarefas">
                  {atrasadas.map((t) => (
                    <LinhaTarefa
                      key={t.id}
                      t={t}
                      mostrarLead
                      mostrarDono={todos}
                      aoAbrirLead={abrirLead}
                      aoEditar={setEditando}
                    />
                  ))}
                  {followAtrasados.map((f) => (
                    <LinhaFollowup
                      key={f.empresaId}
                      f={f}
                      mostrarDono={todos}
                      aoAbrir={() => abrirLead(f.empresaId)}
                      aoMandar={() => setMensagemPara(f)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {total > 0 && (
              <section className="pilha" style={{ gap: 8 }}>
                <h2 className="subtitulo">
                  Hoje <span className="quieto">{deHoje.length + followHoje.length}</span>
                </h2>
                {deHoje.length + followHoje.length === 0 ? (
                  <p className="quieto" style={{ margin: 0 }}>
                    Nada marcado para hoje. Os follow-ups da cadência e as reuniões aparecem aqui sozinhos.
                  </p>
                ) : (
                  <ul className="tarefas">
                    {deHoje.map((t) => (
                      <LinhaTarefa
                        key={t.id}
                        t={t}
                        mostrarLead
                        mostrarDono={todos}
                        aoAbrirLead={abrirLead}
                        aoEditar={setEditando}
                      />
                    ))}
                    {followHoje.map((f) => (
                      <LinhaFollowup
                        key={f.empresaId}
                        f={f}
                        mostrarDono={todos}
                        aoAbrir={() => abrirLead(f.empresaId)}
                        aoMandar={() => setMensagemPara(f)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}

            {total === 0 && (
              <EmptyState
                icone="check-check"
                titulo="Tudo em dia"
                texto="Nenhuma conversa esperando, nada atrasado e nada para hoje."
              />
            )}
          </div>

          <aside className="dia__lado pilha" style={{ gap: 8 }}>
            <h2 className="subtitulo">Próximos 7 dias</h2>
            {d.proximas.length === 0 ? (
              <p className="quieto" style={{ margin: 0 }}>
                Nenhum compromisso nos próximos dias.
              </p>
            ) : (
              <ul className="agenda-curta">
                {d.proximas.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="agenda-curta__item" onClick={() => setEditando(t)}>
                      <span className="agenda-curta__quando mono">{fmtCompromisso(t.inicio)}</span>
                      <span className="agenda-curta__titulo">{t.titulo}</span>
                      {todos && t.usuarioNome && <span className="quieto">{t.usuarioNome}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      {nova && <FormTarefa tipoInicial="tarefa" aoFechar={() => setNova(false)} />}
      {editando && <FormTarefa tarefa={editando} aoFechar={() => setEditando(null)} />}
      {mensagemPara && (
        <EnvioRapido
          empresaId={mensagemPara.empresaId}
          nome={mensagemPara.nome}
          aoFechar={() => setMensagemPara(null)}
        />
      )}
      {lembretes && <ConfigLembretes aoFechar={() => setLembretes(false)} />}
      {google && sessao.data && (
        <Drawer titulo="Ver a agenda no Google Agenda" barra="Meu dia" aoFechar={() => setGoogle(false)}>
          <div className="drawer__corpo">
            <div className="pilha" style={{ gap: 12 }}>
              <Mensagem tipo="ok">
                Suas reuniões, ligações e tarefas aparecem no Google Agenda (computador e celular), com aviso
                15 minutos antes de cada reunião.
              </Mensagem>
              <ConectarGoogle token={sessao.data.agendaToken} />
            </div>
          </div>
        </Drawer>
      )}
      {empresaAberta && (
        <FichaEmpresa
          id={Number(empresaAberta)}
          aoFechar={() => mudar({ empresa: null })}
          aoAbrir={(id) => mudar({ empresa: String(id) })}
        />
      )}
    </>
  );
}
