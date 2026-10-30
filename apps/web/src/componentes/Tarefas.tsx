import { ABERTURAS_SALA, type EntradaSala, type OpcoesSala } from '@prospeccao/shared/reunioes';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ICONE_TAREFA, ROTULO_TAREFA, type Tarefa, type TipoTarefa } from '../api';
import { diaDaqui, diaDoInput, fmtCompromisso, fmtNome, horaDoInput, instanteDoInput } from '../formatar';
import type { EstadoReunioes } from '../reuniao/api';
import { LinkAjuda } from './Ajuda';
import { Drawer } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { useEquipe, useRecurso, useSessao } from './Sessao';

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

/** O que está configurado para as reuniões por vídeo (a tela só oferece o que funciona). */
export function useEstadoReunioes() {
  // Reuniões por vídeo são do plano Time em diante: fora do plano, a tela não oferece a sala.
  const noPlano = useRecurso('reunioes');
  return useQuery({
    queryKey: ['reunioes', 'estado', noPlano],
    queryFn: async () => {
      const e = await api<EstadoReunioes>('/reunioes/estado');
      return noPlano ? { ...e, foraDoPlano: false } : { ...e, video: false, foraDoPlano: true };
    },
    staleTime: 10 * 60_000,
  });
}

/** Link da sala de vídeo de uma reunião. */
export const linkDaSala = (codigo: string) => `${location.origin}/r/${codigo}`;

/** Copia o link da sala (e mostra "copiado" por um instante). */
export function CopiarLinkSala(props: { codigo: string; comTexto?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () =>
    void navigator.clipboard?.writeText(linkDaSala(props.codigo)).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  return props.comTexto ? (
    <Button size="sm" variant="ghost" icon={copiado ? 'check' : 'copy'} onClick={copiar}>
      {copiado ? 'Link copiado' : 'Copiar link'}
    </Button>
  ) : (
    <button
      type="button"
      className="botao-icone"
      title={copiado ? 'Link copiado' : 'Copiar o link da reunião'}
      aria-label={copiado ? 'Link copiado' : 'Copiar o link da reunião'}
      onClick={copiar}
    >
      <Icon name={copiado ? 'check' : 'link'} size={16} />
    </button>
  );
}

/** Manda o convite com o link pelo WhatsApp do lead. */
export function ConvidarPeloWhatsapp(props: {
  salaId: number;
  jaEnviado: string | null;
  aoEnviar?: () => void;
}) {
  const convidar = useMutation({
    mutationFn: () =>
      api<{ telefone: string }>(`/reunioes/salas/${props.salaId}/convite`, { metodo: 'POST', corpo: {} }),
    onSuccess: () => props.aoEnviar?.(),
  });
  return (
    <>
      <Button size="sm" icon="message-circle" disabled={convidar.isPending} onClick={() => convidar.mutate()}>
        {convidar.isPending
          ? 'Mandando…'
          : convidar.isSuccess
            ? 'Convite mandado'
            : props.jaEnviado
              ? 'Mandar o convite de novo'
              : 'Mandar convite no WhatsApp'}
      </Button>
      <ErroDaApi erro={convidar.error} />
    </>
  );
}

const OPCOES_SALA_PADRAO: OpcoesSala = {
  entrada: 'livre',
  gravar: true,
  transcrever: true,
  abreMinutosAntes: 10,
};

/** Opções da sala de vídeo: quem entra, quando abre e se grava. */
function OpcoesDaSala(props: {
  valor: OpcoesSala;
  aoMudar: (o: OpcoesSala) => void;
  estado: EstadoReunioes;
}) {
  const o = props.valor;
  const mudar = (x: Partial<OpcoesSala>) => props.aoMudar({ ...o, ...x });
  return (
    <div className="pilha" style={{ gap: 12 }}>
      <LinkAjuda artigo="reunioes">Como funciona a sala de vídeo</LinkAjuda>
      <fieldset className="opcoes opcoes--pilha" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="campo__rotulo">Quem pode entrar</legend>
        {(['livre', 'aprovacao'] as EntradaSala[]).map((e) => (
          <label key={e} className="opcao">
            <input
              type="radio"
              name="sala-entrada"
              checked={o.entrada === e}
              onChange={() => mudar({ entrada: e })}
            />
            {e === 'livre' ? 'Quem tem o link entra sozinho' : 'Eu aprovo cada pessoa que chegar'}
          </label>
        ))}
      </fieldset>
      <div className="campo">
        <label htmlFor="sala-abre">A sala abre para os convidados</label>
        <select
          id="sala-abre"
          value={o.abreMinutosAntes}
          onChange={(e) => mudar({ abreMinutosAntes: Number(e.target.value) })}
        >
          {ABERTURAS_SALA.map((m) => (
            <option key={m} value={m}>
              {m} minutos antes
            </option>
          ))}
        </select>
        <span className="campo__dica">
          Antes disso, o link mostra quanto falta. Você e o time entram quando quiserem.
        </span>
      </div>
      <div className="opcoes opcoes--pilha">
        <label className="opcao">
          <input
            type="checkbox"
            checked={o.gravar && props.estado.gravacao}
            disabled={!props.estado.gravacao}
            onChange={(e) =>
              mudar({ gravar: e.target.checked, transcrever: e.target.checked && o.transcrever })
            }
          />
          Gravar a reunião (vídeo, áudio e tela compartilhada)
        </label>
        <label className="opcao">
          <input
            type="checkbox"
            checked={o.gravar && o.transcrever && props.estado.transcricao}
            disabled={!o.gravar || !props.estado.transcricao}
            onChange={(e) => mudar({ transcrever: e.target.checked })}
          />
          Transcrever e resumir com a IA (resumo e próximos passos na ficha)
        </label>
      </div>
      {!props.estado.gravacao && (
        <span className="campo__dica">
          A gravação ainda não foi configurada neste sistema: a reunião acontece sem gravar.
        </span>
      )}
      {props.estado.gravacao && o.gravar && (
        <span className="campo__dica">Os convidados são avisados na entrada que a reunião é gravada.</span>
      )}
    </div>
  );
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
  const estado = useEstadoReunioes();
  const videoLigado = !!estado.data?.video;
  // Reunião nova: na sala de vídeo do sistema (quando configurada); editando: como estava.
  const [naSalaEscolha, setNaSala] = useState<boolean | null>(t ? !!t.sala : null);
  const naSala = tipo === 'reuniao' && videoLigado && (naSalaEscolha ?? true);
  const [opcoesSala, setOpcoesSala] = useState<OpcoesSala>(
    t?.sala
      ? {
          entrada: t.sala.entrada,
          gravar: t.sala.gravar,
          transcrever: t.sala.transcrever,
          abreMinutosAntes: t.sala.abreMinutosAntes,
        }
      : OPCOES_SALA_PADRAO,
  );
  const [criada, setCriada] = useState<Tarefa | null>(null);

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        tipo,
        titulo: titulo.trim() || tituloPadrao(tipo, empresaNome) || ROTULO_TAREFA[tipo],
        inicio: instanteDoInput(dia, hora),
        ...(naSala ? {} : { local: t?.sala && local === t.local ? '' : local.trim() }),
        descricao: descricao.trim(),
        ...(usuarioId ? { usuarioId: Number(usuarioId) } : {}),
        ...(t ? {} : { empresaId: props.empresaId ?? null }),
        // A sala do sistema: com as opções; tirar a sala (outro local) cancela o link.
        ...(naSala
          ? {
              sala: {
                ...opcoesSala,
                gravar: opcoesSala.gravar && !!estado.data?.gravacao,
                transcrever: opcoesSala.gravar && opcoesSala.transcrever && !!estado.data?.transcricao,
              },
            }
          : t?.sala
            ? { sala: null }
            : {}),
      };
      return t
        ? api<Tarefa>(`/agenda/${t.id}`, { metodo: 'PATCH', corpo })
        : api<Tarefa>('/agenda', { metodo: 'POST', corpo });
    },
    onSuccess: (salva) => {
      atualizar(t?.empresaId ?? props.empresaId);
      // Reunião nova na sala: mostra o link para copiar ou mandar.
      if (!t && salva.sala) setCriada(salva);
      else props.aoFechar();
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
        {criada?.sala ? (
          <ReuniaoMarcada t={criada} aoFechar={props.aoFechar} />
        ) : (
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
            {tipo === 'reuniao' && videoLigado && (
              <fieldset className="segmentos" aria-label="Onde vai ser a reunião">
                <legend className="pp-sr">Onde vai ser a reunião</legend>
                <label className="segmento">
                  <input
                    type="radio"
                    name="onde-reuniao"
                    className="pp-sr"
                    checked={naSala}
                    onChange={() => setNaSala(true)}
                  />
                  <Icon name="video" size={14} />
                  &nbsp;Sala de vídeo do sistema
                </label>
                <label className="segmento">
                  <input
                    type="radio"
                    name="onde-reuniao"
                    className="pp-sr"
                    checked={!naSala}
                    onChange={() => setNaSala(false)}
                  />
                  <Icon name="link" size={14} />
                  &nbsp;Outro link ou local
                </label>
              </fieldset>
            )}
            {naSala && estado.data && (
              <OpcoesDaSala valor={opcoesSala} aoMudar={setOpcoesSala} estado={estado.data} />
            )}
            {(tipo === 'reuniao' || tipo === 'visita') && !naSala && (
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
        )}
      </div>
    </Drawer>
  );
}

/** Depois de marcar: o link da sala para copiar, mandar ao lead ou entrar. */
function ReuniaoMarcada(props: { t: Tarefa; aoFechar: () => void }) {
  const { t } = props;
  const sala = t.sala!;
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <Mensagem tipo="ok">
        Reunião marcada para {fmtCompromisso(t.inicio)}. A sala abre {sala.abreMinutosAntes} minutos antes
        para os convidados.
      </Mensagem>
      <div className="link-sala">
        <Icon name="link" size={16} />
        <span className="mono">{linkDaSala(sala.codigo)}</span>
        <CopiarLinkSala codigo={sala.codigo} comTexto />
      </div>
      <div className="acoes">
        {t.empresaId && <ConvidarPeloWhatsapp salaId={sala.id} jaEnviado={sala.conviteEnviadoEm} />}
        <Button icon="video" href={`/r/${sala.codigo}`} target="_blank" rel="noreferrer">
          Entrar na sala
        </Button>
      </div>
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        O lembrete automático para o lead também leva o link.
      </p>
      <div className="acoes">
        <Button variant="primary" onClick={props.aoFechar}>
          Pronto
        </Button>
      </div>
    </div>
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
              {t.sala ? (
                <>sala de vídeo{t.sala.gravar ? ' · gravada' : ''}</>
              ) : /^https?:\/\//.test(t.local) ? (
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
        {t.sala && t.sala.status !== 'cancelada' && !feita && (
          <>
            <Button
              size="sm"
              variant={t.sala.status === 'ao_vivo' ? 'primary' : 'secondary'}
              icon="video"
              href={`/r/${t.sala.codigo}`}
              target="_blank"
              rel="noreferrer"
            >
              {t.sala.status === 'ao_vivo' ? 'Acontecendo agora' : 'Entrar'}
            </Button>
            <CopiarLinkSala codigo={t.sala.codigo} />
          </>
        )}
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
