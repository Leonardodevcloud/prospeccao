import {
  type AssinarEntrada,
  type AssinaturaDaConta,
  contratoDoPedido,
  DIFERENCA_MINIMA,
  ROTULO_ASSINATURA,
  ROTULO_TIPO_COBRANCA,
  type TipoCobranca,
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
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useSessao } from '../componentes/Sessao';
import { WHATSAPP_PROSPECT } from '../componentes/TesteEAssinatura';
import { fmtData, fmtNumero, fmtReais, fmtReaisCentavos, formatarCnpj } from '../formatar';

/**
 * Meu plano › Assinar (o plano, os usuários e os módulos, com o preço na hora), Meu plano › Pagar
 * (o Pix na tela, a página do Asaas para boleto e cartão, e as cobranças), o bloco da assinatura em
 * Meu plano e a compra de minutos de ligação. Sem recorrência: cada mês é uma cobrança.
 */

export interface CobrancaDaConta {
  id: number;
  asaasId: string;
  tipo: TipoCobranca;
  descricao: string | null;
  valor: number;
  vencimento: string;
  situacao: 'pendente' | 'paga' | 'atrasada' | 'cancelada' | 'estornada';
  forma: string | null;
  link: string | null;
  pagoEm: string | null;
  minutos: number | null;
}

type Pedido = AssinarEntrada & { valor: number };

export interface ResumoAssinatura {
  disponivel: boolean;
  sandbox: boolean;
  situacao: AssinaturaDaConta | null;
  feito: { leads: number; funil: number; reunioes: number };
  tabela: TabelaPrecos;
  contrato: Pedido | null;
  proximo: Pedido | null;
  pedido: Pedido | null;
  valor: number | null;
  dados: { documento: string | null; nome: string | null; email: string | null };
  minutos: { saldo: number };
  cobrancas: CobrancaDaConta[];
}

interface APagar {
  cobranca:
    | (CobrancaDaConta & { pix: { imagem: string; copiaECola: string; expiraEm: string | null } | null })
    | null;
  abertas: CobrancaDaConta[];
}

export function useResumoAssinatura(ligado = true) {
  return useQuery({
    queryKey: ['assinatura'],
    queryFn: () => api<ResumoAssinatura>('/assinatura'),
    enabled: ligado,
  });
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
  atrasada: { texto: 'vencida', tom: 'danger' },
  cancelada: { texto: 'cancelada', tom: 'outline' },
  estornada: { texto: 'estornada', tom: 'outline' },
};
const NOME_FORMA: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão' };
const DIA = 86_400_000;
const descricao = (p: AssinarEntrada) =>
  [NOME_PLANO[p.plano], `${p.usuarios} usuários`, ...p.modulos.map((m) => MODULOS[m].nome)].join(' · ');

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
  const [dados, setDados] = useState({ documento: '', nome: '', email: '' });
  const [carregado, setCarregado] = useState(false);

  // Começa do que já foi pedido, do plano pago ou do plano atual.
  useEffect(() => {
    if (!q.data || carregado) return;
    const p = q.data.pedido ?? q.data.proximo ?? q.data.contrato;
    const atual = sessao?.conta.plano;
    const inicial: PlanoPronto = p?.plano ?? (atual === 'start' || atual === 'escala' ? atual : 'time');
    setPlano(inicial);
    setUsuarios(p?.usuarios ?? q.data.tabela.planos[inicial].usuarios);
    setModulos(p?.modulos ?? []);
    setDados({
      documento: q.data.dados.documento
        ? q.data.dados.documento.length === 14
          ? formatarCnpj(q.data.dados.documento)
          : q.data.dados.documento
        : '',
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
      api<{
        valor: number;
        tipo: 'mensalidade' | 'diferenca' | 'na_hora' | 'proximo';
        cobranca: CobrancaDaConta | null;
        valeEm: string | null;
      }>('/assinatura/assinar', {
        metodo: 'POST',
        corpo: { plano, usuarios, modulos, numerosExtras: 0, ...dados },
      }),
    onSuccess: async (r) => {
      await Promise.all([
        cliente.invalidateQueries({ queryKey: ['assinatura'] }),
        cliente.invalidateQueries({ queryKey: ['assinatura-pagar'] }),
        cliente.invalidateQueries({ queryKey: ['sessao'] }),
        cliente.invalidateQueries({ queryKey: ['meu-plano'] }),
      ]);
      if (r.cobranca) navegar(`/plano/pagar?cobranca=${r.cobranca.id}`);
      else navegar(r.tipo === 'proximo' ? '/plano?mudou=proximo' : '/plano?mudou=1');
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
  const s = q.data.situacao;
  // Mês pago valendo: é uma mudança de plano.
  const valendo = !!s.acessoAte && new Date(s.acessoAte).getTime() > Date.now() && !!q.data.contrato;
  const atual = q.data.valor ?? 0;
  const novo = preco.mensalidade ?? 0;
  const restam = valendo
    ? Math.min(30, Math.max(1, Math.ceil((new Date(s.acessoAte!).getTime() - Date.now()) / DIA)))
    : 0;
  const diferenca = valendo && novo > atual ? Math.round((novo - atual) * (restam / 30) * 100) / 100 : 0;
  const pronto =
    dados.documento.replace(/\D/g, '').length >= 11 &&
    dados.nome.trim().length >= 2 &&
    dados.email.includes('@');
  const extrasUsuarios = usuarios - linha.usuarios;
  const campo = (k: keyof typeof dados) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDados((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      <div className="topo">
        <div>
          <h1>{valendo ? 'Mudar o plano' : 'Assinar'}</h1>
          <p>
            {valendo
              ? 'Para mais: paga só a diferença dos dias que faltam e vale na hora. Para menos: vale no próximo mês.'
              : s.jaPagou
                ? 'Pague o mês e a conta volta na hora, do jeito que estava.'
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
                          <span className="quieto">
                            {' '}
                            ({fmtNumero(tabela.minutosLigacao)} min; acabou, +
                            {fmtNumero(tabela.pacoteMinutos)} por {fmtReais(tabela.pacotePreco)})
                          </span>
                        )}
                        {m === 'agente_ia' && (
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
              <div className="assinar__inteira">
                <TextField
                  rotulo="E-mail do financeiro"
                  type="email"
                  dica="As cobranças e a nota fiscal chegam nele."
                  value={dados.email}
                  onChange={campo('email')}
                />
              </div>
            </div>
          </section>

          <section className="pp-panel assinar__bloco assinar__como">
            <h2 className="assinar__titulo">Como funciona o pagamento</h2>
            <ul>
              <li>
                <Icon name="check" size={14} />
                <span>
                  <b>Um mês por vez, sem cobrança automática no cartão.</b> 7 dias antes de vencer, a
                  mensalidade seguinte aparece aqui e no e-mail do financeiro.
                </span>
              </li>
              <li>
                <Icon name="check" size={14} />
                <span>
                  <b>Pix na tela</b> (libera na hora), <b>boleto</b> (até 2 dias úteis) ou <b>cartão</b> na
                  página segura do Asaas.
                </span>
              </li>
              <li>
                <Icon name="check" size={14} />
                <span>
                  Venceu sem pagar: tudo continua por 3 dias; depois, a conta fica só leitura (vocês veem e
                  exportam os contatos) até o pagamento.
                </span>
              </li>
            </ul>
          </section>
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
          {valendo && (
            <p className="assinar__mudanca">
              {novo > atual ? (
                diferenca < DIFERENCA_MINIMA ? (
                  <>
                    Vale na hora, sem custo agora. A partir de {fmtData(s.acessoAte)}, {fmtReais(novo)} por
                    mês.
                  </>
                ) : (
                  <>
                    Hoje: <b>{fmtReaisCentavos(diferenca)}</b> (a diferença dos {restam} dias até{' '}
                    {fmtData(s.acessoAte)}). Vale assim que pagar. Depois, {fmtReais(novo)} por mês.
                  </>
                )
              ) : novo < atual ? (
                <>
                  Hoje você paga {fmtReais(atual)} por mês. O plano novo vale a partir de{' '}
                  {fmtData(s.acessoAte)}, já com {fmtReais(novo)}.
                </>
              ) : (
                <>Mesmo valor de hoje. A mudança vale na próxima renovação ({fmtData(s.acessoAte)}).</>
              )}
            </p>
          )}
          <ErroDaApi erro={assinar.error} />
          <Button
            variant="primary"
            disabled={!pronto || assinar.isPending || !q.data.disponivel}
            onClick={() => assinar.mutate()}
          >
            {assinar.isPending
              ? 'Mandando…'
              : !valendo
                ? 'Assinar e pagar'
                : novo > atual && diferenca >= DIFERENCA_MINIMA
                  ? 'Mudar e pagar a diferença'
                  : 'Mudar o plano'}
          </Button>
          <p className="quieto assinar__dica">
            Sem fidelidade: para parar, é só não pagar o mês seguinte (ou desligar a renovação em Meu plano).
            A nota fiscal vai para o e-mail do financeiro.
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
          <th>Pago com</th>
          <th>Situação</th>
          <th aria-label="Ações" />
        </tr>
      </thead>
      <tbody>
        {props.cobrancas.map((c) => {
          const r = ROTULO_COBRANCA[c.situacao];
          const aberta = c.situacao === 'pendente' || c.situacao === 'atrasada';
          return (
            <tr key={c.id}>
              <td>{fmtData(c.vencimento)}</td>
              <td>
                <span className="quieto">{ROTULO_TIPO_COBRANCA[c.tipo]}</span>
                <br />
                {c.descricao ?? '—'}
              </td>
              <td className="mono">{fmtReaisCentavos(c.valor)}</td>
              <td>{c.situacao === 'paga' ? (NOME_FORMA[c.forma ?? ''] ?? '—') : '—'}</td>
              <td>
                <Badge tone={r.tom}>{r.texto}</Badge>
              </td>
              <td>
                {aberta ? (
                  <Link to={`/plano/pagar?cobranca=${c.id}`}>Pagar</Link>
                ) : c.link && c.situacao === 'paga' ? (
                  <a href={c.link} target="_blank" rel="noopener noreferrer">
                    Recibo
                  </a>
                ) : null}
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
  const [params, setParams] = useSearchParams();
  const escolhida = Number(params.get('cobranca')) || null;
  const resumo = useResumoAssinatura();
  const pagar = useQuery({
    queryKey: ['assinatura-pagar', escolhida],
    queryFn: () => api<APagar>(`/assinatura/pagar${escolhida ? `?cobranca=${escolhida}` : ''}`),
  });
  const [copiado, setCopiado] = useState(false);
  const situacao = resumo.data?.situacao?.situacao;
  const esperando = !!pagar.data?.cobranca;
  const conferir = useMutation({
    mutationFn: () => api<ResumoAssinatura>('/assinatura/conferir', { metodo: 'POST' }),
    onSuccess: (r) => {
      cliente.setQueryData(['assinatura'], r);
      void cliente.invalidateQueries({ queryKey: ['assinatura-pagar'] });
      void cliente.invalidateQueries({ queryKey: ['sessao'] });
      void cliente.invalidateQueries({ queryKey: ['meu-plano'] });
      void cliente.invalidateQueries({ queryKey: ['telefonia'] });
    },
  });
  // Esperando o pagamento: confere a cada 10 segundos (o aviso do Asaas libera sozinho).
  useEffect(() => {
    if (!esperando) return;
    const t = window.setInterval(() => {
      void cliente.invalidateQueries({ queryKey: ['assinatura-pagar'] });
      void cliente.invalidateQueries({ queryKey: ['assinatura'] });
    }, 10_000);
    return () => window.clearInterval(t);
  }, [esperando, cliente]);
  const anterior = useRef<string | null>(null);
  // Pagou (a cobrança saiu das abertas): atualiza o menu, os limites e os minutos.
  useEffect(() => {
    if (!pagar.data) return;
    const agora = pagar.data.cobranca?.asaasId ?? null;
    if (anterior.current && anterior.current !== agora) {
      void cliente.invalidateQueries({ queryKey: ['sessao'] });
      void cliente.invalidateQueries({ queryKey: ['meu-plano'] });
      void cliente.invalidateQueries({ queryKey: ['telefonia'] });
    }
    anterior.current = agora;
  }, [pagar.data, cliente]);

  if (resumo.isPending || pagar.isPending) return <div className="esqueleto" />;
  if (!resumo.data || !pagar.data) return <ErroDaApi erro={resumo.error ?? pagar.error} />;
  const c = pagar.data.cobranca;
  const outras = pagar.data.abertas.filter((x) => x.id !== c?.id);
  const p = resumo.data.pedido ?? resumo.data.contrato;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Pagar</h1>
          <p>{p ? descricao(p) : situacao ? ROTULO_ASSINATURA[situacao] : ''}</p>
        </div>
        <Button onClick={() => navegar('/plano')}>Voltar para Meu plano</Button>
      </div>
      <div className="pagar">
        <section className="pp-panel pagar__caixa">
          {!c ? (
            <EmptyState
              icone="badge-check"
              titulo={situacao === 'ativa' ? 'Tudo pago.' : 'Nada para pagar agora'}
              texto={
                situacao === 'ativa' && resumo.data.situacao?.acessoAte
                  ? `O plano vale até ${fmtData(resumo.data.situacao.acessoAte)}. A mensalidade seguinte aparece aqui 7 dias antes.`
                  : 'Quando houver uma cobrança em aberto, ela aparece aqui.'
              }
            />
          ) : (
            <>
              <span className="pagar__tipo">{ROTULO_TIPO_COBRANCA[c.tipo]}</span>
              <h2 className="pagar__titulo">
                Pague {fmtReaisCentavos(c.valor)}
                {c.pix ? ' com Pix' : ''}
              </h2>
              <p className="quieto" style={{ margin: 0 }}>
                {c.descricao}
                <br />
                Vencimento {fmtData(c.vencimento)}
                {c.situacao === 'atrasada' ? ' (vencida)' : ''}
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
                    {c.pix ? 'Boleto ou cartão: abrir a página de pagamento' : 'Abrir a página de pagamento'}
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
          {c?.tipo === 'mensalidade' && situacao === 'teste' && (
            <Mensagem tipo="ok">
              <b>Pagou? Liberamos na hora.</b> O teste vira assinatura: os usuários, os módulos e os limites
              do plano valem assim que o pagamento cair. Até lá, o teste continua normal.
            </Mensagem>
          )}
          {c && (situacao === 'so_leitura' || situacao === 'atrasada') && (
            <Mensagem tipo="ok">
              <b>Pagou? A conta volta na hora,</b> do jeito que estava.
            </Mensagem>
          )}
          {c?.tipo === 'minutos' && (
            <Mensagem tipo="ok">
              <b>Os minutos entram assim que o pagamento cair</b> e o saldo do pacote não vence: o que sobrar
              fica para os meses seguintes.
            </Mensagem>
          )}
          {outras.length > 0 && (
            <section className="pp-panel pagar__cobrancas">
              <h2 className="subtitulo">Também em aberto</h2>
              <ul className="pagar__outras">
                {outras.map((x) => (
                  <li key={x.id}>
                    <span>
                      <b>{ROTULO_TIPO_COBRANCA[x.tipo]}</b> · {fmtReaisCentavos(x.valor)}
                    </span>
                    <Button size="sm" onClick={() => setParams({ cobranca: String(x.id) })}>
                      Pagar esta
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            As cobranças pagas (com o recibo), mudar de plano e desligar a renovação ficam em{' '}
            {admin ? <Link to="/plano">Meu plano</Link> : 'Meu plano'}.
          </p>
        </div>
      </div>
    </>
  );
}

/** Comprar um pacote de minutos de ligação (vai para o Pix). */
export function ComprarMinutos(props: { tabela?: TabelaPrecos | null; variante?: 'primary' | 'secondary' }) {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const comprar = useMutation({
    mutationFn: () => api<CobrancaDaConta>('/assinatura/minutos', { metodo: 'POST', corpo: { pacotes: 1 } }),
    onSuccess: (c) => {
      void cliente.invalidateQueries({ queryKey: ['assinatura'] });
      navegar(`/plano/pagar?cobranca=${c.id}`);
    },
  });
  const t = props.tabela;
  return (
    <div className="pilha" style={{ gap: 6 }}>
      <Button
        variant={props.variante ?? 'primary'}
        icon="phone"
        disabled={comprar.isPending}
        onClick={() => comprar.mutate()}
      >
        {comprar.isPending
          ? 'Gerando o Pix…'
          : t
            ? `Comprar +${fmtNumero(t.pacoteMinutos)} minutos por ${fmtReais(t.pacotePreco)}`
            : 'Comprar mais minutos'}
      </Button>
      <ErroDaApi erro={comprar.error} />
    </div>
  );
}

/** O bloco da assinatura em Meu plano (situação, próxima mensalidade, renovação, minutos e cobranças). */
export function AssinaturaNoPlano() {
  const admin = useEhAdmin();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const q = useResumoAssinatura(admin);
  const [confirmar, setConfirmar] = useState(false);
  const atualizar = (r: ResumoAssinatura) => {
    cliente.setQueryData(['assinatura'], r);
    setConfirmar(false);
    void cliente.invalidateQueries({ queryKey: ['sessao'] });
  };
  const cancelar = useMutation({
    mutationFn: () => api<ResumoAssinatura>('/assinatura/cancelar', { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  const renovar = useMutation({
    mutationFn: () => api<ResumoAssinatura>('/assinatura/renovar', { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  if (!admin || !q.data?.situacao) return null;
  const r = q.data;
  const s = r.situacao!;
  const pagante = s.situacao === 'ativa' || s.situacao === 'atrasada' || s.situacao === 'cancelada';
  const temLigacoes = !!r.contrato?.modulos.includes('ligacoes');
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
            {pagante && s.acessoAte
              ? ` · ${s.situacao === 'atrasada' ? 'venceu em' : 'pago até'} ${fmtData(s.acessoAte)}`
              : ''}
            {r.valor != null && pagante ? ` · ${fmtReais(r.valor)} por mês` : ''}
            {s.esperandoPagamento ? ' · cobrança esperando o pagamento' : ''}
          </p>
          {r.proximo && s.acessoAte && (
            <p className="quieto" style={{ margin: '4px 0 0', fontSize: 13 }}>
              A partir de {fmtData(s.acessoAte)}: {descricao(r.proximo)} ({fmtReais(r.proximo.valor)} por
              mês).
            </p>
          )}
        </div>
        <div className="assinatura-plano__botoes">
          {s.esperandoPagamento && (
            <Button variant="primary" onClick={() => navegar('/plano/pagar')}>
              Pagar
            </Button>
          )}
          <Button
            variant={s.esperandoPagamento ? 'secondary' : 'primary'}
            onClick={() => navegar('/plano/assinar')}
          >
            {pagante ? 'Mudar o plano' : 'Assinar'}
          </Button>
          {pagante && s.renovar && s.situacao !== 'atrasada' && (
            <Button variant="ghost" onClick={() => setConfirmar(true)}>
              Não renovar
            </Button>
          )}
          {s.situacao === 'cancelada' && (
            <Button variant="ghost" disabled={renovar.isPending} onClick={() => renovar.mutate()}>
              Voltar a renovar
            </Button>
          )}
          {!pagante && s.esperandoPagamento && (
            <Button variant="ghost" onClick={() => setConfirmar(true)}>
              Desistir
            </Button>
          )}
        </div>
      </div>
      {confirmar && (
        <div className="assinatura-plano__cancelar">
          <p style={{ margin: 0 }}>
            {pagante
              ? `Desligar a renovação? A mensalidade seguinte não é gerada e o plano vale até ${fmtData(s.acessoAte)}; depois, a conta fica só leitura (vocês continuam vendo e exportando tudo).`
              : 'Desistir da assinatura pedida? A cobrança em aberto é cancelada.'}
          </p>
          <ErroDaApi erro={cancelar.error} />
          <div className="assinatura-plano__botoes">
            <Button variant="ghost" onClick={() => setConfirmar(false)}>
              Manter
            </Button>
            <Button variant="danger" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>
              {cancelar.isPending ? 'Mandando…' : pagante ? 'Desligar a renovação' : 'Desistir'}
            </Button>
          </div>
        </div>
      )}
      {temLigacoes && pagante && (
        <div className="assinatura-plano__minutos">
          <div>
            <b>Minutos de ligação em pacote</b>
            <p className="quieto" style={{ margin: '2px 0 0', fontSize: 13 }}>
              {r.minutos.saldo
                ? `Sobram ${fmtNumero(r.minutos.saldo)} minutos de pacote (não vencem). Entram quando a franquia do mês acaba.`
                : `A franquia do mês acabou? Compre um pacote: entra na hora com Pix e o que sobrar não vence.`}
            </p>
          </div>
          <ComprarMinutos tabela={r.tabela} variante="secondary" />
        </div>
      )}
      {r.cobrancas.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <ListaCobrancas cobrancas={r.cobrancas} />
        </div>
      )}
    </section>
  );
}
