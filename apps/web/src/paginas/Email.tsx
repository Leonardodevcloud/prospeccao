import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  type ArquivoEmail,
  api,
  type Campanha,
  type CampanhaEmail,
  type ClasseResposta,
  type ConfigEmail,
  type EnvioEmail,
  type ModeloEmail,
  type RespostaEmail,
  ROTULO_CLASSE,
  ROTULO_ETAPA,
  type VisaoEmail,
} from '../api';
import { Drawer } from '../componentes/Drawer';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useSessao } from '../componentes/Sessao';
import { fmtCidade, fmtHora, fmtNome, fmtNumero, fmtPct, fmtQuando } from '../formatar';

type Aba = 'campanhas' | 'modelos' | 'enviados' | 'respostas' | 'config';
const ABAS: { id: Aba; rotulo: string; admin?: boolean }[] = [
  { id: 'campanhas', rotulo: 'Campanhas' },
  { id: 'respostas', rotulo: 'Respostas' },
  { id: 'enviados', rotulo: 'Enviados' },
  { id: 'modelos', rotulo: 'Modelos' },
  { id: 'config', rotulo: 'Configuração', admin: true },
];

const TOM_CLASSE: Record<ClasseResposta, 'brand' | 'neutral' | 'danger' | 'outline'> = {
  interessado: 'brand',
  sem_interesse: 'neutral',
  descadastro: 'danger',
  automatica: 'outline',
};

const ROTULO_STATUS: Record<CampanhaEmail['status'], string> = {
  rascunho: 'Rascunho',
  enviando: 'Enviando',
  pausada: 'Pausada',
  concluida: 'Concluída',
};

export function useVisaoEmail() {
  return useQuery({ queryKey: ['email'], queryFn: () => api<VisaoEmail>('/email'), refetchInterval: 30_000 });
}

function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

const fmtTamanho = (b: number) =>
  b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

/* ───────────────────────── Status (topo) ───────────────────────── */

function Status(props: { v: VisaoEmail; aoConfigurar: () => void }) {
  const { v } = props;
  const cliente = useQueryClient();
  const admin = useEhAdmin();
  const ligar = useMutation({
    mutationFn: (ligado: boolean) => api('/email/config', { metodo: 'PUT', corpo: { ...v.config, ligado } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });
  if (!v.status.smtp)
    return (
      <Mensagem tipo="aviso">
        O e-mail ainda não está conectado. Configure a caixa da empresa na API do Railway (EMAIL_SMTP_HOST,
        EMAIL_USUARIO, EMAIL_SENHA e, para ler as respostas, EMAIL_IMAP_HOST).{' '}
        <button type="button" className="link-botao" onClick={props.aoConfigurar}>
          Ver como
        </button>
      </Mensagem>
    );
  return (
    <div className="status-email">
      <div className="status-email__item">
        <span className="quieto">Envio automático</span>
        {admin ? (
          <label className="interruptor">
            <input
              type="checkbox"
              checked={v.config.ligado}
              disabled={ligar.isPending}
              onChange={(e) => ligar.mutate(e.target.checked)}
            />
            <b>{v.config.ligado ? 'Ligado' : 'Desligado'}</b>
          </label>
        ) : (
          <b>{v.config.ligado ? 'Ligado' : 'Desligado'}</b>
        )}
      </div>
      <div className="status-email__item">
        <span className="quieto">Enviados hoje</span>
        <b className="mono">
          {fmtNumero(v.resumo.enviadosHoje)} / {fmtNumero(v.config.limiteDia)}
        </b>
      </div>
      <div className="status-email__item">
        <span className="quieto">Na fila</span>
        <b className="mono">{fmtNumero(v.resumo.naFila)}</b>
      </div>
      <div className="status-email__item">
        <span className="quieto">Remetente</span>
        <b>
          {v.config.remetenteNome} &lt;{v.status.remetente}&gt;
        </b>
      </div>
      <div className="status-email__item">
        <span className="quieto">Leitura das respostas</span>
        <b>
          {!v.status.imap
            ? 'Não configurada'
            : v.config.imapErro
              ? 'Com erro'
              : v.config.imapLidoEm
                ? `Lida ${fmtQuando(v.config.imapLidoEm)}`
                : 'Aguardando'}
        </b>
      </div>
      <ErroDaApi erro={ligar.error} />
    </div>
  );
}

/* ───────────────────────── Campanhas ───────────────────────── */

function NovaCampanha(props: { modelos: ModeloEmail[]; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });
  const [f, setF] = useState({
    nome: '',
    campanhaId: 0,
    faixas: [] as ('A' | 'B' | 'C')[],
    pularNoFunil: true,
    incluirContador: false,
    passos: [{ modeloId: props.modelos[0]?.id ?? 0, dias: 0 }] as { modeloId: number; dias: number }[],
  });
  const filtro = {
    campanhaId: f.campanhaId,
    faixas: f.faixas,
    pularNoFunil: f.pularNoFunil,
    incluirContador: f.incluirContador,
  };
  const estimativa = useQuery({
    queryKey: ['email', 'estimar', filtro],
    queryFn: () =>
      api<{
        leads: number;
        comEmail: number;
        elegiveis: number;
        exemplos: { empresaId: number; nome: string; email: string; faixa: string | null }[];
      }>('/email/campanhas/estimar', { metodo: 'POST', corpo: filtro }),
    enabled: f.campanhaId > 0,
    placeholderData: keepPreviousData,
  });
  const criar = useMutation({
    mutationFn: async (iniciar: boolean) => {
      const { id } = await api<{ id: number }>('/email/campanhas', { metodo: 'POST', corpo: f });
      if (iniciar) await api(`/email/campanhas/${id}/iniciar`, { metodo: 'POST' });
    },
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['email'] });
      props.aoFechar();
    },
  });
  const faixa = (x: 'A' | 'B' | 'C') =>
    setF({ ...f, faixas: f.faixas.includes(x) ? f.faixas.filter((y) => y !== x) : [...f.faixas, x] });
  const campanha = campanhas.data?.find((c) => c.id === f.campanhaId);

  return (
    <Drawer titulo="Nova campanha de e-mail" barra="E-mail" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            criar.mutate(true);
          }}
        >
          <div className="campo">
            <label htmlFor="ce-campanha">Leads de qual campanha</label>
            <select
              id="ce-campanha"
              className="filtro"
              value={f.campanhaId || ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                const c = campanhas.data?.find((x) => x.id === id);
                setF({ ...f, campanhaId: id, nome: f.nome || (c ? `E-mail · ${c.nome}` : '') });
              }}
            >
              <option value="">Escolha a campanha de prospecção</option>
              {campanhas.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="ce-nome">Nome desta campanha de e-mail</label>
            <input
              id="ce-nome"
              className="filtro"
              maxLength={120}
              value={f.nome}
              onChange={(e) => setF({ ...f, nome: e.target.value })}
            />
          </div>

          <fieldset className="opcoes">
            <legend>Quem recebe</legend>
            <div className="segmentos">
              {(['A', 'B', 'C'] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  className="segmento"
                  data-ativo={f.faixas.includes(x) || undefined}
                  aria-pressed={f.faixas.includes(x)}
                  onClick={() => faixa(x)}
                >
                  Nota {x}
                </button>
              ))}
              <span className="quieto" style={{ alignSelf: 'center', fontSize: 12 }}>
                {f.faixas.length ? '' : 'Nenhuma marcada = todas (qualificados ou não)'}
              </span>
            </div>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.pularNoFunil}
                onChange={(e) => setF({ ...f, pularNoFunil: e.target.checked })}
              />
              Pular quem já está sendo trabalhado no funil (abordado, em conversa, cliente…)
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.incluirContador}
                onChange={(e) => setF({ ...f, incluirContador: e.target.checked })}
              />
              Incluir e-mails que parecem ser do contador (vieram da Receita)
            </label>
          </fieldset>

          {f.campanhaId > 0 && (
            <div className="estimativa-email">
              {estimativa.isPending ? (
                <div className="esqueleto" />
              ) : estimativa.data ? (
                <>
                  <p style={{ margin: 0 }}>
                    <b className="mono" style={{ fontSize: 20 }}>
                      {fmtNumero(estimativa.data.elegiveis)}
                    </b>{' '}
                    {estimativa.data.elegiveis === 1 ? 'lead vai receber' : 'leads vão receber'}
                    <span className="quieto">
                      {' '}
                      · {fmtNumero(estimativa.data.comEmail)} de {fmtNumero(estimativa.data.leads)} leads de “
                      {campanha?.nome}” têm e-mail
                    </span>
                  </p>
                  {estimativa.data.exemplos.length > 0 && (
                    <ul className="exemplos-email">
                      {estimativa.data.exemplos.map((x) => (
                        <li key={x.empresaId}>
                          {fmtNome(x.nome)} <span className="quieto mono">{x.email}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <span className="campo__dica">
                    Fica de fora quem pediu para sair, quem foi descartado e quem já recebeu e-mail de outra
                    campanha nos últimos 30 dias.
                  </span>
                </>
              ) : null}
            </div>
          )}

          <fieldset className="opcoes">
            <legend>Sequência</legend>
            {f.passos.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a posição é o próprio passo
              <div key={i} className="passo-email">
                <span className="passo-email__n mono">{i + 1}º</span>
                <label className="pp-sr" htmlFor={`passo-modelo-${i}`}>
                  Modelo do {i + 1}º e-mail
                </label>
                <select
                  id={`passo-modelo-${i}`}
                  className="filtro"
                  value={p.modeloId}
                  onChange={(e) =>
                    setF({
                      ...f,
                      passos: f.passos.map((x, j) =>
                        j === i ? { ...x, modeloId: Number(e.target.value) } : x,
                      ),
                    })
                  }
                >
                  {props.modelos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                      {m.arquivos.length
                        ? ` (${m.arquivos.length} anexo${m.arquivos.length === 1 ? '' : 's'})`
                        : ''}
                    </option>
                  ))}
                </select>
                {i === 0 ? (
                  <span className="quieto">logo que começar</span>
                ) : (
                  <span className="passo-email__dias">
                    <input
                      className="filtro"
                      inputMode="numeric"
                      aria-label={`Dias sem resposta antes do ${i + 1}º e-mail`}
                      value={p.dias}
                      onChange={(e) =>
                        setF({
                          ...f,
                          passos: f.passos.map((x, j) =>
                            j === i ? { ...x, dias: Number(e.target.value.replace(/\D/g, '')) || 0 } : x,
                          ),
                        })
                      }
                    />
                    dias sem resposta
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label={`Tirar o ${i + 1}º e-mail`}
                      onClick={() => setF({ ...f, passos: f.passos.filter((_, j) => j !== i) })}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </span>
                )}
              </div>
            ))}
            {f.passos.length < 4 && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="plus"
                  onClick={() =>
                    setF({
                      ...f,
                      passos: [
                        ...f.passos,
                        { modeloId: props.modelos.at(-1)?.id ?? 0, dias: f.passos.length === 1 ? 3 : 5 },
                      ],
                    })
                  }
                >
                  Follow-up se não responder
                </Button>
              </div>
            )}
            <span className="campo__dica">
              Respondeu, pediu para sair ou o e-mail voltou: a sequência para na hora para aquele lead.
            </span>
          </fieldset>

          <ErroDaApi erro={criar.error} />
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              icon="send"
              disabled={criar.isPending || !f.campanhaId || !f.nome.trim() || !estimativa.data?.elegiveis}
            >
              Criar e começar a enviar
            </Button>
            <Button
              variant="ghost"
              disabled={criar.isPending || !f.campanhaId || !f.nome.trim()}
              onClick={() => criar.mutate(false)}
            >
              Salvar sem enviar
            </Button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}

function Campanhas(props: { modelos: ModeloEmail[]; ligado: boolean }) {
  const cliente = useQueryClient();
  const admin = useEhAdmin();
  const [, setParams] = useSearchParams();
  const [nova, setNova] = useState(false);
  const q = useQuery({
    queryKey: ['email', 'campanhas'],
    queryFn: () => api<CampanhaEmail[]>('/email/campanhas'),
    refetchInterval: 30_000,
  });
  const acao = useMutation({
    mutationFn: (d: { id: number; acao: 'iniciar' | 'pausar' | 'apagar' }) =>
      d.acao === 'apagar'
        ? api(`/email/campanhas/${d.id}`, { metodo: 'DELETE' })
        : api(`/email/campanhas/${d.id}/${d.acao}`, { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });

  return (
    <section className="pilha" style={{ gap: 12 }}>
      {admin && (
        <div className="acoes">
          <Button
            variant="primary"
            icon="plus"
            disabled={!props.modelos.length}
            onClick={() => setNova(true)}
          >
            Nova campanha de e-mail
          </Button>
        </div>
      )}
      {!props.ligado && q.data?.some((c) => c.status === 'enviando' && c.naFila > 0) && (
        <Mensagem tipo="aviso">
          Há e-mails na fila, mas o envio automático está desligado. Ligue no topo da página para começarem a sair.
        </Mensagem>
      )}
      <ErroDaApi erro={q.error ?? acao.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : !q.data?.length ? (
        <div className="pp-panel">
          <EmptyState
            icone="mail"
            titulo="Nenhuma campanha de e-mail ainda"
            texto="Escolha uma campanha de prospecção: todo lead com e-mail recebe sua apresentação e a proposta em anexo, com follow-up automático. Quem responder com interesse entra sozinho no SDR."
          />
        </div>
      ) : (
        <div className="grade-cards">
          {q.data.map((c) => {
            const base = c.enviados ? c.leads : 0;
            return (
              <article key={c.id} className="pp-panel card-email">
                <header className="card-email__topo">
                  <div>
                    <b>{c.nome}</b>
                    <span className="quieto card-email__sub">
                      {c.campanhaNome} · {c.passos.length}{' '}
                      {c.passos.length === 1 ? 'e-mail' : 'e-mails na sequência'}
                    </span>
                  </div>
                  <Badge
                    tone={c.status === 'enviando' ? 'brand' : c.status === 'pausada' ? 'warning' : 'neutral'}
                  >
                    {ROTULO_STATUS[c.status]}
                  </Badge>
                </header>
                <div className="funil-email">
                  <div>
                    <b className="mono">{fmtNumero(c.enviados)}</b>
                    <span>enviados</span>
                  </div>
                  <div>
                    <b className="mono">{fmtPct(c.abriram, base)}</b>
                    <span>abriram ({fmtNumero(c.abriram)})</span>
                  </div>
                  <div>
                    <b className="mono">{fmtNumero(c.clicaram)}</b>
                    <span>clicaram</span>
                  </div>
                  <div>
                    <b className="mono">{fmtNumero(c.responderam)}</b>
                    <span>responderam</span>
                  </div>
                  <div data-destaque>
                    <b className="mono">{fmtNumero(c.interessados)}</b>
                    <span>com interesse</span>
                  </div>
                </div>
                <p className="quieto card-email__rodape">
                  {c.naFila > 0 && `${fmtNumero(c.naFila)} na fila · `}
                  {c.erros > 0 && `${fmtNumero(c.erros)} não entregues · `}
                  {c.ultimoEnvio ? `último envio ${fmtHora(c.ultimoEnvio)}` : 'nada enviado ainda'}
                </p>
                <div className="acoes">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setParams({ aba: 'enviados', campanha: String(c.id) })}
                  >
                    Ver envios
                  </Button>
                  {admin && (c.status === 'rascunho' || c.status === 'pausada') && (
                    <Button size="sm" icon="send" onClick={() => acao.mutate({ id: c.id, acao: 'iniciar' })}>
                      {c.status === 'rascunho' ? 'Começar a enviar' : 'Retomar'}
                    </Button>
                  )}
                  {admin && c.status === 'enviando' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => acao.mutate({ id: c.id, acao: 'pausar' })}
                    >
                      Pausar
                    </Button>
                  )}
                  {admin && c.enviados === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => acao.mutate({ id: c.id, acao: 'apagar' })}
                    >
                      Apagar
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="nota-rodape">
        “Abriram” conta quem carregou as imagens do e-mail: o Gmail carrega sozinho e o Outlook às vezes
        bloqueia, então é uma estimativa. Clique e resposta são certeza.
      </p>
      {nova && <NovaCampanha modelos={props.modelos} aoFechar={() => setNova(false)} />}
    </section>
  );
}

/* ───────────────────────── Modelos (editor com prévia) ───────────────────────── */

function Previa(props: { assunto: string; corpo: string }) {
  const [atraso, setAtraso] = useState(props);
  useEffect(() => {
    const t = setTimeout(() => setAtraso(props), 400);
    return () => clearTimeout(t);
  }, [props]);
  const q = useQuery({
    queryKey: ['email', 'previa', atraso.assunto, atraso.corpo],
    queryFn: () =>
      api<{
        assunto: string;
        html: string;
        remetente: string;
        lead: { empresa: string; nome: string | null };
      }>('/email/previa', {
        metodo: 'POST',
        corpo: atraso,
      }),
    placeholderData: keepPreviousData,
    enabled: !!atraso.corpo.trim(),
  });
  return (
    <div className="previa-email">
      <div className="previa-email__cabeca">
        <span className="quieto">
          De: <b>{q.data?.remetente ?? '—'}</b>
        </span>
        <span className="quieto">
          Para:{' '}
          <b>{q.data ? `${q.data.lead.empresa}${q.data.lead.nome ? ` (${q.data.lead.nome})` : ''}` : '—'}</b>
        </span>
        <span className="previa-email__assunto">{q.data?.assunto || 'Sem assunto'}</span>
      </div>
      {q.data ? (
        <iframe title="Prévia do e-mail" className="previa-email__corpo" sandbox="" srcDoc={q.data.html} />
      ) : (
        <div className="esqueleto" />
      )}
    </div>
  );
}

function EditorModelo(props: {
  modelo: ModeloEmail | null;
  aoSalvar: (id: number) => void;
  aoApagar: () => void;
}) {
  const cliente = useQueryClient();
  const sessao = useSessao();
  const admin = useEhAdmin();
  const m = props.modelo;
  const [f, setF] = useState({ nome: '', assunto: '', corpo: '' });
  const [arquivos, setArquivos] = useState<ArquivoEmail[]>([]);
  const [para, setPara] = useState('');
  const [testeOk, setTesteOk] = useState(false);
  const corpoRef = useRef<HTMLTextAreaElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setF({ nome: m?.nome ?? '', assunto: m?.assunto ?? '', corpo: m?.corpo ?? '' });
    setArquivos(m?.arquivos ?? []);
    setTesteOk(false);
  }, [m]);
  useEffect(() => setPara((p) => p || sessao.data?.email || ''), [sessao.data?.email]);

  const salvar = useMutation({
    mutationFn: () =>
      m
        ? api<{ id: number; modelos: ModeloEmail[] }>(`/email/modelos/${m.id}`, {
            metodo: 'PUT',
            corpo: { ...f, anexos: arquivos.map((a) => a.id) },
          })
        : api<{ id: number; modelos: ModeloEmail[] }>('/email/modelos', {
            metodo: 'POST',
            corpo: { ...f, anexos: arquivos.map((a) => a.id) },
          }),
    onSuccess: (d) => {
      cliente.setQueryData(['email', 'modelos'], d.modelos);
      props.aoSalvar(d.id);
    },
  });
  const apagar = useMutation({
    mutationFn: () => api<ModeloEmail[]>(`/email/modelos/${m?.id}`, { metodo: 'DELETE' }),
    onSuccess: (d) => {
      cliente.setQueryData(['email', 'modelos'], d);
      props.aoApagar();
    },
  });
  const anexar = useMutation({
    mutationFn: async (arq: File) =>
      api<ArquivoEmail>('/email/anexos', {
        metodo: 'POST',
        corpo: { nome: arq.name, mime: arq.type || 'application/octet-stream', base64: await lerBase64(arq) },
      }),
    onSuccess: (a) => setArquivos((x) => [...x, a]),
  });
  const teste = useMutation({
    mutationFn: () =>
      api('/email/teste', { metodo: 'POST', corpo: { ...f, anexos: arquivos.map((a) => a.id), para } }),
    onSuccess: () => setTesteOk(true),
  });

  const inserir = (v: string) => {
    const el = corpoRef.current;
    if (!el) return;
    const ini = el.selectionStart ?? f.corpo.length;
    const fim = el.selectionEnd ?? ini;
    const novo = f.corpo.slice(0, ini) + v + f.corpo.slice(fim);
    setF({ ...f, corpo: novo });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + v.length, ini + v.length);
    });
  };
  const total = arquivos.reduce((s, a) => s + a.tamanho, 0);
  const mudou =
    !m ||
    f.nome !== m.nome ||
    f.assunto !== m.assunto ||
    f.corpo !== m.corpo ||
    arquivos.map((a) => a.id).join() !== m.anexos.join();

  return (
    <div className="editor-email">
      <form
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="campo">
          <label htmlFor="me-nome">Nome do modelo</label>
          <input
            id="me-nome"
            className="filtro"
            maxLength={80}
            disabled={!admin}
            value={f.nome}
            onChange={(e) => setF({ ...f, nome: e.target.value })}
          />
        </div>
        <div className="campo">
          <label htmlFor="me-assunto">Assunto</label>
          <input
            id="me-assunto"
            className="filtro"
            maxLength={200}
            disabled={!admin}
            value={f.assunto}
            onChange={(e) => setF({ ...f, assunto: e.target.value })}
          />
        </div>
        <div className="campo">
          <label htmlFor="me-corpo">Texto do e-mail</label>
          <div className="variaveis">
            {[
              ['{saudacao}', '“Olá, Marcos!”'],
              ['{nome}', 'nome do decisor'],
              ['{empresa}', 'nome da loja'],
              ['{cidade}', 'cidade'],
              ['{remetente}', 'seu nome'],
            ].map(([v, dica]) => (
              <button
                key={v}
                type="button"
                className="variavel"
                title={dica}
                disabled={!admin}
                onClick={() => inserir(v as string)}
              >
                {v}
              </button>
            ))}
          </div>
          <textarea
            id="me-corpo"
            ref={corpoRef}
            rows={14}
            maxLength={20_000}
            disabled={!admin}
            value={f.corpo}
            onChange={(e) => setF({ ...f, corpo: e.target.value })}
          />
          <span className="campo__dica">
            Linha em branco separa parágrafos. Comece a linha com “- ” para lista e use **assim** para
            negrito. Links viram clicáveis. A assinatura e o “sair da lista” entram sozinhos no fim.
          </span>
        </div>

        <div className="campo">
          <span className="campo__rotulo">Anexos</span>
          {arquivos.length > 0 && (
            <ul className="anexos">
              {arquivos.map((a) => (
                <li key={a.id}>
                  <Icon name="file-text" size={14} />
                  <a href={`/api/conversas/midia/${a.id}`} target="_blank" rel="noreferrer">
                    {a.nome}
                  </a>
                  <span className="quieto">{fmtTamanho(a.tamanho)}</span>
                  {admin && (
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label={`Tirar ${a.nome}`}
                      onClick={() => setArquivos((x) => x.filter((y) => y.id !== a.id))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {admin && (
            <div>
              <input
                ref={arquivoRef}
                type="file"
                hidden
                accept="application/pdf,image/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                onChange={(e) => {
                  const arq = e.target.files?.[0];
                  if (arq) anexar.mutate(arq);
                  e.target.value = '';
                }}
              />
              <Button
                size="sm"
                icon="paperclip"
                disabled={anexar.isPending || arquivos.length >= 5}
                onClick={() => arquivoRef.current?.click()}
              >
                {anexar.isPending ? 'Enviando…' : 'Anexar arquivo'}
              </Button>
              <span className="campo__dica" style={{ marginLeft: 8 }}>
                Proposta comercial, apresentação… até 10 MB somando tudo ({fmtTamanho(total)} usados).
              </span>
            </div>
          )}
          <ErroDaApi erro={anexar.error} />
        </div>

        <ErroDaApi erro={salvar.error ?? apagar.error} />
        {admin && (
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={salvar.isPending || !mudou || !f.nome.trim() || !f.assunto.trim() || !f.corpo.trim()}
            >
              {salvar.isPending ? 'Salvando…' : m ? 'Salvar modelo' : 'Criar modelo'}
            </Button>
            {m && (
              <Button variant="ghost" disabled={apagar.isPending} onClick={() => apagar.mutate()}>
                Apagar modelo
              </Button>
            )}
          </div>
        )}

        {admin && (
          <div className="confirmar">
            <label htmlFor="me-teste" style={{ fontWeight: 500 }}>
              Mandar um teste para ver na caixa de entrada de verdade
            </label>
            <div className="barra">
              <input
                id="me-teste"
                className="filtro"
                type="email"
                style={{ flex: '1 1 220px' }}
                value={para}
                onChange={(e) => setPara(e.target.value)}
              />
              <Button
                size="sm"
                icon="send"
                disabled={teste.isPending || !para || !f.assunto.trim() || !f.corpo.trim()}
                onClick={() => teste.mutate()}
              >
                {teste.isPending ? 'Enviando…' : 'Enviar teste'}
              </Button>
            </div>
            {testeOk && (
              <Mensagem tipo="ok">Teste enviado para {para}. Confira também a pasta de spam.</Mensagem>
            )}
            <ErroDaApi erro={teste.error} />
          </div>
        )}
      </form>
      <Previa assunto={f.assunto} corpo={f.corpo} />
    </div>
  );
}

function Modelos(props: { modelos: ModeloEmail[]; carregando: boolean }) {
  const [params, setParams] = useSearchParams();
  const admin = useEhAdmin();
  const pedido = params.get('modelo');
  const novo = pedido === 'novo';
  const atual = novo
    ? null
    : (props.modelos.find((m) => String(m.id) === pedido) ?? props.modelos[0] ?? null);
  const abrir = (v: string) => {
    const p = new URLSearchParams(params);
    p.set('modelo', v);
    setParams(p, { replace: true });
  };
  if (props.carregando) return <div className="esqueleto" />;
  return (
    <div className="modelos-email">
      <nav className="modelos-email__lista" aria-label="Modelos">
        {props.modelos.map((m) => (
          <button
            key={m.id}
            type="button"
            className="modelo-item"
            aria-current={(!novo && atual?.id === m.id) || undefined}
            onClick={() => abrir(String(m.id))}
          >
            <b>{m.nome}</b>
            <span className="quieto">{m.assunto}</span>
            {m.arquivos.length > 0 && (
              <span className="quieto">
                <Icon name="paperclip" size={12} /> {m.arquivos.map((a) => a.nome).join(', ')}
              </span>
            )}
          </button>
        ))}
        {admin && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => abrir('novo')}>
            Novo modelo
          </Button>
        )}
      </nav>
      <EditorModelo
        key={novo ? 'novo' : (atual?.id ?? 'vazio')}
        modelo={atual}
        aoSalvar={(id) => abrir(String(id))}
        aoApagar={() => abrir('')}
      />
    </div>
  );
}

/* ───────────────────────── Enviados ───────────────────────── */

function Enviados(props: { aoAbrirLead: (id: number) => void }) {
  const [params, setParams] = useSearchParams();
  const campanha = params.get('campanha') ?? '';
  const filtro = params.get('filtro') ?? 'todos';
  const campanhas = useQuery({
    queryKey: ['email', 'campanhas'],
    queryFn: () => api<CampanhaEmail[]>('/email/campanhas'),
  });
  const q = useQuery({
    queryKey: ['email', 'envios', campanha, filtro],
    queryFn: () =>
      api<EnvioEmail[]>(`/email/envios?filtro=${filtro}${campanha ? `&campanhaEmailId=${campanha}` : ''}`),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const mudar = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const STATUS: Record<EnvioEmail['status'], string> = {
    na_fila: 'Na fila',
    enviado: 'Enviado',
    erro: 'Erro',
    devolvido: 'Voltou',
    cancelado: 'Cancelado',
  };
  return (
    <section className="pilha" style={{ gap: 12 }}>
      <div className="barra">
        <label className="pp-sr" htmlFor="env-campanha">
          Campanha
        </label>
        <select
          id="env-campanha"
          className="filtro"
          value={campanha}
          onChange={(e) => mudar('campanha', e.target.value || null)}
        >
          <option value="">Todas as campanhas</option>
          {campanhas.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <div className="segmentos" role="tablist" aria-label="Filtro">
          {[
            ['todos', 'Todos'],
            ['abriram', 'Abriram'],
            ['responderam', 'Responderam'],
            ['fila', 'Na fila'],
            ['erros', 'Não entregues'],
          ].map(([id, r]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="segmento"
              aria-selected={filtro === id}
              data-ativo={filtro === id || undefined}
              onClick={() => mudar('filtro', id === 'todos' ? null : (id as string))}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <ErroDaApi erro={q.error} />
      <div className="pp-tablewrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>E-mail</th>
              <th>Passo</th>
              <th>Status</th>
              <th>Abriu</th>
              <th>Clicou</th>
              <th>Respondeu</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending ? (
              <tr>
                <td colSpan={7}>
                  <div className="esqueleto" />
                </td>
              </tr>
            ) : !q.data?.length ? (
              <tr>
                <td colSpan={7} className="quieto">
                  Nada por aqui ainda.
                </td>
              </tr>
            ) : (
              q.data.map((e) => (
                <tr key={e.id}>
                  <td>
                    <button
                      type="button"
                      className="link-botao"
                      onClick={() => props.aoAbrirLead(e.empresaId)}
                    >
                      {fmtNome(e.nome)}
                    </button>
                    <div className="quieto" style={{ fontSize: 12 }}>
                      {e.cidade ? fmtCidade(e.cidade) : ''}
                      {e.etapaFunil && e.etapaFunil !== 'descartado'
                        ? ` · no funil: ${ROTULO_ETAPA[e.etapaFunil]}`
                        : ''}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {e.email}
                  </td>
                  <td className="mono">{e.passo}º</td>
                  <td>
                    <Badge
                      tone={
                        e.status === 'enviado'
                          ? 'neutral'
                          : e.status === 'na_fila'
                            ? 'outline'
                            : e.status === 'cancelado'
                              ? 'outline'
                              : 'danger'
                      }
                    >
                      {STATUS[e.status]}
                    </Badge>
                    {e.enviadoEm && (
                      <div className="quieto" style={{ fontSize: 12 }}>
                        {fmtHora(e.enviadoEm)}
                      </div>
                    )}
                    {e.erro && (
                      <div className="quieto" style={{ fontSize: 12 }} title={e.erro}>
                        {e.erro.slice(0, 60)}
                      </div>
                    )}
                  </td>
                  <td>
                    {e.abertoEm ? (
                      <span title={`${e.aberturas} vez(es)`}>{fmtHora(e.abertoEm)}</span>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                  <td>{e.clicadoEm ? fmtHora(e.clicadoEm) : <span className="quieto">—</span>}</td>
                  <td>
                    {e.respondidoEm ? (
                      <>
                        {e.classeResposta && (
                          <Badge tone={TOM_CLASSE[e.classeResposta]}>{ROTULO_CLASSE[e.classeResposta]}</Badge>
                        )}
                        <div className="quieto" style={{ fontSize: 12 }}>
                          {fmtHora(e.respondidoEm)}
                        </div>
                      </>
                    ) : (
                      <span className="quieto">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ───────────────────────── Respostas ───────────────────────── */

function Resposta(props: {
  r: RespostaEmail;
  aberta: boolean;
  aoAbrir: () => void;
  aoAbrirLead: (id: number) => void;
}) {
  const { r } = props;
  const cliente = useQueryClient();
  const [texto, setTexto] = useState('');
  const atualizar = () => {
    cliente.invalidateQueries({ queryKey: ['email'] });
    cliente.invalidateQueries({ queryKey: ['quadro'] });
  };
  const classe = useMutation({
    mutationFn: (c: ClasseResposta) =>
      api(`/email/respostas/${r.id}/classe`, { metodo: 'POST', corpo: { classe: c } }),
    onSuccess: atualizar,
  });
  const responder = useMutation({
    mutationFn: () => api(`/email/respostas/${r.id}/responder`, { metodo: 'POST', corpo: { texto } }),
    onSuccess: () => {
      setTexto('');
      atualizar();
    },
  });
  const lida = useMutation({
    mutationFn: () => api(`/email/respostas/${r.id}/lida`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: marca como lida só ao abrir
  useEffect(() => {
    if (props.aberta && !r.lidaEm) lida.mutate();
  }, [props.aberta]);

  return (
    <li className="resposta-email" data-nova={!r.lidaEm || undefined} data-aberta={props.aberta || undefined}>
      <button
        type="button"
        className="resposta-email__cabeca"
        aria-expanded={props.aberta}
        onClick={props.aoAbrir}
      >
        <span className="resposta-email__quem">
          <b>{r.nome ? fmtNome(r.nome) : r.deEmail}</b>
          <span className="quieto">
            {r.deNome ? `${r.deNome} · ` : ''}
            {r.deEmail}
          </span>
        </span>
        <Badge tone={TOM_CLASSE[r.classe]}>{ROTULO_CLASSE[r.classe]}</Badge>
        <span className="quieto resposta-email__quando">{fmtQuando(r.recebidoEm)}</span>
        <span className="resposta-email__previa">{r.resumo ?? r.texto.slice(0, 160)}</span>
      </button>
      {props.aberta && (
        <div className="resposta-email__corpo pilha" style={{ gap: 12 }}>
          <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
            {r.assunto} · {fmtHora(r.recebidoEm)}
            {r.campanhaNome ? ` · ${r.campanhaNome}` : ''} · classificado{' '}
            {r.classificadoPor === 'ia'
              ? 'pela IA'
              : r.classificadoPor === 'voce'
                ? 'por você'
                : 'pelas palavras da resposta'}
          </p>
          <p className="resposta-email__texto">{r.texto}</p>
          <div className="acoes">
            {r.empresaId && (
              <Button
                size="sm"
                variant="ghost"
                icon="id-card"
                onClick={() => props.aoAbrirLead(r.empresaId!)}
              >
                {r.etapaFunil && r.etapaFunil !== 'descartado'
                  ? `Ficha (no funil: ${ROTULO_ETAPA[r.etapaFunil]})`
                  : 'Ficha'}
              </Button>
            )}
            {r.classe !== 'interessado' && (
              <Button
                size="sm"
                icon="arrow-right"
                disabled={classe.isPending}
                onClick={() => classe.mutate('interessado')}
              >
                Tem interesse: mandar para o SDR
              </Button>
            )}
            {r.classe !== 'sem_interesse' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={classe.isPending}
                onClick={() => classe.mutate('sem_interesse')}
              >
                Sem interesse
              </Button>
            )}
            {r.classe !== 'descadastro' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={classe.isPending}
                onClick={() => classe.mutate('descadastro')}
              >
                Tirar da lista
              </Button>
            )}
          </div>
          <form
            className="pilha"
            style={{ gap: 8 }}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              responder.mutate();
            }}
          >
            <label htmlFor={`resp-${r.id}`} style={{ fontWeight: 500, fontSize: 13 }}>
              Responder por e-mail
            </label>
            <textarea
              id={`resp-${r.id}`}
              rows={4}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Sua resposta (a assinatura entra sozinha)"
            />
            <ErroDaApi erro={responder.error ?? classe.error} />
            {responder.isSuccess && <Mensagem tipo="ok">Resposta enviada.</Mensagem>}
            <div className="acoes">
              <Button
                size="sm"
                type="submit"
                variant="primary"
                icon="send"
                disabled={!texto.trim() || responder.isPending}
              >
                {responder.isPending ? 'Enviando…' : 'Enviar resposta'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </li>
  );
}

function Respostas(props: { aoAbrirLead: (id: number) => void }) {
  const [params, setParams] = useSearchParams();
  const classe = params.get('classe') ?? '';
  const aberta = Number(params.get('resposta')) || null;
  const q = useQuery({
    queryKey: ['email', 'respostas', classe],
    queryFn: () => api<RespostaEmail[]>(`/email/respostas${classe ? `?classe=${classe}` : ''}`),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const mudar = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <section className="pilha" style={{ gap: 12 }}>
      <div className="segmentos" role="tablist" aria-label="Classificação">
        {(['', 'interessado', 'sem_interesse', 'descadastro', 'automatica'] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            className="segmento"
            aria-selected={classe === c}
            data-ativo={classe === c || undefined}
            onClick={() => mudar('classe', c || null)}
          >
            {c ? ROTULO_CLASSE[c] : 'Todas'}
          </button>
        ))}
      </div>
      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" />
      ) : !q.data?.length ? (
        <p className="quieto">
          Nenhuma resposta {classe ? 'nesta classificação' : 'ainda'}. As respostas chegam na caixa da empresa
          e aparecem aqui em até 2 minutos; quem tem interesse entra sozinho no SDR em “Respondeu”.
        </p>
      ) : (
        <ul className="respostas-email">
          {q.data.map((r) => (
            <Resposta
              key={r.id}
              r={r}
              aberta={aberta === r.id}
              aoAbrir={() => mudar('resposta', aberta === r.id ? null : String(r.id))}
              aoAbrirLead={props.aoAbrirLead}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────── Configuração ───────────────────────── */

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function Configuracao(props: { v: VisaoEmail }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<ConfigEmail>(props.v.config);
  useEffect(() => setF(props.v.config), [props.v.config]);
  const salvar = useMutation({
    mutationFn: () =>
      api('/email/config', { metodo: 'PUT', corpo: { ...f, responderPara: f.responderPara ?? '' } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });
  const verificar = useMutation({
    mutationFn: () => api<{ smtp: string; imap: string }>('/email/verificar', { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['email'] }),
  });
  const num = (k: keyof ConfigEmail, v: string) => setF({ ...f, [k]: Number(v.replace(/\D/g, '')) || 0 });
  const assinaturaPrevia = useMemo(() => f.assinatura, [f.assinatura]);

  return (
    <div className="grade-config-email">
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
            checked={f.ligado}
            onChange={(e) => setF({ ...f, ligado: e.target.checked })}
          />
          <b>Envio automático ligado</b>
        </label>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="cfe-nome">Nome do remetente</label>
            <input
              id="cfe-nome"
              className="filtro"
              maxLength={80}
              value={f.remetenteNome}
              onChange={(e) => setF({ ...f, remetenteNome: e.target.value })}
            />
            <span className="campo__dica">Ex.: “Leonardo | Tutts”. Aparece na caixa de entrada do lead.</span>
          </div>
          <div className="campo">
            <label htmlFor="cfe-resp">Respostas vão para (opcional)</label>
            <input
              id="cfe-resp"
              className="filtro"
              type="email"
              placeholder={props.v.status.remetente ?? ''}
              value={f.responderPara ?? ''}
              onChange={(e) => setF({ ...f, responderPara: e.target.value || null })}
            />
            <span className="campo__dica">Deixe vazio para o sistema ler as respostas na mesma caixa.</span>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="cfe-ass">Assinatura</label>
          <textarea
            id="cfe-ass"
            rows={4}
            value={assinaturaPrevia}
            onChange={(e) => setF({ ...f, assinatura: e.target.value })}
          />
          <span className="campo__dica">Uma informação por linha. Vale {'{remetente}'}.</span>
        </div>
        <h3 className="subtitulo">Ritmo</h3>
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="cfe-lim">E-mails por dia</label>
            <input
              id="cfe-lim"
              className="filtro"
              inputMode="numeric"
              value={f.limiteDia}
              onChange={(e) => num('limiteDia', e.target.value)}
            />
            <span className="campo__dica">Caixa nova: comece com 30 a 50 por dia e aumente aos poucos.</span>
          </div>
          <div className="campo">
            <label htmlFor="cfe-int">Intervalo entre e-mails (segundos)</label>
            <input
              id="cfe-int"
              className="filtro"
              inputMode="numeric"
              value={f.intervaloSeg}
              onChange={(e) => num('intervaloSeg', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="cfe-ini">Das (hora)</label>
            <input
              id="cfe-ini"
              className="filtro"
              inputMode="numeric"
              value={f.horaInicio}
              onChange={(e) => num('horaInicio', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="cfe-fim">Até (hora)</label>
            <input
              id="cfe-fim"
              className="filtro"
              inputMode="numeric"
              value={f.horaFim}
              onChange={(e) => num('horaFim', e.target.value)}
            />
          </div>
        </div>
        <fieldset className="segmentos">
          <legend className="campo__rotulo">Dias</legend>
          {DIAS.map((d, i) => (
            <button
              key={d}
              type="button"
              className="segmento"
              aria-pressed={f.diasSemana.includes(i)}
              data-ativo={f.diasSemana.includes(i) || undefined}
              onClick={() =>
                setF({
                  ...f,
                  diasSemana: f.diasSemana.includes(i)
                    ? f.diasSemana.filter((x) => x !== i)
                    : [...f.diasSemana, i].sort(),
                })
              }
            >
              {d}
            </button>
          ))}
        </fieldset>
        <label className="opcao">
          <input
            type="checkbox"
            checked={f.rastrearAbertura}
            onChange={(e) => setF({ ...f, rastrearAbertura: e.target.checked })}
          />
          Contar aberturas e cliques
        </label>
        <ErroDaApi erro={salvar.error} />
        {salvar.isSuccess && <Mensagem tipo="ok">Configuração salva.</Mensagem>}
        <div className="acoes">
          <Button type="submit" variant="primary" disabled={salvar.isPending}>
            Salvar
          </Button>
        </div>
      </form>

      <aside className="pilha" style={{ gap: 12 }}>
        <div className="pp-panel" style={{ padding: 16 }}>
          <h3 className="subtitulo" style={{ marginTop: 0 }}>
            Conexão
          </h3>
          <ul className="lista-status">
            <li data-ok={props.v.status.smtp || undefined}>
              <Icon name={props.v.status.smtp ? 'check' : 'circle-x'} size={14} /> Envio (SMTP){' '}
              {props.v.status.remetente && <span className="quieto">· {props.v.status.remetente}</span>}
            </li>
            <li data-ok={props.v.status.imap || undefined}>
              <Icon name={props.v.status.imap ? 'check' : 'circle-x'} size={14} /> Leitura das respostas
              (IMAP)
              {props.v.config.imapErro && <span className="erro-texto"> · {props.v.config.imapErro}</span>}
            </li>
            <li data-ok={props.v.status.ia || undefined}>
              <Icon name={props.v.status.ia ? 'check' : 'circle-help'} size={14} /> IA que lê as respostas{' '}
              <span className="quieto">
                {props.v.status.ia ? '(Gemini)' : '(sem ela, uma regra de palavras decide)'}
              </span>
            </li>
          </ul>
          {props.v.status.smtp && (
            <div className="acoes" style={{ marginTop: 12 }}>
              <Button
                size="sm"
                icon="check"
                disabled={verificar.isPending}
                onClick={() => verificar.mutate()}
              >
                {verificar.isPending ? 'Testando…' : 'Testar conexão'}
              </Button>
            </div>
          )}
          {verificar.data && (
            <Mensagem
              tipo={verificar.data.smtp === 'ok' && !/erro|fail/i.test(verificar.data.imap) ? 'ok' : 'aviso'}
            >
              Envio: {verificar.data.smtp} · Leitura: {verificar.data.imap}
            </Mensagem>
          )}
          <ErroDaApi erro={verificar.error} />
        </div>
        <div className="pp-panel" style={{ padding: 16 }}>
          <h3 className="subtitulo" style={{ marginTop: 0 }}>
            Como conectar a caixa
          </h3>
          <p className="quieto" style={{ margin: '0 0 8px', fontSize: 13 }}>
            No Railway, na API, preencha (a senha fica só no servidor):
          </p>
          <pre className="bloco-codigo">{`EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORTA=587
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_USUARIO=comercial@suaempresa.com.br
EMAIL_SENHA=senha de app`}</pre>
          <p className="quieto" style={{ margin: '8px 0 0', fontSize: 13 }}>
            Google: use uma “senha de app” (Conta Google → Segurança → Verificação em duas etapas → Senhas de
            app). Zoho, Hostinger e Outlook funcionam igual, com os servidores deles. Use um endereço só para
            prospecção: protege a caixa principal.
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ───────────────────────── Página ───────────────────────── */

export function Email() {
  const [params, setParams] = useSearchParams();
  const admin = useEhAdmin();
  const aba = (params.get('aba') as Aba | null) ?? 'campanhas';
  const lead = params.get('empresa');
  const visao = useVisaoEmail();
  const modelos = useQuery({
    queryKey: ['email', 'modelos'],
    queryFn: () => api<ModeloEmail[]>('/email/modelos'),
  });
  const mudar = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const naoLidas = visao.data?.resumo.respostasNaoLidas ?? 0;

  return (
    <>
      <div className="topo">
        <div>
          <h1>E-mail</h1>
          <p>
            Apresentação e proposta por e-mail para os leads das campanhas, com follow-up e leitura das
            respostas.
          </p>
        </div>
      </div>
      {visao.data && <Status v={visao.data} aoConfigurar={() => setParams({ aba: 'config' })} />}
      <ErroDaApi erro={visao.error} />
      <div className="pipelines" role="tablist" aria-label="Seções">
        {ABAS.filter((a) => !a.admin || admin).map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className="pipelines__aba"
            onClick={() => setParams({ aba: a.id }, { replace: true })}
          >
            {a.rotulo}
            {a.id === 'respostas' && naoLidas > 0 && (
              <span className="pipelines__conta pipelines__conta--nova">{naoLidas}</span>
            )}
          </button>
        ))}
      </div>
      {aba === 'campanhas' && <Campanhas modelos={modelos.data ?? []} ligado={!!visao.data?.config.ligado} />}
      {aba === 'modelos' && <Modelos modelos={modelos.data ?? []} carregando={modelos.isPending} />}
      {aba === 'enviados' && <Enviados aoAbrirLead={(id) => mudar('empresa', String(id))} />}
      {aba === 'respostas' && <Respostas aoAbrirLead={(id) => mudar('empresa', String(id))} />}
      {aba === 'config' && admin && visao.data && <Configuracao v={visao.data} />}
      {lead && (
        <FichaEmpresa
          id={Number(lead)}
          aoFechar={() => mudar('empresa', null)}
          aoAbrir={(id) => mudar('empresa', String(id))}
        />
      )}
    </>
  );
}
