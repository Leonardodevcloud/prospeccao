import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type ContatoLead, type ConversaAberta, type OpcaoEnvio } from '../api';
import { fmtNome, fmtQuando, formatarTelefone } from '../formatar';
import { Drawer } from './Drawer';
import { ErroDaApi } from './Formulario';

/**
 * Contatos da negociação: a empresa é um card só, e nele ficam todas as pessoas com quem a equipe
 * falou até chegar a quem decide (a atendente → o comprador que ela indicou → o sócio).
 */

const mesmoNumero = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.slice(0, 2) === b.slice(0, 2) && a.slice(-8) === b.slice(-8);

const fone = (t: string | null) => (t ? formatarTelefone(t) : null);

/* ───────────── Enviar para ───────────── */

/** Com quem a conversa segue: números da empresa e pessoas da negociação. */
export function EnviarPara(props: {
  empresaId: number;
  telefone: string | null;
  opcoes: OpcaoEnvio[];
  aoMudar: (c: ConversaAberta) => void;
}) {
  const mudar = useMutation({
    mutationFn: (telefone: string) =>
      api<ConversaAberta>(`/conversas/${props.empresaId}/destino`, { metodo: 'PUT', corpo: { telefone } }),
    onSuccess: props.aoMudar,
  });
  if (props.opcoes.length < 2) return null;
  const atual = props.opcoes.find((o) => mesmoNumero(o.telefone, props.telefone));
  const pessoas = props.opcoes.filter((o) => o.tipo === 'contato');
  const empresa = props.opcoes.filter((o) => o.tipo === 'empresa');
  const rotulo = (o: OpcaoEnvio) =>
    `${o.nome}${o.detalhe ? ` · ${o.detalhe}` : ''} · ${formatarTelefone(o.telefone)}`;
  return (
    <div className="enviar-para">
      <label htmlFor={`enviar-para-${props.empresaId}`}>
        <Icon name="send" size={12} /> Enviar para
      </label>
      <select
        id={`enviar-para-${props.empresaId}`}
        value={atual?.telefone ?? ''}
        disabled={mudar.isPending}
        onChange={(e) => e.target.value && mudar.mutate(e.target.value)}
      >
        {!atual && <option value="">{props.telefone ? formatarTelefone(props.telefone) : 'Escolha'}</option>}
        {pessoas.length > 0 && (
          <optgroup label="Pessoas na negociação">
            {pessoas.map((o) => (
              <option key={o.telefone} value={o.telefone}>
                {rotulo(o)}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Números da empresa">
          {empresa.map((o) => (
            <option key={o.telefone} value={o.telefone}>
              {rotulo(o)}
            </option>
          ))}
        </optgroup>
      </select>
      <ErroDaApi erro={mudar.error} />
    </div>
  );
}

/* ───────────── Sugestões (indicação vista numa mensagem) ───────────── */

export function FaixaIndicacoes(props: {
  conversa: ConversaAberta;
  aoRevisar: (c: ContatoLead) => void;
  aoMudar: (c: ConversaAberta) => void;
}) {
  const sugeridos = props.conversa.contatos.filter((c) => c.status === 'sugerido');
  const descartar = useMutation({
    mutationFn: (id: number) =>
      api<ConversaAberta>(`/conversas/${props.conversa.empresaId}/contatos/${id}`, { metodo: 'DELETE' }),
    onSuccess: props.aoMudar,
  });
  if (!sugeridos.length) return null;
  return (
    <div className="faixa-indicacao" role="status">
      {sugeridos.map((s) => (
        <div key={s.id} className="faixa-indicacao__item">
          <span className="faixa-indicacao__icone" aria-hidden="true">
            <Icon name="user-plus" size={16} />
          </span>
          <div className="faixa-indicacao__texto">
            <b>
              {s.indicadoPorNome ? `${fmtNome(s.indicadoPorNome)} indicou` : 'Indicação na conversa'}:{' '}
              {s.nome}
              {s.cargo ? ` · ${s.cargo}` : ''}
            </b>
            <span className="mono">{fone(s.telefone)}</span>
            {s.evidencia && <span className="quieto">“{s.evidencia}”</span>}
          </div>
          <div className="acoes">
            <Button size="sm" variant="primary" icon="check" onClick={() => props.aoRevisar(s)}>
              Adicionar contato
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={descartar.isPending}
              onClick={() => descartar.mutate(s.id)}
            >
              Descartar
            </Button>
          </div>
        </div>
      ))}
      <ErroDaApi erro={descartar.error} />
    </div>
  );
}

/* ───────────── Cadeia: quem indicou quem ───────────── */

interface No {
  c: ContatoLead;
  filhos: No[];
}

function montarCadeia(contatos: ContatoLead[]): No[] {
  const confirmados = contatos.filter((c) => c.status === 'confirmado');
  const nos = new Map(confirmados.map((c) => [c.id, { c, filhos: [] as No[] }]));
  const raizes: No[] = [];
  for (const no of nos.values()) {
    const pai = no.c.indicadoPorId ? nos.get(no.c.indicadoPorId) : undefined;
    if (pai && pai !== no) pai.filhos.push(no);
    else raizes.push(no);
  }
  return raizes;
}

export function CadeiaContatos(props: {
  contatos: ContatoLead[];
  telefoneAtual: string | null;
  /** Ações de cada pessoa (na conversa); sem isto, a cadeia é só leitura (ficha). */
  acoes?: (c: ContatoLead) => React.ReactNode;
}) {
  const raizes = montarCadeia(props.contatos);
  if (!raizes.length)
    return (
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Ninguém além dos contatos da empresa ainda. Quando alguém indicar outra pessoa, adicione aqui: a
        conversa continua neste mesmo lead.
      </p>
    );
  const item = (no: No) => {
    const { c } = no;
    const agora = mesmoNumero(c.telefone, props.telefoneAtual);
    return (
      <li key={c.id}>
        <div className="cadeia__pessoa" data-decisor={c.decisor || undefined} data-agora={agora || undefined}>
          <div className="cadeia__id">
            <b>{fmtNome(c.nome)}</b>
            {c.cargo && <span className="quieto"> · {c.cargo}</span>}
            <span className="cadeia__selos">
              {c.decisor && <Badge tone="brand">Decide a compra</Badge>}
              {agora && <Badge tone="neutral">Conversa com ele(a)</Badge>}
            </span>
          </div>
          <div className="cadeia__meta">
            {c.telefone && <span className="mono">{fone(c.telefone)}</span>}
            {c.email && <span>{c.email}</span>}
            {!c.indicadoPorId && c.indicadoPorTexto && <span>indicado por {c.indicadoPorTexto}</span>}
            {c.origem === 'nao_identificado' && <span>escreveu antes de estar no lead</span>}
            {c.mensagens > 0 && (
              <span>
                {c.mensagens} {c.mensagens === 1 ? 'mensagem' : 'mensagens'}
              </span>
            )}
            <span>desde {fmtQuando(c.criadoEm)}</span>
          </div>
          {props.acoes && <div className="cadeia__acoes">{props.acoes(c)}</div>}
        </div>
        {no.filhos.length > 0 && (
          <ol className="cadeia cadeia--filhos" aria-label={`Indicados por ${c.nome}`}>
            {no.filhos.map(item)}
          </ol>
        )}
      </li>
    );
  };
  return (
    <ol className="cadeia" aria-label="Pessoas na negociação, por quem indicou">
      {raizes.map(item)}
    </ol>
  );
}

/* ───────────── Formulário (novo, editar ou confirmar sugestão) ───────────── */

function FormContato(props: {
  empresaId: number;
  contatos: ContatoLead[];
  editando: ContatoLead | null;
  aoSalvo: (c: ConversaAberta) => void;
  aoCancelar: () => void;
}) {
  const e = props.editando;
  const confirmando = e?.status === 'sugerido';
  const [nome, setNome] = useState(e?.nome ?? '');
  const [cargo, setCargo] = useState(e?.cargo ?? '');
  const [telefone, setTelefone] = useState(e?.telefone ? formatarTelefone(e.telefone) : '');
  const [email, setEmail] = useState(e?.email ?? '');
  const [indicadoPor, setIndicadoPor] = useState<string>(
    e?.indicadoPorId ? String(e.indicadoPorId) : e?.indicadoPorTexto ? 'outro' : '',
  );
  const [indicadoPorTexto, setIndicadoPorTexto] = useState(e?.indicadoPorTexto ?? '');
  const [decisor, setDecisor] = useState(e?.decisor ?? false);
  const [conversarCom, setConversarCom] = useState(!e || confirmando);
  const outros = props.contatos.filter((c) => c.status === 'confirmado' && c.id !== e?.id);

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: nome.trim(),
        cargo: cargo.trim() || null,
        telefone: telefone.trim() || null,
        email: email.trim() || null,
        indicadoPorId: indicadoPor && indicadoPor !== 'outro' ? Number(indicadoPor) : null,
        indicadoPorTexto: indicadoPor === 'outro' ? indicadoPorTexto.trim() || null : null,
        decisor,
        conversarCom: conversarCom && !!telefone.trim(),
      };
      return e
        ? api<ConversaAberta>(`/conversas/${props.empresaId}/contatos/${e.id}`, {
            metodo: 'PATCH',
            corpo: { ...corpo, ...(confirmando ? { confirmar: true } : {}) },
          })
        : api<ConversaAberta>(`/conversas/${props.empresaId}/contatos`, { metodo: 'POST', corpo });
    },
    onSuccess: props.aoSalvo,
  });

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    salvar.mutate();
  };
  const id = (x: string) => `contato-${e?.id ?? 'novo'}-${x}`;
  return (
    <form className="form cadeia__form" onSubmit={enviar}>
      <h3 className="subtitulo">
        {confirmando ? 'Confirmar indicação' : e ? `Editar ${fmtNome(e.nome)}` : 'Adicionar contato indicado'}
      </h3>
      {confirmando && e?.evidencia && <p className="quieto cadeia__evidencia">“{e.evidencia}”</p>}
      <div className="form__duas">
        <div className="campo">
          <label htmlFor={id('nome')}>Nome</label>
          <input
            id={id('nome')}
            className="filtro"
            required
            maxLength={120}
            autoComplete="off"
            value={nome}
            onChange={(x) => setNome(x.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor={id('cargo')}>Cargo ou setor</label>
          <input
            id={id('cargo')}
            className="filtro"
            maxLength={80}
            placeholder="Compras, gerente, sócio…"
            value={cargo}
            onChange={(x) => setCargo(x.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor={id('tel')}>WhatsApp ou telefone</label>
          <input
            id={id('tel')}
            className="filtro mono"
            inputMode="tel"
            maxLength={30}
            placeholder="(71) 99999-0000"
            value={telefone}
            onChange={(x) => setTelefone(x.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor={id('email')}>E-mail</label>
          <input
            id={id('email')}
            className="filtro"
            type="email"
            maxLength={160}
            value={email}
            onChange={(x) => setEmail(x.target.value)}
          />
        </div>
      </div>
      <div className="campo">
        <label htmlFor={id('por')}>Quem indicou</label>
        <select id={id('por')} value={indicadoPor} onChange={(x) => setIndicadoPor(x.target.value)}>
          <option value="">Ninguém (primeiro contato)</option>
          {outros.map((c) => (
            <option key={c.id} value={c.id}>
              {fmtNome(c.nome)}
              {c.cargo ? ` · ${c.cargo}` : ''}
            </option>
          ))}
          <option value="outro">Outra pessoa (escrever)</option>
        </select>
        {indicadoPor === 'outro' && (
          <input
            className="filtro"
            aria-label="Quem indicou"
            maxLength={120}
            placeholder="Ex.: a atendente do balcão"
            value={indicadoPorTexto}
            onChange={(x) => setIndicadoPorTexto(x.target.value)}
          />
        )}
      </div>
      <div className="opcoes">
        <label className="opcao">
          <input type="checkbox" checked={decisor} onChange={(x) => setDecisor(x.target.checked)} />
          <span>É quem decide a compra</span>
        </label>
        <label className="opcao">
          <input
            type="checkbox"
            checked={conversarCom}
            disabled={!telefone.trim()}
            onChange={(x) => setConversarCom(x.target.checked)}
          />
          <span>Continuar a conversa com esta pessoa</span>
        </label>
      </div>
      <ErroDaApi erro={salvar.error} />
      <div className="acoes">
        <Button type="submit" variant="primary" disabled={!nome.trim() || salvar.isPending}>
          {confirmando ? 'Adicionar contato' : e ? 'Salvar' : 'Adicionar'}
        </Button>
        <Button variant="ghost" onClick={props.aoCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/* ───────────── Painel ───────────── */

export function PainelContatos(props: {
  conversa: ConversaAberta;
  /** Abrir já editando (ex.: confirmar uma sugestão da faixa). */
  editarInicial?: ContatoLead | null;
  aoMudar: (c: ConversaAberta) => void;
  aoFechar: () => void;
}) {
  const c = props.conversa;
  const [editando, setEditando] = useState<ContatoLead | 'novo' | null>(props.editarInicial ?? null);
  const acao = useMutation({
    mutationFn: (a: { id: number; corpo?: object; apagar?: boolean }) =>
      api<ConversaAberta>(`/conversas/${c.empresaId}/contatos/${a.id}`, {
        metodo: a.apagar ? 'DELETE' : 'PATCH',
        corpo: a.corpo,
      }),
    onSuccess: props.aoMudar,
  });
  const sugeridos = c.contatos.filter((x) => x.status === 'sugerido');
  return (
    <Drawer titulo="Pessoas na negociação" barra={fmtNome(c.nome)} aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        <div className="pilha" style={{ gap: 20 }}>
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            Todo mundo com quem a equipe falou nesta empresa fica neste mesmo lead: a conversa, o card e o
            histórico continuam um só, de quem atendeu até quem decide.
          </p>

          {sugeridos.length > 0 && editando === null && (
            <section className="pilha" style={{ gap: 8 }}>
              <h3 className="subtitulo">Indicações vistas nas mensagens</h3>
              {sugeridos.map((s) => (
                <div key={s.id} className="cadeia__sugestao">
                  <div>
                    <b>{s.nome}</b>
                    {s.cargo && <span className="quieto"> · {s.cargo}</span>}{' '}
                    <span className="mono">{fone(s.telefone)}</span>
                    {s.evidencia && <p className="quieto cadeia__evidencia">“{s.evidencia}”</p>}
                  </div>
                  <div className="acoes">
                    <Button size="sm" variant="primary" onClick={() => setEditando(s)}>
                      Adicionar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={acao.isPending}
                      onClick={() => acao.mutate({ id: s.id, apagar: true })}
                    >
                      Descartar
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {editando !== null ? (
            <FormContato
              key={editando === 'novo' ? 'novo' : editando.id}
              empresaId={c.empresaId}
              contatos={c.contatos}
              editando={editando === 'novo' ? null : editando}
              aoSalvo={(nova) => {
                setEditando(null);
                props.aoMudar(nova);
              }}
              aoCancelar={() => setEditando(null)}
            />
          ) : (
            <section className="pilha" style={{ gap: 12 }}>
              <div className="cadeia__cabeca">
                <h3 className="subtitulo">Quem indicou quem</h3>
                <Button size="sm" icon="user-plus" onClick={() => setEditando('novo')}>
                  Adicionar contato indicado
                </Button>
              </div>
              <CadeiaContatos
                contatos={c.contatos}
                telefoneAtual={c.telefone}
                acoes={(x) => (
                  <>
                    {x.telefone && !mesmoNumero(x.telefone, c.telefone) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="message-circle"
                        disabled={acao.isPending}
                        onClick={() => acao.mutate({ id: x.id, corpo: { conversarCom: true } })}
                      >
                        Conversar com
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={x.decisor ? 'x' : 'star'}
                      disabled={acao.isPending}
                      onClick={() => acao.mutate({ id: x.id, corpo: { decisor: !x.decisor } })}
                    >
                      {x.decisor ? 'Não é o decisor' : 'É o decisor'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditando(x)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={acao.isPending}
                      onClick={() => acao.mutate({ id: x.id, apagar: true })}
                    >
                      Remover
                    </Button>
                  </>
                )}
              />
            </section>
          )}
          <ErroDaApi erro={acao.error} />
        </div>
      </div>
    </Drawer>
  );
}
