import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ICONE_TAREFA, ROTULO_TAREFA, type Tarefa, type TipoTarefa } from '../api';
import { diaDaqui, diaDoInput, fmtCompromisso, fmtNome, horaDoInput, instanteDoInput } from '../formatar';
import { Drawer } from './Drawer';
import { ErroDaApi } from './Formulario';
import { useEquipe, useSessao } from './Sessao';

const TIPOS: TipoTarefa[] = ['reuniao', 'ligacao', 'visita', 'tarefa'];

/** Atualiza tudo que mostra agenda depois de mexer numa tarefa. */
export function useAtualizarAgenda() {
  const cliente = useQueryClient();
  return (empresaId?: number | null) => {
    cliente.invalidateQueries({ queryKey: ['agenda'] });
    cliente.invalidateQueries({ queryKey: ['meu-dia'] });
    cliente.invalidateQueries({ queryKey: ['quadro'] });
    if (empresaId) cliente.invalidateQueries({ queryKey: ['funil', empresaId] });
  };
}

/** "Adicionar ao Google Agenda" na hora (sem esperar a assinatura atualizar). */
export function linkGoogle(
  t: Pick<Tarefa, 'titulo' | 'inicio' | 'fim' | 'local' | 'descricao' | 'empresaNome'>,
): string {
  const f = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const fim = t.fim ?? new Date(new Date(t.inicio).getTime() + 30 * 60_000).toISOString();
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: t.titulo,
    dates: `${f(t.inicio)}/${f(fim)}`,
    details: [t.descricao, t.empresaNome && `Lead: ${fmtNome(t.empresaNome)}`].filter(Boolean).join('\n'),
    location: t.local ?? '',
    ctz: 'America/Sao_Paulo',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function tituloPadrao(tipo: TipoTarefa, empresa?: string | null) {
  const nome = empresa ? fmtNome(empresa) : '';
  if (tipo === 'reuniao') return nome ? `Reunião com ${nome}` : 'Reunião';
  if (tipo === 'ligacao') return nome ? `Ligar para ${nome}` : 'Ligação';
  if (tipo === 'visita') return nome ? `Visita à ${nome}` : 'Visita';
  return '';
}

/** Criar ou editar tarefa/reunião (com ou sem lead). */
export function FormTarefa(props: {
  empresaId?: number | null;
  empresaNome?: string | null;
  tarefa?: Tarefa;
  tipoInicial?: TipoTarefa;
  aoFechar: () => void;
}) {
  const t = props.tarefa;
  const atualizar = useAtualizarAgenda();
  const equipe = useEquipe();
  const sessao = useSessao();
  const empresaNome = t?.empresaNome ?? props.empresaNome ?? null;
  const [tipo, setTipo] = useState<TipoTarefa>(t?.tipo ?? props.tipoInicial ?? 'reuniao');
  const [titulo, setTitulo] = useState(
    t?.titulo ?? tituloPadrao(t?.tipo ?? props.tipoInicial ?? 'reuniao', empresaNome),
  );
  const [tituloMexido, setTituloMexido] = useState(!!t);
  const [dia, setDia] = useState(t ? diaDoInput(t.inicio) : diaDaqui(1));
  const [hora, setHora] = useState(t ? horaDoInput(t.inicio) : '10:00');
  const [local, setLocal] = useState(t?.local ?? '');
  const [descricao, setDescricao] = useState(t?.descricao ?? '');
  const [usuarioId, setUsuarioId] = useState<string>(t?.usuarioId ? String(t.usuarioId) : '');

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        tipo,
        titulo: titulo.trim() || tituloPadrao(tipo, empresaNome) || ROTULO_TAREFA[tipo],
        inicio: instanteDoInput(dia, hora),
        local: local.trim(),
        descricao: descricao.trim(),
        ...(usuarioId ? { usuarioId: Number(usuarioId) } : {}),
        ...(t ? {} : { empresaId: props.empresaId ?? null }),
      };
      return t
        ? api<Tarefa>(`/agenda/${t.id}`, { metodo: 'PATCH', corpo })
        : api<Tarefa>('/agenda', { metodo: 'POST', corpo });
    },
    onSuccess: () => {
      atualizar(t?.empresaId ?? props.empresaId);
      props.aoFechar();
    },
  });

  const apagar = useMutation({
    mutationFn: () => api(`/agenda/${t?.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      atualizar(t?.empresaId);
      props.aoFechar();
    },
  });
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  const ativos = equipe.data?.usuarios.filter((u) => u.ativo) ?? [];

  return (
    <Drawer
      titulo={t ? 'Editar compromisso' : 'Novo compromisso'}
      barra={empresaNome ? `Agenda · ${fmtNome(empresaNome)}` : 'Agenda'}
      aoFechar={props.aoFechar}
    >
      <div className="drawer__corpo">
        <form className="form" onSubmit={enviar}>
          <fieldset className="segmentos" aria-label="Tipo">
            <legend className="pp-sr">Tipo</legend>
            {TIPOS.map((x) => (
              <label key={x} className="segmento">
                <input
                  type="radio"
                  name="tipo-tarefa"
                  className="pp-sr"
                  checked={tipo === x}
                  onChange={() => {
                    setTipo(x);
                    if (!tituloMexido) setTitulo(tituloPadrao(x, empresaNome));
                  }}
                />
                <Icon name={ICONE_TAREFA[x]} size={14} />
                &nbsp;{ROTULO_TAREFA[x]}
              </label>
            ))}
          </fieldset>
          <div className="campo">
            <label htmlFor="tarefa-titulo">O que é</label>
            <input
              id="tarefa-titulo"
              className="filtro"
              maxLength={200}
              placeholder="Ex.: mandar a proposta revisada"
              value={titulo}
              onChange={(e) => {
                setTitulo(e.target.value);
                setTituloMexido(true);
              }}
            />
          </div>
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="tarefa-dia">Dia</label>
              <input
                id="tarefa-dia"
                className="filtro"
                type="date"
                required
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              />
            </div>
            <div className="campo">
              <label htmlFor="tarefa-hora">Hora</label>
              <input
                id="tarefa-hora"
                className="filtro"
                type="time"
                required
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          </div>
          <div className="atalhos-dia">
            {[
              ['Hoje', 0],
              ['Amanhã', 1],
              ['Em 2 dias', 2],
              ['Semana que vem', 7],
            ].map(([r, n]) => (
              <button
                key={r}
                type="button"
                className="link-botao"
                onClick={() => setDia(diaDaqui(Number(n)))}
              >
                {r}
              </button>
            ))}
          </div>
          {(tipo === 'reuniao' || tipo === 'visita') && (
            <div className="campo">
              <label htmlFor="tarefa-local">
                {tipo === 'reuniao' ? 'Link da reunião ou local' : 'Endereço'}
              </label>
              <input
                id="tarefa-local"
                className="filtro"
                maxLength={300}
                placeholder={tipo === 'reuniao' ? 'https://meet.google.com/…' : 'Rua, número, bairro'}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
              />
            </div>
          )}
          <div className="campo">
            <label htmlFor="tarefa-desc">Observação</label>
            <textarea
              id="tarefa-desc"
              rows={3}
              maxLength={2000}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          {ativos.length > 1 && (
            <div className="campo">
              <label htmlFor="tarefa-quem">De quem</label>
              <select
                id="tarefa-quem"
                className="filtro"
                value={usuarioId}
                onChange={(e) => setUsuarioId(e.target.value)}
              >
                <option value="">
                  {props.empresaId && !t
                    ? 'Do responsável pelo lead'
                    : `Minha (${sessao.data?.nome ?? 'eu'})`}
                </option>
                {ativos.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ErroDaApi erro={salvar.error ?? apagar.error} />
          {confirmarApagar && (
            <div className="confirmar">
              <span>Apagar “{t?.titulo}” da agenda?</span>
              <div className="acoes">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={apagar.isPending}
                  onClick={() => apagar.mutate()}
                >
                  Apagar compromisso
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmarApagar(false)}>
                  Manter
                </Button>
              </div>
            </div>
          )}
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              icon="calendar-plus"
              disabled={salvar.isPending || !dia || !hora}
            >
              {salvar.isPending
                ? 'Salvando…'
                : t
                  ? 'Salvar'
                  : tipo === 'reuniao'
                    ? 'Marcar reunião'
                    : 'Pôr na agenda'}
            </Button>
            <Button variant="ghost" onClick={props.aoFechar}>
              Cancelar
            </Button>
            {t && !confirmarApagar && (
              <Button variant="ghost" onClick={() => setConfirmarApagar(true)}>
                Apagar
              </Button>
            )}
          </div>
        </form>
      </div>
    </Drawer>
  );
}

/** Uma linha da agenda: concluir, abrir o lead, mandar para o Google, editar. */
export function LinhaTarefa(props: {
  t: Tarefa;
  mostrarLead?: boolean;
  mostrarDono?: boolean;
  aoAbrirLead?: (empresaId: number) => void;
  aoEditar?: (t: Tarefa) => void;
}) {
  const { t } = props;
  const atualizar = useAtualizarAgenda();
  const concluir = useMutation({
    mutationFn: (concluida: boolean) => api(`/agenda/${t.id}`, { metodo: 'PATCH', corpo: { concluida } }),
    onSuccess: () => atualizar(t.empresaId),
  });
  const feita = !!t.concluidaEm;
  return (
    <li
      className="tarefa"
      data-feita={feita || undefined}
      data-atrasada={(t.atrasada && !feita) || undefined}
    >
      <label className="tarefa__marcar" title={feita ? 'Desmarcar' : 'Marcar como feita'}>
        <input
          type="checkbox"
          checked={feita}
          disabled={concluir.isPending}
          onChange={(e) => concluir.mutate(e.target.checked)}
        />
        <span className="pp-sr">{feita ? `Desmarcar ${t.titulo}` : `Concluir ${t.titulo}`}</span>
      </label>
      <span className="tarefa__icone" data-tipo={t.tipo}>
        <Icon name={ICONE_TAREFA[t.tipo]} size={14} />
      </span>
      <div className="tarefa__corpo">
        <span className="tarefa__titulo">{t.titulo}</span>
        <span className="tarefa__meta">
          <span className={t.atrasada && !feita ? 'tarefa__quando--atrasada' : undefined}>
            {fmtCompromisso(t.inicio)}
          </span>
          {props.mostrarLead && t.empresaId && t.empresaNome && (
            <>
              {' · '}
              <button type="button" className="link-botao" onClick={() => props.aoAbrirLead?.(t.empresaId!)}>
                {fmtNome(t.empresaNome)}
              </button>
            </>
          )}
          {props.mostrarDono && t.usuarioNome && <> · {t.usuarioNome}</>}
          {t.local && (
            <>
              {' · '}
              {/^https?:\/\//.test(t.local) ? (
                <a href={t.local} target="_blank" rel="noreferrer">
                  entrar na reunião
                </a>
              ) : (
                t.local
              )}
            </>
          )}
          {t.lembreteLeadEm && <> · lembrete enviado ao lead</>}
        </span>
      </div>
      <div className="tarefa__acoes">
        {(t.tipo === 'reuniao' || t.tipo === 'visita') && !feita && (
          <a
            className="botao-icone"
            href={linkGoogle(t)}
            target="_blank"
            rel="noreferrer"
            title="Adicionar ao Google Agenda"
            aria-label={`Adicionar ${t.titulo} ao Google Agenda`}
          >
            <Icon name="calendar-plus" size={16} />
          </a>
        )}
        {props.aoEditar && (
          <button
            type="button"
            className="botao-icone"
            title="Editar"
            aria-label={`Editar ${t.titulo}`}
            onClick={() => props.aoEditar?.(t)}
          >
            <Icon name="ellipsis" size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

/** Agenda do lead, na ficha: reuniões e tarefas, marcar nova. */
export function AgendaDoLead(props: { empresaId: number; empresaNome: string }) {
  const q = useQuery({
    queryKey: ['agenda', 'lead', props.empresaId],
    queryFn: () => api<Tarefa[]>(`/agenda/lead/${props.empresaId}`),
  });
  const [form, setForm] = useState<{ tipo?: TipoTarefa; tarefa?: Tarefa } | null>(null);
  const abertas = q.data?.filter((t) => !t.concluidaEm) ?? [];
  const feitas = q.data?.filter((t) => t.concluidaEm) ?? [];
  return (
    <div className="pilha" style={{ gap: 8 }}>
      <div className="acoes">
        <Button size="sm" icon="calendar-plus" onClick={() => setForm({ tipo: 'reuniao' })}>
          Marcar reunião
        </Button>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setForm({ tipo: 'ligacao' })}>
          Ligação ou tarefa
        </Button>
      </div>
      {q.isPending ? null : !q.data?.length ? (
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Nada marcado com este lead.
        </p>
      ) : (
        <ul className="tarefas">
          {[...abertas.reverse(), ...feitas].map((t) => (
            <LinhaTarefa key={t.id} t={t} mostrarDono aoEditar={(x) => setForm({ tarefa: x })} />
          ))}
        </ul>
      )}
      {form && (
        <FormTarefa
          empresaId={props.empresaId}
          empresaNome={props.empresaNome}
          tarefa={form.tarefa}
          tipoInicial={form.tipo}
          aoFechar={() => setForm(null)}
        />
      )}
    </div>
  );
}
