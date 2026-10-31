import {
  type AssinarEntrada,
  type AssinaturaDaConta,
  contratoDoPedido,
  FORMAS_PAGAMENTO,
  type FormaPagamento,
  ROTULO_ASSINATURA,
} from '@prospeccao/shared/assinatura';
import {
  LISTA_MODULOS,
  MODULOS,
  type Modulo,
  NOME_PLANO,
  type PlanoPronto,
  planoEfetivo,
  type TabelaPrecos,
} from '@prospeccao/shared/planos';
import { Badge, Button, EmptyState, Icon, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useSessao } from '../componentes/Sessao';
import { WHATSAPP_PROSPECT } from '../componentes/TesteEAssinatura';
import { fmtData, fmtNumero, fmtReais, fmtReaisCentavos } from '../formatar';

/**
 * Meu plano › Assinar (o plano, os usuários, os módulos e a forma de pagamento, com o preço na hora)
 * e Meu plano › Pagar (o Pix na tela, a página do Asaas para boleto e cartão, e as cobranças).
 */

export interface CobrancaDaConta {
  id: number;
  asaasId: string;
  descricao: string | null;
  valor: number;
  vencimento: string;
  situacao: 'pendente' | 'paga' | 'atrasada' | 'cancelada' | 'estornada';
  forma: string | null;
  link: string | null;
  pagoEm: string | null;
}

export interface ResumoAssinatura {
  disponivel: boolean;
  sandbox: boolean;
  situacao: AssinaturaDaConta | null;
  feito: { leads: number; funil: number; reunioes: number };
  tabela: TabelaPrecos;
  pedido: AssinarEntrada | null;
  valor: number | null;
  forma: FormaPagamento | null;
  dados: { documento: string | null; nome: string | null; email: string | null };
  cobrancas: CobrancaDaConta[];
}

interface APagar {
  asaas_id: string;
  valor: number;
  vencimento: string;
  forma: string | null;
  link: string | null;
  situacao: string;
  pix: { imagem: string; copiaECola: string; expiraEm: string | null } | null;
}

export function useResumoAssinatura() {
  return useQuery({ queryKey: ['assinatura'], queryFn: () => api<ResumoAssinatura>('/assinatura') });
}

const PLANOS: PlanoPronto[] = ['start', 'time', 'escala'];
const RESUMO_PLANO: Record<PlanoPronto, string> = {
  start: 'Prospecção e funil',
  time: 'Equipe, reuniões, e-mail, rua, API',
  escala: 'Tudo, inclusive o Argos',
};
const ROTULO_COBRANCA: Record<
  CobrancaDaConta['situacao'],
  { texto: string; tom: 'brand' | 'warning' | 'danger' | 'outline' }
> = {
  pendente: { texto: 'esperando', tom: 'warning' },
  paga: { texto: 'paga', tom: 'brand' },
  atrasada: { texto: 'atrasada', tom: 'danger' },
  cancelada: { texto: 'cancelada', tom: 'outline' },
  estornada: { texto: 'estornada', tom: 'outline' },
};
const NOME_FORMA: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão',
  UNDEFINED: '—',
};

/** /plano/assinar */
export function Assinar() {
  const admin = useEhAdmin();
  const sessao = useSessao().data;
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const q = useResumoAssinatura();
  const [plano, setPlano] = useState<PlanoPronto>('time');
  const [usuarios, setUsuarios] = useState(4);
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [forma, setForma] = useState<FormaPagamento>('PIX');
  const [dados, setDados] = useState({ documento: '', nome: '', email: '' });
  const [carregado, setCarregado] = useState(false);

  // Começa do que já foi pedido (ou do plano atual).
  useEffect(() => {
    if (!q.data || carregado) return;
    const p = q.data.pedido;
    const atual = sessao?.conta.plano;
    const inicial: PlanoPronto = p?.plano ?? (atual === 'start' || atual === 'escala' ? atual : 'time');
    setPlano(inicial);
    setUsuarios(p?.usuarios ?? q.data.tabela.planos[inicial].usuarios);
    setModulos(p?.modulos ?? []);
    if (q.data.forma) setForma(q.data.forma);
    setDados({
      documento: q.data.dados.documento ?? '',
      nome: q.data.dados.nome ?? '',
      email: q.data.dados.email ?? sessao?.email ?? '',
    });
    setCarregado(true);
  }, [q.data, carregado, sessao]);

  const tabela = q.data?.tabela;
  const linha = tabela?.planos[plano];
  const preco = useMemo(
    () =>
      tabela ? planoEfetivo(contratoDoPedido({ plano, usuarios, modulos, numerosExtras: 0 }), tabela) : null,
    [tabela, plano, usuarios, modulos],
  );
  const assinar = useMutation({
    mutationFn: () =>
      api<{ valor: number; mudouNaHora: boolean }>('/assinatura/assinar', {
        metodo: 'POST',
        corpo: { plano, usuarios, modulos, numerosExtras: 0, forma, ...dados },
      }),
    onSuccess: async (r) => {
      await Promise.all([
        cliente.invalidateQueries({ queryKey: ['assinatura'] }),
        cliente.invalidateQueries({ queryKey: ['sessao'] }),
        cliente.invalidateQueries({ queryKey: ['meu-plano'] }),
      ]);
      navegar(r.mudouNaHora ? '/plano?mudou=1' : '/plano/pagar');
    },
  });

  if (!admin)
    return (
      <div className="pp-panel">
        <EmptyState
          icone="lock"
          titulo="Só quem administra a conta assina"
          texto="Peça para o administrador abrir Meu plano › Assinar."
        />
      </div>
    );
  if (q.isPending) return <div className="esqueleto" />;
  if (!q.data || !tabela || !linha || !preco) return <ErroDaApi erro={q.error} />;
  if (!q.data.situacao)
    return (
      <div className="pp-panel">
        <EmptyState
          icone="badge-check"
          titulo="O seu contrato é combinado com a gente"
          texto="Para mudar de plano, usuários ou módulos, fale com o nosso time pelo WhatsApp."
        />
      </div>
    );

  const trocarPlano = (p: PlanoPronto) => {
    setPlano(p);
    setUsuarios((u) => Math.max(u, tabela.planos[p].usuarios));
  };
  const alternar = (m: Modulo) =>
    setModulos((xs) => {
      if (xs.includes(m)) return xs.filter((x) => x !== m && !(m === 'whatsapp' && x === 'agente_ia'));
      return m === 'agente_ia' && !xs.includes('whatsapp') ? [...xs, 'whatsapp', m] : [...xs, m];
    });
  const ativa = q.data.situacao.situacao === 'ativa' || q.data.situacao.situacao === 'atrasada';
  const pronto =
    dados.documento.replace(/\D/g, '').length >= 11 &&
    dados.nome.trim().length >= 2 &&
    dados.email.includes('@');
  const extrasUsuarios = usuarios - linha.usuarios;
  const dia = new Date().getDate();
  const campo = (k: keyof typeof dados) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDados((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      <div className="topo">
        <div>
          <h1>{ativa ? 'Mudar a assinatura' : 'Assinar'}</h1>
          <p>
            {ativa
              ? 'A mudança vale na hora; a próxima mensalidade já vem com o valor novo.'
              : 'Continue de onde parou: tudo o que você fez no teste fica.'}{' '}
            <LinkAjuda artigo="assinatura" />
          </p>
        </div>
        <Button onClick={() => navegar('/plano')}>Voltar para Meu plano</Button>
      </div>
      {!q.data.disponivel && (
        <Mensagem tipo="aviso">
          A assinatura pelo sistema ainda não foi ligada. Para assinar agora,{' '}
          <a href={WHATSAPP_PROSPECT} target="_blank" rel="noopener noreferrer">
            fale com a gente pelo WhatsApp
          </a>
          .
        </Mensagem>
      )}
      {q.data.sandbox && (
        <Mensagem tipo="aviso">
          Modo de teste do Asaas: as cobranças são de mentira (nada é cobrado).
        </Mensagem>
      )}
      <div className="assinar">
        <div className="assinar__principal">
          <fieldset className="assinar__planos">
            <legend className="assinar__legenda">Plano</legend>
            {PLANOS.map((p) => {
              const l = tabela.planos[p];
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={plano === p}
                  className="assinar__plano"
                  data-ativo={plano === p || undefined}
                  onClick={() => trocarPlano(p)}
                >
                  <span className="assinar__plano-nome">
                    {NOME_PLANO[p]}
                    {plano === p && <Icon name="check" size={16} />}
                  </span>
                  <span className="assinar__plano-preco">
                    {fmtReais(l.preco)}
                    <small>/mês</small>
                  </span>
                  <span className="quieto">
                    {l.usuarios} usuários · {fmtNumero(l.leadsMes)} leads/mês
                  </span>
                  <span className="quieto">{RESUMO_PLANO[p]}</span>
                </button>
              );
            })}
          </fieldset>

          <section className="pp-panel assinar__bloco assinar__colunas">
            <div>
              <h2 className="assinar__titulo">Usuários</h2>
              <div className="assinar__contador">
                <button
                  type="button"
                  aria-label="Menos um usuário"
                  disabled={usuarios <= linha.usuarios}
                  onClick={() => setUsuarios((u) => Math.max(linha.usuarios, u - 1))}
                >
                  −
                </button>
                <output aria-live="polite">{usuarios}</output>
                <button
                  type="button"
                  aria-label="Mais um usuário"
                  disabled={usuarios >= 200}
                  onClick={() => setUsuarios((u) => Math.min(200, u + 1))}
                >
                  +
                </button>
              </div>
              <p className="quieto assinar__dica">
                {linha.usuarios} inclusos
                {extrasUsuarios > 0 ? ` + ${extrasUsuarios} a ${fmtReais(tabela.usuario)}` : ''}
              </p>
            </div>
            <div>
              <h2 className="assinar__titulo">Módulos</h2>
              <div className="assinar__modulos">
                {LISTA_MODULOS.map((m) => {
                  const incluso = linha.modulosInclusos.includes(m);
                  const ehCombo = m === 'whatsapp' || m === 'agente_ia';
                  return (
                    <label key={m} className="assinar__modulo">
                      <input
                        type="checkbox"
                        checked={incluso || modulos.includes(m)}
                        disabled={incluso}
                        onChange={() => alternar(m)}
                      />
                      <span>
                        {MODULOS[m].nome} <b>{incluso ? 'incluso' : fmtReais(tabela.modulos[m])}</b>
                        {m === 'ligacoes' && !incluso && (
                          <span className="quieto"> ({fmtNumero(tabela.minutosLigacao)} min)</span>
                        )}
                        {ehCombo && m === 'agente_ia' && (
                          <span className="quieto">
                            {' '}
                            · com o WhatsApp sai {fmtReais(tabela.comboWhatsappIa)} os dois
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="pp-panel assinar__bloco">
            <h2 className="assinar__titulo">Dados para a cobrança e a nota fiscal</h2>
            <div className="assinar__dados">
              <TextField
                rotulo="CNPJ (ou CPF)"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={dados.documento}
                onChange={campo('documento')}
              />
              <TextField rotulo="Razão social (ou nome)" value={dados.nome} onChange={campo('nome')} />
              <TextField
                rotulo="E-mail do financeiro"
                type="email"
                dica="A cobrança e a nota fiscal chegam nele."
                value={dados.email}
                onChange={campo('email')}
              />
              <TextField
                rotulo="Vencimento"
                value={ativa ? 'O mesmo de hoje' : `Todo dia ${dia}`}
                readOnly
                dica={ativa ? undefined : 'O dia em que assinar.'}
              />
            </div>
          </section>

          <fieldset className="assinar__formas">
            <legend className="assinar__legenda">Forma de pagamento</legend>
            {(Object.keys(FORMAS_PAGAMENTO) as FormaPagamento[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={forma === f}
                className="assinar__forma"
                data-ativo={forma === f || undefined}
                onClick={() => setForma(f)}
              >
                <b>{FORMAS_PAGAMENTO[f].nome}</b>
                <span className="quieto">{FORMAS_PAGAMENTO[f].descricao}</span>
              </button>
            ))}
          </fieldset>
        </div>

        <aside className="pp-panel assinar__resumo">
          <h2 className="assinar__titulo">Resumo mensal</h2>
          <div className="plano-conta">
            {preco.itens.map((i) => (
              <div key={i.rotulo} className="plano-conta__linha">
                <span>{i.rotulo}</span>
                <span className="mono">{fmtReais(i.valor)}</span>
              </div>
            ))}
          </div>
          <div className="assinar__total">
            <span>Por mês</span>
            <b>{fmtReais(preco.mensalidade)}</b>
          </div>
          <ErroDaApi erro={assinar.error} />
          <Button
            variant="primary"
            disabled={!pronto || assinar.isPending || !q.data.disponivel}
            onClick={() => assinar.mutate()}
          >
            {assinar.isPending
              ? 'Mandando…'
              : ativa
                ? 'Mudar a assinatura'
                : forma === 'PIX'
                  ? 'Assinar e pagar com Pix'
                  : forma === 'BOLETO'
                    ? 'Assinar e gerar o boleto'
                    : 'Assinar com cartão'}
          </Button>
          <p className="quieto assinar__dica">
            Cobrança recorrente pelo Asaas. Muda de plano ou cancela quando quiser em Meu plano; a nota fiscal
            vai para o e-mail do financeiro.
          </p>
        </aside>
      </div>
    </>
  );
}

/** As cobranças da conta (Meu plano e Pagar). */
export function ListaCobrancas(props: { cobrancas: CobrancaDaConta[] }) {
  if (!props.cobrancas.length)
    return (
      <p className="quieto" style={{ margin: 0 }}>
        Nenhuma cobrança ainda.
      </p>
    );
  return (
    <table className="pp-table tabela-cartoes assinatura-cobrancas">
      <thead>
        <tr>
          <th>Vencimento</th>
          <th>O quê</th>
          <th>Valor</th>
          <th>Forma</th>
          <th>Situação</th>
          <th aria-label="Ações" />
        </tr>
      </thead>
      <tbody>
        {props.cobrancas.map((c) => {
          const r = ROTULO_COBRANCA[c.situacao];
          return (
            <tr key={c.id}>
              <td>{fmtData(c.vencimento)}</td>
              <td>{c.descricao ?? '—'}</td>
              <td className="mono">{fmtReaisCentavos(c.valor)}</td>
              <td>{NOME_FORMA[c.forma ?? ''] ?? '—'}</td>
              <td>
                <Badge tone={r.tom}>{r.texto}</Badge>
              </td>
              <td>
                {c.link && (
                  <a href={c.link} target="_blank" rel="noopener noreferrer">
                    {c.situacao === 'pendente' || c.situacao === 'atrasada' ? 'Pagar' : 'Ver'}
                  </a>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** /plano/pagar */
export function Pagar() {
  const admin = useEhAdmin();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const resumo = useResumoAssinatura();
  const pagar = useQuery({
    queryKey: ['assinatura-pagar'],
    queryFn: () => api<{ cobranca: APagar | null }>('/assinatura/pagar'),
  });
  const [copiado, setCopiado] = useState(false);
  const situacao = resumo.data?.situacao?.situacao;
  const esperando = !!pagar.data?.cobranca;
  // Esperando o Pix: confere a cada 10 segundos (o aviso do Asaas libera a conta sozinho).
  const conferir = useMutation({
    mutationFn: () => api<ResumoAssinatura>('/assinatura/conferir', { metodo: 'POST' }),
    onSuccess: (r) => {
      cliente.setQueryData(['assinatura'], r);
      void cliente.invalidateQueries({ queryKey: ['assinatura-pagar'] });
      void cliente.invalidateQueries({ queryKey: ['sessao'] });
      void cliente.invalidateQueries({ queryKey: ['meu-plano'] });
    },
  });
  useEffect(() => {
    if (!esperando) return;
    const t = window.setInterval(() => {
      void cliente.invalidateQueries({ queryKey: ['assinatura-pagar'] });
      void cliente.invalidateQueries({ queryKey: ['assinatura'] });
    }, 10_000);
    return () => window.clearInterval(t);
  }, [esperando, cliente]);
  const anterior = useRef<string | null>(null);
  // Pagou (sumiu a cobrança em aberto): atualiza o menu e os limites.
  useEffect(() => {
    if (!pagar.data) return;
    const agora = pagar.data.cobranca?.asaas_id ?? null;
    if (anterior.current && !agora) {
      void cliente.invalidateQueries({ queryKey: ['sessao'] });
      void cliente.invalidateQueries({ queryKey: ['meu-plano'] });
    }
    anterior.current = agora;
  }, [pagar.data, cliente]);

  if (resumo.isPending || pagar.isPending) return <div className="esqueleto" />;
  if (!resumo.data || !pagar.data) return <ErroDaApi erro={resumo.error ?? pagar.error} />;
  const c = pagar.data.cobranca;
  const pedido = resumo.data.pedido;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Pagar</h1>
          <p>
            {pedido
              ? [
                  NOME_PLANO[pedido.plano],
                  `${pedido.usuarios} usuários`,
                  ...pedido.modulos.map((m) => MODULOS[m].nome),
                ].join(' · ')
              : situacao
                ? ROTULO_ASSINATURA[situacao]
                : ''}
          </p>
        </div>
        <Button onClick={() => navegar('/plano')}>Voltar para Meu plano</Button>
      </div>
      <div className="pagar">
        <section className="pp-panel pagar__caixa">
          {!c ? (
            <EmptyState
              icone="badge-check"
              titulo={situacao === 'ativa' ? 'Pago. A assinatura está ativa.' : 'Nada para pagar agora'}
              texto={
                situacao === 'ativa'
                  ? 'O plano novo já vale. A próxima mensalidade chega no e-mail do financeiro.'
                  : 'Quando houver uma cobrança em aberto, ela aparece aqui.'
              }
            />
          ) : (
            <>
              <h2 className="pagar__titulo">
                Pague {fmtReaisCentavos(c.valor)}
                {c.pix ? ' com Pix' : ''}
              </h2>
              <p className="quieto" style={{ margin: 0 }}>
                Vencimento {fmtData(c.vencimento)}
                {c.situacao === 'atrasada' ? ' (atrasada)' : ''}
              </p>
              {c.pix && (
                <>
                  <img
                    className="pagar__qr"
                    src={`data:image/png;base64,${c.pix.imagem}`}
                    alt="QR Code do Pix"
                    width={200}
                    height={200}
                  />
                  <code className="pagar__codigo">{c.pix.copiaECola}</code>
                  <Button
                    icon="copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(c.pix!.copiaECola).then(() => setCopiado(true));
                    }}
                  >
                    {copiado ? 'Copiado' : 'Copiar o código Pix'}
                  </Button>
                </>
              )}
              <p className="pagar__esperando">
                <span className="pagar__ponto" aria-hidden="true" />
                Esperando o pagamento… esta tela atualiza sozinha.
              </p>
              <div className="pagar__acoes">
                {c.link && (
                  <Button href={c.link} target="_blank" rel="noopener noreferrer" iconRight="external-link">
                    {c.pix
                      ? 'Prefere boleto ou cartão? Abrir a página de pagamento'
                      : 'Abrir a página de pagamento'}
                  </Button>
                )}
                <Button variant="ghost" disabled={conferir.isPending} onClick={() => conferir.mutate()}>
                  {conferir.isPending ? 'Conferindo…' : 'Já paguei'}
                </Button>
              </div>
              <ErroDaApi erro={conferir.error} />
            </>
          )}
        </section>
        <div className="pilha" style={{ gap: 16 }}>
          {c && situacao === 'teste' && (
            <Mensagem tipo="ok">
              <b>Pagou? Liberamos na hora.</b> O teste vira assinatura: os usuários, os módulos e os limites
              do plano valem assim que o pagamento cair. Até lá, o teste continua normal.
            </Mensagem>
          )}
          {c && situacao === 'so_leitura' && (
            <Mensagem tipo="ok">
              <b>Pagou? A conta volta na hora,</b> do jeito que estava.
            </Mensagem>
          )}
          <section className="pp-panel pagar__cobrancas">
            <h2 className="subtitulo">Cobranças</h2>
            <ListaCobrancas cobrancas={resumo.data.cobrancas} />
          </section>
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            Mudar de plano, de forma de pagamento ou cancelar: em{' '}
            {admin ? <Link to="/plano">Meu plano</Link> : 'Meu plano'}, quando quiser.
          </p>
        </div>
      </div>
    </>
  );
}

/** O bloco da assinatura em Meu plano (situação, cobranças, mudar e cancelar). */
export function AssinaturaNoPlano() {
  const admin = useEhAdmin();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const q = useResumoAssinatura();
  const [confirmar, setConfirmar] = useState(false);
  const cancelar = useMutation({
    mutationFn: () => api<ResumoAssinatura>('/assinatura/cancelar', { metodo: 'POST' }),
    onSuccess: (r) => {
      cliente.setQueryData(['assinatura'], r);
      setConfirmar(false);
      void cliente.invalidateQueries({ queryKey: ['sessao'] });
    },
  });
  if (!admin || !q.data?.situacao) return null;
  const s = q.data.situacao;
  const temAssinatura = s.situacao === 'ativa' || s.situacao === 'atrasada' || s.esperandoPagamento;
  return (
    <section className="pp-panel meu-plano">
      <div className="assinatura-plano__topo">
        <div>
          <h2 className="subtitulo" style={{ margin: 0 }}>
            Assinatura
          </h2>
          <p className="quieto" style={{ margin: '4px 0 0', fontSize: 13 }}>
            {ROTULO_ASSINATURA[s.situacao]}
            {s.situacao === 'teste' && s.testeAte ? ` até ${fmtData(s.testeAte)}` : ''}
            {s.esperandoPagamento ? ' · esperando o pagamento' : ''}
            {q.data.valor != null && temAssinatura
              ? ` · ${fmtReais(q.data.valor)}/mês no ${NOME_FORMA[q.data.forma ?? ''] ?? '—'}`
              : ''}
          </p>
        </div>
        <div className="assinatura-plano__botoes">
          {(s.esperandoPagamento || s.situacao === 'atrasada') && (
            <Button variant="primary" onClick={() => navegar('/plano/pagar')}>
              Pagar
            </Button>
          )}
          <Button
            variant={s.esperandoPagamento || s.situacao === 'atrasada' ? 'secondary' : 'primary'}
            onClick={() => navegar('/plano/assinar')}
          >
            {s.situacao === 'ativa' || s.situacao === 'atrasada' ? 'Mudar plano ou pagamento' : 'Assinar'}
          </Button>
          {temAssinatura && (
            <Button variant="ghost" onClick={() => setConfirmar(true)}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
      {confirmar && (
        <div className="assinatura-plano__cancelar">
          <p style={{ margin: 0 }}>
            {s.situacao === 'ativa' || s.situacao === 'atrasada'
              ? `Cancelar a assinatura? O acesso continua até o fim do período pago${s.acessoAte ? ` (${fmtData(s.acessoAte)})` : ''}; depois a conta fica só leitura.`
              : 'Desistir da assinatura pedida? A cobrança em aberto é cancelada.'}
          </p>
          <ErroDaApi erro={cancelar.error} />
          <div className="assinatura-plano__botoes">
            <Button variant="ghost" onClick={() => setConfirmar(false)}>
              Manter
            </Button>
            <Button variant="danger" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>
              {cancelar.isPending ? 'Cancelando…' : 'Cancelar a assinatura'}
            </Button>
          </div>
        </div>
      )}
      {q.data.cobrancas.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <ListaCobrancas cobrancas={q.data.cobrancas} />
        </div>
      )}
    </section>
  );
}
