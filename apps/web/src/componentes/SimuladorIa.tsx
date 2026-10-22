import { Badge, Button, Icon, Panel, Stat } from '@prospeccao/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { type AcaoAgente, api, type DesempenhoIa, type Simulacao } from '../api';
import { fmtCompromisso, fmtNumero } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

const ROTULO_ACAO: Record<AcaoAgente, string> = {
  responder: 'Respondeu',
  marcar_reuniao: 'Marcou reunião',
  agendar_retorno: 'Combinou retorno',
  passar_para_humano: 'Passou para o time',
  encerrar_sem_interesse: 'Encerrou: sem interesse',
  optout: 'Pediu para sair',
};

const ROTULO_REGRA_FIXA = {
  parar: 'Pediu para não receber mensagens: a IA para e o lead sai do funil (sem mensagem).',
  pediu_pessoa: 'Pediu para falar com uma pessoa: vai direto para o time, sem passar pela IA.',
  sensivel: 'Assunto sério (reclamação ou jurídico): vai direto para o time, sem passar pela IA.',
} as const;

const EXEMPLOS = [
  'Oi, quanto custa?',
  'Vocês atendem na minha cidade?',
  'Já tenho fornecedor.',
  'Agora não dá, me chama semana que vem.',
  'Prefiro falar com uma pessoa.',
];

interface Turno {
  de: 'lead' | 'nos' | 'sistema';
  texto: string;
  /** Bastidores da resposta da IA (só nas mensagens dela). */
  sim?: Simulacao;
}

/** O que aconteceu por trás de uma resposta: ação, trechos lidos, o que foi corrigido ou barrado. */
function Bastidores(props: { s: Simulacao }) {
  const { s } = props;
  const d = s.decisao;
  return (
    <details className="sim-bastidores">
      <summary>
        {s.regraFixa ? 'Regra fixa' : d ? ROTULO_ACAO[d.acao] : ''}
        {s.barrada?.length ? ' · barrada' : s.problemasIniciais?.length ? ' · corrigida' : ''}
        {s.trechos?.length ? ` · leu ${s.trechos.length} trecho${s.trechos.length > 1 ? 's' : ''}` : ''}
      </summary>
      <div className="sim-bastidores__corpo">
        {s.regraFixa && <p className="sim-bastidores__linha">{ROTULO_REGRA_FIXA[s.regraFixa.tipo]}</p>}
        {d && (
          <p className="sim-bastidores__linha">
            <b>Por quê:</b> {d.motivo || '—'}
            {d.reuniaoEm && <> · reunião em {fmtCompromisso(d.reuniaoEm)}</>}
            {d.retornoEm && <> · retoma em {fmtCompromisso(d.retornoEm)}</>}
          </p>
        )}
        {s.trechos && (
          <p className="sim-bastidores__linha">
            <b>Leu na base:</b>{' '}
            {s.trechos.length ? s.trechos.map((t) => t.titulo).join(' · ') : 'nada (só o resumo da empresa)'}
          </p>
        )}
        {d?.semResposta && (
          <p className="sim-bastidores__linha">
            <b>Não sabia:</b> “{d.semResposta}” (iria para “O que falta ensinar”)
          </p>
        )}
        {!!d?.memoria?.length && (
          <p className="sim-bastidores__linha">
            <b>Guardou sobre o lead:</b> {d.memoria.join(' · ')}
          </p>
        )}
        {!!s.problemasIniciais?.length && (
          <p className="sim-bastidores__linha">
            <b>1ª versão barrada:</b> “{s.primeiraResposta}”
            <br />
            <span className="quieto">{s.problemasIniciais.map((p) => p.detalhe).join(' ')}</span>
          </p>
        )}
        {!!s.barrada?.length && (
          <p className="sim-bastidores__linha">
            <b>A reescrita também não passou:</b> “{d?.resposta}”
            <br />
            <span className="quieto">{s.barrada.map((p) => p.detalhe).join(' ')}</span>
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Simulador: converse com a IA como se fosse um lead, pelo mesmo caminho do atendimento de verdade
 * (base, verificações, reescrita, regras fixas), sem WhatsApp e sem gravar nada.
 */
export function SimuladorIa() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [etapa, setEtapa] = useState<'abordado' | 'respondeu' | 'reuniao' | 'proposta'>('respondeu');
  const [memoria, setMemoria] = useState<string[]>([]);
  const simular = useMutation({
    mutationFn: (conversa: Turno[]) =>
      api<Simulacao>('/agente/simular', {
        metodo: 'POST',
        corpo: {
          etapa,
          memoria,
          conversa: conversa.filter((t) => t.de !== 'sistema').map((t) => ({ de: t.de, texto: t.texto })),
        },
      }),
    onSuccess: (s, conversa) => {
      const novos: Turno[] = [];
      if (s.regraFixa) {
        novos.push({ de: 'sistema', texto: ROTULO_REGRA_FIXA[s.regraFixa.tipo], sim: s });
        if (s.aviso) novos.push({ de: 'nos', texto: s.aviso });
      } else {
        const bolhas = s.bolhas ?? [];
        for (const [i, b] of bolhas.entries())
          novos.push({ de: 'nos', texto: b, sim: i === bolhas.length - 1 ? s : undefined });
        if (!bolhas.length) novos.push({ de: 'sistema', texto: 'A IA não mandaria mensagem.', sim: s });
        if (s.barrada?.length || s.decisao?.acao === 'passar_para_humano')
          novos.push({ de: 'sistema', texto: 'A IA passaria a conversa para o time (com resumo).' });
        if (s.aviso) novos.push({ de: 'nos', texto: s.aviso });
        if (s.decisao?.memoria?.length) setMemoria((m) => [...m, ...(s.decisao?.memoria ?? [])].slice(-15));
      }
      setTurnos([...conversa, ...novos]);
    },
  });
  const mandar = (t: string) => {
    if (!t.trim() || simular.isPending) return;
    const conversa: Turno[] = [...turnos, { de: 'lead', texto: t.trim() }];
    setTurnos(conversa);
    setTexto('');
    simular.mutate(conversa);
  };

  return (
    <Panel
      titulo="Simulador"
      acoes={
        <div className="barra">
          <label className="pp-sr" htmlFor="sim-etapa">
            Etapa do lead
          </label>
          <select
            id="sim-etapa"
            className="filtro"
            value={etapa}
            onChange={(e) => setEtapa(e.target.value as typeof etapa)}
          >
            <option value="abordado">Lead abordado</option>
            <option value="respondeu">Lead em conversa</option>
            <option value="reuniao">Reunião marcada</option>
            <option value="proposta">Proposta enviada</option>
          </select>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTurnos([]);
              setMemoria([]);
              simular.reset();
            }}
          >
            Recomeçar
          </Button>
        </div>
      }
    >
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Escreva como um lead escreveria e veja o que a IA responderia, com a configuração salva e a base de
        conhecimento de agora. Nada é enviado nem gravado. Abra os detalhes de cada resposta para ver o que
        ela leu e o que foi barrado.
      </p>
      <div className="sim-chat" aria-live="polite">
        {turnos.length === 0 && (
          <div className="sim-vazio">
            <Icon name="bot" size={20} />
            <span>Comece com uma pergunta de lead ou use um exemplo:</span>
            <div className="sim-exemplos">
              {EXEMPLOS.map((e) => (
                <button key={e} type="button" className="segmento" onClick={() => mandar(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {turnos.map((t, i) =>
          t.de === 'sistema' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: a conversa só cresce, na ordem
            <div key={i} className="sim-sistema">
              <span>{t.texto}</span>
              {t.sim && <Bastidores s={t.sim} />}
            </div>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: a conversa só cresce, na ordem
            <div key={i} className={`sim-bolha sim-bolha--${t.de}`}>
              <span className="sim-bolha__quem">{t.de === 'lead' ? 'Lead' : 'IA'}</span>
              <p className="sim-bolha__texto">{t.texto}</p>
              {t.sim && <Bastidores s={t.sim} />}
            </div>
          ),
        )}
        {simular.isPending && <div className="sim-bolha sim-bolha--nos sim-bolha--digitando">digitando…</div>}
      </div>
      <ErroDaApi erro={simular.error} />
      {memoria.length > 0 && (
        <span className="quieto" style={{ fontSize: 12 }}>
          <b>A IA já sabe deste lead:</b> {memoria.join(' · ')}
        </span>
      )}
      <form
        className="barra"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          mandar(texto);
        }}
      >
        <label className="pp-sr" htmlFor="sim-texto">
          Mensagem do lead
        </label>
        <input
          id="sim-texto"
          className="filtro"
          style={{ flex: '1 1 320px' }}
          placeholder="Escreva como o lead…"
          value={texto}
          maxLength={2000}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button type="submit" variant="primary" icon="send" disabled={simular.isPending || !texto.trim()}>
          Mandar como lead
        </Button>
      </form>
    </Panel>
  );
}

const ROTULO_PASSAGEM: Record<string, string> = {
  pediu_pessoa: 'Pediu para falar com uma pessoa',
  sensivel: 'Assunto sério (reclamação, jurídico)',
  limite: 'Limite de respostas do dia',
  sem_ia: 'IA não configurada',
  falha: 'A IA falhou',
  verificacao: 'Resposta barrada nas verificações',
  ia: 'A IA decidiu passar (fora da base, preço fechado…)',
};

function fmtTempo(seg: number | null): string {
  if (seg == null) return '—';
  if (seg < 90) return `${Math.round(seg)} s`;
  return `${Math.round(seg / 60)} min`;
}

/** Números da IA no período. */
export function DesempenhoAgente() {
  const [dias, setDias] = useState(30);
  const q = useQuery({
    queryKey: ['agente', 'desempenho', dias],
    queryFn: () => api<DesempenhoIa>(`/agente/desempenho?dias=${dias}`),
  });
  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const { numeros: n, passagensPorTipo, baseMaisUsada } = q.data;
  const maxPassagem = Math.max(1, ...passagensPorTipo.map((p) => p.n));

  return (
    <>
      <div className="barra" style={{ justifyContent: 'flex-end' }}>
        <label className="pp-sr" htmlFor="desemp-dias">
          Período
        </label>
        <select
          id="desemp-dias"
          className="filtro"
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
        >
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </div>
      <div className="kpis">
        <Stat rotulo="Leads atendidos pela IA" valor={fmtNumero(n.leadsAtendidos)} />
        <Stat rotulo="Mensagens da IA" valor={fmtNumero(n.respostas)} />
        <Stat rotulo="Reuniões marcadas" valor={fmtNumero(n.reunioes)} />
        <Stat rotulo="Tempo de resposta (mediana)" valor={fmtTempo(n.tempoRespostaSeg)} />
      </div>
      <div className="kpis">
        <Stat rotulo="Retornos combinados" valor={fmtNumero(n.retornos)} />
        <Stat rotulo="Passou para o time" valor={fmtNumero(n.passagens)} />
        <Stat rotulo="Corrigidas antes de sair" valor={fmtNumero(n.corrigidas)} />
        <Stat rotulo="Barradas (não saíram)" valor={fmtNumero(n.barradas)} />
      </div>
      <div className="desemp-colunas">
        <Panel titulo="Por que passou para o time" contagem={n.passagens}>
          {passagensPorTipo.length ? (
            <ul className="barras-h">
              {passagensPorTipo.map((p) => (
                <li key={p.tipo} className="barras-h__item">
                  <span>{ROTULO_PASSAGEM[p.tipo] ?? p.tipo}</span>
                  <span className="barras-h__barra" aria-hidden="true">
                    <span className="barras-h__cheio" style={{ width: `${(p.n / maxPassagem) * 100}%` }} />
                  </span>
                  <b>{fmtNumero(p.n)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              A IA não passou nenhum lead no período.
            </p>
          )}
        </Panel>
        <Panel titulo="Aprendizado">
          <ul className="lista-numeros">
            <li className="lista-numeros__item">
              <span>Perguntas que a IA não soube</span>
              <b>{fmtNumero(n.lacunas)}</b>
            </li>
            <li className="lista-numeros__item">
              <span>Ensinadas pela equipe</span>
              <b>{fmtNumero(n.ensinadas)}</b>
            </li>
            <li className="lista-numeros__item">
              <span>Aprendidas com as conversas (aprovadas)</span>
              <b>{fmtNumero(n.aprendidas)}</b>
            </li>
            <li className="lista-numeros__item">
              <span>Encerradas por falta de interesse</span>
              <b>{fmtNumero(n.semInteresse)}</b>
            </li>
          </ul>
          {baseMaisUsada.length > 0 && (
            <>
              <h3 className="rotulo-forte" style={{ margin: '12px 0 4px' }}>
                O que a IA mais consulta
              </h3>
              <ul className="lista-numeros">
                {baseMaisUsada.map((b) => (
                  <li key={b.id} className="lista-numeros__item">
                    <span>{b.pergunta || b.titulo}</span>
                    <Badge tone="outline">{fmtNumero(b.usos)}x</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
      {n.respostas === 0 && (
        <Mensagem tipo="aviso">
          A IA ainda não respondeu ninguém neste período. Use o Simulador para testar antes de ligar.
        </Mensagem>
      )}
    </>
  );
}
