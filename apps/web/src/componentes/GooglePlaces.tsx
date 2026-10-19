import { Badge, Button, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, type Campanha, type ConfigPlaces, type EstimativaPlaces, type UsoPlaces } from '../api';
import { fmtBrl, fmtDiaMes, fmtNomeMes, fmtNumero, fmtUsd } from '../formatar';
import { ErroDaApi } from './Formulario';

/**
 * Google Places na prospecção: o Google não informa a franquia restante por API, então os
 * números vêm da conta que o sistema faz de cada busca (cada página de 20 lugares = 1 busca).
 */

const SITUACAO: Record<UsoPlaces['situacao'], { rotulo: string; tom: 'brand' | 'warning' | 'danger' }> = {
  gratis: { rotulo: 'dentro do grátis', tom: 'brand' },
  vai_cobrar: { rotulo: 'vai passar do grátis', tom: 'warning' },
  cobrando: { rotulo: 'cobrando', tom: 'danger' },
};

/** Barra em duas cores: grátis usado (verde) e pago (vermelho). */
function BarraFranquia({ usados, franquia }: { usados: number; franquia: number }) {
  const total = Math.max(usados, franquia, 1);
  const gratis = Math.min(usados, franquia);
  const pagos = Math.max(0, usados - franquia);
  return (
    <div
      className="barra-franquia"
      role="progressbar"
      aria-label="Franquia grátis do Google usada"
      aria-valuemin={0}
      aria-valuemax={franquia}
      aria-valuenow={usados}
    >
      <span className="barra-franquia__gratis" style={{ width: `${(gratis / total) * 100}%` }} />
      {pagos > 0 && <span className="barra-franquia__paga" style={{ width: `${(pagos / total) * 100}%` }} />}
    </div>
  );
}

function FormConfig({ uso, aoFechar }: { uso: UsoPlaces; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    franquiaMensal: String(uso.franquia),
    precoMilUsd: String(uso.precoMilUsd).replace('.', ','),
    cotacaoBrl: String(uso.cotacaoBrl).replace('.', ','),
    tetoMensalUsd: uso.tetoMensalUsd == null ? '' : String(uso.tetoMensalUsd).replace('.', ','),
    maxBairros: String(uso.maxBairros),
  });
  const mudar = (campo: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [campo]: e.target.value });
  const num = (v: string) => (v.trim() === '' ? '' : v.replace(/\./g, '').replace(',', '.'));
  const salvar = useMutation({
    mutationFn: () =>
      api<ConfigPlaces>('/places/config', {
        metodo: 'PUT',
        corpo: {
          franquiaMensal: num(f.franquiaMensal),
          precoMilUsd: num(f.precoMilUsd),
          cotacaoBrl: num(f.cotacaoBrl),
          tetoMensalUsd: num(f.tetoMensalUsd),
          maxBairros: num(f.maxBairros),
        },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['places-uso'] });
      aoFechar();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  return (
    <form className="confirmar form" onSubmit={enviar} noValidate style={{ marginTop: 12 }}>
      <span>
        Tabela do Google (Text Search Enterprise, out/2026: 1.000 grátis por mês e US$ 35 por mil depois).
        Mude aqui se o Google mudar os preços.
      </span>
      <div className="form__duas">
        <TextField
          rotulo="Buscas grátis por mês"
          inputMode="numeric"
          value={f.franquiaMensal}
          onChange={mudar('franquiaMensal')}
        />
        <TextField
          rotulo="US$ por mil buscas"
          inputMode="decimal"
          value={f.precoMilUsd}
          onChange={mudar('precoMilUsd')}
        />
        <TextField
          rotulo="Cotação (R$ por US$)"
          inputMode="decimal"
          value={f.cotacaoBrl}
          onChange={mudar('cotacaoBrl')}
        />
        <TextField
          rotulo="Teto do mês (US$)"
          inputMode="decimal"
          value={f.tetoMensalUsd}
          onChange={mudar('tetoMensalUsd')}
          placeholder="sem teto"
          dica="Ao bater, todas as buscas pagas param até o mês virar. 0 = nunca pagar."
        />
        <TextField
          rotulo="Máximo de bairros por cidade"
          inputMode="numeric"
          value={f.maxBairros}
          onChange={mudar('maxBairros')}
          dica="Quando a busca da cidade inteira enche (60 lugares), ela é dividida por bairro."
        />
      </div>
      <ErroDaApi erro={salvar.error} />
      <div className="acoes">
        <Button size="sm" variant="primary" type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Painel do mês no topo de Campanhas: franquia usada, gasto, ritmo e projeção. */
export function PainelPlaces() {
  const [configurando, setConfigurando] = useState(false);
  const uso = useQuery({
    queryKey: ['places-uso'],
    queryFn: () => api<UsoPlaces>('/places/uso'),
    refetchInterval: 60_000,
  });
  if (uso.error) return <ErroDaApi erro={uso.error} />;
  const u = uso.data;
  if (!u) return <div className="esqueleto" style={{ height: 150, marginBottom: 16 }} />;

  const s = SITUACAO[u.situacao];
  const cobrando = u.situacao === 'cobrando';
  return (
    <section className="painel-places" aria-label="Uso do Google Places">
      <div className="painel-places__topo">
        <div>
          <b>Google Places · {fmtNomeMes(u.mes)}</b>
          <p className="quieto">
            renova em {fmtDiaMes(u.renovaEm)} · {u.diasRestantes} {u.diasRestantes === 1 ? 'dia' : 'dias'}
          </p>
        </div>
        <div className="painel-places__acoes">
          <Badge tone={s.tom}>{s.rotulo}</Badge>
          <Button size="sm" variant="ghost" onClick={() => setConfigurando((v) => !v)}>
            Preços e teto
          </Button>
        </div>
      </div>

      <div className="painel-places__bloco">
        <div className="painel-places__linha">
          <b>Buscas com telefone e site</b>
          <span className="mono">
            <b>{fmtNumero(u.usados)}</b> / {fmtNumero(u.franquia)} grátis
          </span>
        </div>
        <BarraFranquia usados={u.usados} franquia={u.franquia} />
        <p className="quieto">
          {cobrando ? (
            <>
              <b className="mono">{fmtNumero(u.pagos)}</b> buscas pagas este mês
            </>
          ) : (
            <>
              Restam <b className="mono">{fmtNumero(u.gratisRestantes)}</b> buscas grátis · cada busca traz
              até 20 empresas
            </>
          )}
        </p>
      </div>

      <div className="painel-places__kpis">
        <div>
          <small>Gasto no mês</small>
          <b className="mono" style={cobrando ? { color: 'var(--danger)' } : undefined}>
            {fmtUsd(u.gastoUsd)}
          </b>
        </div>
        <div>
          <small>{cobrando ? 'Custo por busca' : 'Ritmo atual'}</small>
          <b className="mono">
            {cobrando ? fmtUsd(u.precoPorPedidoUsd, true) : `${fmtNumero(u.ritmoDia)}/dia`}
          </b>
        </div>
        <div>
          <small>Projeção fim do mês</small>
          <b className="mono">{fmtUsd(u.projecaoUsd)}</b>
        </div>
      </div>

      {cobrando ? (
        <div className="alerta-places alerta-places--erro">
          <b>Você já passou da franquia grátis.</b>A partir de agora, cada busca custa{' '}
          {fmtUsd(u.precoPorPedidoUsd, true)} ({fmtUsd(u.precoMilUsd)} por mil). No ritmo atual (
          {fmtNumero(u.ritmoDia)} buscas/dia), o mês fecha em cerca de <b>{fmtUsd(u.projecaoUsd)}</b> (≈{' '}
          {fmtBrl(u.projecaoUsd * u.cotacaoBrl)}).
          {u.tetoMensalUsd != null && ` Teto do mês: ${fmtUsd(u.tetoMensalUsd)}.`}
        </div>
      ) : u.situacao === 'vai_cobrar' ? (
        <div className="alerta-places alerta-places--aviso">
          <b>No ritmo atual, a franquia acaba em {fmtDiaMes(u.franquiaAcabaEm)}.</b>
          Depois disso, cada busca custa {fmtUsd(u.precoPorPedidoUsd, true)}. Projeção do mês:{' '}
          <b>{fmtUsd(u.projecaoUsd)}</b> (≈ {fmtBrl(u.projecaoUsd * u.cotacaoBrl)}).
          {u.tetoMensalUsd != null && ` Teto do mês: ${fmtUsd(u.tetoMensalUsd)}.`}
        </div>
      ) : (
        <p className="quieto painel-places__nota">
          {u.usados === 0
            ? 'Nenhuma busca no Google este mês ainda.'
            : 'No ritmo atual, a franquia dura o mês todo: não deve haver custo este mês.'}
          {u.tetoMensalUsd != null && ` Teto do mês: ${fmtUsd(u.tetoMensalUsd)}.`}
        </p>
      )}

      {configurando && <FormConfig uso={u} aoFechar={() => setConfigurando(false)} />}
    </section>
  );
}

/** "12,5" → 12.5; vazio → null (sem teto). */
function lerTeto(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Antes de rodar (iniciar, retomar ou tentar de novo): quantas buscas no Google a campanha vai
 * gastar, quanto cabe no grátis e quanto custa o resto. O usuário escolhe rodar assim mesmo
 * (com ou sem teto), só o grátis, ou cancelar.
 */
export function EstimativaBusca(props: {
  c: Campanha;
  ocupado: boolean;
  /** teto: undefined = não mexe; null = sem teto; 0 = só o grátis. */
  aoRodar: (tetoPlacesUsd: number | null) => void;
  aoCancelar: () => void;
}) {
  const { c } = props;
  const est = useQuery({
    queryKey: ['estimativa-places', c.id],
    queryFn: () => api<EstimativaPlaces>(`/campanhas/${c.id}/estimativa-places`),
  });
  const tetoAtual = c.tetoPlacesUsd ?? null;
  const [teto, setTeto] = useState(tetoAtual && tetoAtual > 0 ? String(tetoAtual).replace('.', ',') : '');
  const e = est.data;
  const tetoNum = lerTeto(teto);

  return (
    <div className="confirmar estimativa-places">
      <div>
        <b style={{ fontSize: 14 }}>Buscar no Google Maps</b>
        <p className="quieto" style={{ margin: 0 }}>
          {c.nichoNome} · {c.cidades.map((x) => `${x.cidade}/${x.uf}`).join(', ')}
        </p>
      </div>
      <ErroDaApi erro={est.error} />
      {!e ? (
        !est.error && <div className="esqueleto" style={{ height: 90 }} />
      ) : (
        <>
          <table className="tabela-estimativa">
            <thead>
              <tr>
                <th>Estimativa</th>
                <th className="num">Buscas</th>
              </tr>
            </thead>
            <tbody>
              {e.divideBairro &&
                e.cidades.map((x) => (
                  <tr key={`${x.cidade}-${x.uf}`}>
                    <td>Bairros de {x.cidade} com o nicho</td>
                    <td className="num mono">{fmtNumero(x.bairros)}</td>
                  </tr>
                ))}
              {e.termos > 1 && (
                <tr>
                  <td>Termos do nicho</td>
                  <td className="num mono">× {e.termos}</td>
                </tr>
              )}
              <tr>
                <td>Páginas por busca (até {e.paginasPorBusca})</td>
                <td className="num mono">
                  × ~{e.divideBairro ? fmtNumero(e.mediaPaginasBairro) : e.paginasPorBusca}
                </td>
              </tr>
              <tr>
                <td>
                  <b>Total estimado</b>
                </td>
                <td className="num mono">
                  <b>{e.pedidosMax === 0 ? '0' : `até ~${fmtNumero(e.pedidosMax)}`}</b>
                </td>
              </tr>
            </tbody>
          </table>
          {e.divideBairro && e.pedidosMax > e.pedidosMin && (
            <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
              Os bairros só são buscados se a busca da cidade inteira encher (60 lugares). Cidade pequena
              gasta bem menos: a partir de ~{fmtNumero(e.pedidosMin)}.
            </p>
          )}

          {e.pedidosMax === 0 ? (
            <div className="alerta-places alerta-places--aviso">
              <b>Nada novo para buscar.</b>As buscas desta campanha rodaram nos últimos 30 dias; só a base de
              CNPJ será conferida de novo.
            </div>
          ) : e.pagos === 0 ? (
            <div className="alerta-places alerta-places--ok">
              <b>Cabe na franquia grátis.</b>Restam {fmtNumero(e.gratisRestantes)} buscas grátis este mês;
              depois desta campanha, sobram ~{fmtNumero(e.sobraGratisDepois)}. Custo estimado:{' '}
              <b>{fmtUsd(0)}</b>.
            </div>
          ) : (
            <div className="alerta-places alerta-places--erro">
              <b>
                {e.gratisRestantes === 0
                  ? 'A franquia grátis do mês já acabou.'
                  : 'Esta campanha passa da franquia.'}
              </b>
              {e.gratisRestantes > 0 && `${fmtNumero(e.gratis)} grátis e `}~{fmtNumero(e.pagos)} buscas pagas
              × {fmtUsd(e.precoPorPedidoUsd, true)} = <b>~{fmtUsd(e.custoUsd)}</b> (≈ {fmtBrl(e.custoBrl)}).
              Você pode rodar assim mesmo, limitar ao grátis ou deixar para {fmtDiaMes(e.renovaEm)}, quando a
              franquia renova.
            </div>
          )}

          <TextField
            rotulo="Teto desta campanha (US$)"
            inputMode="decimal"
            value={teto}
            onChange={(ev) => setTeto(ev.target.value)}
            placeholder="sem teto"
            dica={`Se as buscas pagas chegarem ao teto, a busca no Google para sozinha e avisa. Já gasto: ${fmtUsd(e.gastoCampanhaUsd)}.`}
          />
          {tetoNum != null && tetoNum > 0 && e.custoUsd > tetoNum - e.gastoCampanhaUsd && (
            <p className="aviso-texto" style={{ margin: 0 }}>
              Com este teto, a busca para em {fmtUsd(tetoNum)} de gasto (antes de terminar).
            </p>
          )}
          {e.tetoMensalUsd != null && e.pagos > 0 && (
            <p className="quieto" style={{ margin: 0, fontSize: 12 }}>
              Teto do mês (todas as campanhas): {fmtUsd(e.tetoMensalUsd)} · já gasto {fmtUsd(e.gastoMesUsd)}.
            </p>
          )}
        </>
      )}

      <div className="acoes">
        <Button
          size="sm"
          variant="primary"
          icon="send"
          disabled={props.ocupado || !e}
          onClick={() => props.aoRodar(tetoNum)}
        >
          {props.ocupado
            ? 'Iniciando…'
            : e && e.pagos > 0 && (tetoNum == null || tetoNum > 0)
              ? `Rodar (~${fmtUsd(tetoNum != null ? Math.min(e.custoUsd, Math.max(0, tetoNum - e.gastoCampanhaUsd)) : e.custoUsd)})`
              : 'Rodar busca'}
        </Button>
        {e && e.pagos > 0 && (
          <Button size="sm" disabled={props.ocupado} onClick={() => props.aoRodar(0)}>
            Só o grátis
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={props.aoCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Linha do card: buscas usadas no Google, gasto e teto da campanha. */
export function ResumoPlacesCampanha({ c }: { c: Campanha }) {
  const p = c.progresso;
  const pedidos = p.pedidosPlaces ?? 0;
  const teto = c.tetoPlacesUsd ?? null;
  const rotuloTeto = teto == null ? 'sem teto' : teto === 0 ? 'só a franquia grátis' : `teto ${fmtUsd(teto)}`;
  const porBairro = p.buscasPorBairro ?? 0;
  if (!pedidos && teto == null) return null;
  return (
    <p className="quieto">
      {porBairro > 0 && `${fmtNumero(porBairro)} por bairro · `}
      {fmtNumero(pedidos)} {pedidos === 1 ? 'página usada' : 'páginas usadas'} no Google ·{' '}
      <b className="mono">{fmtUsd(p.gastoPlacesUsd ?? 0)}</b>
      {(p.pagosPlaces ?? 0) === 0 && pedidos > 0 ? ' (franquia)' : ''} · {rotuloTeto}
    </p>
  );
}
