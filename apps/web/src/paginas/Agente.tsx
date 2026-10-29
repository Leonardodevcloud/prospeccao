import { Badge, Button, Panel, Stat } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, type ConfigAgente, type RascunhoAgente, ROTULO_ETAPA, type TelaAgente } from '../api';
import { Aprendizados, BaseConhecimento, useConhecimento } from '../componentes/BaseConhecimento';
import { Chips } from '../componentes/Chips';
import { ConfiguracaoIa, usePerfilIa } from '../componentes/ConfiguracaoIa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { ResumoPassagem } from '../componentes/ResumoPassagem';
import { useSessao } from '../componentes/Sessao';
import { DesempenhoAgente, SimuladorIa } from '../componentes/SimuladorIa';
import { fmtCidade, fmtHora, fmtNome, fmtNumero, formatarTelefone } from '../formatar';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Contagem leve para o menu: mensagens para revisar + leads que a IA passou para você. */
export function useAgentePendente() {
  return useQuery({
    queryKey: ['agente'],
    queryFn: () => api<TelaAgente>('/agente'),
    refetchInterval: 60_000,
    select: (d) => d.resumo.rascunhos + d.resumo.pausados,
  });
}

function Rascunho(props: { r: RascunhoAgente; aoAbrir: () => void }) {
  const { r } = props;
  const cliente = useQueryClient();
  const [texto, setTexto] = useState(r.texto);
  const acao = useMutation({
    mutationFn: (tipo: 'aprovar' | 'descartar') =>
      api(`/agente/rascunhos/${r.id}/${tipo}`, {
        metodo: 'POST',
        corpo: tipo === 'aprovar' && texto !== r.texto ? { texto } : {},
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['agente'] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
    },
  });
  return (
    <article className="rascunho">
      <header className="rascunho__topo">
        <button type="button" className="link-botao" onClick={props.aoAbrir}>
          <b>{fmtNome(r.nome)}</b>
        </button>
        <span className="quieto">
          {[
            r.cidade ? fmtCidade(r.cidade) : null,
            r.etapa ? ROTULO_ETAPA[r.etapa] : null,
            r.telefone ? formatarTelefone(r.telefone) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <Badge tone={r.origem === 'agente' ? 'brand' : 'neutral'}>
          {r.origem === 'agente' ? 'Resposta da IA' : 'Cadência'}
        </Badge>
      </header>
      {r.origem === 'agente' && r.ultimaDoLead && <p className="rascunho__lead">Lead: “{r.ultimaDoLead}”</p>}
      {r.nota && <p className="quieto rascunho__nota">{r.nota}</p>}
      <label className="pp-sr" htmlFor={`rasc-${r.id}`}>
        Mensagem para {r.nome}
      </label>
      <textarea id={`rasc-${r.id}`} rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
      <div className="acoes">
        <Button
          size="sm"
          variant="primary"
          icon="send"
          disabled={acao.isPending || !texto.trim()}
          onClick={() => acao.mutate('aprovar')}
        >
          Aprovar e enviar
        </Button>
        <Button size="sm" variant="ghost" disabled={acao.isPending} onClick={() => acao.mutate('descartar')}>
          Descartar
        </Button>
      </div>
      <ErroDaApi erro={acao.error} />
    </article>
  );
}

function FormConfig(props: { config: ConfigAgente; aoConfigurar: () => void }) {
  const cliente = useQueryClient();
  const perfil = usePerfilIa();
  const [f, setF] = useState(props.config);
  useEffect(() => setF(props.config), [props.config]);
  const mudar = <K extends keyof ConfigAgente>(k: K, v: ConfigAgente[K]) => setF((x) => ({ ...x, [k]: v }));
  const salvar = useMutation({
    // O texto da IA (empresa, regras, horários de reunião) vem da Configuração da IA: não vai daqui.
    mutationFn: ({ sobreEmpresa: _s, regras: _r, horariosReuniao: _h, ...c }: ConfigAgente) =>
      api('/agente/config', { metodo: 'PUT', corpo: c }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['agente'] }),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate(f);
  };
  const numero = (k: 'horaInicio' | 'horaFim' | 'limiteDia' | 'intervaloSeg' | 'respostasDiaLead') => (
    <input
      id={`ag-${k}`}
      className="filtro"
      inputMode="numeric"
      value={f[k]}
      onChange={(e) => mudar(k, Number(e.target.value.replace(/\D/g, '')) || 0)}
    />
  );

  return (
    <form className="form" onSubmit={enviar}>
      <label className="opcao">
        <input
          type="checkbox"
          checked={f.ligado}
          disabled={!f.ligado && !props.config.ligado && !perfil.data?.pronto}
          onChange={(e) => mudar('ligado', e.target.checked)}
        />
        <b>Agente ligado</b>: aborda os leads com a IA ligada e responde quem escrever
      </label>
      {!props.config.ligado && perfil.data && !perfil.data.pronto && (
        <p className="campo__dica" style={{ margin: 0 }}>
          Para ligar, a Configuração da IA precisa estar toda conferida e a prova aprovada (
          {perfil.data.prontidao}% pronta).{' '}
          <button type="button" className="link-botao" onClick={props.aoConfigurar}>
            Abrir a Configuração da IA
          </button>
        </p>
      )}
      <label className="opcao">
        <input
          type="checkbox"
          checked={f.revisarAntes}
          onChange={(e) => mudar('revisarAntes', e.target.checked)}
        />
        Revisar antes de enviar (recomendado no começo): cada mensagem espera sua aprovação aqui
      </label>
      <label className="opcao">
        <input
          type="checkbox"
          checked={f.avisoPassagem}
          onChange={(e) => mudar('avisoPassagem', e.target.checked)}
        />
        Avisar o lead quando a IA passar para o time ("vou chamar alguém do time"; fora do horário, diz quando
        o time volta)
      </label>
      <div className="funil-ficha">
        <div className="campo">
          <label htmlFor="ag-horaInicio">Começa às (hora)</label>
          {numero('horaInicio')}
        </div>
        <div className="campo">
          <label htmlFor="ag-horaFim">Para às (hora)</label>
          {numero('horaFim')}
        </div>
        <div className="campo">
          <label htmlFor="ag-limiteDia">Mensagens por dia (chip)</label>
          {numero('limiteDia')}
          <span className="campo__dica">Com chips cadastrados, vale o limite de cada chip.</span>
        </div>
        <div className="campo">
          <label htmlFor="ag-intervaloSeg">Segundos entre mensagens</label>
          {numero('intervaloSeg')}
          <span className="campo__dica">
            Entre mensagens frias, em cada chip, mais uma variação de até 60%.
          </span>
        </div>
        <div className="campo">
          <label htmlFor="ag-respostasDiaLead">Respostas da IA por lead/dia</label>
          {numero('respostasDiaLead')}
        </div>
      </div>
      <fieldset className="campo">
        <legend>Dias</legend>
        <div className="opcoes" style={{ flexWrap: 'wrap', display: 'flex', gap: 12 }}>
          {DIAS.map((d, i) => (
            <label key={d} className="opcao">
              <input
                type="checkbox"
                checked={f.diasSemana.includes(i)}
                onChange={(e) =>
                  mudar(
                    'diasSemana',
                    e.target.checked ? [...f.diasSemana, i].sort() : f.diasSemana.filter((x) => x !== i),
                  )
                }
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <ErroDaApi erro={salvar.error} />
      {salvar.isSuccess && <Mensagem tipo="ok">Configuração salva.</Mensagem>}
      <div className="acoes">
        <Button type="submit" variant="primary" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

type AbaAgente = 'atendimento' | 'configuracao' | 'base' | 'ensinar' | 'simulador' | 'desempenho';

export function Agente() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [params, setParams] = useSearchParams();
  const sessao = useSessao();
  const master = !!sessao.data?.master;
  // Módulo Agente de IA fora do plano: só ficam os chips e o WhatsApp das sequências.
  const temIa = sessao.data?.conta.modulos?.includes('agente_ia') ?? true;
  const aba = temIa ? ((params.get('aba') as AbaAgente | null) ?? 'atendimento') : 'atendimento';
  const base = useConhecimento();
  const q = useQuery({
    queryKey: ['agente'],
    queryFn: () => api<TelaAgente>('/agente'),
    refetchInterval: 20_000,
  });
  const devolver = useMutation({
    mutationFn: (empresaId: number) =>
      api(`/funil/${empresaId}`, { metodo: 'PATCH', corpo: { devolverParaIa: true } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['agente'] }),
  });
  const emMassa = useMutation({
    mutationFn: () =>
      api<{ ligados: number }>('/agente/ligar-em-massa', {
        metodo: 'POST',
        corpo: { etapas: ['a_abordar'] },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['agente'] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
    },
  });

  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const d = q.data;
  const abrir = (id: number) => navegar(`/funil?empresa=${id}`);
  const nb = base.data?.numeros;
  const abas: { id: AbaAgente; rotulo: string; conta?: number; nova?: boolean }[] = [
    { id: 'atendimento', rotulo: 'Atendimento', conta: d.rascunhos.length + d.pausados.length, nova: true },
    { id: 'configuracao', rotulo: 'Configuração da IA' },
    { id: 'base', rotulo: 'Base de conhecimento', conta: nb?.sugeridos, nova: true },
    { id: 'ensinar', rotulo: 'O que falta ensinar', conta: nb?.lacunas, nova: true },
    { id: 'simulador', rotulo: 'Simulador' },
    { id: 'desempenho', rotulo: 'Desempenho' },
  ];

  return (
    <>
      <div className="topo">
        <div>
          <h1>Agente</h1>
          <p>
            A IA aborda pelo WhatsApp, lê as respostas, tira dúvidas, marca reunião e passa para você quando
            precisa.
          </p>
        </div>
        <div className="acoes">
          <Button variant="ghost" icon="mail" onClick={() => navegar('/email?aba=modelos')}>
            Textos dos e-mails
          </Button>
          <Badge tone={d.config.ligado ? 'brand' : 'neutral'}>
            {d.config.ligado ? 'Ligado' : 'Desligado'}
          </Badge>
        </div>
      </div>

      {!temIa && (
        <Mensagem tipo="aviso">
          O módulo Agente de IA não está no plano desta conta: a IA não aborda nem responde. Os chips e o
          WhatsApp das sequências continuam funcionando. Para contratar, fale com a gente.
        </Mensagem>
      )}
      {temIa && (!d.status.whatsapp || !d.status.ia) && (
        <Mensagem tipo="aviso">
          {master ? (
            <>
              {!d.status.whatsapp &&
                'Nenhum número de WhatsApp conectado (o cliente conecta em “Números de WhatsApp”, abaixo, lendo o QR Code). '}
              {!d.status.ia && 'Falta a IA (DeepSeek, Gemini…) desta conta, no painel master. '}
              Sem isso o agente prepara as mensagens mas não envia nem responde.
            </>
          ) : (
            <>
              {!d.status.whatsapp
                ? 'Conecte um número de WhatsApp em “Números de WhatsApp”, abaixo (é só ler o QR Code).'
                : 'A IA desta conta ainda está sendo ativada pelo nosso suporte.'}{' '}
              Até lá, o agente prepara as mensagens, mas não envia nem responde.
            </>
          )}
        </Mensagem>
      )}

      <div className="kpis">
        <Stat
          rotulo="Enviadas hoje"
          valor={`${fmtNumero(d.resumo.enviadasHoje)} / ${fmtNumero(d.config.limiteDia)}`}
        />
        <Stat rotulo="Respostas de leads hoje" valor={fmtNumero(d.resumo.recebidasHoje)} />
        <Stat rotulo="Leads com a IA" valor={fmtNumero(d.resumo.leadsComIa)} />
        <Stat rotulo="Para você" valor={fmtNumero(d.resumo.rascunhos + d.resumo.pausados)} />
      </div>

      <div className="pipelines abas-agente" role="tablist" aria-label="Seções do agente">
        {abas
          .filter((a) => temIa || a.id === 'atendimento')
          .map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id}
              className="pipelines__aba"
              onClick={() => setParams({ aba: a.id }, { replace: true })}
            >
              {a.rotulo}
              {!!a.conta && (
                <span className={`pipelines__conta${a.nova ? ' pipelines__conta--nova' : ''}`}>
                  {a.conta}
                </span>
              )}
            </button>
          ))}
      </div>

      {aba === 'configuracao' && (
        <ConfiguracaoIa config={d.config} aoVerBase={() => setParams({ aba: 'base' }, { replace: true })} />
      )}
      {aba === 'base' && <BaseConhecimento />}
      {aba === 'simulador' && <SimuladorIa />}
      {aba === 'desempenho' && <DesempenhoAgente />}
      {aba === 'ensinar' && (
        <Aprendizados
          aoAbrirLead={(id) => navegar(`/conversas?lead=${id}`)}
          aoVerBase={() => setParams({ aba: 'base' })}
        />
      )}
      {aba === 'atendimento' && (
        <>
          <Panel titulo="Para revisar" contagem={d.rascunhos.length}>
            {d.rascunhos.length ? (
              <div className="pilha">
                {d.rascunhos.map((r) => (
                  <Rascunho key={r.id} r={r} aoAbrir={() => abrir(r.empresaId)} />
                ))}
              </div>
            ) : (
              <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                Nada esperando aprovação.
                {d.config.revisarAntes
                  ? ' As mensagens da IA aparecem aqui antes de sair.'
                  : ' A revisão está desligada: a IA envia direto.'}
              </p>
            )}
          </Panel>

          <Panel titulo="A IA passou para você" contagem={d.pausados.length}>
            {d.pausados.length ? (
              <ul className="lista-simples">
                {d.pausados.map((p) => (
                  <li key={p.empresaId}>
                    <div className="pausado-ia">
                      <div>
                        <button type="button" className="link-botao" onClick={() => abrir(p.empresaId)}>
                          <b>{fmtNome(p.nome)}</b>
                        </button>{' '}
                        <span className="quieto">
                          · {ROTULO_ETAPA[p.etapa]} · {fmtHora(p.em)}
                        </span>
                      </div>
                      <div className="quieto" style={{ fontSize: 13 }}>
                        {p.motivo}
                      </div>
                      {p.resumo && <ResumoPassagem r={p.resumo} />}
                    </div>
                    <div className="acoes">
                      <Button size="sm" onClick={() => navegar(`/conversas?lead=${p.empresaId}`)}>
                        Responder
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={devolver.isPending}
                        onClick={() => devolver.mutate(p.empresaId)}
                      >
                        Devolver para a IA
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
                Nenhum lead esperando você.
              </p>
            )}
          </Panel>

          <Panel
            titulo="Configuração"
            acoes={
              <Button size="sm" variant="ghost" disabled={emMassa.isPending} onClick={() => emMassa.mutate()}>
                Ligar a IA em todos de "A abordar"
              </Button>
            }
          >
            {emMassa.data && (
              <Mensagem tipo="ok">
                IA ligada em {fmtNumero(emMassa.data.ligados)} lead(s) de "A abordar".
              </Mensagem>
            )}
            <FormConfig
              config={d.config}
              aoConfigurar={() => setParams({ aba: 'configuracao' }, { replace: true })}
            />
          </Panel>

          <Chips />
        </>
      )}
    </>
  );
}
