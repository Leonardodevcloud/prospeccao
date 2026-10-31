import {
  LISTA_MODULOS,
  LISTA_RECURSOS,
  MODULOS,
  type Modulo,
  NOME_PLANO,
  PLANOS_PRONTOS,
  type Plano,
  planoEfetivo,
  RECURSOS,
  type Recurso,
  TABELA_PADRAO,
  type TabelaPrecos,
} from '@prospeccao/shared/planos';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type PlanoConta } from '../api';
import { fmtData, fmtNumero, fmtReais } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

export const ROTULO_PLANO: Record<Plano, string> = NOME_PLANO;

/** Barra de uso: "3 de 4" (sem limite: só o número). */
export function UsoComLimite(props: {
  rotulo: string;
  usado: number;
  limite: number | null;
  detalhe?: string;
}) {
  const pct = props.limite ? Math.min(100, Math.round((props.usado / Math.max(1, props.limite)) * 100)) : 0;
  const tom = !props.limite ? '' : pct >= 100 ? 'cheio' : pct >= 90 ? 'quase' : '';
  return (
    <div className="uso-plano" data-tom={tom || undefined}>
      <div className="uso-plano__topo">
        <span>{props.rotulo}</span>
        <b className="mono">
          {fmtNumero(props.usado)}
          {props.limite != null ? (
            <span className="quieto"> de {fmtNumero(props.limite)}</span>
          ) : (
            ' · sem limite'
          )}
        </b>
      </div>
      {props.limite != null && (
        <span className="barra-uso" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {props.detalhe && <span className="quieto uso-plano__detalhe">{props.detalhe}</span>}
    </div>
  );
}

/** O que a conta contratou e quanto já usou no mês (tela do cliente e painel master). */
export function ResumoPlano(props: { p: PlanoConta; contato?: boolean; semPreco?: boolean }) {
  const { p } = props;
  if (!p.plano)
    return (
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Conta sem plano: sem limite de usuários e de leads, com todos os módulos.
      </p>
    );
  return (
    <div className="pilha" style={{ gap: 12 }}>
      <div className="plano-cabeca">
        <div>
          <span className="plano-cabeca__nome">Plano {ROTULO_PLANO[p.plano]}</span>
          {p.planoDesde && <span className="quieto"> · desde {fmtData(p.planoDesde)}</span>}
        </div>
        {p.mensalidade != null && !props.semPreco && (
          <span className="plano-cabeca__preco">
            {fmtReais(p.mensalidade)}
            <span className="quieto">/mês</span>
          </span>
        )}
      </div>
      {/* De onde vem o valor (cada item da mensalidade). */}
      {!props.semPreco && p.itens.length > 0 && (
        <p className="plano-composicao">
          {p.mensalidadeManual != null ? (
            <>Valor combinado. Pela tabela seria {fmtReais(p.mensalidadeCalculada ?? 0)}: </>
          ) : (
            'Como chega no valor: '
          )}
          {p.itens.map((i, n) => (
            <span key={i.rotulo}>
              {n > 0 && (i.valor < 0 ? ' − ' : ' + ')}
              {i.rotulo} <span className="mono">{fmtReais(Math.abs(i.valor))}</span>
            </span>
          ))}
        </p>
      )}
      <div className="plano-usos">
        <UsoComLimite rotulo="Usuários ativos" usado={p.uso.usuarios} limite={p.usuarios} />
        <UsoComLimite
          rotulo="Leads enriquecidos neste mês"
          usado={p.uso.leadsMes}
          limite={p.leadsMes}
          detalhe={
            p.uso.leadsEsperando
              ? `${fmtNumero(p.uso.leadsEsperando)} esperando o limite (entram sozinhos no próximo mês ou com plano maior)`
              : undefined
          }
        />
      </div>
      <ul className="plano-modulos">
        {LISTA_MODULOS.map((m) => {
          const tem = p.modulos.includes(m);
          return (
            <li key={m} className="plano-modulos__item" data-ativo={tem || undefined}>
              <Badge tone={tem ? 'brand' : 'outline'}>{tem ? 'Contratado' : 'Não contratado'}</Badge>
              <span>
                <b>{MODULOS[m].nome}</b>
                <span className="quieto"> · {MODULOS[m].descricao}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="plano-recursos" aria-label="Recursos do plano">
        {LISTA_RECURSOS.map((r) => {
          const tem = p.recursos.includes(r);
          return (
            <li
              key={r}
              className="plano-recursos__item"
              data-ativo={tem || undefined}
              title={RECURSOS[r].descricao}
            >
              <Icon name={tem ? 'check' : 'lock'} size={14} />
              {RECURSOS[r].nome}
              {tem && p.recursosExtras.includes(r) && <span className="quieto"> · à parte</span>}
            </li>
          );
        })}
      </ul>
      {props.contato && (
        <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
          Para mudar de plano, aumentar usuários ou leads, ou contratar um módulo, fale com a gente.
        </p>
      )}
    </div>
  );
}

/** Tabela de preços em vigor (painel master). */
export function useTabelaPrecos() {
  return useQuery({
    queryKey: ['master', 'precos'],
    queryFn: () => api<TabelaPrecos>('/master/precos'),
    staleTime: 60_000,
  });
}

/** Número com botões de menos e mais (o valor muda o preço na hora). */
export function Contador(props: {
  id: string;
  rotulo: string;
  valor: number;
  passo: number;
  minimo: number;
  padrao?: number | null;
  aoMudar: (v: number) => void;
}) {
  const [texto, setTexto] = useState(String(props.valor));
  useEffect(() => setTexto(String(props.valor)), [props.valor]);
  const mudar = (v: number) => props.aoMudar(Math.max(props.minimo, Math.round(v)));
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <div className="contador">
        <button
          type="button"
          className="contador__botao"
          aria-label={`Menos ${props.rotulo.toLowerCase()}`}
          disabled={props.valor <= props.minimo}
          onClick={() => mudar(props.valor - props.passo)}
        >
          −
        </button>
        <input
          id={props.id}
          className="filtro contador__valor mono"
          inputMode="numeric"
          value={texto}
          onChange={(e) => {
            const limpo = e.target.value.replace(/\D/g, '');
            setTexto(limpo);
            if (limpo) mudar(Number(limpo));
          }}
          onBlur={() => setTexto(String(props.valor))}
        />
        <button
          type="button"
          className="contador__botao"
          aria-label={`Mais ${props.rotulo.toLowerCase()}`}
          onClick={() => mudar(props.valor + props.passo)}
        >
          +
        </button>
      </div>
      {props.padrao != null && props.padrao !== props.valor && (
        <span className="campo__dica">
          O plano inclui {fmtNumero(props.padrao)}.{' '}
          <button type="button" className="link-botao" onClick={() => props.aoMudar(props.padrao!)}>
            Voltar para o do plano
          </button>
        </span>
      )}
    </div>
  );
}

const reais = (v: string) => (v.trim() ? Number(v.replace(/\./g, '').replace(',', '.')) : null);

/**
 * Painel master: escolhe o plano da conta e ajusta só para ela (mais ou menos usuários e leads),
 * liga os módulos e, se quiser, combina outro valor. O preço é recalculado a cada mudança.
 * Personalizado: monta tudo do zero (usuários, leads, módulos e valor).
 */
export function FormPlano(props: { contaId: number; p: PlanoConta }) {
  const cliente = useQueryClient();
  const tabela = useTabelaPrecos().data ?? TABELA_PADRAO;
  const numerosDoPlano = (plano: Plano | '', t: TabelaPrecos) =>
    plano && plano !== 'personalizado'
      ? { usuarios: t.planos[plano].usuarios, leads: t.planos[plano].leadsMes }
      : { usuarios: 2, leads: 2000 };
  const inclusosDo = (plano: Plano | ''): Modulo[] =>
    plano && plano !== 'personalizado' ? tabela.planos[plano].modulosInclusos : [];
  const inteiroOuNulo = (v: string) => (v.trim() ? Number(v.replace(/\D/g, '')) : null);
  const inicial = () => {
    const plano = (props.p.plano ?? '') as Plano | '';
    return {
      plano,
      usuarios: props.p.usuarios ?? numerosDoPlano(plano, tabela).usuarios,
      leads: props.p.leadsMes ?? numerosDoPlano(plano, tabela).leads,
      // Os inclusos no plano não entram como contratados (vêm sozinhos).
      modulos: props.p.plano
        ? props.p.modulos.filter((m) => !inclusosDo(plano).includes(m))
        : ([] as Modulo[]),
      manual: props.p.mensalidadeManual != null ? String(props.p.mensalidadeManual).replace('.', ',') : '',
      numerosExtras: props.p.numerosExtras ?? 0,
      recursosExtras: [...(props.p.recursosExtras ?? [])] as Recurso[],
      horas: props.p.limiteHorasReuniaoProprio != null ? String(props.p.limiteHorasReuniaoProprio) : '',
      conversas: props.p.limiteConversasIaProprio != null ? String(props.p.limiteConversasIaProprio) : '',
    };
  };
  const [f, setF] = useState(inicial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recarrega quando o servidor devolve o plano salvo
  useEffect(() => setF(inicial()), [props.p]);
  const pronto = f.plano && f.plano !== 'personalizado' ? tabela.planos[f.plano] : null;
  const recursosDoPlano: Recurso[] = pronto?.recursos ?? [];
  const inclusos = inclusosDo(f.plano);
  const salvar = useMutation({
    mutationFn: () =>
      api<PlanoConta>(`/master/contas/${props.contaId}/plano`, {
        metodo: 'PUT',
        corpo: {
          plano: f.plano || null,
          // Igual ao do plano: guarda vazio, para acompanhar se a tabela mudar.
          limiteUsuarios: pronto && f.usuarios === pronto.usuarios ? null : f.usuarios,
          limiteLeadsMes: pronto && f.leads === pronto.leadsMes ? null : f.leads,
          modulos: f.modulos,
          mensalidadeManual: reais(f.manual),
          numerosExtras: f.modulos.includes('whatsapp') ? f.numerosExtras : 0,
          // Liberado à parte só o que o plano não traz.
          recursosExtras: f.recursosExtras.filter((r) => !recursosDoPlano.includes(r)),
          horasReuniao: inteiroOuNulo(f.horas),
          conversasIa: inteiroOuNulo(f.conversas),
        },
      }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['master'] }),
  });
  const previa = planoEfetivo(
    {
      plano: f.plano || null,
      limiteUsuarios: f.usuarios,
      limiteLeadsMes: f.leads,
      modulos: f.modulos,
      mensalidadeManual: reais(f.manual),
      numerosExtras: f.numerosExtras,
      recursosExtras: f.recursosExtras,
      horasReuniao: inteiroOuNulo(f.horas),
      conversasIa: inteiroOuNulo(f.conversas),
    },
    tabela,
  );
  const escolher = (plano: Plano | '') =>
    setF((x) => {
      // Personalizado parte do que a conta já tem (números, módulos e recursos do plano anterior),
      // para não sumir nada sem querer; os planos prontos voltam aos números deles.
      if (plano === 'personalizado') {
        const antes = x.plano && x.plano !== 'personalizado' ? tabela.planos[x.plano] : null;
        return {
          ...x,
          plano,
          usuarios: x.plano ? x.usuarios : 2,
          leads: x.plano ? x.leads : 2000,
          modulos: [...new Set([...x.modulos, ...(antes?.modulosInclusos ?? [])])],
          recursosExtras: [...new Set([...x.recursosExtras, ...(antes?.recursos ?? [])])],
        };
      }
      const n = numerosDoPlano(plano, tabela);
      return { ...x, plano, usuarios: n.usuarios, leads: n.leads };
    });
  const alternar = (m: Modulo, ligado: boolean) =>
    setF((x) => {
      let mods = ligado ? [...new Set([...x.modulos, m])] : x.modulos.filter((y) => y !== m);
      // O agente conversa pelo WhatsApp: liga junto; sem WhatsApp, o agente sai.
      if (m === 'agente_ia' && ligado && !mods.includes('whatsapp')) mods = [...mods, 'whatsapp'];
      if (m === 'whatsapp' && !ligado) mods = mods.filter((y) => y !== 'agente_ia');
      return { ...x, modulos: mods };
    });

  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <fieldset className="planos-escolha" aria-label="Plano">
        {PLANOS_PRONTOS.map((id) => (
          <label key={id} className="plano-opcao" data-ativo={f.plano === id || undefined}>
            <input type="radio" name="plano" checked={f.plano === id} onChange={() => escolher(id)} />
            <b>{NOME_PLANO[id]}</b>
            <span className="plano-opcao__preco">{fmtReais(tabela.planos[id].preco)}/mês</span>
            <span className="quieto">
              {tabela.planos[id].usuarios} usuários · {fmtNumero(tabela.planos[id].leadsMes)} leads/mês
            </span>
          </label>
        ))}
        <label className="plano-opcao" data-ativo={f.plano === 'personalizado' || undefined}>
          <input
            type="radio"
            name="plano"
            checked={f.plano === 'personalizado'}
            onChange={() => escolher('personalizado')}
          />
          <b>Personalizado</b>
          <span className="quieto">Você monta: usuários, leads, módulos e valor</span>
        </label>
        <label className="plano-opcao" data-ativo={f.plano === '' || undefined}>
          <input type="radio" name="plano" checked={f.plano === ''} onChange={() => escolher('')} />
          <b>Sem plano</b>
          <span className="quieto">Sem limites e todos os módulos (uso interno)</span>
        </label>
      </fieldset>

      {f.plano && (
        <div className="plano-montagem">
          <div className="pilha" style={{ gap: 16 }}>
            <div className="form__duas">
              <Contador
                id="pl-usuarios"
                rotulo="Usuários"
                valor={f.usuarios}
                passo={1}
                minimo={1}
                padrao={pronto?.usuarios}
                aoMudar={(v) => setF({ ...f, usuarios: v })}
              />
              <Contador
                id="pl-leads"
                rotulo="Leads enriquecidos por mês"
                valor={f.leads}
                passo={1000}
                minimo={0}
                padrao={pronto?.leadsMes}
                aoMudar={(v) => setF({ ...f, leads: v })}
              />
            </div>
            <fieldset className="campo">
              <legend>Módulos</legend>
              <div className="pilha" style={{ gap: 8 }}>
                {LISTA_MODULOS.map((m) => (
                  <label key={m} className="opcao">
                    <input
                      type="checkbox"
                      checked={f.modulos.includes(m) || inclusos.includes(m)}
                      disabled={inclusos.includes(m)}
                      onChange={(e) => alternar(m, e.target.checked)}
                    />
                    <span>
                      <b>{MODULOS[m].nome}</b> ·{' '}
                      {inclusos.includes(m) ? 'incluso no plano' : `${fmtReais(tabela.modulos[m])}/mês`}
                      <span className="quieto"> · {MODULOS[m].descricao}</span>
                    </span>
                  </label>
                ))}
                <span className="campo__dica">
                  WhatsApp + Agente de IA juntos: {fmtReais(tabela.comboWhatsappIa)}/mês. O WhatsApp inclui{' '}
                  {tabela.numerosInclusos} números.
                </span>
              </div>
            </fieldset>
            {(f.modulos.includes('whatsapp') || inclusos.includes('whatsapp')) && (
              <Contador
                id="pl-numeros"
                rotulo={`Números de WhatsApp extras (${fmtReais(tabela.numeroExtra)} cada)`}
                valor={f.numerosExtras}
                passo={1}
                minimo={0}
                aoMudar={(v) => setF({ ...f, numerosExtras: v })}
              />
            )}
            <fieldset className="campo">
              <legend>Recursos</legend>
              <div className="pilha" style={{ gap: 6 }}>
                {LISTA_RECURSOS.map((r) => {
                  const doPlano = recursosDoPlano.includes(r);
                  return (
                    <label key={r} className="opcao">
                      <input
                        type="checkbox"
                        checked={doPlano || f.recursosExtras.includes(r)}
                        disabled={doPlano}
                        onChange={(e) =>
                          setF({
                            ...f,
                            recursosExtras: e.target.checked
                              ? [...new Set([...f.recursosExtras, r])]
                              : f.recursosExtras.filter((x) => x !== r),
                          })
                        }
                      />
                      <span>
                        <b>{RECURSOS[r].nome}</b>
                        <span className="quieto"> · {doPlano ? 'no plano' : 'liberar à parte'}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="pl-horas">Horas de reunião por mês</label>
                <input
                  id="pl-horas"
                  className="filtro mono"
                  inputMode="numeric"
                  placeholder={`Do plano: ${pronto ? (pronto.horasReuniao ?? 'sem limite') : 0}`}
                  value={f.horas}
                  onChange={(e) => setF({ ...f, horas: e.target.value.replace(/\D/g, '') })}
                />
              </div>
              <div className="campo">
                <label htmlFor="pl-conversas">Conversas do Agente de IA por mês</label>
                <input
                  id="pl-conversas"
                  className="filtro mono"
                  inputMode="numeric"
                  placeholder={`Padrão: ${tabela.conversasIaMes == null ? 'sem limite' : fmtNumero(tabela.conversasIaMes)}`}
                  value={f.conversas}
                  onChange={(e) => setF({ ...f, conversas: e.target.value.replace(/\D/g, '') })}
                />
              </div>
            </div>
          </div>

          <aside className="plano-conta" aria-live="polite">
            <b className="plano-conta__titulo">Mensalidade</b>
            {previa.itens.map((i) => (
              <div key={i.rotulo} className="plano-conta__linha" data-negativo={i.valor < 0 || undefined}>
                <span>{i.rotulo}</span>
                <span className="mono">
                  {i.valor < 0 ? '− ' : ''}
                  {fmtReais(Math.abs(i.valor))}
                </span>
              </div>
            ))}
            <div className="plano-conta__linha plano-conta__total">
              <span>Calculado</span>
              <span className="mono">{fmtReais(previa.mensalidadeCalculada)}</span>
            </div>
            <div className="campo">
              <label htmlFor="pl-manual">Valor combinado (R$)</label>
              <input
                id="pl-manual"
                className="filtro"
                inputMode="decimal"
                placeholder="Em branco: o calculado"
                value={f.manual}
                onChange={(e) => setF({ ...f, manual: e.target.value.replace(/[^\d.,]/g, '') })}
              />
            </div>
            <div className="plano-conta__linha plano-conta__final">
              <span>O cliente paga</span>
              <span className="mono">{fmtReais(previa.mensalidade)}/mês</span>
            </div>
            <span className="quieto" style={{ fontSize: 11 }}>
              Usuário {fmtReais(tabela.usuario)} · cada 1.000 leads {fmtReais(tabela.milLeads)} (para mais ou
              para menos). A tabela fica em “Tabela de preços”.
            </span>
          </aside>
        </div>
      )}
      <ErroDaApi erro={salvar.error} />
      {salvar.isSuccess && <Mensagem tipo="ok">Plano salvo. Vale na hora para a conta.</Mensagem>}
      <div className="acoes">
        <Button type="submit" variant="primary" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar plano'}
        </Button>
      </div>
    </form>
  );
}

/** Painel master: preço de cada plano e módulo, do usuário e de cada 1.000 leads. */
export function TabelaDePrecos() {
  const cliente = useQueryClient();
  const q = useTabelaPrecos();
  const [t, setT] = useState<TabelaPrecos | null>(null);
  useEffect(() => {
    if (q.data) setT(q.data);
  }, [q.data]);
  const salvar = useMutation({
    mutationFn: (dados: TabelaPrecos) => api<TabelaPrecos>('/master/precos', { metodo: 'PUT', corpo: dados }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['master'] }),
  });
  if (!t) return <div className="esqueleto" />;
  const num = (v: string) =>
    Number(
      v
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^\d.]/g, ''),
    ) || 0;
  const campo = (
    id: string,
    rotulo: string,
    valor: number,
    aoMudar: (v: number) => void,
    dinheiro = true,
  ) => (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        className="filtro mono"
        inputMode={dinheiro ? 'decimal' : 'numeric'}
        value={String(valor)}
        onChange={(e) => aoMudar(num(e.target.value))}
      />
    </div>
  );
  /** Número com "em branco = sem limite". */
  const campoLimite = (
    id: string,
    rotulo: string,
    valor: number | null,
    aoMudar: (v: number | null) => void,
  ) => (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        className="filtro mono"
        inputMode="numeric"
        placeholder="Sem limite"
        value={valor == null ? '' : String(valor)}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, '');
          aoMudar(d === '' ? null : Number(d));
        }}
      />
      <span className="campo__dica">Em branco: sem limite.</span>
    </div>
  );
  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate(t);
      }}
    >
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Vale para o cálculo de todos os clientes (quem tem valor combinado continua pagando o combinado).
      </p>
      <div className="tabela-precos">
        {PLANOS_PRONTOS.map((id) => (
          <fieldset key={id} className="caixa">
            <legend>Plano {NOME_PLANO[id]}</legend>
            {campo(`tp-${id}-preco`, 'Preço (R$/mês)', t.planos[id].preco, (v) =>
              setT({ ...t, planos: { ...t.planos, [id]: { ...t.planos[id], preco: v } } }),
            )}
            {campo(
              `tp-${id}-usuarios`,
              'Usuários incluídos',
              t.planos[id].usuarios,
              (v) =>
                setT({ ...t, planos: { ...t.planos, [id]: { ...t.planos[id], usuarios: Math.max(1, v) } } }),
              false,
            )}
            {campo(
              `tp-${id}-leads`,
              'Leads/mês incluídos',
              t.planos[id].leadsMes,
              (v) => setT({ ...t, planos: { ...t.planos, [id]: { ...t.planos[id], leadsMes: v } } }),
              false,
            )}
            {campoLimite(`tp-${id}-horas`, 'Horas de reunião por mês', t.planos[id].horasReuniao, (v) =>
              setT({ ...t, planos: { ...t.planos, [id]: { ...t.planos[id], horasReuniao: v } } }),
            )}
            <fieldset className="campo">
              <legend>O que o plano libera</legend>
              <div className="pilha" style={{ gap: 4 }}>
                {LISTA_RECURSOS.map((r) => (
                  <label key={r} className="opcao">
                    <input
                      type="checkbox"
                      checked={t.planos[id].recursos.includes(r)}
                      onChange={(e) =>
                        setT({
                          ...t,
                          planos: {
                            ...t.planos,
                            [id]: {
                              ...t.planos[id],
                              recursos: e.target.checked
                                ? LISTA_RECURSOS.filter((x) => x === r || t.planos[id].recursos.includes(x))
                                : t.planos[id].recursos.filter((x) => x !== r),
                            },
                          },
                        })
                      }
                    />
                    <span>{RECURSOS[r].nome}</span>
                  </label>
                ))}
                {LISTA_MODULOS.map((m) => (
                  <label key={m} className="opcao">
                    <input
                      type="checkbox"
                      checked={t.planos[id].modulosInclusos.includes(m)}
                      onChange={(e) =>
                        setT({
                          ...t,
                          planos: {
                            ...t.planos,
                            [id]: {
                              ...t.planos[id],
                              modulosInclusos: e.target.checked
                                ? [...new Set([...t.planos[id].modulosInclusos, m])]
                                : t.planos[id].modulosInclusos.filter((x) => x !== m),
                            },
                          },
                        })
                      }
                    />
                    <span>{MODULOS[m].nome} incluso</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
        ))}
        <fieldset className="caixa">
          <legend>Módulos e ajustes</legend>
          {/* O Agente de IA só é vendido junto com o WhatsApp (combo abaixo). */}
          {LISTA_MODULOS.filter((m) => m !== 'agente_ia').map((m) =>
            campo(`tp-${m}`, `${MODULOS[m].nome} sozinho (R$/mês)`, t.modulos[m], (v) =>
              setT({ ...t, modulos: { ...t.modulos, [m]: v } }),
            ),
          )}
          {campo('tp-combo', 'WhatsApp + Agente de IA juntos (R$/mês)', t.comboWhatsappIa, (v) =>
            setT({ ...t, comboWhatsappIa: v }),
          )}
          {campo(
            'tp-numeros',
            'Números de WhatsApp inclusos no módulo',
            t.numerosInclusos,
            (v) => setT({ ...t, numerosInclusos: v }),
            false,
          )}
          {campo('tp-numero-extra', 'Cada número de WhatsApp extra (R$/mês)', t.numeroExtra, (v) =>
            setT({ ...t, numeroExtra: v }),
          )}
          {campoLimite('tp-conversas', 'Conversas do Agente de IA por mês', t.conversasIaMes, (v) =>
            setT({ ...t, conversasIaMes: v }),
          )}
          {campo('tp-usuario', 'Cada usuário a mais ou a menos (R$)', t.usuario, (v) =>
            setT({ ...t, usuario: v }),
          )}
          {campo('tp-mil', 'Cada 1.000 leads a mais ou a menos (R$)', t.milLeads, (v) =>
            setT({ ...t, milLeads: v }),
          )}
        </fieldset>
      </div>
      <ErroDaApi erro={salvar.error} />
      {salvar.isSuccess && <Mensagem tipo="ok">Tabela salva.</Mensagem>}
      <div className="acoes">
        <Button type="submit" variant="primary" disabled={salvar.isPending}>
          Salvar tabela
        </Button>
      </div>
    </form>
  );
}
