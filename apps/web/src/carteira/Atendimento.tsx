import {
  type Atendimento,
  type ClienteDoAtendimento,
  type ContagemFilas,
  type Etiqueta as EtiquetaCatalogo,
  type EventoAtendimento,
  FILAS_ATENDIMENTO,
  type FilaAtendimento,
  PERGUNTA_PESQUISA,
  textoEncerramento,
} from '@prospeccao/shared/carteira';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { Modal } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { Dono, useEhAdmin, useSessao } from '../componentes/Sessao';
import { fmtCidade, fmtHoraSo, fmtNome, fmtQuando } from '../formatar';
import {
  COR_ETIQUETA,
  corDaEtiqueta,
  diaMes,
  haQuanto,
  type ItemAtendimento,
  mesAno,
  useAtualizarAtendimento,
  useConfigAtendimento,
  usePessoasAtendimento,
} from './dados';

/* ───────────────────────────── Etiquetas ───────────────────────────── */

export function Etiqueta(props: {
  nome: string;
  catalogo?: EtiquetaCatalogo[];
  aoTirar?: () => void;
  pequena?: boolean;
}) {
  const cor = COR_ETIQUETA[corDaEtiqueta(props.nome, props.catalogo)];
  return (
    <span
      className={props.pequena ? 'etq etq--pequena' : 'etq'}
      style={{ background: cor.fundo, color: cor.texto }}
    >
      {props.nome}
      {props.aoTirar && (
        <button
          type="button"
          className="etq__tirar"
          aria-label={`Tirar ${props.nome}`}
          onClick={props.aoTirar}
        >
          <Icon name="x" size={11} />
        </button>
      )}
    </span>
  );
}

/** "+ Etiqueta": escolhe do catálogo da conta (o administrador cria em Configurações › Atendimento). */
function EscolherEtiqueta(props: {
  catalogo: EtiquetaCatalogo[];
  marcadas: string[];
  aoEscolher: (n: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const livres = props.catalogo.filter(
    (e) => !props.marcadas.some((m) => m.toLowerCase() === e.nome.toLowerCase()),
  );
  return (
    <span className="etq-escolher">
      <button
        type="button"
        className="etq etq--mais"
        aria-expanded={aberto}
        onClick={() => setAberto((x) => !x)}
        disabled={!livres.length}
        title={livres.length ? 'Marcar uma etiqueta' : 'Todas as etiquetas já estão marcadas'}
      >
        <Icon name="plus" size={11} /> Etiqueta
      </button>
      {aberto && (
        <span className="etq-escolher__lista" role="listbox" aria-label="Etiquetas">
          {livres.map((e) => (
            <button
              key={e.id}
              type="button"
              role="option"
              aria-selected={false}
              className="etq-escolher__item"
              onClick={() => {
                props.aoEscolher(e.nome);
                setAberto(false);
              }}
            >
              <Etiqueta nome={e.nome} catalogo={props.catalogo} pequena />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/* ───────────────────────────── Filas (lista da esquerda) ───────────────────────────── */

export function AbasDasFilas(props: {
  fila: FilaAtendimento;
  contagem: ContagemFilas | undefined;
  aoMudar: (f: FilaAtendimento) => void;
}) {
  const n: Record<FilaAtendimento, number | null> = {
    minha: props.contagem?.minha ?? null,
    geral: props.contagem?.geral ?? null,
    aguardando: props.contagem?.aguardando ?? null,
    encerrados: null,
  };
  return (
    <div className="filas" role="tablist" aria-label="Filas do atendimento">
      {FILAS_ATENDIMENTO.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={props.fila === f.id}
          className="filas__aba"
          data-ativo={props.fila === f.id || undefined}
          onClick={() => props.aoMudar(f.id)}
        >
          {f.nome}
          {!!n[f.id] && (
            <span className={f.id === 'geral' ? 'filas__n filas__n--geral' : 'filas__n'}>{n[f.id]}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function FiltroEtiquetas(props: {
  catalogo: EtiquetaCatalogo[];
  ativa: string | null;
  aoMudar: (e: string | null) => void;
}) {
  if (!props.catalogo.length) return null;
  return (
    <fieldset className="filas__etiquetas">
      <legend className="pp-sr">Filtrar por etiqueta</legend>
      <span className="quieto">Etiquetas:</span>
      <button
        type="button"
        className="etq etq--filtro"
        aria-pressed={!props.ativa}
        onClick={() => props.aoMudar(null)}
      >
        Todas
      </button>
      {props.catalogo.map((e) => (
        <button
          key={e.id}
          type="button"
          className="etq etq--filtro"
          aria-pressed={props.ativa === e.nome}
          style={
            props.ativa === e.nome
              ? { background: COR_ETIQUETA[e.cor].fundo, color: COR_ETIQUETA[e.cor].texto }
              : undefined
          }
          onClick={() => props.aoMudar(props.ativa === e.nome ? null : e.nome)}
        >
          {e.nome}
        </button>
      ))}
    </fieldset>
  );
}

/** Fila geral esperando: o aviso no topo das outras filas. */
export function AvisoFilaGeral(props: { contagem: ContagemFilas | undefined; aoVer: () => void }) {
  const n = props.contagem?.geral ?? 0;
  if (!n) return null;
  return (
    <div className="filas__aviso" role="status">
      <Icon name="inbox" size={14} />
      <span>
        Fila geral: <b>{n === 1 ? '1 esperando' : `${n} esperando`}</b>
        {props.contagem?.geralDesde ? `, a mais antiga ${haQuanto(props.contagem.geralDesde)}` : ''}
      </span>
      <button type="button" className="link-botao" onClick={props.aoVer}>
        Ver fila
      </button>
    </div>
  );
}

function situacaoDoItem(a: ItemAtendimento, eu: number | undefined): { texto: string; tom: string } {
  if (a.situacao === 'encerrado')
    return { texto: `${a.motivo ?? 'Encerrado'} · ${diaMes(a.encerradoEm)}`, tom: 'quieto' };
  if (a.semRespostaDoDono && a.atendenteId !== eu)
    return { texto: `Carteira de ${fmtNome(a.atendenteNome ?? '')}, sem resposta`, tom: 'aviso' };
  if (!a.atendenteId) {
    const espera = `esperando ${haQuanto(a.ultimaClienteEm ?? a.abertoEm)}`;
    if (a.grupoNome) return { texto: `Fila ${a.grupoNome} · ${espera}`, tom: 'novo' };
    if (a.donoNome)
      return { texto: `Carteira de ${fmtNome(a.donoNome).split(' ')[0]} · ${espera}`, tom: 'novo' };
    return { texto: `Novo · ${espera}`, tom: 'novo' };
  }
  if (a.reaberto) return { texto: 'Reaberto', tom: 'aviso' };
  if (a.situacao === 'aguardando') return { texto: 'Aguardando o cliente', tom: 'quieto' };
  return { texto: 'Em atendimento', tom: 'ok' };
}

export function ItemDaFila(props: {
  a: ItemAtendimento;
  ativo: boolean;
  catalogo: EtiquetaCatalogo[];
  aoAbrir: () => void;
}) {
  const { a } = props;
  const eu = useSessao().data?.id;
  const s = situacaoDoItem(a, eu);
  const etiquetas = [...new Set([...a.etiquetas, ...a.etiquetasCliente])].slice(0, 3);
  return (
    <li>
      <button
        type="button"
        className="conversa-item"
        aria-current={props.ativo || undefined}
        onClick={props.aoAbrir}
      >
        <span className="conversa-item__topo">
          <b>{fmtNome(a.nome)}</b>
          <span
            className={a.naoLidas ? 'conversa-item__hora conversa-item__hora--nova' : 'conversa-item__hora'}
          >
            {fmtQuando(a.ultimaEm ?? a.abertoEm)}
          </span>
        </span>
        <span className="conversa-item__linha">
          <span className="conversa-item__previa">
            {a.ultimaDirecao === 'enviada' ? 'Você: ' : ''}
            {a.ultima ?? ''}
          </span>
          {a.naoLidas > 0 && <span className="conversa-item__conta">{a.naoLidas}</span>}
        </span>
        <span className="conversa-item__rodape fila-item__rodape">
          {etiquetas.map((e) => (
            <Etiqueta key={e} nome={e} catalogo={props.catalogo} pequena />
          ))}
          <span className={`fila-item__situacao fila-item__situacao--${s.tom}`}>{s.texto}</span>
          <span style={{ marginLeft: 'auto' }}>
            <Dono id={a.atendenteId ?? a.donoId} nome={a.atendenteNome ?? a.donoNome} tamanho={18} />
          </span>
        </span>
      </button>
    </li>
  );
}

/* ───────────────────────────── Na conversa ───────────────────────────── */

const ROTULO_SITUACAO = {
  aberto: 'Em atendimento',
  aguardando: 'Aguardando o cliente',
  encerrado: 'Encerrado',
} as const;

/** A faixa do atendimento logo abaixo do topo da conversa: protocolo, com quem está e as ações. */
export function BarraDoAtendimento(props: { cliente: ClienteDoAtendimento }) {
  const c = props.cliente;
  const a = c.atual;
  const sessao = useSessao().data;
  const admin = useEhAdmin();
  const atualizar = useAtualizarAtendimento();
  const catalogo = useConfigAtendimento().data?.etiquetas ?? [];
  const [modal, setModal] = useState<'encerrar' | 'transferir' | null>(null);
  const acao = (caminho: string, corpo?: object, metodo = 'POST') =>
    api<ClienteDoAtendimento>(`/carteira/cliente/${c.empresaId}/${caminho}`, { metodo, corpo: corpo ?? {} });
  const assumir = useMutation({
    mutationFn: () => acao('assumir'),
    onSuccess: (d) => atualizar(c.empresaId, d),
  });
  const reabrir = useMutation({
    mutationFn: () => acao('reabrir'),
    onSuccess: (d) => atualizar(c.empresaId, d),
  });
  const etiquetar = useMutation({
    mutationFn: (etiquetas: string[]) => acao('etiquetas', { etiquetas }, 'PUT'),
    onSuccess: (d) => atualizar(c.empresaId, d),
  });

  if (!a) {
    return (
      <div className="atend-barra atend-barra--encerrado">
        <span className="atend-barra__info">
          {c.ultimo ? (
            <>
              <Icon name="circle-check" size={14} /> Atendimento{' '}
              <span className="mono">{c.ultimo.protocolo}</span> encerrado {fmtQuando(c.ultimo.encerradoEm)}
              {c.ultimo.motivo ? ` · ${c.ultimo.motivo}` : ''}
              {c.ultimo.notaCliente ? ` · nota ${c.ultimo.notaCliente}/5` : ''}
            </>
          ) : (
            'Sem atendimento em aberto. Quando o cliente escrever, abre um com protocolo.'
          )}
        </span>
        {c.ultimo && (
          <Button
            size="sm"
            variant="secondary"
            icon="rotate-ccw"
            disabled={reabrir.isPending}
            onClick={() => reabrir.mutate()}
          >
            Reabrir
          </Button>
        )}
        <ErroDaApi erro={reabrir.error} />
      </div>
    );
  }
  const comigo = a.atendenteId === sessao?.id;
  const naFila = a.atendenteId == null;
  const podeMexer = comigo || admin || naFila;
  return (
    <>
      <div className="atend-barra">
        <span className="atend-barra__info">
          <span className="quieto">Protocolo</span> <b className="mono">{a.protocolo}</b>
          <span className={`atend-barra__situacao atend-barra__situacao--${naFila ? 'fila' : a.situacao}`}>
            {naFila
              ? a.grupoNome
                ? `Na fila ${a.grupoNome}`
                : 'Na Fila geral'
              : comigo
                ? `${ROTULO_SITUACAO[a.situacao]} com você`
                : `${ROTULO_SITUACAO[a.situacao]} com ${fmtNome(a.atendenteNome ?? '')}`}
          </span>
          {a.etiquetas.map((e) => (
            <Etiqueta
              key={e}
              nome={e}
              catalogo={catalogo}
              aoTirar={podeMexer ? () => etiquetar.mutate(a.etiquetas.filter((x) => x !== e)) : undefined}
            />
          ))}
          {podeMexer && (
            <EscolherEtiqueta
              catalogo={catalogo}
              marcadas={a.etiquetas}
              aoEscolher={(n) => etiquetar.mutate([...a.etiquetas, n])}
            />
          )}
        </span>
        <span className="atend-barra__acoes">
          {!comigo && (naFila || admin) && (
            <Button
              size="sm"
              variant="primary"
              icon="hand"
              disabled={assumir.isPending}
              onClick={() => assumir.mutate()}
            >
              {assumir.isPending ? 'Assumindo…' : 'Assumir'}
            </Button>
          )}
          {podeMexer && (
            <Button size="sm" variant="ghost" icon="arrow-right-left" onClick={() => setModal('transferir')}>
              Transferir
            </Button>
          )}
          {(comigo || admin) && (
            <Button size="sm" variant="secondary" icon="circle-check" onClick={() => setModal('encerrar')}>
              Encerrar atendimento
            </Button>
          )}
        </span>
        <ErroDaApi erro={assumir.error ?? etiquetar.error} />
      </div>
      {modal === 'encerrar' && <ModalEncerrar cliente={c} atendimento={a} aoFechar={() => setModal(null)} />}
      {modal === 'transferir' && (
        <ModalTransferir cliente={c} atendimento={a} aoFechar={() => setModal(null)} />
      )}
    </>
  );
}

function minutosDesde(iso: string): string {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function ModalEncerrar(props: {
  cliente: ClienteDoAtendimento;
  atendimento: Atendimento;
  aoFechar: () => void;
}) {
  const { cliente: c, atendimento: a } = props;
  const cfg = useConfigAtendimento().data;
  const atualizar = useAtualizarAtendimento();
  const [motivo, setMotivo] = useState<string | null>(null);
  const [etiquetas, setEtiquetas] = useState<string[]>(a.etiquetas);
  const [mandar, setMandar] = useState(cfg?.config.mandarEncerramento ?? true);
  const [nota, setNota] = useState(cfg?.config.pesquisa ?? true);
  const [aviso, setAviso] = useState<string | null>(null);
  const encerrar = useMutation({
    mutationFn: () =>
      api<{ mensagemEnviada: boolean; aviso: string | null; cliente: ClienteDoAtendimento }>(
        `/carteira/cliente/${c.empresaId}/encerrar`,
        { metodo: 'POST', corpo: { motivo, etiquetas, mandarMensagem: mandar, pedirNota: nota } },
      ),
    onSuccess: (r) => {
      atualizar(c.empresaId, r.cliente);
      if (r.aviso) setAviso(r.aviso);
      else props.aoFechar();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (motivo) encerrar.mutate();
  };
  const whatsapp = a.canal === 'whatsapp';
  const previa = cfg
    ? textoEncerramento(cfg.config.msgEncerramento, { nome: fmtNome(c.nome), protocolo: a.protocolo })
    : '';
  return (
    <Modal
      titulo="Encerrar o atendimento"
      subtitulo={
        <>
          {fmtNome(c.nome)} · <span className="mono">{a.protocolo}</span> · {minutosDesde(a.abertoEm)}
        </>
      }
      aoFechar={props.aoFechar}
      rodape={
        aviso ? (
          <Button variant="primary" onClick={props.aoFechar}>
            Voltar à conversa
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={props.aoFechar}>
              Voltar à conversa
            </Button>
            <Button
              variant="primary"
              icon="circle-check"
              type="submit"
              form="form-encerrar"
              disabled={!motivo || encerrar.isPending}
            >
              {encerrar.isPending ? 'Encerrando…' : 'Encerrar atendimento'}
            </Button>
          </>
        )
      }
    >
      {aviso ? (
        <Mensagem tipo="aviso">{aviso}</Mensagem>
      ) : (
        <form id="form-encerrar" className="pilha" style={{ gap: 16 }} onSubmit={enviar}>
          <fieldset className="campo">
            <legend>Como terminou</legend>
            <div className="encerrar__motivos">
              {(cfg?.config.motivos ?? []).map((m) => (
                <label key={m} className="encerrar__motivo" data-ativo={motivo === m || undefined}>
                  <input
                    type="radio"
                    name="motivo"
                    value={m}
                    checked={motivo === m}
                    onChange={() => setMotivo(m)}
                  />
                  {m}
                </label>
              ))}
            </div>
            <small className="quieto">
              A lista de motivos é do administrador da conta (Configurações › Atendimento).
            </small>
          </fieldset>
          <div className="campo">
            <span className="campo__rotulo">Etiquetas</span>
            <div className="etq-linha">
              {etiquetas.map((e) => (
                <Etiqueta
                  key={e}
                  nome={e}
                  catalogo={cfg?.etiquetas}
                  aoTirar={() => setEtiquetas(etiquetas.filter((x) => x !== e))}
                />
              ))}
              <EscolherEtiqueta
                catalogo={cfg?.etiquetas ?? []}
                marcadas={etiquetas}
                aoEscolher={(n) => setEtiquetas([...etiquetas, n])}
              />
            </div>
          </div>
          {whatsapp ? (
            <>
              {cfg?.config.mandarEncerramento && (
                <label className="opcao atend-opcao">
                  <input type="checkbox" checked={mandar} onChange={(e) => setMandar(e.target.checked)} />
                  <span>
                    <b>Mandar a mensagem de encerramento</b>
                    <span className="encerrar__previa">{previa}</span>
                  </span>
                </label>
              )}
              {cfg?.config.pesquisa && (
                <label className="opcao atend-opcao">
                  <input type="checkbox" checked={nota} onChange={(e) => setNota(e.target.checked)} />
                  <span>
                    <b>Pedir a nota do atendimento (1 a 5)</b>
                    <small className="quieto">
                      Vai junto: “{PERGUNTA_PESQUISA}” Se o cliente escrever outra coisa, o atendimento reabre
                      normalmente.
                    </small>
                  </span>
                </label>
              )}
            </>
          ) : (
            <p className="quieto">No direct do Instagram o encerramento não manda mensagem.</p>
          )}
          <ErroDaApi erro={encerrar.error} />
        </form>
      )}
    </Modal>
  );
}

function ModalTransferir(props: {
  cliente: ClienteDoAtendimento;
  atendimento: Atendimento;
  aoFechar: () => void;
}) {
  const { cliente: c, atendimento: a } = props;
  const admin = useEhAdmin();
  const sessao = useSessao().data;
  const q = usePessoasAtendimento();
  const atualizar = useAtualizarAtendimento();
  const [modo, setModo] = useState<'pessoa' | 'grupo'>('pessoa');
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [nota, setNota] = useState('');
  const [passar, setPassar] = useState(false);
  const transferir = useMutation({
    mutationFn: () =>
      api<ClienteDoAtendimento>(`/carteira/cliente/${c.empresaId}/transferir`, {
        metodo: 'POST',
        corpo: {
          usuarioId: modo === 'pessoa' ? escolhido : null,
          grupoId: modo === 'grupo' ? escolhido : null,
          nota,
          passarCarteira: modo === 'pessoa' && passar,
        },
      }),
    onSuccess: (d) => {
      atualizar(c.empresaId, d);
      props.aoFechar();
    },
  });
  const pessoas = (q.data?.pessoas ?? []).filter((p) => p.id !== a.atendenteId);
  const grupos = q.data?.grupos ?? [];
  const nomeEscolhido =
    modo === 'pessoa'
      ? pessoas.find((p) => p.id === escolhido)?.nome
      : grupos.find((g) => g.id === escolhido)?.nome;
  return (
    <Modal
      titulo="Transferir o atendimento"
      subtitulo={
        <>
          {fmtNome(c.nome)} · <span className="mono">{a.protocolo}</span>
        </>
      }
      aoFechar={props.aoFechar}
      rodape={
        <>
          <Button variant="ghost" onClick={props.aoFechar}>
            Voltar à conversa
          </Button>
          <Button
            variant="primary"
            icon="arrow-right-left"
            disabled={!escolhido || transferir.isPending}
            onClick={() => transferir.mutate()}
          >
            {transferir.isPending
              ? 'Transferindo…'
              : nomeEscolhido
                ? `Transferir para ${fmtNome(nomeEscolhido).split(' ')[0]}`
                : 'Transferir'}
          </Button>
        </>
      }
    >
      <div className="pilha" style={{ gap: 16 }}>
        {!!grupos.length && (
          <div className="segmentos" role="tablist" aria-label="Para quem">
            {(['pessoa', 'grupo'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={modo === m}
                className="segmento"
                data-ativo={modo === m || undefined}
                onClick={() => {
                  setModo(m);
                  setEscolhido(null);
                }}
              >
                {m === 'pessoa' ? 'Para uma pessoa' : 'Para um grupo'}
              </button>
            ))}
          </div>
        )}
        {q.isPending ? (
          <div className="esqueleto" style={{ height: 160 }} />
        ) : (
          <ul className="transferir__lista">
            {modo === 'pessoa'
              ? pessoas.map((p) => (
                  <li key={p.id}>
                    <label className="transferir__opcao" data-ativo={escolhido === p.id || undefined}>
                      <input
                        type="radio"
                        name="para"
                        checked={escolhido === p.id}
                        onChange={() => setEscolhido(p.id)}
                      />
                      <Dono id={p.id} nome={p.nome} tamanho={28} rotulo="" />
                      <span className="transferir__quem">
                        <b>
                          {fmtNome(p.nome)}
                          {p.id === sessao?.id ? ' (você)' : ''}
                        </b>
                        <small className="quieto">
                          {[p.grupos.join(', '), `${p.emAtendimento} em atendimento`]
                            .filter(Boolean)
                            .join(' · ')}
                          {!p.disponivel && p.pausaDesde
                            ? ` · em pausa desde ${fmtHoraSo(p.pausaDesde)}`
                            : ''}
                        </small>
                      </span>
                      <span className={p.disponivel ? 'disp disp--sim' : 'disp disp--nao'}>
                        {p.disponivel ? 'Disponível' : 'Em pausa'}
                      </span>
                    </label>
                  </li>
                ))
              : grupos.map((g) => (
                  <li key={g.id}>
                    <label className="transferir__opcao" data-ativo={escolhido === g.id || undefined}>
                      <input
                        type="radio"
                        name="para"
                        checked={escolhido === g.id}
                        onChange={() => setEscolhido(g.id)}
                      />
                      <Icon name="users" size={18} />
                      <span className="transferir__quem">
                        <b>{g.nome}</b>
                        <small className="quieto">
                          {g.membros === 1 ? '1 pessoa' : `${g.membros} pessoas`} · quem do grupo pegar
                          primeiro fica com ele
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
          </ul>
        )}
        <div className="campo">
          <label htmlFor="transferir-nota">Nota para quem recebe (o cliente não vê)</label>
          <textarea
            id="transferir-nota"
            rows={3}
            maxLength={1000}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="O que o cliente quer e o que já foi feito"
          />
        </div>
        {modo === 'pessoa' && (
          <label className="opcao atend-opcao">
            <input type="checkbox" checked={passar} onChange={(e) => setPassar(e.target.checked)} />
            <span>
              <b>
                Passar também a carteira deste cliente{nomeEscolhido ? ` para ${fmtNome(nomeEscolhido)}` : ''}
              </b>
              <small className="quieto">
                {admin
                  ? 'Sem marcar, o cliente continua com o dono de hoje e os próximos contatos voltam para ele.'
                  : 'Só o administrador passa a carteira: marcando, vai um pedido para ele.'}
              </small>
            </span>
          </label>
        )}
        <ErroDaApi erro={transferir.error} />
      </div>
    </Modal>
  );
}

/** Nota interna: só a equipe vê. Fica no lugar da caixa de escrever. */
export function CompositorDeNota(props: { empresaId: number }) {
  const [texto, setTexto] = useState('');
  const atualizar = useAtualizarAtendimento();
  const salvar = useMutation({
    mutationFn: () =>
      api<ClienteDoAtendimento>(`/carteira/cliente/${props.empresaId}/nota`, {
        metodo: 'POST',
        corpo: { texto },
      }),
    onSuccess: (d) => {
      setTexto('');
      atualizar(props.empresaId, d);
    },
  });
  return (
    <form
      className="compositor compositor--nota"
      onSubmit={(e) => {
        e.preventDefault();
        if (texto.trim()) salvar.mutate();
      }}
    >
      <label className="pp-sr" htmlFor="nota-interna">
        Nota interna
      </label>
      <textarea
        id="nota-interna"
        rows={2}
        maxLength={2000}
        spellCheck
        lang="pt-BR"
        value={texto}
        placeholder="Só a equipe vê. Ex.: conferi o estoque, avisar o depósito."
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (texto.trim()) salvar.mutate();
          }
        }}
      />
      <Button type="submit" variant="primary" icon="sticky-note" disabled={!texto.trim() || salvar.isPending}>
        Salvar nota
      </Button>
      <ErroDaApi erro={salvar.error} />
    </form>
  );
}

/** Responder ao cliente ou escrever uma nota interna. */
export function AbasDoCompositor(props: {
  modo: 'cliente' | 'nota';
  aoMudar: (m: 'cliente' | 'nota') => void;
}) {
  return (
    <div className="compositor-abas" role="tablist" aria-label="Escrever">
      <button
        type="button"
        role="tab"
        aria-selected={props.modo === 'cliente'}
        data-ativo={props.modo === 'cliente' || undefined}
        onClick={() => props.aoMudar('cliente')}
      >
        Responder ao cliente
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={props.modo === 'nota'}
        data-ativo={props.modo === 'nota' || undefined}
        data-nota
        onClick={() => props.aoMudar('nota')}
      >
        <Icon name="lock" size={12} /> Nota interna
      </button>
    </div>
  );
}

/** O que aconteceu no atendimento, no meio das mensagens. */
export function LinhaDoEvento(props: { e: EventoAtendimento }) {
  const { e } = props;
  if (e.tipo === 'nota')
    return (
      <div className="bolha bolha--nota" data-lado="enviada">
        <span className="bolha__pessoa">
          <Icon name="lock" size={11} /> Nota interna · só a equipe vê
        </span>
        <p className="bolha__texto">{e.texto}</p>
        <span className="bolha__meta">
          <span>{e.usuario ? fmtNome(e.usuario) : ''}</span>
          <span>{fmtHoraSo(e.em)}</span>
        </span>
      </div>
    );
  const quem = e.usuario ? fmtNome(e.usuario) : 'O sistema';
  const texto = (() => {
    switch (e.tipo) {
      case 'aberto':
        return e.usuario
          ? `${quem} abriu o atendimento ${e.protocolo}`
          : `Atendimento ${e.protocolo} aberto${e.para ? `, direto para ${fmtNome(e.para)} (carteira)` : ' na Fila geral'}`;
      case 'reaberto':
        return e.usuario
          ? `${quem} reabriu o atendimento ${e.protocolo}`
          : `O cliente voltou: atendimento ${e.protocolo} reaberto${e.para ? ` com ${fmtNome(e.para)}` : ''}`;
      case 'assumiu':
        return `${quem} assumiu o atendimento`;
      case 'transferiu':
        return e.para
          ? `${quem} transferiu para ${e.para}${e.texto ? `: “${e.texto}”` : ''}`
          : e.texto?.startsWith('Em pausa')
            ? `${quem} entrou em pausa: o atendimento foi para a Fila geral`
            : `${quem}: ${e.texto ?? 'foi para a Fila geral'}`;
      case 'encerrou':
        return `${e.usuario ? quem : 'Encerrado'}${e.usuario ? ' encerrou' : ''}${e.texto ? ` · ${e.texto}` : ''}`;
      case 'pesquisa':
        return `Nota do cliente: ${e.texto}/5`;
      case 'carteira':
        return e.para ? `${fmtNome(e.para)} virou o dono do cliente` : 'O cliente ficou sem dono';
      default:
        return e.texto ?? '';
    }
  })();
  return (
    <div className="bolhas__evento">
      <span>
        {texto} · {fmtHoraSo(e.em)}
      </span>
    </div>
  );
}

/* ───────────────────────────── Painel do cliente (direita) ───────────────────────────── */

export function PainelDoCliente(props: { cliente: ClienteDoAtendimento; aoAbrirFicha: () => void }) {
  const c = props.cliente;
  const admin = useEhAdmin();
  const sessao = useSessao().data;
  const cfg = useConfigAtendimento().data;
  const pessoas = usePessoasAtendimento(admin);
  const atualizar = useAtualizarAtendimento();
  const cliente = useQueryClient();
  const [trocando, setTrocando] = useState(false);
  const dono = useMutation({
    mutationFn: (usuarioId: number | null) =>
      api<ClienteDoAtendimento>(`/carteira/cliente/${c.empresaId}/dono`, {
        metodo: 'PUT',
        corpo: { usuarioId },
      }),
    onSuccess: (d) => {
      atualizar(c.empresaId, d);
      cliente.invalidateQueries({ queryKey: ['conversas'] });
      setTrocando(false);
    },
  });
  const etiquetar = useMutation({
    mutationFn: (etiquetas: string[]) =>
      api<ClienteDoAtendimento>(`/carteira/cliente/${c.empresaId}/etiquetas-cliente`, {
        metodo: 'PUT',
        corpo: { etiquetas },
      }),
    onSuccess: (d) => atualizar(c.empresaId, d),
  });
  const catalogo = cfg?.etiquetas ?? [];
  return (
    <aside className="painel-cliente" aria-label="Cliente">
      <section>
        <h3 className="painel-cliente__titulo">Cliente</h3>
        <b className="painel-cliente__nome">{fmtNome(c.nome)}</b>
        {c.cnpj && <span className="mono quieto">{c.cnpj}</span>}
        <span className="quieto">
          {[
            [c.cidade ? fmtCidade(c.cidade) : null, c.uf].filter(Boolean).join(', '),
            `cliente desde ${mesAno(c.clienteDesde)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </section>
      <section>
        <div className="painel-cliente__linha">
          <h3 className="painel-cliente__titulo">Carteira de</h3>
          {admin && !trocando && (
            <button type="button" className="link-botao" onClick={() => setTrocando(true)}>
              Trocar
            </button>
          )}
        </div>
        {trocando ? (
          <div className="pilha" style={{ gap: 8 }}>
            <label className="pp-sr" htmlFor="painel-dono">
              Dono do cliente
            </label>
            <select
              id="painel-dono"
              className="filtro"
              defaultValue={c.donoId ?? ''}
              disabled={dono.isPending}
              onChange={(e) => dono.mutate(Number(e.target.value) || null)}
            >
              <option value="">Sem dono (Fila geral)</option>
              {(pessoas.data?.pessoas ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <button type="button" className="link-botao" onClick={() => setTrocando(false)}>
              Cancelar
            </button>
          </div>
        ) : c.donoId ? (
          <span className="painel-cliente__dono">
            <Dono id={c.donoId} nome={c.donoNome} tamanho={28} rotulo="" />
            <span>
              <b>
                {fmtNome(c.donoNome ?? '')}
                {c.donoId === sessao?.id ? ' (você)' : ''}
              </b>
              {c.donoDesde && <small className="quieto">desde {diaMes(c.donoDesde)}</small>}
            </span>
          </span>
        ) : (
          <span className="quieto">Sem dono: os contatos dele caem na Fila geral.</span>
        )}
        <ErroDaApi erro={dono.error} />
      </section>
      <section>
        <h3 className="painel-cliente__titulo">Etiquetas do cliente</h3>
        <div className="etq-linha">
          {c.etiquetas.map((e) => (
            <Etiqueta
              key={e}
              nome={e}
              catalogo={catalogo}
              aoTirar={() => etiquetar.mutate(c.etiquetas.filter((x) => x !== e))}
            />
          ))}
          <EscolherEtiqueta
            catalogo={catalogo}
            marcadas={c.etiquetas}
            aoEscolher={(n) => etiquetar.mutate([...c.etiquetas, n])}
          />
        </div>
        <ErroDaApi erro={etiquetar.error} />
      </section>
      <section>
        <h3 className="painel-cliente__titulo">Atendimentos anteriores</h3>
        {c.anteriores.length ? (
          <ul className="painel-cliente__historico">
            {c.anteriores.map((h) => (
              <li key={h.id}>
                <span className="painel-cliente__linha">
                  <b>{h.motivo ?? 'Encerrado'}</b>
                  <span className="quieto">{diaMes(h.encerradoEm)}</span>
                </span>
                <small className="quieto">
                  {[
                    h.etiquetas.join(', '),
                    h.atendente
                      ? fmtNome(h.atendente).split(' ')[0] + (h.origem === 'geral' ? ' (fila geral)' : '')
                      : null,
                    h.notaCliente
                      ? `pesquisa ${h.notaCliente}/5`
                      : h.pesquisaPedida
                        ? 'sem resposta da pesquisa'
                        : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <span className="quieto">Este é o primeiro atendimento.</span>
        )}
      </section>
      <Button size="sm" variant="secondary" icon="id-card" onClick={props.aoAbrirFicha}>
        Abrir ficha do cliente
      </Button>
    </aside>
  );
}

/* ───────────────────────────── Disponível / Em pausa ───────────────────────────── */

export function BotaoDisponivel() {
  const sessao = useSessao().data;
  const cliente = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const marcar = useMutation({
    mutationFn: (disponivel: boolean) =>
      api<{ paraFila: number }>('/carteira/disponivel', { metodo: 'PUT', corpo: { disponivel } }),
    onSuccess: (r) => {
      cliente.invalidateQueries({ queryKey: ['sessao'] });
      cliente.invalidateQueries({ queryKey: ['carteira'] });
      setAviso(
        r.paraFila
          ? `${r.paraFila === 1 ? '1 cliente esperando foi' : `${r.paraFila} clientes esperando foram`} para a Fila geral.`
          : null,
      );
    },
  });
  if (!sessao?.atendimento?.ativo) return null;
  const disponivel = sessao.atendimento.disponivel;
  return (
    <span className="disponivel">
      <button
        type="button"
        className={
          disponivel ? 'disponivel__botao disponivel__botao--sim' : 'disponivel__botao disponivel__botao--nao'
        }
        aria-pressed={disponivel}
        disabled={marcar.isPending}
        title={disponivel ? 'Clique para entrar em pausa' : 'Clique para voltar a atender'}
        onClick={() => marcar.mutate(!disponivel)}
      >
        <span className="disponivel__ponto" aria-hidden="true" />
        {disponivel
          ? 'Disponível'
          : `Em pausa${sessao.atendimento.pausaDesde ? ` desde ${fmtHoraSo(sessao.atendimento.pausaDesde)}` : ''}`}
      </button>
      {aviso && (
        <span className="disponivel__aviso" role="status">
          {aviso}
        </span>
      )}
    </span>
  );
}
