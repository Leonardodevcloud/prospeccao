import {
  CAMPOS_FORMULARIO_SITE,
  type CampoFormularioSite,
  type CampoSite,
  EVENTOS_AVISO,
  type EventoAviso,
  LISTA_EVENTOS_AVISO,
  LISTA_PERMISSOES_API,
  PERMISSOES_API,
  type PermissaoApi,
} from '@prospeccao/shared/integracoes';
import { Badge, Button, EmptyState, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Drawer, Modal } from '../componentes/Drawer';
import { CampoEtiquetas, ErroDaApi, Mensagem } from '../componentes/Formulario';
import { usePipelines } from '../componentes/Pipelines';
import { useEquipe } from '../componentes/Sessao';
import { fmtNumero, fmtQuando } from '../formatar';
import { SITE_PROSPECT_TEAM } from '../marcaPublica';

/**
 * Gestão › Integrações: as chaves da API, os formulários do site (direto no funil) e os avisos
 * (webhooks) para o ERP, a loja virtual e o Make/Zapier. Só o administrador.
 */

const DOCUMENTACAO = `${SITE_PROSPECT_TEAM}/api`;

interface Chave {
  id: number;
  nome: string;
  final: string;
  permissoes: PermissaoApi[];
  ips: string[];
  expiraEm: string | null;
  criadoPor: string | null;
  criadaEm: string;
  revogadaEm: string | null;
  revogadaPor: string | null;
  ultimoUsoEm: string | null;
  ultimoIp: string | null;
  usosHoje: number;
}

interface Resumo {
  plano: boolean;
  base: string;
  uso: {
    chamadasHoje: number;
    errosHoje: number;
    leads30: number;
    duplicados30: number;
    limiteDia: number;
    limiteMinuto: number;
  } | null;
  chaves: Chave[];
}

interface FormularioSite {
  id: number;
  nome: string;
  chave: string;
  ligado: boolean;
  campos: CampoSite[];
  etapaId: number | null;
  responsavelId: number | null;
  etiquetas: string[];
  boasVindas: string | null;
  avisar: boolean;
  redirecionar: string | null;
  ultimoEnvioEm: string | null;
  leads30: number;
  robos7: number;
  erros7: number;
  envios7: number;
}

interface Envio {
  id: number;
  recebidoEm: string;
  resultado: 'lead' | 'duplicado' | 'robo' | 'erro' | 'desligado';
  erro: string | null;
  empresaId: number | null;
  lead: string | null;
}

interface Aviso {
  id: number;
  nome: string;
  url: string;
  eventos: EventoAviso[];
  situacao: 'ativo' | 'pausado';
  pausadoMotivo: string | null;
  falhandoDesde: string | null;
  pelaApi: boolean;
  entregues: number;
  falhas: number;
  pendentes: number;
  ultimaEm: string | null;
}

interface Entrega {
  id: number;
  evento: EventoAviso | 'teste';
  empresaId: number | null;
  lead: string | null;
  situacao: 'pendente' | 'entregue' | 'falhou';
  tentativas: number;
  proximaEm: string;
  statusHttp: number | null;
  resposta: string | null;
  duracaoMs: number | null;
  erro: string | null;
  corpo: unknown;
  criadoEm: string;
}

const ABAS = [
  { id: 'chaves', rotulo: 'Chaves da API' },
  { id: 'formularios', rotulo: 'Formulários do site' },
  { id: 'avisos', rotulo: 'Avisos (webhooks)' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

function Copiar(props: { valor: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      icon={copiado ? 'check' : 'copy'}
      onClick={() => {
        void navigator.clipboard?.writeText(props.valor);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
    >
      {copiado ? 'Copiado' : (props.rotulo ?? 'Copiar')}
    </Button>
  );
}

/** "em 30 min", "às 14:20", "amanhã às 09:00". */
function fmtDaqui(iso: string): string {
  const d = new Date(iso);
  const min = Math.round((d.getTime() - Date.now()) / 60_000);
  if (min <= 1) return 'agora';
  if (min < 60) return `em ${min} min`;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `às ${hora}` : `amanhã às ${hora}`;
}

function Codigo(props: { children: string }) {
  return <pre className="int-codigo">{props.children}</pre>;
}

export function Integracoes() {
  const [busca, setBusca] = useSearchParams();
  const abaUrl = busca.get('aba') as Aba | null;
  const aba: Aba = ABAS.some((a) => a.id === abaUrl) ? abaUrl! : 'chaves';
  const resumo = useQuery({ queryKey: ['integracoes'], queryFn: () => api<Resumo>('/integracoes') });
  const [novo, setNovo] = useState<Aba | null>(null);

  return (
    <>
      <div className="topo">
        <div>
          <h1>Integrações</h1>
          <p>
            Ligue o CRM ao site, ao ERP, à loja virtual e ao Make/Zapier.{' '}
            <a href={DOCUMENTACAO} target="_blank" rel="noopener" className="link-ajuda">
              <Icon name="external-link" size={14} />
              Documentação da API
            </a>{' '}
            <LinkAjuda artigo="integracoes" />
          </p>
        </div>
        <div className="acoes">
          <Button variant="primary" icon="plus" onClick={() => setNovo(aba)}>
            {aba === 'chaves' ? 'Nova chave' : aba === 'formularios' ? 'Novo formulário' : 'Novo aviso'}
          </Button>
        </div>
      </div>
      <div className="pipelines int-abas" role="tablist" aria-label="Seções de integrações">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className="pipelines__aba"
            onClick={() => setBusca({ aba: a.id }, { replace: true })}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {resumo.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : !resumo.data ? (
        <ErroDaApi erro={resumo.error} />
      ) : aba === 'chaves' ? (
        <Chaves resumo={resumo.data} criar={novo === 'chaves'} aoFecharCriar={() => setNovo(null)} />
      ) : aba === 'formularios' ? (
        <Formularios
          base={resumo.data.base}
          criar={novo === 'formularios'}
          aoFecharCriar={() => setNovo(null)}
        />
      ) : (
        <Avisos criar={novo === 'avisos'} aoFecharCriar={() => setNovo(null)} />
      )}
    </>
  );
}

/* ───────────────────────────── Chaves ───────────────────────────── */

function Chaves(props: { resumo: Resumo; criar: boolean; aoFecharCriar: () => void }) {
  const { resumo: r } = props;
  const cliente = useQueryClient();
  const [revogar, setRevogar] = useState<Chave | null>(null);
  const tirar = useMutation({
    mutationFn: (id: number) => api(`/integracoes/chaves/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      setRevogar(null);
      cliente.invalidateQueries({ queryKey: ['integracoes'] });
    },
  });
  const ativas = r.chaves.filter((c) => !c.revogadaEm);
  const vencendo = ativas.filter(
    (c) => c.expiraEm && new Date(c.expiraEm).getTime() - Date.now() < 15 * 86_400_000,
  ).length;
  return (
    <>
      {r.uso && (
        <div className="lig-totais">
          <div>
            <small>Chamadas hoje</small>
            <b>{fmtNumero(r.uso.chamadasHoje)}</b>
            <span>de {fmtNumero(r.uso.limiteDia)} por dia</span>
          </div>
          <div>
            <small>Leads criados pela API (30 dias)</small>
            <b>{fmtNumero(r.uso.leads30)}</b>
            <span>{fmtNumero(r.uso.duplicados30)} repetidos juntados no lead que já existia</span>
          </div>
          <div>
            <small>Erros hoje</small>
            <b>{fmtNumero(r.uso.errosHoje)}</b>
            <span>pedidos recusados (dados inválidos, sem permissão…)</span>
          </div>
          <div>
            <small>Chaves ativas</small>
            <b>{fmtNumero(ativas.length)}</b>
            <span>
              {vencendo
                ? `${vencendo} vence${vencendo > 1 ? 'm' : ''} em menos de 15 dias`
                : 'nenhuma vencendo'}
            </span>
          </div>
        </div>
      )}
      {!r.chaves.length ? (
        <EmptyState
          icone="key-round"
          titulo="Nenhuma chave ainda"
          texto="Crie uma chave para cada sistema que vai falar com o CRM (o ERP, a loja virtual, o Make). Assim dá para revogar uma sem parar as outras."
        />
      ) : (
        <Panel semPadding>
          <div className="pp-tablewrap">
            <table className="pp-table int-chaves">
              <thead>
                <tr>
                  <th>Chave</th>
                  <th>Pode</th>
                  <th>Último uso</th>
                  <th>Criada por</th>
                  <th>Validade</th>
                  <th>
                    <span className="pp-sr">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.chaves.map((c) => (
                  <tr key={c.id} data-revogada={c.revogadaEm ? '' : undefined}>
                    <td>
                      <b>{c.nome}</b>
                      <small>
                        <span className="int-final mono">pt_live_…{c.final}</span>
                      </small>
                    </td>
                    <td>
                      {c.permissoes.map((p) => (
                        <span key={p} className="int-perm">
                          {PERMISSOES_API[p]?.nome ?? p}
                        </span>
                      ))}
                      {c.ips.length > 0 && <small>Só de {c.ips.join(', ')}</small>}
                    </td>
                    <td>
                      {c.ultimoUsoEm ? fmtQuando(c.ultimoUsoEm) : 'nunca usada'}
                      {c.ultimoUsoEm && (
                        <small>
                          {[c.ultimoIp, `${fmtNumero(c.usosHoje)} chamadas hoje`].filter(Boolean).join(' · ')}
                        </small>
                      )}
                    </td>
                    <td>
                      {c.criadoPor ?? '—'}
                      <small>{new Date(c.criadaEm).toLocaleDateString('pt-BR')}</small>
                    </td>
                    <td>
                      {c.revogadaEm ? (
                        <Badge>revogada {new Date(c.revogadaEm).toLocaleDateString('pt-BR')}</Badge>
                      ) : c.expiraEm ? (
                        new Date(c.expiraEm) < new Date() ? (
                          <Badge tone="danger">venceu</Badge>
                        ) : (
                          <Badge tone="warning">
                            vence {new Date(c.expiraEm).toLocaleDateString('pt-BR')}
                          </Badge>
                        )
                      ) : (
                        'sem validade'
                      )}
                    </td>
                    <td className="num">
                      {!c.revogadaEm && (
                        <Button size="sm" variant="ghost" onClick={() => setRevogar(c)}>
                          Revogar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Mensagem tipo="aviso">
        A chave dá acesso aos dados desta unidade. Guarde como uma senha: quem tiver a chave faz o que as
        permissões dela deixam. Tudo o que a API muda fica na Auditoria, com o nome da chave.
      </Mensagem>
      {props.criar && <NovaChave base={r.base} aoFechar={props.aoFecharCriar} />}
      {revogar && (
        <Modal
          titulo={`Revogar a chave “${revogar.nome}”?`}
          aoFechar={() => setRevogar(null)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setRevogar(null)}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={tirar.isPending} onClick={() => tirar.mutate(revogar.id)}>
                Revogar “{revogar.nome}”
              </Button>
            </>
          }
        >
          <p>
            O sistema que usa esta chave para de falar com o CRM na hora. Não dá para desfazer: para voltar,
            crie outra chave e troque no sistema.
          </p>
          <ErroDaApi erro={tirar.error} />
        </Modal>
      )}
    </>
  );
}

function NovaChave(props: { base: string; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [nome, setNome] = useState('');
  const [permissoes, setPermissoes] = useState<PermissaoApi[]>(['leads:criar', 'leads:ler']);
  const [validade, setValidade] = useState<'' | '30' | '90' | '365'>('');
  const [ips, setIps] = useState('');
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number; chave: string }>('/integracoes/chaves', {
        metodo: 'POST',
        corpo: {
          nome: nome.trim(),
          permissoes,
          validadeDias: validade ? Number(validade) : null,
          ips: ips
            .split(/[\s,;]+/)
            .map((x) => x.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['integracoes'] }),
  });
  const marcar = (p: PermissaoApi, sim: boolean) =>
    setPermissoes(sim ? [...permissoes, p] : permissoes.filter((x) => x !== p));
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate();
  };
  const chave = criar.data?.chave;
  return (
    <Drawer titulo="Nova chave da API" barra="Nova chave da API" largo aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {chave ? (
          <div className="int-uma-vez">
            <div className="int-uma-vez__caixa">
              <b>Chave criada. Copie agora: ela não aparece de novo.</b>
              <div className="int-uma-vez__chave">
                <code className="mono">{chave}</code>
                <Copiar valor={chave} />
              </div>
              <p className="quieto">
                Se perder, é só revogar e criar outra. Cole no sistema que vai usar, no cabeçalho{' '}
                <code>Authorization: Bearer &lt;chave&gt;</code>.
              </p>
            </div>
            <div className="campo">
              <span className="campo__rotulo">Teste rápido (os 5 leads mais recentes)</span>
              <Codigo>{`curl "${props.base}/leads?limite=5" \\\n  -H "Authorization: Bearer ${chave}"`}</Codigo>
            </div>
            <div className="acoes">
              <Button
                variant="secondary"
                onClick={() => {
                  criar.reset();
                  setNome('');
                }}
              >
                Criar outra
              </Button>
              <Button variant="primary" onClick={props.aoFechar}>
                Concluir
              </Button>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={enviar}>
            <div className="campo">
              <label htmlFor="ch-nome">Nome (para saber quem usa)</label>
              <input
                id="ch-nome"
                className="filtro"
                maxLength={80}
                placeholder="Ex.: ERP Bling — pedidos"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <fieldset className="campo">
              <legend>O que ela pode fazer</legend>
              {LISTA_PERMISSOES_API.map((p) => (
                <label key={p} className="lig-sug">
                  <input
                    type="checkbox"
                    checked={permissoes.includes(p)}
                    onChange={(e) => marcar(p, e.target.checked)}
                  />
                  <span>
                    <b>{PERMISSOES_API[p].nome}</b>
                    <small>{PERMISSOES_API[p].descricao}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="form__duas">
              <div className="campo">
                <label htmlFor="ch-validade">Validade</label>
                <select
                  id="ch-validade"
                  className="filtro"
                  value={validade}
                  onChange={(e) => setValidade(e.target.value as typeof validade)}
                >
                  <option value="">Sem validade</option>
                  <option value="30">30 dias</option>
                  <option value="90">90 dias</option>
                  <option value="365">1 ano</option>
                </select>
                <span className="campo__dica">
                  Para um teste ou um fornecedor temporário, escolha 30 ou 90 dias.
                </span>
              </div>
              <div className="campo">
                <label htmlFor="ch-ips">Só destes endereços IP (opcional)</label>
                <input
                  id="ch-ips"
                  className="filtro mono"
                  placeholder="ex.: 201.17.40.0/24"
                  value={ips}
                  onChange={(e) => setIps(e.target.value)}
                />
                <span className="campo__dica">Separe por vírgula. Vazio: de qualquer lugar.</span>
              </div>
            </div>
            <ErroDaApi erro={criar.error} />
            <div className="acoes">
              <Button type="button" variant="ghost" onClick={props.aoFechar}>
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="key-round"
                disabled={criar.isPending || nome.trim().length < 2 || !permissoes.length}
              >
                {criar.isPending ? 'Criando…' : 'Criar chave'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Drawer>
  );
}

/* ───────────────────────────── Formulários do site ───────────────────────────── */

const RESULTADO_ENVIO: Record<
  Envio['resultado'],
  { rotulo: string; tom: 'brand' | 'neutral' | 'warning' | 'danger' }
> = {
  lead: { rotulo: 'lead novo', tom: 'brand' },
  duplicado: { rotulo: 'juntou no lead', tom: 'neutral' },
  robo: { rotulo: 'robô barrado', tom: 'neutral' },
  erro: { rotulo: 'não entrou', tom: 'danger' },
  desligado: { rotulo: 'formulário pausado', tom: 'warning' },
};

function Formularios(props: { base: string; criar: boolean; aoFecharCriar: () => void }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['integracoes-formularios'],
    queryFn: () => api<FormularioSite[]>('/integracoes/formularios'),
    refetchInterval: 15_000,
  });
  const [sel, setSel] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number }>('/integracoes/formularios', { metodo: 'POST', corpo: { nome: nome.trim() } }),
    onSuccess: async (r) => {
      await cliente.invalidateQueries({ queryKey: ['integracoes-formularios'] });
      setSel(r.id);
      setNome('');
      props.aoFecharCriar();
    },
  });
  const lista = q.data ?? [];
  const atual = lista.find((f) => f.id === sel) ?? lista[0];
  if (q.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  return (
    <>
      {!lista.length ? (
        <EmptyState
          icone="file-text"
          titulo="Nenhum formulário ainda"
          texto="Crie um formulário, cole o endereço no construtor do seu site (Elementor, RD Station, Typeform…) e cada envio vira lead no funil."
        />
      ) : (
        <div className="int-duas">
          <ul className="int-lista" aria-label="Formulários">
            {lista.map((f) => {
              const novos = f.campos.filter((c) => c.novo).length;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    className="int-item"
                    aria-current={atual?.id === f.id || undefined}
                    onClick={() => setSel(f.id)}
                  >
                    <span>
                      <b>{f.nome}</b>
                      <small>{fmtNumero(f.leads30)} leads em 30 dias</small>
                    </span>
                    <span className="int-item__dir">
                      {!f.ligado ? (
                        <Badge>pausado</Badge>
                      ) : novos ? (
                        <Badge tone="warning">
                          {novos} campo{novos > 1 ? 's' : ''} novo{novos > 1 ? 's' : ''}
                        </Badge>
                      ) : f.ultimoEnvioEm ? (
                        <Badge tone="brand">recebendo</Badge>
                      ) : (
                        <Badge tone="outline">esperando o 1º envio</Badge>
                      )}
                      <small>{f.ultimoEnvioEm ? fmtQuando(f.ultimoEnvioEm) : ''}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {atual && <EditarFormulario key={atual.id} f={atual} base={props.base} />}
        </div>
      )}
      {props.criar && (
        <Modal
          titulo="Novo formulário do site"
          aoFechar={props.aoFecharCriar}
          rodape={
            <>
              <Button variant="ghost" onClick={props.aoFecharCriar}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={nome.trim().length < 2 || criar.isPending}
                onClick={() => criar.mutate()}
              >
                Criar formulário
              </Button>
            </>
          }
        >
          <div className="campo">
            <label htmlFor="fs-nome">Nome (para você reconhecer)</label>
            <input
              id="fs-nome"
              className="filtro"
              maxLength={80}
              placeholder="Ex.: Site — Fale com a gente"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            <span className="campo__dica">
              Um para cada formulário do site: assim você sabe de onde veio cada lead.
            </span>
          </div>
          <ErroDaApi erro={criar.error} />
        </Modal>
      )}
    </>
  );
}

const COMO_COLAR: { nome: string; texto: ReactNode }[] = [
  {
    nome: 'Elementor',
    texto: (
      <>
        No formulário: <b>Ações após o envio</b> › adicione <b>Webhook</b> e cole o endereço em{' '}
        <b>URL do webhook</b>. Marque “Dados avançados”.
      </>
    ),
  },
  {
    nome: 'WordPress (Contact Form 7)',
    texto: (
      <>
        Instale o plugin <b>CF7 to Webhook</b>, abra o formulário › aba <b>Webhook</b> e cole o endereço.
      </>
    ),
  },
  {
    nome: 'RD Station Marketing',
    texto: (
      <>
        <b>Integrações</b> › <b>Webhooks</b> › criar, com o gatilho “Conversão” e o endereço como URL.
      </>
    ),
  },
  {
    nome: 'Typeform',
    texto: (
      <>
        No formulário: <b>Connect</b> › <b>Webhooks</b> › <b>Add a webhook</b>, cole o endereço e ligue.
      </>
    ),
  },
  {
    nome: 'Google Forms',
    texto: (
      <>
        Na planilha de respostas: <b>Extensões</b> › <b>Apps Script</b>, cole o script do guia da documentação
        (manda cada resposta para o endereço).
      </>
    ),
  },
  {
    nome: 'HTML puro',
    texto: (
      <>Use o endereço no action do formulário (exemplo abaixo). Quem envia vê a sua página de obrigado.</>
    ),
  },
];

function EditarFormulario(props: { f: FormularioSite; base: string }) {
  const cliente = useQueryClient();
  const pipelines = usePipelines();
  const equipe = useEquipe();
  const [f, setF] = useState({
    nome: props.f.nome,
    ligado: props.f.ligado,
    campos: props.f.campos,
    etapaId: props.f.etapaId ? String(props.f.etapaId) : '',
    responsavelId: props.f.responsavelId ? String(props.f.responsavelId) : '',
    etiquetas: props.f.etiquetas,
    boasVindas: props.f.boasVindas ?? '',
    avisar: props.f.avisar,
    redirecionar: props.f.redirecionar ?? '',
  });
  // Chegou campo novo enquanto a tela estava aberta: entra no mapa.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando o número de campos muda
  useEffect(() => {
    if (props.f.campos.length > f.campos.length)
      setF((x) => ({ ...x, campos: [...x.campos, ...props.f.campos.slice(x.campos.length)] }));
  }, [props.f.campos.length]);
  const [como, setComo] = useState(COMO_COLAR[0]!.nome);
  const [apagar, setApagar] = useState(false);
  const endereco = `${props.base}/entrada/${props.f.chave}`;
  const envios = useQuery({
    queryKey: ['integracoes-envios', props.f.id],
    queryFn: () => api<Envio[]>(`/integracoes/formularios/${props.f.id}/envios`),
    refetchInterval: 15_000,
  });
  const atualizar = () => cliente.invalidateQueries({ queryKey: ['integracoes-formularios'] });
  const salvar = useMutation({
    mutationFn: (x: typeof f) =>
      api(`/integracoes/formularios/${props.f.id}`, {
        metodo: 'PUT',
        corpo: {
          nome: x.nome.trim(),
          ligado: x.ligado,
          campos: x.campos,
          etapaId: x.etapaId ? Number(x.etapaId) : null,
          responsavelId: x.responsavelId ? Number(x.responsavelId) : null,
          etiquetas: x.etiquetas,
          boasVindas: x.boasVindas.trim() || null,
          avisar: x.avisar,
          redirecionar: x.redirecionar.trim() || null,
        },
      }),
    onSuccess: atualizar,
  });
  const tirar = useMutation({
    mutationFn: () => api(`/integracoes/formularios/${props.f.id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const pessoas = (equipe.data?.usuarios ?? []).filter((u) => u.ativo);
  const htmlPuro = `<form action="${endereco}" method="post">
  <input name="nome" placeholder="Seu nome" required>
  <input name="whatsapp" placeholder="WhatsApp" required>
  <input name="email" type="email" placeholder="E-mail">
  <!-- contra robôs: fica escondido e vazio -->
  <input name="pt_confirmar" style="display:none" tabindex="-1" autocomplete="off">
  <button>Quero conversar</button>
</form>`;
  return (
    <Panel className="int-detalhe">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate(f);
        }}
      >
        <div className="int-detalhe__cab">
          <div className="campo int-detalhe__nome">
            <label htmlFor="fs-edit-nome" className="pp-sr">
              Nome do formulário
            </label>
            <input
              id="fs-edit-nome"
              className="filtro"
              value={f.nome}
              maxLength={80}
              onChange={(e) => setF({ ...f, nome: e.target.value })}
            />
          </div>
          <label className="chave-liga chave-liga--texto">
            <input
              type="checkbox"
              checked={f.ligado}
              onChange={(e) => {
                const x = { ...f, ligado: e.target.checked };
                setF(x);
                salvar.mutate(x);
              }}
            />
            <span>{f.ligado ? 'Os envios viram lead' : 'Pausado: os envios não entram'}</span>
          </label>
        </div>

        <div className="campo">
          <span className="campo__rotulo">Cole este endereço no formulário (envio por POST ou webhook)</span>
          <div className="int-endereco">
            <code className="mono">{endereco}</code>
            <Copiar valor={endereco} />
          </div>
          <div className="segmentos int-como" role="tablist" aria-label="Como colar">
            {COMO_COLAR.map((c) => (
              <button
                key={c.nome}
                type="button"
                role="tab"
                aria-selected={como === c.nome}
                className="segmento"
                data-ativo={como === c.nome || undefined}
                onClick={() => setComo(c.nome)}
              >
                {c.nome}
              </button>
            ))}
          </div>
          <p className="campo__dica">{COMO_COLAR.find((c) => c.nome === como)?.texto}</p>
          {como === 'HTML puro' && <Codigo>{htmlPuro}</Codigo>}
        </div>

        <div className="int-form-grade">
          <fieldset className="campo">
            <legend>Campos que chegaram → onde entram no CRM</legend>
            {f.campos.length ? (
              <div className="ig-mapa">
                {f.campos.map((c, i) => (
                  <div key={c.chave} className="ig-mapa__linha" data-novo={c.novo || undefined}>
                    <span className="ig-mapa__de">
                      <span className="int-rotulo">
                        {c.rotulo}
                        {c.novo && <Badge tone="warning">novo</Badge>}
                      </span>
                      <small className="mono">
                        {c.chave}
                        {c.exemplo ? ` · ex.: ${c.exemplo}` : ''}
                      </small>
                    </span>
                    <Icon name="arrow-right" size={14} />
                    <label className="pp-sr" htmlFor={`fs-campo-${i}`}>
                      Campo para {c.rotulo}
                    </label>
                    <select
                      id={`fs-campo-${i}`}
                      className="filtro"
                      value={c.campo}
                      onChange={(e) =>
                        setF({
                          ...f,
                          campos: f.campos.map((x, j) =>
                            j === i ? { ...x, campo: e.target.value as CampoFormularioSite, novo: false } : x,
                          ),
                        })
                      }
                    >
                      {Object.entries(CAMPOS_FORMULARIO_SITE).map(([id, rotulo]) => (
                        <option key={id} value={id}>
                          {rotulo}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="quieto">
                Ainda não chegou nenhum envio. Mande um teste pelo próprio formulário do site: os campos
                aparecem aqui com a sugestão de para onde vai cada um.
              </p>
            )}
            <span className="campo__dica">
              Campo novo no formulário aparece marcado; até você escolher, vai para a anotação do lead.
            </span>
          </fieldset>

          <div className="int-coluna">
            <div className="campo">
              <label htmlFor="fs-etapa">O lead entra em</label>
              <select
                id="fs-etapa"
                className="filtro"
                value={f.etapaId}
                onChange={(e) => setF({ ...f, etapaId: e.target.value })}
              >
                <option value="">{pipelines.data?.[0]?.etapas[0]?.nome ?? 'A abordar'} (padrão)</option>
                {pipelines.data?.map((p) => (
                  <optgroup key={p.id} label={p.nome}>
                    {p.etapas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="fs-resp">Quem cuida</label>
              <select
                id="fs-resp"
                className="filtro"
                value={f.responsavelId}
                onChange={(e) => setF({ ...f, responsavelId: e.target.value })}
              >
                <option value="">Rodízio da equipe</option>
                {pessoas.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
            <CampoEtiquetas
              id="fs-etiquetas"
              rotulo="Etiquetas no lead"
              valor={f.etiquetas}
              aoMudar={(v) => setF({ ...f, etiquetas: v })}
            />
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.avisar}
                onChange={(e) => setF({ ...f, avisar: e.target.checked })}
              />
              Avisar quem cuida (notificação no sistema e no celular)
            </label>
            <div className="campo">
              <label htmlFor="fs-boas">WhatsApp de boas-vindas (opcional)</label>
              <textarea
                id="fs-boas"
                className="filtro"
                rows={3}
                maxLength={900}
                placeholder="Oi, {nome}! Recebemos seu contato pelo site. Posso te ligar hoje?"
                value={f.boasVindas}
                onChange={(e) => setF({ ...f, boasVindas: e.target.value })}
              />
              <span className="campo__dica">
                Sai pelo WhatsApp da conta, no horário de envio, só para lead novo.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="fs-redir">Página de obrigado (formulário HTML puro)</label>
              <input
                id="fs-redir"
                className="filtro"
                placeholder="https://seusite.com.br/obrigado"
                value={f.redirecionar}
                onChange={(e) => setF({ ...f, redirecionar: e.target.value })}
              />
            </div>
          </div>
        </div>
        <ErroDaApi erro={salvar.error ?? tirar.error} />
        {salvar.isSuccess && <Mensagem tipo="ok">Salvo. Vale para o próximo envio.</Mensagem>}
        <div className="acoes">
          <Button type="button" variant="ghost" onClick={() => setApagar(true)}>
            Apagar formulário
          </Button>
          <Button type="submit" variant="primary" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </form>

      <div className="campo int-envios">
        <span className="campo__rotulo">Últimos envios</span>
        {envios.data?.length ? (
          <ul>
            {envios.data.map((e) => (
              <li key={e.id}>
                <span className="quieto">{fmtQuando(e.recebidoEm)}</span>
                <span>
                  {e.lead ? (
                    <a href={`/funil?empresa=${e.empresaId}`}>{e.lead}</a>
                  ) : (
                    <span className="quieto">{e.erro ?? '—'}</span>
                  )}
                </span>
                <Badge tone={RESULTADO_ENVIO[e.resultado].tom}>{RESULTADO_ENVIO[e.resultado].rotulo}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quieto">Nenhum envio ainda.</p>
        )}
      </div>
      {apagar && (
        <Modal
          titulo={`Apagar o formulário “${props.f.nome}”?`}
          aoFechar={() => setApagar(false)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setApagar(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                disabled={tirar.isPending}
                onClick={() => tirar.mutate(undefined, { onSuccess: () => setApagar(false) })}
              >
                Apagar “{props.f.nome}”
              </Button>
            </>
          }
        >
          <p>
            O endereço para de receber na hora: o site que ainda manda para ele vai dar erro. Os leads que já
            entraram continuam no funil.
          </p>
        </Modal>
      )}
    </Panel>
  );
}

/* ───────────────────────────── Avisos ───────────────────────────── */

function Avisos(props: { criar: boolean; aoFecharCriar: () => void }) {
  const q = useQuery({
    queryKey: ['integracoes-avisos'],
    queryFn: () => api<Aviso[]>('/integracoes/avisos'),
    refetchInterval: 15_000,
  });
  const [sel, setSel] = useState<number | null>(null);
  const [editar, setEditar] = useState<Aviso | null>(null);
  const lista = q.data ?? [];
  const atual = lista.find((a) => a.id === sel) ?? lista[0];
  if (q.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  return (
    <>
      {!lista.length ? (
        <EmptyState
          icone="webhook"
          titulo="Nenhum aviso ainda"
          texto="Um aviso manda os acontecimentos do CRM (lead criado, ganho, perdido, reunião marcada…) para o endereço de outro sistema, na hora."
        />
      ) : (
        <div className="int-duas">
          <div>
            <ul className="int-lista" aria-label="Avisos">
              {lista.map((a) => {
                const total = a.entregues + a.falhas;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="int-item"
                      aria-current={atual?.id === a.id || undefined}
                      onClick={() => setSel(a.id)}
                    >
                      <span>
                        <b>{a.nome}</b>
                        <small className="mono int-url">{a.url}</small>
                        <span className="int-eventos">
                          {a.eventos.map((e) => (
                            <span key={e} className="int-perm">
                              {EVENTOS_AVISO[e] ?? e}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="int-item__dir">
                        {a.situacao === 'pausado' ? (
                          <Badge tone="warning">pausado</Badge>
                        ) : a.falhandoDesde ? (
                          <Badge tone="danger">falhando</Badge>
                        ) : (
                          <Badge tone="brand">
                            {total ? `${Math.floor((a.entregues / total) * 1000) / 10}% entregues` : 'ativo'}
                          </Badge>
                        )}
                        {a.falhandoDesde && <small>desde {fmtQuando(a.falhandoDesde)}</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Panel className="int-sobre">
              <span className="campo__rotulo">Segurança</span>
              <p className="quieto">
                Cada aviso vai assinado no cabeçalho <code>X-Prospect-Assinatura</code> (HMAC-SHA256 com o
                segredo do aviso). Se o seu sistema não responder 2xx em 10 segundos, o CRM tenta de novo 6
                vezes (1 min, 5 min, 30 min, 2 h, 6 h e 24 h). Falhando por 3 dias seguidos, o aviso é pausado
                e os administradores recebem um alerta.
              </p>
            </Panel>
          </div>
          {atual && <DetalheAviso key={atual.id} a={atual} aoEditar={() => setEditar(atual)} />}
        </div>
      )}
      {(props.criar || editar) && (
        <EditarAviso
          a={editar}
          aoFechar={() => {
            setEditar(null);
            props.aoFecharCriar();
          }}
        />
      )}
    </>
  );
}

const ROTULO_ENTREGA: Record<Entrega['situacao'], string> = {
  entregue: 'entregue',
  pendente: 'tentando de novo',
  falhou: 'falhou',
};

function DetalheAviso(props: { a: Aviso; aoEditar: () => void }) {
  const { a } = props;
  const cliente = useQueryClient();
  const entregas = useQuery({
    queryKey: ['integracoes-entregas', a.id],
    queryFn: () => api<Entrega[]>(`/integracoes/avisos/${a.id}/entregas`),
    refetchInterval: 10_000,
  });
  const [aberta, setAberta] = useState<number | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [apagar, setApagar] = useState(false);
  const atualizar = () => {
    cliente.invalidateQueries({ queryKey: ['integracoes-entregas', a.id] });
    cliente.invalidateQueries({ queryKey: ['integracoes-avisos'] });
  };
  const acao = useMutation({
    mutationFn: (p: { caminho: string; metodo?: string }) =>
      api<{ segredo?: string }>(`/integracoes${p.caminho}`, { metodo: p.metodo ?? 'POST' }),
    onSuccess: (r) => {
      if (r?.segredo) setSegredo(r.segredo);
      atualizar();
    },
  });
  const verSegredo = useMutation({
    mutationFn: () => api<{ segredo: string }>(`/integracoes/avisos/${a.id}/segredo`),
    onSuccess: (r) => setSegredo(r.segredo),
  });
  const lista = entregas.data ?? [];
  const selecionada =
    lista.find((e) => e.id === aberta) ?? lista.find((e) => e.situacao !== 'entregue') ?? lista[0];
  return (
    <Panel
      semPadding
      className="int-detalhe"
      titulo={`Entregas · ${a.nome}`}
      acoes={
        <span className="int-acoes">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => acao.mutate({ caminho: `/avisos/${a.id}/testar` })}
          >
            Enviar teste
          </Button>
          <Button size="sm" variant="secondary" icon="key-round" onClick={() => verSegredo.mutate()}>
            Segredo
          </Button>
          <Button size="sm" variant="ghost" onClick={props.aoEditar}>
            Editar
          </Button>
        </span>
      }
    >
      {a.situacao === 'pausado' && (
        <div className="int-faixa">
          <Mensagem tipo="aviso">
            {a.pausadoMotivo ?? 'Pausado.'} Os eventos de agora não são guardados para este aviso.{' '}
            <button
              type="button"
              className="link-botao"
              onClick={() => acao.mutate({ caminho: `/avisos/${a.id}/ativar` })}
            >
              Ativar de novo
            </button>
          </Mensagem>
        </div>
      )}
      {lista.length ? (
        <div className="pp-tablewrap">
          <table className="pp-table int-entregas">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Evento</th>
                <th>Resposta</th>
                <th className="num">Tentativas</th>
                <th>
                  <span className="pp-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr
                  key={e.id}
                  data-situacao={e.situacao}
                  aria-selected={selecionada?.id === e.id}
                  onClick={() => setAberta(e.id)}
                >
                  <td>{fmtQuando(e.criadoEm)}</td>
                  <td>
                    {e.evento === 'teste' ? 'teste' : (EVENTOS_AVISO[e.evento] ?? e.evento)}
                    {e.lead && <b> · {e.lead}</b>}
                    {e.erro && e.situacao !== 'entregue' && <small className="int-erro">{e.erro}</small>}
                  </td>
                  <td>
                    <span
                      className={`mono int-status${e.situacao === 'entregue' ? '' : ' int-status--erro'}`}
                    >
                      {e.statusHttp != null
                        ? `${e.statusHttp}${e.duracaoMs != null ? ` · ${e.duracaoMs} ms` : ''}`
                        : e.tentativas
                          ? 'sem resposta'
                          : 'na fila'}
                    </span>
                    <small>{ROTULO_ENTREGA[e.situacao]}</small>
                  </td>
                  <td className="num">
                    {e.tentativas} de 7
                    {e.situacao === 'pendente' && e.tentativas > 0 && (
                      <small>próxima {fmtDaqui(e.proximaEm)}</small>
                    )}
                  </td>
                  <td className="num">
                    {e.situacao !== 'entregue' && e.tentativas > 0 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          acao.mutate({ caminho: `/entregas/${e.id}/reenviar` });
                        }}
                      >
                        Reenviar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="quieto int-faixa">
          Ainda nada enviado. Use <b>Enviar teste</b> para conferir se o seu sistema recebe e confere a
          assinatura.
        </p>
      )}
      {selecionada?.corpo != null && (
        <div className="int-faixa">
          <span className="campo__rotulo">O que foi enviado</span>
          <Codigo>{JSON.stringify(selecionada.corpo, null, 2)}</Codigo>
          {selecionada.resposta && (
            <p className="quieto">
              Resposta do seu sistema: <code>{selecionada.resposta.slice(0, 200)}</code>
            </p>
          )}
        </div>
      )}
      <div className="int-faixa acoes">
        {a.situacao === 'ativo' ? (
          <Button variant="ghost" onClick={() => acao.mutate({ caminho: `/avisos/${a.id}/pausar` })}>
            Pausar
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => acao.mutate({ caminho: `/avisos/${a.id}/ativar` })}>
            Ativar
          </Button>
        )}
        <Button variant="ghost" onClick={() => setApagar(true)}>
          Apagar aviso
        </Button>
      </div>
      <ErroDaApi erro={acao.error ?? verSegredo.error} />
      {segredo && (
        <Modal
          titulo="Segredo da assinatura"
          aoFechar={() => setSegredo(null)}
          rodape={
            <>
              <Button
                variant="ghost"
                onClick={() => acao.mutate({ caminho: `/avisos/${a.id}/segredo` })}
                disabled={acao.isPending}
              >
                Trocar o segredo
              </Button>
              <Button variant="primary" onClick={() => setSegredo(null)}>
                Fechar
              </Button>
            </>
          }
        >
          <div className="int-endereco">
            <code className="mono">{segredo}</code>
            <Copiar valor={segredo} />
          </div>
          <p className="quieto">
            O seu sistema calcula o HMAC-SHA256 de <code>&lt;t&gt;.&lt;corpo&gt;</code> com este segredo e
            compara com o <code>v1</code> do cabeçalho. Trocar o segredo vale para os próximos avisos.
          </p>
        </Modal>
      )}
      {apagar && (
        <Modal
          titulo={`Apagar o aviso “${a.nome}”?`}
          aoFechar={() => setApagar(false)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setApagar(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  acao.mutate(
                    { caminho: `/avisos/${a.id}`, metodo: 'DELETE' },
                    { onSuccess: () => setApagar(false) },
                  )
                }
              >
                Apagar “{a.nome}”
              </Button>
            </>
          }
        >
          <p>O endereço deixa de receber os eventos na hora, e o histórico de entregas some junto.</p>
        </Modal>
      )}
    </Panel>
  );
}

function EditarAviso(props: { a: Aviso | null; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [nome, setNome] = useState(props.a?.nome ?? '');
  const [url, setUrl] = useState(props.a?.url ?? 'https://');
  const [eventos, setEventos] = useState<EventoAviso[]>(props.a?.eventos ?? ['lead.criado', 'lead.ganho']);
  const salvar = useMutation({
    mutationFn: () =>
      props.a
        ? api<{ segredo?: string }>(`/integracoes/avisos/${props.a.id}`, {
            metodo: 'PUT',
            corpo: { nome: nome.trim(), url: url.trim(), eventos },
          })
        : api<{ id: number; segredo: string }>('/integracoes/avisos', {
            metodo: 'POST',
            corpo: { nome: nome.trim(), url: url.trim(), eventos },
          }),
    onSuccess: (r) => {
      cliente.invalidateQueries({ queryKey: ['integracoes-avisos'] });
      if (props.a || !r?.segredo) props.aoFechar();
    },
  });
  const segredo = !props.a ? salvar.data?.segredo : undefined;
  return (
    <Modal
      titulo={props.a ? `Editar “${props.a.nome}”` : 'Novo aviso (webhook)'}
      aoFechar={props.aoFechar}
      largura="media"
      rodape={
        segredo ? (
          <Button variant="primary" onClick={props.aoFechar}>
            Concluir
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={props.aoFechar}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={
                salvar.isPending ||
                nome.trim().length < 2 ||
                !eventos.length ||
                !/^https:\/\/.+\..+/.test(url.trim())
              }
              onClick={() => salvar.mutate()}
            >
              {props.a ? 'Salvar' : 'Criar aviso'}
            </Button>
          </>
        )
      }
    >
      {segredo ? (
        <div className="int-uma-vez__caixa">
          <b>Aviso criado. Guarde o segredo da assinatura:</b>
          <div className="int-uma-vez__chave">
            <code className="mono">{segredo}</code>
            <Copiar valor={segredo} />
          </div>
          <p className="quieto">
            Use “Enviar teste” para conferir se o seu sistema recebe e confere a assinatura.
          </p>
        </div>
      ) : (
        <div className="form">
          <div className="campo">
            <label htmlFor="av-nome">Nome</label>
            <input
              id="av-nome"
              className="filtro"
              maxLength={80}
              placeholder="Ex.: ERP Bling"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="av-url">Endereço que recebe (https)</label>
            <input
              id="av-url"
              className="filtro mono"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <fieldset className="campo">
            <legend>Quando avisar</legend>
            <div className="int-eventos-grade">
              {LISTA_EVENTOS_AVISO.map((e) => (
                <label key={e} className="opcao">
                  <input
                    type="checkbox"
                    checked={eventos.includes(e)}
                    onChange={(x) =>
                      setEventos(x.target.checked ? [...eventos, e] : eventos.filter((y) => y !== e))
                    }
                  />
                  {EVENTOS_AVISO[e]}
                </label>
              ))}
            </div>
          </fieldset>
          <ErroDaApi erro={salvar.error} />
        </div>
      )}
    </Modal>
  );
}
