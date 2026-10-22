import { Badge, Button, EmptyState, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import {
  api,
  type ItemConhecimento,
  type LacunaIa,
  type TelaConhecimento,
  type TrechoAchado,
  type VerificacaoIa,
} from '../api';
import { fmtNome, fmtNumero, fmtQuando } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';
import { useEhAdmin } from './Sessao';

const CHAVE = ['agente', 'conhecimento'];

export function useConhecimento() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () => api<TelaConhecimento>('/agente/conhecimento'),
    refetchInterval: 60_000,
  });
}

function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

const ROTULO_TIPO: Record<ItemConhecimento['tipo'], string> = {
  faq: 'Pergunta e resposta',
  texto: 'Texto',
  arquivo: 'Arquivo',
};

/* ───────────── Testar: o que a IA leria ───────────── */

/** O trecho sem o título repetido na primeira linha, cortado em 400 caracteres. */
function semTitulo(t: TrechoAchado): string {
  const texto = t.texto.startsWith(`${t.titulo}\n`) ? t.texto.slice(t.titulo.length + 1) : t.texto;
  return texto.length > 400 ? `${texto.slice(0, 400)}…` : texto;
}

function Testar() {
  const [pergunta, setPergunta] = useState('');
  const testar = useMutation({
    mutationFn: () =>
      api<TrechoAchado[]>('/agente/conhecimento/testar', { metodo: 'POST', corpo: { pergunta } }),
  });
  return (
    <form
      className="pilha"
      style={{ gap: 8 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (pergunta.trim().length >= 2) testar.mutate();
      }}
    >
      <label htmlFor="base-testar" className="rotulo-forte">
        Testar a base
      </label>
      <div className="barra">
        <input
          id="base-testar"
          className="filtro"
          style={{ flex: '1 1 320px' }}
          placeholder="Escreva como um lead perguntaria. Ex.: vocês atendem em Camaçari?"
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          icon="search"
          disabled={testar.isPending || pergunta.trim().length < 2}
        >
          Testar
        </Button>
      </div>
      <ErroDaApi erro={testar.error} />
      {testar.data &&
        (testar.data.length ? (
          <div className="pilha" style={{ gap: 6 }}>
            <span className="quieto" style={{ fontSize: 12 }}>
              A IA leria {testar.data.length === 1 ? 'este trecho' : `estes ${testar.data.length} trechos`},
              além do resumo da empresa:
            </span>
            {testar.data.map((t) => (
              <div key={`${t.conhecimentoId}-${t.texto.slice(0, 60)}`} className="trecho">
                <b>{t.titulo}</b>
                <p className="trecho__texto">{semTitulo(t)}</p>
              </div>
            ))}
          </div>
        ) : (
          <Mensagem tipo="aviso">
            Nada na base fala disso. A IA responderia só com o resumo da empresa ou passaria para você.
          </Mensagem>
        ))}
    </form>
  );
}

/* ───────────── Novo item ───────────── */

type Modo = 'faq' | 'texto' | 'arquivo';

function NovoItem(props: { aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [modo, setModo] = useState<Modo>('faq');
  const [f, setF] = useState({ titulo: '', pergunta: '', conteudo: '' });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const salvar = useMutation({
    mutationFn: async () => {
      if (modo === 'arquivo') {
        if (!arquivo) throw new Error('Escolha o arquivo.');
        return api('/agente/conhecimento/arquivo', {
          metodo: 'POST',
          corpo: {
            nome: arquivo.name,
            mime: arquivo.type || 'application/octet-stream',
            titulo: f.titulo || undefined,
            base64: await lerBase64(arquivo),
          },
        });
      }
      return api('/agente/conhecimento', {
        metodo: 'POST',
        corpo: {
          tipo: modo,
          titulo: modo === 'faq' ? f.titulo || f.pergunta.slice(0, 120) : f.titulo,
          pergunta: modo === 'faq' ? f.pergunta : undefined,
          conteudo: f.conteudo,
        },
      });
    },
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: CHAVE });
      props.aoFechar();
    },
  });
  const pronto =
    modo === 'arquivo'
      ? !!arquivo
      : modo === 'faq'
        ? f.pergunta.trim().length >= 5 && f.conteudo.trim().length >= 5
        : f.titulo.trim().length >= 2 && f.conteudo.trim().length >= 5;

  return (
    <form
      className="form caixa"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <fieldset className="segmentos segmentos--mini" aria-label="Tipo">
        {(
          [
            ['faq', 'Pergunta e resposta'],
            ['texto', 'Texto'],
            ['arquivo', 'Arquivo (PDF, TXT)'],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            className="segmento"
            aria-pressed={modo === id}
            data-ativo={modo === id || undefined}
            onClick={() => setModo(id)}
          >
            {rotulo}
          </button>
        ))}
      </fieldset>
      {modo === 'faq' && (
        <>
          <div className="campo">
            <label htmlFor="base-pergunta">Pergunta do lead</label>
            <input
              id="base-pergunta"
              className="filtro"
              maxLength={500}
              placeholder="Ex.: Vocês atendem em Feira de Santana?"
              value={f.pergunta}
              onChange={(e) => setF({ ...f, pergunta: e.target.value })}
            />
          </div>
          <div className="campo">
            <label htmlFor="base-resposta">Resposta</label>
            <textarea
              id="base-resposta"
              rows={3}
              value={f.conteudo}
              onChange={(e) => setF({ ...f, conteudo: e.target.value })}
            />
            <span className="campo__dica">
              A IA usa a resposta com as palavras dela, sem inventar nada além.
            </span>
          </div>
        </>
      )}
      {modo === 'texto' && (
        <>
          <div className="campo">
            <label htmlFor="base-titulo">Título</label>
            <input
              id="base-titulo"
              className="filtro"
              maxLength={200}
              placeholder="Ex.: Planos e preços, Cidades atendidas, Política de troca"
              value={f.titulo}
              onChange={(e) => setF({ ...f, titulo: e.target.value })}
            />
          </div>
          <div className="campo">
            <label htmlFor="base-conteudo">Conteúdo</label>
            <textarea
              id="base-conteudo"
              rows={8}
              value={f.conteudo}
              onChange={(e) => setF({ ...f, conteudo: e.target.value })}
            />
            <span className="campo__dica">
              Pode ser longo (catálogo, tabela de cidades, condições). A IA lê só a parte que tem a ver com o
              que o lead perguntou.
            </span>
          </div>
        </>
      )}
      {modo === 'arquivo' && (
        <>
          <div className="campo">
            <label htmlFor="base-arquivo">Arquivo</label>
            <input
              id="base-arquivo"
              type="file"
              accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
            <span className="campo__dica">
              PDF com texto (não escaneado), TXT, Markdown ou CSV, até 10 MB. Guardamos só o texto.
            </span>
          </div>
          <div className="campo">
            <label htmlFor="base-titulo-arq">Título (opcional)</label>
            <input
              id="base-titulo-arq"
              className="filtro"
              maxLength={200}
              placeholder="Usa o nome do arquivo"
              value={f.titulo}
              onChange={(e) => setF({ ...f, titulo: e.target.value })}
            />
          </div>
        </>
      )}
      <ErroDaApi erro={salvar.error} />
      <div className="acoes">
        <Button type="submit" variant="primary" disabled={salvar.isPending || !pronto}>
          {salvar.isPending ? 'Salvando…' : 'Adicionar à base'}
        </Button>
        <Button variant="ghost" onClick={props.aoFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/* ───────────── Item da base ───────────── */

function LinhaItem(props: { item: ItemConhecimento; admin: boolean }) {
  const { item } = props;
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(item.status === 'sugerido');
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState({ titulo: item.titulo, pergunta: item.pergunta ?? '', conteudo: item.conteudo });
  const atualizar = () => cliente.invalidateQueries({ queryKey: CHAVE });
  const salvar = useMutation({
    mutationFn: (aprovar: boolean) =>
      api(`/agente/conhecimento/${item.id}`, {
        metodo: 'PATCH',
        corpo: {
          ...(editando
            ? {
                titulo: f.titulo,
                conteudo: f.conteudo,
                ...(item.tipo === 'faq' ? { pergunta: f.pergunta } : {}),
              }
            : {}),
          ...(aprovar ? { aprovar: true } : {}),
        },
      }),
    onSuccess: () => {
      setEditando(false);
      atualizar();
    },
  });
  const arquivar = useMutation({
    mutationFn: () => api(`/agente/conhecimento/${item.id}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const sugerido = item.status === 'sugerido';

  return (
    <li className="base-item" data-sugerido={sugerido || undefined}>
      <button
        type="button"
        className="base-item__topo"
        onClick={() => setAberto(!aberto)}
        aria-expanded={aberto}
      >
        <Icon
          name={item.tipo === 'arquivo' ? 'paperclip' : item.tipo === 'faq' ? 'circle-help' : 'file-text'}
          size={14}
        />
        <b className="base-item__titulo">
          {item.tipo === 'faq' && item.pergunta ? item.pergunta : item.titulo}
        </b>
        {sugerido ? (
          <Badge tone="warning">Aprendido: aprovar?</Badge>
        ) : (
          <span className="quieto base-item__uso">
            {item.usos ? `usado ${fmtNumero(item.usos)}x · ${fmtQuando(item.usadoEm)}` : 'ainda não usado'}
          </span>
        )}
        <Icon name="chevron-down" size={14} className="base-item__seta" />
      </button>
      {aberto && (
        <div className="base-item__corpo">
          <span className="quieto" style={{ fontSize: 12 }}>
            {ROTULO_TIPO[item.tipo]}
            {item.origem === 'conversa' && item.empresaNome
              ? ` · aprendido com a conversa com ${fmtNome(item.empresaNome)}`
              : item.criadoPorNome
                ? ` · por ${item.criadoPorNome}`
                : ''}{' '}
            · {fmtQuando(item.criadoEm)}
          </span>
          {editando ? (
            <div className="form">
              {item.tipo === 'faq' ? (
                <div className="campo">
                  <label htmlFor={`base-p-${item.id}`}>Pergunta</label>
                  <input
                    id={`base-p-${item.id}`}
                    className="filtro"
                    value={f.pergunta}
                    onChange={(e) => setF({ ...f, pergunta: e.target.value })}
                  />
                </div>
              ) : (
                <div className="campo">
                  <label htmlFor={`base-t-${item.id}`}>Título</label>
                  <input
                    id={`base-t-${item.id}`}
                    className="filtro"
                    value={f.titulo}
                    onChange={(e) => setF({ ...f, titulo: e.target.value })}
                  />
                </div>
              )}
              <div className="campo">
                <label htmlFor={`base-c-${item.id}`}>{item.tipo === 'faq' ? 'Resposta' : 'Conteúdo'}</label>
                <textarea
                  id={`base-c-${item.id}`}
                  rows={item.tipo === 'faq' ? 3 : 10}
                  value={f.conteudo}
                  onChange={(e) => setF({ ...f, conteudo: e.target.value })}
                />
              </div>
            </div>
          ) : (
            <p className="base-item__texto">
              {item.conteudo.length > 1500 ? `${item.conteudo.slice(0, 1500)}…` : item.conteudo}
            </p>
          )}
          {props.admin && (
            <div className="acoes">
              {sugerido && (
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  disabled={salvar.isPending}
                  onClick={() => salvar.mutate(true)}
                >
                  {editando ? 'Salvar e aprovar' : 'Aprovar'}
                </Button>
              )}
              {editando && !sugerido && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={salvar.isPending}
                  onClick={() => salvar.mutate(false)}
                >
                  Salvar
                </Button>
              )}
              {!editando && (
                <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>
                  Editar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={arquivar.isPending}
                onClick={() => arquivar.mutate()}
              >
                {sugerido ? 'Recusar' : 'Tirar da base'}
              </Button>
            </div>
          )}
          <ErroDaApi erro={salvar.error ?? arquivar.error} />
        </div>
      )}
    </li>
  );
}

/** Aba "Base de conhecimento": o que a IA sabe, com busca de teste e o que ela aprendeu esperando aprovação. */
export function BaseConhecimento() {
  const admin = useEhAdmin();
  const q = useConhecimento();
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState('');
  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const d = q.data;
  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? d.itens.filter((i) => `${i.titulo} ${i.pergunta ?? ''} ${i.conteudo}`.toLowerCase().includes(termo))
    : d.itens;
  const sugeridos = filtrados.filter((i) => i.status === 'sugerido');
  const ativos = filtrados.filter((i) => i.status === 'ativo');

  return (
    <>
      <Panel
        titulo="Base de conhecimento"
        contagem={d.numeros.ativos}
        acoes={
          admin && !novo ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => setNovo(true)}>
              Adicionar
            </Button>
          ) : undefined
        }
      >
        <p className="quieto" style={{ margin: '0 0 12px', fontSize: 13 }}>
          Tudo o que a IA pode dizer aos leads: perguntas frequentes, preços, cidades, condições, catálogo. A
          cada mensagem ela lê só os trechos que têm a ver com o que o lead escreveu, e o que não estiver aqui
          ela não inventa: passa para você e a pergunta aparece em “O que falta ensinar”.
        </p>
        {novo && <NovoItem aoFechar={() => setNovo(false)} />}
        <Testar />
      </Panel>

      {sugeridos.length > 0 && (
        <Panel titulo="Aprendido com as conversas" contagem={sugeridos.length}>
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            Respostas que o time deu quando a IA não sabia, escritas para valer para todos os leads. Só entram
            na base depois de aprovadas.
          </p>
          <ul className="base-lista">
            {sugeridos.map((i) => (
              <LinhaItem key={i.id} item={i} admin={admin} />
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        titulo="O que a IA sabe"
        contagem={ativos.length}
        acoes={
          d.itens.length > 6 ? (
            <input
              className="filtro"
              aria-label="Buscar na base"
              placeholder="Buscar…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          ) : undefined
        }
      >
        {ativos.length ? (
          <ul className="base-lista">
            {ativos.map((i) => (
              <LinhaItem key={i.id} item={i} admin={admin} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icone="bot"
            titulo={termo ? 'Nada com esse termo' : 'A base está vazia'}
            texto={
              termo
                ? 'Tente outra palavra.'
                : 'Comece pelas 5 perguntas que os leads mais fazem (preço, cidades, prazo, como funciona, pagamento).'
            }
          />
        )}
      </Panel>
    </>
  );
}

/* ───────────── O que falta ensinar ───────────── */

function LinhaLacuna(props: {
  l: LacunaIa;
  admin: boolean;
  aoAbrirLead: (id: number) => void;
  aoVerSugestao: () => void;
}) {
  const { l } = props;
  const cliente = useQueryClient();
  const [resposta, setResposta] = useState('');
  const atualizar = () => cliente.invalidateQueries({ queryKey: CHAVE });
  const ensinar = useMutation({
    mutationFn: () => api(`/agente/lacunas/${l.id}/ensinar`, { metodo: 'POST', corpo: { resposta } }),
    onSuccess: atualizar,
  });
  const dispensar = useMutation({
    mutationFn: () => api(`/agente/lacunas/${l.id}/dispensar`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  return (
    <li className="lacuna">
      <div className="lacuna__topo">
        <b>“{l.pergunta}”</b>
        <span className="quieto">
          <button type="button" className="link-botao" onClick={() => props.aoAbrirLead(l.empresaId)}>
            {l.empresaNome ? fmtNome(l.empresaNome) : 'Lead'}
          </button>{' '}
          · {fmtQuando(l.criadoEm)}
        </span>
      </div>
      {l.sugestaoId ? (
        <span className="quieto" style={{ fontSize: 13 }}>
          O time já respondeu este lead e a IA preparou uma sugestão.{' '}
          <button type="button" className="link-botao" onClick={props.aoVerSugestao}>
            Revisar na base
          </button>
        </span>
      ) : (
        props.admin && (
          <form
            className="lacuna__form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (resposta.trim().length >= 2) ensinar.mutate();
            }}
          >
            <label className="pp-sr" htmlFor={`lacuna-${l.id}`}>
              Resposta para “{l.pergunta}”
            </label>
            <textarea
              id={`lacuna-${l.id}`}
              rows={2}
              placeholder="Escreva a resposta: ela entra na base e a IA passa a responder isso sozinha."
              value={resposta}
              onChange={(e) => setResposta(e.target.value)}
            />
            <div className="acoes">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={ensinar.isPending || resposta.trim().length < 2}
              >
                Ensinar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={dispensar.isPending}
                onClick={() => dispensar.mutate()}
              >
                Dispensar
              </Button>
            </div>
          </form>
        )
      )}
      <ErroDaApi erro={ensinar.error ?? dispensar.error} />
    </li>
  );
}

const ROTULO_REGRA: Record<string, string> = {
  vazia: 'vazia',
  longa: 'longa demais',
  perguntas_demais: 'perguntas demais',
  preco_fora_da_base: 'preço fora da base',
  link_fora_da_base: 'link fora da base',
  contato_fora_da_base: 'contato fora da base',
  repetida: 'repetida',
  formatacao: 'formatação',
  texto_de_robo: 'falou como robô',
  promessa: 'promessa sem base',
  retorno_sem_passar: '“te retorno” sem passar para o time',
  agenda_sem_reuniao: 'disse que marcou sem marcar',
};

function LinhaVerificacao(props: { v: VerificacaoIa; aoAbrirLead: (id: number) => void }) {
  const { v } = props;
  return (
    <li className="verificacao">
      <div className="lacuna__topo">
        <Badge tone={v.resultado === 'bloqueada' ? 'danger' : 'outline'}>
          {v.resultado === 'bloqueada' ? 'Não enviada' : 'Corrigida pela IA'}
        </Badge>
        <span className="quieto">
          <button type="button" className="link-botao" onClick={() => props.aoAbrirLead(v.empresaId)}>
            {v.empresaNome ? fmtNome(v.empresaNome) : 'Lead'}
          </button>{' '}
          · {fmtQuando(v.criadoEm)}
        </span>
      </div>
      <p className="verificacao__texto">“{v.texto}”</p>
      <span className="quieto" style={{ fontSize: 12 }}>
        Barrada por: {v.problemas.map((p) => ROTULO_REGRA[p.regra] ?? p.regra).join(', ')}
      </span>
    </li>
  );
}

/** Aba "O que falta ensinar": perguntas sem resposta na base e o que as verificações barraram. */
export function Aprendizados(props: { aoAbrirLead: (id: number) => void; aoVerBase: () => void }) {
  const admin = useEhAdmin();
  const q = useConhecimento();
  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const d = q.data;
  return (
    <>
      <Panel titulo="Perguntas que a IA não soube responder" contagem={d.lacunas.length}>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Quando o lead pergunta algo que não está na base, a IA não inventa: passa para você e a pergunta
          fica aqui. Responda uma vez e ela passa a responder sozinha. Se você responder direto na conversa, a
          IA transforma a sua resposta em sugestão para a base.
        </p>
        {d.lacunas.length ? (
          <ul className="lacunas">
            {d.lacunas.map((l) => (
              <LinhaLacuna
                key={l.id}
                l={l}
                admin={admin}
                aoAbrirLead={props.aoAbrirLead}
                aoVerSugestao={props.aoVerBase}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icone="check-check"
            titulo="Nada pendente"
            texto="A IA respondeu tudo o que perguntaram."
          />
        )}
      </Panel>
      <Panel titulo="Mensagens barradas antes de sair" contagem={d.verificacoes.length}>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Antes de cada envio conferimos se a IA citou preço, link ou contato que não estão na base, prometeu
          o que não pode, repetiu mensagem ou disse que ia retornar sem avisar o time. A mensagem com problema
          volta para a IA corrigir; se ainda assim não passar, ela não sai e o lead vai para você.
        </p>
        {d.verificacoes.length ? (
          <ul className="lacunas">
            {d.verificacoes.map((v) => (
              <LinhaVerificacao key={v.id} v={v} aoAbrirLead={props.aoAbrirLead} />
            ))}
          </ul>
        ) : (
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            Nenhuma mensagem barrada.
          </p>
        )}
      </Panel>
    </>
  );
}
