import {
  fmtDuracaoLigacao,
  ROTULO_CLIMA,
  ROTULO_RESULTADO_LIGACAO,
  type TelefoneParaLigar,
} from '@prospeccao/shared/ligacoes';
import { fmtTempoReuniao } from '@prospeccao/shared/reunioes';
import { Badge, Button, Icon, Panel } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { useSoLeitura } from '../componentes/Sessao';
import { fmtQuando, formatarTelefone } from '../formatar';
import { telefone } from './ligacao';
import {
  type LigacaoDetalhe,
  type LigacaoResumida,
  type LigacoesDoLeadResposta,
  MOTIVO_INDISPONIVEL,
  useModuloLigacoes,
  useSituacaoTelefonia,
  useTelefone,
} from './tipos';

/**
 * Ligações na ficha do lead: os números na ordem em que o CRM tenta (de onde veio cada um e como
 * foi a última tentativa) e as ligações feitas, com a gravação, o resumo e a transcrição.
 */

const ROTULO_ORIGEM: Record<string, string> = {
  contato: 'pessoa da negociação',
  whatsapp: 'WhatsApp',
  enriquecimento: 'enriquecimento',
  google: 'Google',
  receita: 'Receita',
  manual: 'à mão',
};

export function useLigacoesDoLead(empresaId: number, ligado = true) {
  return useQuery({
    queryKey: ['ligacoes-lead', empresaId],
    queryFn: () => api<LigacoesDoLeadResposta>(`/ligacoes/lead/${empresaId}`),
    enabled: ligado,
    // Enquanto a IA resume a última ligação, a ficha acompanha.
    refetchInterval: (q) =>
      q.state.data?.ligacoes.some(
        (l) => l.processamento === 'aguardando' || l.processamento === 'processando',
      )
        ? 5_000
        : false,
  });
}

/** Botão "Ligar" do topo da ficha (o melhor número). */
export function BotaoLigar(props: { empresaId: number; nome: string }) {
  const modulo = useModuloLigacoes();
  const soLeitura = useSoLeitura();
  const q = useLigacoesDoLead(props.empresaId, modulo && !soLeitura);
  const e = useTelefone();
  if (!modulo || soLeitura) return null;
  const primeiro = q.data?.telefones.find((t) => t.ordem === 1);
  if (!primeiro || q.data?.naoLigar) return null;
  const ocupado = telefone.ocupado || e.aberto;
  return (
    <Button
      variant="primary"
      icon="phone"
      disabled={ocupado}
      title={`Ligar para ${formatarTelefone(primeiro.numero)}`}
      onClick={() =>
        void telefone.ligar({ telefone: primeiro.numero, empresaId: props.empresaId, lead: props.nome })
      }
    >
      Ligar
    </Button>
  );
}

function LinhaTelefone(props: { t: TelefoneParaLigar; empresaId: number; nome: string; podeLigar: boolean }) {
  const { t } = props;
  const origem = t.origens.length > 1 ? `${t.origens.length} fontes` : ROTULO_ORIGEM[t.origens[0] ?? ''];
  // "Cadastro da Receita · Receita": a origem só entra quando o nome não a repete.
  const detalhe = [
    t.tipo === 'celular' ? 'Celular' : 'Fixo',
    t.whatsapp && !/whatsapp/i.test(t.rotulo) ? 'WhatsApp' : null,
    t.rotulo,
    origem && !t.rotulo.toLowerCase().includes(origem.toLowerCase()) ? origem : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="lig-numero" data-primeiro={t.ordem === 1 || undefined} data-errado={t.errado || undefined}>
      <span className="lig-numero__ordem">{t.ordem ?? '–'}</span>
      <span className="lig-numero__texto">
        <span className="mono">{formatarTelefone(t.numero)}</span>
        <small>{detalhe}</small>
      </span>
      <span className="lig-numero__fim">
        {t.errado ? (
          <Badge tone="warning">número errado</Badge>
        ) : t.confirmado ? (
          <Badge tone="brand">confirmado</Badge>
        ) : t.ultimoResultado ? (
          <Badge tone="neutral">
            {ROTULO_RESULTADO_LIGACAO[t.ultimoResultado].toLowerCase()} {fmtQuando(t.ultimaEm)}
          </Badge>
        ) : null}
        {!t.errado && props.podeLigar && (
          <Button
            size="sm"
            variant={t.ordem === 1 ? 'primary' : 'secondary'}
            icon="phone"
            aria-label={`Ligar para ${formatarTelefone(t.numero)}`}
            onClick={() =>
              void telefone.ligar({ telefone: t.numero, empresaId: props.empresaId, lead: props.nome })
            }
          />
        )}
      </span>
    </li>
  );
}

export function LigacoesDoLead(props: { empresaId: number; nome: string }) {
  const modulo = useModuloLigacoes();
  const soLeitura = useSoLeitura();
  const q = useLigacoesDoLead(props.empresaId, modulo);
  const situacao = useSituacaoTelefonia(modulo && !soLeitura);
  const e = useTelefone();
  const [abertas, setAbertas] = useState<number | null>(null);
  const [todos, setTodos] = useState(false);
  if (!modulo) return null;
  if (q.isPending) return <div className="esqueleto" style={{ height: 120 }} />;
  if (!q.data) return <ErroDaApi erro={q.error} />;
  const d = q.data;
  const s = situacao.data;
  const podeLigar = !soLeitura && !!s?.disponivel && !d.naoLigar && !telefone.ocupado && !e.aberto;
  const visiveis = todos ? d.telefones : d.telefones.slice(0, 4);
  return (
    <Panel
      titulo="Ligações"
      contagem={d.ligacoes.length || undefined}
      acoes={
        <Button size="sm" variant="ghost" href={`/ligacoes?lead=${props.empresaId}`}>
          Ver todas
        </Button>
      }
    >
      <div className="pilha" style={{ gap: 12 }}>
        {d.naoLigar && (
          <p className="lig-nao-ligar">
            <Icon name="phone-off" size={14} /> Pediu para não receber ligações ({fmtQuando(d.naoLigar)}).
          </p>
        )}
        {s && !s.disponivel && s.motivo && !soLeitura && (
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            {MOTIVO_INDISPONIVEL[s.motivo]}
          </p>
        )}
        {d.telefones.length ? (
          <>
            <span className="ig-rotulo">Números · o CRM tenta nesta ordem</span>
            <ul className="lig-numeros">
              {visiveis.map((t) => (
                <LinhaTelefone
                  key={t.numero}
                  t={t}
                  empresaId={props.empresaId}
                  nome={props.nome}
                  podeLigar={podeLigar}
                />
              ))}
            </ul>
            {d.telefones.length > 4 && (
              <button type="button" className="link-botao" onClick={() => setTodos(!todos)}>
                {todos ? 'Mostrar menos' : `Ver mais ${d.telefones.length - 4} números`}
              </button>
            )}
          </>
        ) : (
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            Nenhum telefone neste lead ainda.
          </p>
        )}
        {d.ligacoes.length > 0 && (
          <>
            <span className="ig-rotulo">Ligações feitas</span>
            <ul className="lig-historico">
              {d.ligacoes.slice(0, 6).map((l) => (
                <li key={l.id}>
                  <ItemLigacao
                    l={l}
                    aberta={abertas === l.id}
                    aoAlternar={() => setAbertas(abertas === l.id ? null : l.id)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}

/** Linha de uma ligação (abre o cartão com gravação, resumo e transcrição). */
export function ItemLigacao(props: {
  l: LigacaoResumida;
  aberta: boolean;
  aoAlternar: () => void;
  comLead?: boolean;
}) {
  const { l } = props;
  const recebida = l.direcao === 'entrada';
  const resultado = l.resultado
    ? ROTULO_RESULTADO_LIGACAO[l.resultado]
    : l.perdida
      ? 'Perdida (ninguém atendeu)'
      : recebida && l.sigaMe
        ? 'Atendida no celular'
        : l.situacao === 'falhou'
          ? 'Não completou'
          : l.atendidaEm
            ? 'Atendida'
            : 'Sem resposta';
  return (
    <div className="lig-item" data-aberta={props.aberta || undefined}>
      <button
        type="button"
        className="lig-item__linha"
        aria-expanded={props.aberta}
        onClick={props.aoAlternar}
      >
        <Icon name={recebida ? 'phone-incoming' : 'phone'} size={14} />
        <span className="lig-item__texto">
          <b>
            {props.comLead && l.leadNome ? `${l.leadNome} · ` : ''}
            {resultado}
            {l.duracaoSegundos ? ` · ${fmtDuracaoLigacao(l.duracaoSegundos)}` : ''}
          </b>
          <small>
            {fmtQuando(l.iniciadaEm)} · {recebida ? 'recebida · ' : ''}
            {l.usuarioNome ?? (recebida ? 'ninguém atendeu' : 'Alguém do time')} ·{' '}
            <span className="mono">{formatarTelefone(l.telefone)}</span>
          </small>
        </span>
        {l.clima && (
          <Badge tone={l.clima === 'positivo' ? 'brand' : l.clima === 'negativo' ? 'danger' : 'neutral'}>
            {ROTULO_CLIMA[l.clima].replace('Clima ', '')}
          </Badge>
        )}
        {(l.processamento === 'aguardando' || l.processamento === 'processando') && (
          <Badge tone="neutral">resumindo…</Badge>
        )}
        <Icon name="chevron-down" size={14} />
      </button>
      {props.aberta && <CartaoLigacao id={l.id} />}
    </div>
  );
}

/** Gravação (com velocidade), resumo da IA e a transcrição com o tempo de cada fala. */
export function CartaoLigacao(props: { id: number }) {
  const q = useQuery({
    queryKey: ['ligacao', props.id],
    queryFn: () => api<LigacaoDetalhe>(`/ligacoes/${props.id}`),
  });
  const [tudo, setTudo] = useState(false);
  if (q.isPending) return <div className="esqueleto" style={{ height: 80 }} />;
  if (!q.data) return <ErroDaApi erro={q.error} />;
  const d = q.data;
  const r = d.resumoCompleto;
  const falas = tudo ? d.falas : d.falas.slice(0, 6);
  return (
    <div className="lig-cartao">
      {d.audio && (
        // biome-ignore lint/a11y/useMediaCaption: a transcrição da ligação está logo abaixo
        <audio controls preload="none" src={d.audio} className="lig-audio" />
      )}
      {r ? (
        <div className="lig-ia">
          <div className="lig-ia__titulo">
            <Icon name="sparkles" size={14} /> Resumo
            <Badge tone={r.clima === 'positivo' ? 'brand' : r.clima === 'negativo' ? 'danger' : 'neutral'}>
              {ROTULO_CLIMA[r.clima]}
            </Badge>
          </div>
          <p>{r.resumo}</p>
          {r.sentimento && <p className="quieto">{r.sentimento}</p>}
          {r.proximoPasso && (
            <p>
              <b>Próximo passo:</b> {r.proximoPasso}
            </p>
          )}
          {r.destaques.length > 0 && (
            <ul className="lig-destaques">
              {r.destaques.map((x) => (
                <li key={x.texto}>{x.texto}</li>
              ))}
            </ul>
          )}
        </div>
      ) : d.processamento === 'aguardando' || d.processamento === 'processando' ? (
        <p className="quieto">Transcrevendo e resumindo…</p>
      ) : null}
      {!d.audio &&
        !r &&
        !d.falas.length &&
        d.processamento !== 'aguardando' &&
        d.processamento !== 'processando' && (
          <p className="quieto lig-nota">
            {d.atendidaEm ? 'Ligação sem gravação.' : 'Ninguém atendeu: não há gravação nem resumo.'}
          </p>
        )}
      {d.nota && (
        <p className="lig-nota">
          <b>Nota:</b> {d.nota}
        </p>
      )}
      {d.falas.length > 0 && (
        <div className="lig-falas">
          <span className="ig-rotulo">Transcrição</span>
          {falas.map((f) => (
            <p key={`${f.inicioMs}-${f.quem}`} className="lig-fala" data-quem={f.quem}>
              <span className="mono">{fmtTempoReuniao(Math.floor(f.inicioMs / 1000))}</span>
              <b>{f.quem === 'voce' ? f.nome : 'Lead'}</b>
              <span>{f.texto}</span>
            </p>
          ))}
          {d.falas.length > 6 && (
            <button type="button" className="link-botao" onClick={() => setTudo(!tudo)}>
              {tudo ? 'Mostrar menos' : `Ver a transcrição inteira (${d.falas.length} falas)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
