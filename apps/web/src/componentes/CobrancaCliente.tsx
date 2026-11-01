import { ROTULO_ASSINATURA, type SituacaoAssinatura } from '@prospeccao/shared';
import { Badge, Button } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtData, fmtReais, formatarCnpj } from '../formatar';
import { type CobrancaDaConta, ListaCobrancas } from '../paginas/Assinar';
import { ErroDaApi, Mensagem } from './Formulario';

/**
 * Painel master › cliente › Plano e módulos: como o cliente paga. Contrato combinado à mão (paga
 * por fora), cobrado pelo sistema (todo mês sai uma cobrança no Asaas com o valor do plano daqui)
 * ou assinando sozinho (pelo site ou depois do teste).
 */

interface CobrancaDoCliente {
  disponivel: boolean;
  sandbox: boolean;
  modo: 'combinado' | 'teste' | 'sistema' | 'sozinho';
  situacao: SituacaoAssinatura | null;
  acessoAte: string | null;
  jaPagou: boolean;
  renovar: boolean;
  valor: number | null;
  mensalidade: number | null;
  dados: { documento: string | null; nome: string | null; email: string | null };
  cobrancas: CobrancaDaConta[];
}

const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const docNaTela = (d: string | null) => (d ? (d.length === 14 ? formatarCnpj(d) : d) : '');

export function CobrancaCliente(props: { contaId: number }) {
  const cliente = useQueryClient();
  const chave = ['master', 'cobranca', props.contaId];
  const q = useQuery({
    queryKey: chave,
    queryFn: () => api<CobrancaDoCliente>(`/master/contas/${props.contaId}/cobranca`),
  });
  const [aberto, setAberto] = useState(false);
  const [parar, setParar] = useState(false);
  const [f, setF] = useState({ documento: '', nome: '', email: '', vencimento: hojeSp() });
  useEffect(() => {
    if (!q.data) return;
    setF((x) => ({
      ...x,
      documento: docNaTela(q.data.dados.documento),
      nome: q.data.dados.nome ?? '',
      email: q.data.dados.email ?? '',
    }));
  }, [q.data]);
  const pronto = (r: CobrancaDoCliente) => {
    cliente.setQueryData(chave, r);
    setAberto(false);
    setParar(false);
  };
  const salvar = useMutation({
    mutationFn: () =>
      api<CobrancaDoCliente>(`/master/contas/${props.contaId}/cobranca`, { metodo: 'POST', corpo: f }),
    onSuccess: pronto,
  });
  const desligar = useMutation({
    mutationFn: () =>
      api<CobrancaDoCliente>(`/master/contas/${props.contaId}/cobranca`, { metodo: 'DELETE' }),
    onSuccess: pronto,
  });

  if (q.isPending) return <div className="esqueleto" />;
  if (!q.data) return <ErroDaApi erro={q.error} />;
  const c = q.data;
  const campo = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const completo =
    f.documento.replace(/\D/g, '').length >= 11 && f.nome.trim().length >= 2 && f.email.includes('@');

  return (
    <section className="pilha" style={{ gap: 12 }} aria-labelledby={`cobranca-${props.contaId}`}>
      <div className="assinatura-plano__topo">
        <div>
          <h3 id={`cobranca-${props.contaId}`} className="subtitulo" style={{ margin: 0 }}>
            Como o cliente paga
          </h3>
          <p className="quieto" style={{ margin: '4px 0 0', fontSize: 13 }}>
            {c.modo === 'teste'
              ? 'Veio pelo site e ainda não pagou. Para um plano combinado (ex.: personalizado), ajuste o plano e o valor acima, salve e use Cobrar pelo sistema: a primeira cobrança sai para ele pagar.'
              : c.modo === 'combinado'
                ? 'Contrato combinado à mão: o pagamento é por fora do sistema (nada é cobrado aqui).'
                : c.modo === 'sistema'
                  ? 'Cobrado pelo sistema: todo mês sai uma cobrança (Pix, boleto ou cartão) com o valor do plano acima.'
                  : 'Assina sozinho (pelo site ou depois do teste): o plano e as cobranças ficam com ele, em Meu plano.'}
          </p>
          {c.situacao && (
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              <Badge
                tone={
                  c.situacao === 'ativa'
                    ? 'brand'
                    : c.situacao === 'atrasada' || c.situacao === 'so_leitura'
                      ? 'danger'
                      : 'outline'
                }
              >
                {ROTULO_ASSINATURA[c.situacao]}
              </Badge>
              {c.acessoAte && (
                <span className="quieto">
                  {' '}
                  ·{' '}
                  {c.situacao === 'atrasada'
                    ? 'venceu em'
                    : c.modo === 'sistema' && !c.jaPagou
                      ? 'primeira mensalidade vence em'
                      : 'pago até'}{' '}
                  {fmtData(c.acessoAte)}
                </span>
              )}
              {c.valor != null && <span className="quieto"> · {fmtReais(c.valor)} por mês</span>}
            </p>
          )}
        </div>
        <div className="assinatura-plano__botoes">
          {(c.modo === 'combinado' || c.modo === 'teste') && !aberto && (
            <Button
              variant="secondary"
              disabled={!c.disponivel || !c.mensalidade}
              onClick={() => setAberto(true)}
            >
              Cobrar pelo sistema
            </Button>
          )}
          {c.modo === 'sistema' && !aberto && (
            <>
              <Button variant="secondary" onClick={() => setAberto(true)}>
                Dados da cobrança
              </Button>
              <Button variant="ghost" onClick={() => setParar(true)}>
                Parar de cobrar
              </Button>
            </>
          )}
        </div>
      </div>

      {!c.disponivel && c.modo !== 'sozinho' && (
        <Mensagem tipo="aviso">
          A cobrança pelo sistema ainda não foi ligada (falta a chave do Asaas no servidor).
        </Mensagem>
      )}
      {c.disponivel && c.sandbox && (
        <Mensagem tipo="aviso">
          Modo de teste do Asaas: as cobranças são de mentira (nada é cobrado).
        </Mensagem>
      )}
      {(c.modo === 'combinado' || c.modo === 'teste') && c.disponivel && !c.mensalidade && (
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Para cobrar pelo sistema, escolha um plano com mensalidade acima e salve.
        </p>
      )}

      {aberto && (
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="form__duas">
            <div className="campo">
              <label htmlFor={`cb-doc-${props.contaId}`}>CNPJ ou CPF de quem paga</label>
              <input
                id={`cb-doc-${props.contaId}`}
                className="filtro mono"
                inputMode="numeric"
                autoComplete="off"
                value={f.documento}
                onChange={campo('documento')}
              />
            </div>
            <div className="campo">
              <label htmlFor={`cb-nome-${props.contaId}`}>Razão social (ou nome)</label>
              <input
                id={`cb-nome-${props.contaId}`}
                className="filtro"
                value={f.nome}
                onChange={campo('nome')}
              />
            </div>
          </div>
          <div className="form__duas">
            <div className="campo">
              <label htmlFor={`cb-email-${props.contaId}`}>E-mail do financeiro</label>
              <input
                id={`cb-email-${props.contaId}`}
                className="filtro"
                type="email"
                value={f.email}
                onChange={campo('email')}
              />
              <span className="quieto" style={{ fontSize: 12 }}>
                O Asaas manda a cobrança e o recibo para este e-mail.
              </span>
            </div>
            {(c.modo === 'combinado' || c.modo === 'teste') && (
              <div className="campo">
                <label htmlFor={`cb-venc-${props.contaId}`}>Primeira mensalidade vence em</label>
                <input
                  id={`cb-venc-${props.contaId}`}
                  className="filtro mono"
                  type="date"
                  min={hojeSp()}
                  value={f.vencimento}
                  onChange={campo('vencimento')}
                />
                <span className="quieto" style={{ fontSize: 12 }}>
                  A cobrança sai 7 dias antes. Até vencer, a conta segue normal.
                </span>
              </div>
            )}
          </div>
          {(c.modo === 'combinado' || c.modo === 'teste') && c.mensalidade != null && (
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              Todo mês sai uma cobrança de {fmtReais(c.mensalidade)} (o valor do plano acima; mudou o plano, a
              próxima cobrança acompanha). Pagou, vale um mês. Venceu sem pagar: mais 3 dias normais e depois
              a conta fica só leitura até o pagamento cair.
            </p>
          )}
          <ErroDaApi erro={salvar.error} />
          <div className="acoes">
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="primary" disabled={!completo || salvar.isPending}>
              {salvar.isPending
                ? 'Salvando…'
                : c.modo === 'combinado' || c.modo === 'teste'
                  ? 'Começar a cobrar'
                  : 'Salvar os dados'}
            </Button>
          </div>
        </form>
      )}

      {parar && (
        <div className="assinatura-plano__cancelar">
          <p style={{ margin: 0 }}>
            Parar de cobrar pelo sistema? As cobranças em aberto são canceladas e o cliente volta a ser
            contrato combinado à mão (sem vencimento nem só leitura).
          </p>
          <ErroDaApi erro={desligar.error} />
          <div className="assinatura-plano__botoes">
            <Button variant="ghost" onClick={() => setParar(false)}>
              Continuar cobrando
            </Button>
            <Button variant="danger" disabled={desligar.isPending} onClick={() => desligar.mutate()}>
              {desligar.isPending ? 'Parando…' : 'Parar de cobrar'}
            </Button>
          </div>
        </div>
      )}

      {c.cobrancas.length > 0 && <ListaCobrancas cobrancas={c.cobrancas} master />}
    </section>
  );
}
