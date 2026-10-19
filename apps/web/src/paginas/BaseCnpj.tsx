import { Badge, Button, Panel, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type Importacao } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtDuracao, fmtHora, fmtHoraCompleta, fmtMes, fmtNumero } from '../formatar';
import { useAtividade } from './Atividade';

const STATUS: Record<
  Importacao['status'],
  { rotulo: string; tom: 'brand' | 'warning' | 'danger' | 'neutral' }
> = {
  na_fila: { rotulo: 'Na fila', tom: 'neutral' },
  rodando: { rotulo: 'Importando', tom: 'warning' },
  concluida: { rotulo: 'Concluída', tom: 'brand' },
  erro: { rotulo: 'Falhou', tom: 'danger' },
};

/** Depois de pedir, a tela consulta rápido até o worker assumir (alguns segundos). */
const ESPERA_PEDIDO_MS = 3 * 60_000;

const emAndamento = (i: Importacao | undefined) => i?.status === 'rodando' || i?.status === 'na_fila';

function Momento({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="quieto">—</span>;
  return (
    <time dateTime={iso} title={fmtHoraCompleta(iso)}>
      {fmtHora(iso)}
    </time>
  );
}

/** Importação em andamento, em destaque: etapa legível + contadores que sobem durante a leitura. */
/** Tabelas de apoio (3) + estabelecimentos, empresas e sócios (10 cada). */
const TOTAL_ARQUIVOS = 33;

function Andamento({ i, agora }: { i: Importacao & { iniciadoEm?: string | null }; agora: number }) {
  const inicio = i.iniciadoEm ?? i.criadoEm;
  return (
    <div className="andamento" aria-live="polite">
      <div className="linha-status">
        <Badge tone="warning">
          <span className="vivo" aria-hidden="true" /> {i.status === 'na_fila' ? 'Na fila' : 'Importando'}
        </Badge>
        <b>{i.etapa ?? 'Aguardando o worker começar'}</b>
      </div>
      <div className="andamento__numeros">
        <div>
          <b className="mono">{fmtNumero(i.estabelecimentos)}</b>
          <span>estabelecimentos encontrados</span>
        </div>
        <div>
          <b className="mono">{fmtNumero(i.socios)}</b>
          <span>sócios</span>
        </div>
        <div>
          <b className="mono">{fmtNumero(i.linhasLidas)}</b>
          <span>linhas lidas da Receita</span>
        </div>
        <div>
          <b className="mono">
            {i.arquivosProntos ?? 0} de {TOTAL_ARQUIVOS}
          </b>
          <span>arquivos prontos</span>
        </div>
        <div>
          <b className="mono">{fmtDuracao(agora - new Date(inicio).getTime())}</b>
          <span>
            desde <Momento iso={inicio} />
          </span>
        </div>
      </div>
      <p className="quieto" style={{ margin: 0, fontSize: 12, lineHeight: '16px' }}>
        A Receita publica o Brasil inteiro em 33 arquivos (os grandes com centenas de MB cada). O motor baixa
        e lê um por vez, guardando só as empresas dos estados das suas campanhas e dos CNAEs dos seus nichos.
        O servidor da Receita costuma ser lento, então pode levar algumas horas. Se o serviço reiniciar, a
        importação continua do último arquivo pronto.
      </p>
    </div>
  );
}

export function BaseCnpj() {
  const cliente = useQueryClient();
  const [mes, setMes] = useState('');
  const [pedidoEm, setPedidoEm] = useState<number | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const agendada = useAtividade(15_000).data?.importacaoAgendada;

  const importacoes = useQuery({
    queryKey: ['importacoes'],
    queryFn: () => api<(Importacao & { iniciadoEm: string | null })[]>('/importacoes'),
    refetchInterval: (q) => {
      const recente = pedidoEm != null && Date.now() - pedidoEm < ESPERA_PEDIDO_MS;
      return emAndamento(q.state.data?.[0]) || recente || agendada ? 3_000 : 30_000;
    },
  });
  const ultima = importacoes.data?.[0];

  // Relógio da tela: o "há quanto tempo" anda mesmo entre uma consulta e outra.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const importar = useMutation({
    mutationFn: () =>
      api<{ mensagem: string }>('/importacoes/cnpj', { metodo: 'POST', corpo: mes ? { mes } : {} }),
    onSuccess: () => {
      setPedidoEm(Date.now());
      cliente.invalidateQueries({ queryKey: ['importacoes'] });
      cliente.invalidateQueries({ queryKey: ['atividade'] });
    },
  });

  // Pedido feito, mas o worker ainda não criou o registro: mostra a linha na hora.
  const aguardandoWorker =
    pedidoEm != null &&
    Date.now() - pedidoEm < ESPERA_PEDIDO_MS &&
    !(ultima && new Date(ultima.criadoEm).getTime() >= pedidoEm - 10_000);
  const ocupada = emAndamento(ultima) || aguardandoWorker;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Base CNPJ</h1>
          <p>
            Cópia dos dados abertos da Receita com as empresas dos seus nichos. Atualiza sozinha todo mês;
            importe agora depois de criar um nicho ou uma campanha num estado novo.
          </p>
        </div>
      </div>

      <Panel
        titulo="Importação"
        acoes={
          <Button
            size="sm"
            icon="loader"
            disabled={importar.isPending || ocupada}
            onClick={() => importar.mutate()}
          >
            {ocupada ? 'Importando…' : 'Importar agora'}
          </Button>
        }
      >
        <div className="pilha">
          {aguardandoWorker && !emAndamento(ultima) && (
            <Andamento
              i={{
                id: 0,
                mes: mes || 'auto',
                status: 'na_fila',
                motivo: 'manual',
                ufs: [],
                cnaes: [],
                etapa: 'Pedido enviado · aguardando o worker começar',
                linhasLidas: 0,
                estabelecimentos: 0,
                empresas: 0,
                socios: 0,
                erro: null,
                criadoEm: new Date(pedidoEm).toISOString(),
                concluidoEm: null,
              }}
              agora={agora}
            />
          )}
          {ultima && emAndamento(ultima) && <Andamento i={ultima} agora={agora} />}

          {ultima?.status === 'erro' && !aguardandoWorker && (
            <Mensagem tipo="erro">A última importação falhou: {ultima.erro}</Mensagem>
          )}
          {agendada?.estado === 'nova_tentativa' && (
            <Mensagem tipo="aviso">
              Continua sozinha {fmtHora(agendada.quando)}, de onde parou
              {ultima?.arquivosProntos
                ? ` (${ultima.arquivosProntos} de ${TOTAL_ARQUIVOS} arquivos já prontos)`
                : ''}{' '}
              · tentativa {agendada.falhas + 1} de {agendada.limiteTentativas + 1}. Não precisa clicar de
              novo.
            </Mensagem>
          )}
          <ErroDaApi erro={importar.error ?? importacoes.error} />

          <details className="opcoes">
            <summary>Importar uma publicação específica</summary>
            <div style={{ maxWidth: 260, paddingTop: 8 }}>
              <TextField
                rotulo="Mês da publicação"
                placeholder="Ex.: 2026-09"
                value={mes}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMes(e.target.value)}
                dica="Vazio usa a publicação mais recente."
              />
            </div>
          </details>
        </div>
      </Panel>

      <Panel titulo="Histórico" contagem={importacoes.data?.length} semPadding>
        {importacoes.data?.length ? (
          <div className="pp-tablewrap">
            <table className="pp-table tabela-cartoes">
              <thead>
                <tr>
                  <th>Publicação</th>
                  <th>Situação</th>
                  <th>Estados</th>
                  <th className="num">Estabelecimentos</th>
                  <th className="num">Sócios</th>
                  <th>Início</th>
                  <th>Duração</th>
                </tr>
              </thead>
              <tbody>
                {importacoes.data.map((i) => {
                  const fim = i.concluidoEm
                    ? new Date(i.concluidoEm).getTime()
                    : emAndamento(i)
                      ? agora
                      : null;
                  const inicio = i.iniciadoEm ?? i.criadoEm;
                  return (
                    <tr key={i.id} style={{ cursor: 'default' }}>
                      <td data-rotulo="Publicação">
                        <div>{fmtMes(i.mes)}</div>
                      </td>
                      <td data-rotulo="Situação" title={i.erro ?? undefined}>
                        <div>
                          <Badge tone={STATUS[i.status].tom}>{STATUS[i.status].rotulo}</Badge>
                        </div>
                      </td>
                      <td data-rotulo="Estados" className="mono">
                        <div>{i.ufs.join(', ') || '—'}</div>
                      </td>
                      <td data-rotulo="Estabelecimentos" className="mono num">
                        <div>{fmtNumero(i.estabelecimentos)}</div>
                      </td>
                      <td data-rotulo="Sócios" className="mono num">
                        <div>{fmtNumero(i.socios)}</div>
                      </td>
                      <td data-rotulo="Início">
                        <div>
                          <Momento iso={inicio} />
                        </div>
                      </td>
                      <td data-rotulo="Duração" className="quieto">
                        <div>{fim ? fmtDuracao(fim - new Date(inicio).getTime()) : '—'}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0, padding: 16, fontSize: 14 }}>
            Nenhuma importação ainda. Antes de importar, cadastre um <Link to="/nichos">nicho</Link> com os
            CNAEs e uma <Link to="/campanhas">campanha</Link> com as cidades.
          </p>
        )}
      </Panel>
    </>
  );
}
