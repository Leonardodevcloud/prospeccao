import { fmtDuracaoLigacao } from '@prospeccao/shared/ligacoes';
import { Panel } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtNumero, fmtPct } from '../formatar';

/**
 * Ligações › Relatório: quantas ligações viraram conversa e reunião, quem ligou quanto e em que
 * dia e hora o lead mais atende (para montar as listas na hora certa).
 */

interface Relatorio {
  totais: {
    feitas: number;
    atendidas: number;
    conversas2min: number;
    conversas: number;
    reunioes: number;
    recebidas: number;
    perdidas: number;
    minutos: number;
  };
  porPessoa: {
    usuarioId: number;
    nome: string;
    feitas: number;
    atendidas: number;
    conversas: number;
    reunioes: number;
    segundos: number;
  }[];
  mapa: { dia: number; hora: number; feitas: number; atendidas: number }[];
  usados: number;
  franquia: number | null;
  excedente: number;
}

const DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const HORAS = Array.from({ length: 13 }, (_, i) => i + 8);

export function RelatorioLigacoes(props: { dias: string }) {
  const q = useQuery({
    queryKey: ['ligacoes-relatorio', props.dias],
    queryFn: () => api<Relatorio>(`/ligacoes/relatorio?dias=${props.dias}`),
  });
  if (q.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  if (!q.data) return <ErroDaApi erro={q.error} />;
  const r = q.data;
  const t = r.totais;
  const celula = new Map(r.mapa.map((m) => [`${m.dia}-${m.hora}`, m]));
  const dias = [1, 2, 3, 4, 5, 6, ...(r.mapa.some((m) => m.dia === 7) ? [7] : [])];
  // Melhor e pior hora (só com ligações suficientes para valer).
  const comBase = r.mapa.filter((m) => m.feitas >= 5).map((m) => ({ ...m, taxa: m.atendidas / m.feitas }));
  const melhor = comBase.length > 1 ? comBase.reduce((a, b) => (b.taxa > a.taxa ? b : a)) : null;
  const pior = comBase.length > 1 ? comBase.reduce((a, b) => (b.taxa < a.taxa ? b : a)) : null;
  const pctFranquia = r.franquia ? Math.min(100, Math.round((r.usados / r.franquia) * 100)) : null;

  return (
    <div className="rel-lig">
      <div className="lig-totais">
        <div>
          <small>Ligações feitas</small>
          <b>{fmtNumero(t.feitas)}</b>
        </div>
        <div>
          <small>Atendidas</small>
          <b>{fmtNumero(t.atendidas)}</b>
          <span>{fmtPct(t.atendidas, t.feitas)}</span>
        </div>
        <div>
          <small>Conversas</small>
          <b>{fmtNumero(t.conversas)}</b>
          <span>{fmtNumero(t.conversas2min)} com mais de 2 min</span>
        </div>
        <div>
          <small>Reuniões marcadas</small>
          <b>{fmtNumero(t.reunioes)}</b>
          <span>{fmtPct(t.reunioes, t.conversas)} das conversas</span>
        </div>
        <div>
          <small>Recebidas</small>
          <b>{fmtNumero(t.recebidas)}</b>
          <span>
            {fmtNumero(t.perdidas)} {t.perdidas === 1 ? 'perdida' : 'perdidas'}
          </span>
        </div>
      </div>

      {r.franquia != null && (
        <Panel titulo="Minutos do mês (empresa)">
          <div className="rel-lig__franquia">
            <div
              className="lista-lig__progresso"
              data-alerta={pctFranquia != null && pctFranquia >= 80 ? '' : undefined}
              role="progressbar"
              aria-valuenow={pctFranquia ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Minutos usados no mês"
            >
              <span style={{ width: `${pctFranquia ?? 0}%` }} />
            </div>
            <p>
              <b>{fmtNumero(r.usados)}</b> de {fmtNumero(r.franquia)} minutos usados
              {r.excedente > 0 ? ` · ${fmtNumero(r.excedente)} além da franquia (cobrados à parte)` : ''}.
            </p>
          </div>
          {r.excedente > 0 && (
            <Mensagem tipo="aviso">
              A franquia do mês acabou: as ligações continuam e o excedente vem na fatura.
            </Mensagem>
          )}
        </Panel>
      )}

      <div className="rel-lig__grade">
        <Panel titulo="Por pessoa" semPadding>
          <div className="pp-tablewrap">
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Quem</th>
                  <th className="num">Ligações</th>
                  <th className="num">Atendidas</th>
                  <th className="num">Conversas</th>
                  <th className="num">Reuniões</th>
                  <th className="num">Tempo falando</th>
                </tr>
              </thead>
              <tbody>
                {r.porPessoa.length ? (
                  r.porPessoa.map((p) => (
                    <tr key={p.usuarioId}>
                      <td>{p.nome}</td>
                      <td className="num mono">{fmtNumero(p.feitas)}</td>
                      <td className="num mono">
                        {fmtNumero(p.atendidas)}{' '}
                        <span className="quieto">({fmtPct(p.atendidas, p.feitas)})</span>
                      </td>
                      <td className="num mono">{fmtNumero(p.conversas)}</td>
                      <td className="num mono">{fmtNumero(p.reunioes)}</td>
                      <td className="num mono">{fmtDuracaoLigacao(p.segundos)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="quieto">
                      Nenhuma ligação no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel titulo="Quando o lead atende (% atendidas)">
          <div className="rel-lig__mapa-rolagem">
            <table className="rel-lig__mapa">
              <caption className="pp-sr">Taxa de atendimento por dia da semana e hora</caption>
              <thead>
                <tr>
                  <th>
                    <span className="pp-sr">Dia</span>
                  </th>
                  {HORAS.map((h) => (
                    <th key={h} scope="col">
                      {h}h
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dias.map((d) => (
                  <tr key={d}>
                    <th scope="row">{DIAS[d]}</th>
                    {HORAS.map((h) => {
                      const m = celula.get(`${d}-${h}`);
                      const forca = m ? 0.1 + (m.atendidas / m.feitas) * 0.85 : 0;
                      return (
                        <td
                          key={h}
                          style={
                            m
                              ? {
                                  background: `color-mix(in srgb, var(--brand) ${Math.round(forca * 100)}%, transparent)`,
                                }
                              : undefined
                          }
                          data-forte={forca > 0.55 || undefined}
                          title={
                            m
                              ? `${DIAS[d]} ${h}h: ${m.feitas} ${m.feitas === 1 ? 'ligação' : 'ligações'}, ${m.atendidas} atendidas`
                              : `${DIAS[d]} ${h}h: nenhuma ligação`
                          }
                        >
                          {m ? Math.round((m.atendidas / m.feitas) * 100) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {melhor && pior && melhor !== pior ? (
            <p className="rel-lig__dica">
              Melhor hora:{' '}
              <b>
                {DIAS[melhor.dia]} às {melhor.hora}h
              </b>{' '}
              ({fmtPct(melhor.atendidas, melhor.feitas)} atendem). Pior: {DIAS[pior.dia]} às {pior.hora}h (
              {fmtPct(pior.atendidas, pior.feitas)}).
            </p>
          ) : (
            <p className="rel-lig__dica quieto">
              Com mais ligações no período, aparece aqui a melhor hora para ligar.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
