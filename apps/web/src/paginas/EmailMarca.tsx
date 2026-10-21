import { montarEmail } from '@prospeccao/shared/email';
import { Button, Icon } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  api,
  type CanalSequencia,
  type LeadPrevia,
  type MarcaEmail,
  type PassoSequencia,
  type PreviaEmail,
} from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin } from '../componentes/Sessao';
import { fmtCidade, fmtNome } from '../formatar';

/* ───────────────────────── Comum ───────────────────────── */

export function useMarcas() {
  return useQuery({ queryKey: ['email', 'marcas'], queryFn: () => api<MarcaEmail[]>('/email/marcas') });
}

export function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(arquivo);
  });
}

export const fmtTamanho = (b: number) =>
  b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

type Tela = 'computador' | 'celular';

/**
 * O e-mail como o lead recebe: remetente, assunto, corpo (no tamanho do computador ou do celular),
 * a abertura que a IA escreveu e os anexos.
 */
export function JanelaEmail(props: {
  previa: PreviaEmail | undefined;
  carregando?: boolean;
  /** Mostra a linha "Para" com o lead da prévia. */
  para?: string | null;
}) {
  const [tela, setTela] = useState<Tela>('computador');
  const p = props.previa;
  return (
    <div className="previa-email" data-tela={tela}>
      <div className="previa-email__cabeca">
        <div className="previa-email__linha">
          <span className="quieto">
            De: <b>{p ? `${p.de.nome}${p.de.email ? ` <${p.de.email}>` : ''}` : '—'}</b>
          </span>
          <fieldset className="segmentos segmentos--mini" aria-label="Tamanho da tela">
            {(['computador', 'celular'] as Tela[]).map((t) => (
              <button
                key={t}
                type="button"
                className="segmento"
                aria-pressed={tela === t}
                data-ativo={tela === t || undefined}
                onClick={() => setTela(t)}
              >
                {t === 'computador' ? 'Computador' : 'Celular'}
              </button>
            ))}
          </fieldset>
        </div>
        <span className="quieto">
          Para:{' '}
          <b>
            {props.para ??
              (p ? `${fmtNome(p.lead.empresa)}${p.lead.contato ? ` (${p.lead.contato})` : ''}` : '—')}
          </b>
        </span>
        {p?.responderPara && (
          <span className="quieto">
            Responder para: <b>{p.responderPara}</b>
          </span>
        )}
        <span className="previa-email__assunto">{p?.assunto || 'Sem assunto'}</span>
        {p && p.anexos.length > 0 && (
          <ul className="previa-email__anexos">
            {p.anexos.map((a) => (
              <li key={a.id} className="previa-email__anexo">
                <Icon name="paperclip" size={12} /> {a.nome}{' '}
                <span className="quieto">{fmtTamanho(a.tamanho)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {p?.abertura && (
        <div className="previa-email__ia">
          <span className="previa-email__icone">
            <Icon name="bot" size={14} />
          </span>
          <span>
            <b>Abertura escrita pela IA para este lead:</b> {p.abertura}
          </span>
        </div>
      )}
      {p?.aviso && (
        <div className="previa-email__aviso">
          <span className="previa-email__icone">
            <Icon name="circle-help" size={14} />
          </span>
          <span>{p.aviso}</span>
        </div>
      )}
      <div className="previa-email__moldura" aria-busy={props.carregando || undefined}>
        {p ? (
          <iframe title="Prévia do e-mail" className="previa-email__corpo" sandbox="" srcDoc={p.html} />
        ) : (
          <div className="esqueleto" />
        )}
      </div>
    </div>
  );
}

/** Escolher o lead de verdade que aparece na prévia (os que a campanha alcança, com e-mail primeiro). */
export function EscolherLead(props: {
  campanhaId?: number | null;
  valor: number | null;
  aoMudar: (id: number | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const [atraso, setAtraso] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAtraso(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const q = useQuery({
    queryKey: ['email', 'leads-previa', props.campanhaId ?? null, atraso],
    queryFn: () => {
      const p = new URLSearchParams();
      if (props.campanhaId) p.set('campanhaId', String(props.campanhaId));
      if (atraso) p.set('busca', atraso);
      return api<LeadPrevia[]>(`/email/leads?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  return (
    <div className="campo">
      <label htmlFor="previa-lead">Ver com o lead</label>
      <div className="escolher-lead">
        <input
          className="filtro"
          type="search"
          placeholder="Buscar pelo nome"
          aria-label="Buscar lead"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select
          id="previa-lead"
          className="filtro"
          value={props.valor ?? ''}
          onChange={(e) => props.aoMudar(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">
            {props.campanhaId ? 'Um lead da campanha (automático)' : 'Escolher sozinho'}
          </option>
          {q.data?.map((l) => (
            <option key={l.empresaId} value={l.empresaId}>
              {fmtNome(l.nome)}
              {l.cidade ? ` · ${fmtCidade(l.cidade)}` : ''}
              {l.email ? '' : ' (sem e-mail)'}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ───────────────────────── Identidade visual ───────────────────────── */

type FormMarca = Omit<MarcaEmail, 'id' | 'campanhas'>;

const MARCA_NOVA: FormMarca = {
  nome: '',
  remetenteNome: '',
  remetenteEmail: null,
  responderPara: null,
  estilo: 'cartao',
  corPrimaria: '#0f766e',
  corFundo: '#f4f4f5',
  corTexto: '#1f2933',
  corCabecalho: '#ffffff',
  logoId: null,
  larguraLogo: 140,
  capaId: null,
  assinatura: '{remetente}',
  rodape: '',
  logoUrl: null,
  capaUrl: null,
};

const TEXTO_EXEMPLO = `{saudacao}

{abertura}

Distribuímos peças para lojas de autopeças: o pedido feito até as 16h chega no dia seguinte, com prazo para pagar.

- Reposição em até 24 horas na sua região
- Catálogo com mais de 18 mil itens
- Vendedor dedicado, que conhece a sua loja

[[Ver a proposta|https://exemplo.com.br/proposta]]

Posso te mostrar em 15 minutos como funciona?`;

const CORES: { k: 'corPrimaria' | 'corFundo' | 'corTexto' | 'corCabecalho'; rotulo: string; dica: string }[] =
  [
    { k: 'corPrimaria', rotulo: 'Cor principal', dica: 'Botões, links e a faixa do topo' },
    { k: 'corCabecalho', rotulo: 'Fundo do cabeçalho', dica: 'Atrás da logo' },
    { k: 'corFundo', rotulo: 'Fundo do e-mail', dica: 'Em volta do cartão' },
    { k: 'corTexto', rotulo: 'Cor do texto', dica: 'Parágrafos' },
  ];

function Cor(props: {
  id: string;
  rotulo: string;
  dica: string;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  const [texto, setTexto] = useState(props.valor);
  useEffect(() => setTexto(props.valor), [props.valor]);
  return (
    <div className="campo">
      <label htmlFor={props.id}>{props.rotulo}</label>
      <div className="cor">
        <input
          type="color"
          aria-label={`${props.rotulo}: escolher`}
          value={/^#[0-9a-f]{6}$/i.test(props.valor) ? props.valor : '#000000'}
          onChange={(e) => props.aoMudar(e.target.value)}
        />
        <input
          id={props.id}
          className="filtro mono"
          maxLength={7}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) props.aoMudar(e.target.value.toLowerCase());
          }}
          onBlur={() => setTexto(props.valor)}
        />
      </div>
      <span className="campo__dica">{props.dica}</span>
    </div>
  );
}

function Imagem(props: {
  rotulo: string;
  dica: string;
  url: string | null;
  admin: boolean;
  aoMudar: (v: { id: number; url: string } | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const enviar = useMutation({
    mutationFn: async (arq: File) =>
      api<{ id: number; url: string }>('/email/imagens', {
        metodo: 'POST',
        corpo: { nome: arq.name, mime: arq.type, base64: await lerBase64(arq) },
      }),
    onSuccess: (d) => props.aoMudar(d),
  });
  return (
    <div className="campo">
      <span className="campo__rotulo">{props.rotulo}</span>
      <div className="imagem-marca">
        <div className="imagem-marca__quadro">
          {props.url ? <img src={props.url} alt="" /> : <Icon name="image" size={20} />}
        </div>
        {props.admin && (
          <div className="pilha" style={{ gap: 4 }}>
            <input
              ref={ref}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => {
                const arq = e.target.files?.[0];
                if (arq) enviar.mutate(arq);
                e.target.value = '';
              }}
            />
            <div className="acoes">
              <Button size="sm" icon="image" disabled={enviar.isPending} onClick={() => ref.current?.click()}>
                {enviar.isPending ? 'Enviando…' : props.url ? 'Trocar' : 'Enviar imagem'}
              </Button>
              {props.url && (
                <Button size="sm" variant="ghost" onClick={() => props.aoMudar(null)}>
                  Tirar
                </Button>
              )}
            </div>
            <span className="campo__dica">{props.dica}</span>
          </div>
        )}
      </div>
      <ErroDaApi erro={enviar.error} />
    </div>
  );
}

function EditorMarca(props: {
  marca: MarcaEmail | null;
  remetenteConta: string | null;
  aoSalvar: (id: number) => void;
  aoApagar: () => void;
}) {
  const cliente = useQueryClient();
  const admin = useEhAdmin();
  const m = props.marca;
  const [f, setF] = useState<FormMarca>(m ?? MARCA_NOVA);
  const [confirmar, setConfirmar] = useState(false);
  useEffect(() => {
    setF(m ?? MARCA_NOVA);
    setConfirmar(false);
  }, [m]);

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: f.nome,
        remetenteNome: f.remetenteNome,
        remetenteEmail: f.remetenteEmail ?? '',
        responderPara: f.responderPara ?? '',
        estilo: f.estilo,
        corPrimaria: f.corPrimaria,
        corFundo: f.corFundo,
        corTexto: f.corTexto,
        corCabecalho: f.corCabecalho,
        logoId: f.logoId,
        larguraLogo: f.larguraLogo,
        capaId: f.capaId,
        assinatura: f.assinatura,
        rodape: f.rodape,
      };
      return m
        ? api<{ id: number; marcas: MarcaEmail[] }>(`/email/marcas/${m.id}`, { metodo: 'PUT', corpo })
        : api<{ id: number; marcas: MarcaEmail[] }>('/email/marcas', { metodo: 'POST', corpo });
    },
    onSuccess: (d) => {
      cliente.setQueryData(['email', 'marcas'], d.marcas);
      cliente.invalidateQueries({ queryKey: ['email', 'previa'] });
      props.aoSalvar(d.id);
    },
  });
  const apagar = useMutation({
    mutationFn: () => api<MarcaEmail[]>(`/email/marcas/${m?.id}`, { metodo: 'DELETE' }),
    onSuccess: (d) => {
      cliente.setQueryData(['email', 'marcas'], d);
      props.aoApagar();
    },
  });

  // Prévia instantânea (no navegador): o mesmo montador que o servidor usa no envio.
  const previa = useMemo<PreviaEmail>(() => {
    const e = montarEmail(
      { assunto: 'Entregas em 1 hora para a {empresa}', corpo: TEXTO_EXEMPLO },
      {
        nome: 'Marcos',
        empresa: 'Auto Peças Exemplo',
        cidade: 'Salvador',
        remetente: f.remetenteNome,
        abertura:
          'Vi que a Auto Peças Exemplo atende oficinas em toda a região do Iguatemi, e entrega rápida costuma pesar na escolha delas.',
      },
      {
        assinatura: f.assinatura,
        descadastro: '#descadastro',
        marca: {
          nome: f.nome || 'Sua marca',
          estilo: f.estilo,
          corPrimaria: f.corPrimaria,
          corFundo: f.corFundo,
          corTexto: f.corTexto,
          corCabecalho: f.corCabecalho,
          logoUrl: f.logoUrl,
          larguraLogo: f.larguraLogo,
          capaUrl: f.capaUrl,
          rodape: f.rodape,
        },
      },
    );
    return {
      assunto: e.assunto,
      html: e.html,
      texto: e.texto,
      de: { nome: f.remetenteNome || '—', email: f.remetenteEmail || props.remetenteConta },
      responderPara: f.responderPara,
      lead: { empresaId: null, empresa: 'Auto Peças Exemplo', contato: 'Marcos', cidade: 'Salvador' },
      abertura: null,
      aviso: null,
      anexos: [],
    };
  }, [f, props.remetenteConta]);

  const mudou = !m || (Object.keys(MARCA_NOVA) as (keyof FormMarca)[]).some((k) => f[k] !== m[k]);
  const texto = (k: keyof FormMarca, v: string) => setF({ ...f, [k]: v });

  return (
    <div className="editor-email">
      <form
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <fieldset
          className="form"
          disabled={!admin}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="mc-nome">Nome da identidade</label>
              <input
                id="mc-nome"
                className="filtro"
                maxLength={80}
                placeholder="Ex.: Rota Norte Distribuidora"
                value={f.nome}
                onChange={(e) => texto('nome', e.target.value)}
              />
              <span className="campo__dica">Para escolher na campanha. Sem logo, aparece no topo.</span>
            </div>
            <div className="campo">
              <label htmlFor="mc-rem">Nome do remetente</label>
              <input
                id="mc-rem"
                className="filtro"
                maxLength={80}
                placeholder="Ex.: Paulo | Rota Norte"
                value={f.remetenteNome}
                onChange={(e) => texto('remetenteNome', e.target.value)}
              />
              <span className="campo__dica">Aparece na caixa de entrada do lead.</span>
            </div>
            <div className="campo">
              <label htmlFor="mc-email">E-mail do remetente</label>
              <input
                id="mc-email"
                className="filtro"
                type="email"
                placeholder={props.remetenteConta ?? 'o padrão da conta'}
                value={f.remetenteEmail ?? ''}
                onChange={(e) => setF({ ...f, remetenteEmail: e.target.value || null })}
              />
              <span className="campo__dica">
                Vazio: o padrão da conta. Outro, só de domínio verificado no Resend.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="mc-resp">Cópia das respostas</label>
              <input
                id="mc-resp"
                className="filtro"
                type="email"
                placeholder="opcional"
                value={f.responderPara ?? ''}
                onChange={(e) => setF({ ...f, responderPara: e.target.value || null })}
              />
              <span className="campo__dica">
                Sem domínio de respostas configurado, é para cá que o lead responde.
              </span>
            </div>
          </div>

          <fieldset className="segmentos">
            <legend className="campo__rotulo">Estilo</legend>
            {(
              [
                ['cartao', 'Cartão com logo', 'Cabeçalho, corpo num cartão e botão colorido'],
                ['simples', 'Pessoal', 'Parece um e-mail escrito à mão (costuma cair menos em promoções)'],
              ] as const
            ).map(([v, rotulo, dica]) => (
              <button
                key={v}
                type="button"
                className="segmento"
                title={dica}
                aria-pressed={f.estilo === v}
                data-ativo={f.estilo === v || undefined}
                onClick={() => setF({ ...f, estilo: v })}
              >
                {rotulo}
              </button>
            ))}
          </fieldset>

          <div className="grade-cores">
            {CORES.map((c) => (
              <Cor
                key={c.k}
                id={`mc-${c.k}`}
                rotulo={c.rotulo}
                dica={c.dica}
                valor={f[c.k]}
                aoMudar={(v) => setF({ ...f, [c.k]: v })}
              />
            ))}
          </div>

          <Imagem
            rotulo="Logo"
            dica="PNG com fundo transparente fica melhor. Até 2 MB."
            url={f.logoUrl}
            admin={admin}
            aoMudar={(v) => setF({ ...f, logoId: v?.id ?? null, logoUrl: v?.url ?? null })}
          />
          {f.logoUrl && (
            <div className="campo">
              <label htmlFor="mc-larg">Largura da logo: {f.larguraLogo}px</label>
              <input
                id="mc-larg"
                type="range"
                min={40}
                max={400}
                step={10}
                value={f.larguraLogo}
                onChange={(e) => setF({ ...f, larguraLogo: Number(e.target.value) })}
              />
            </div>
          )}
          <Imagem
            rotulo="Imagem de capa"
            dica="Faixa larga logo abaixo do cabeçalho (600px de largura). Opcional."
            url={f.capaUrl}
            admin={admin}
            aoMudar={(v) => setF({ ...f, capaId: v?.id ?? null, capaUrl: v?.url ?? null })}
          />

          <div className="campo">
            <label htmlFor="mc-ass">Assinatura</label>
            <textarea
              id="mc-ass"
              rows={4}
              maxLength={2000}
              value={f.assinatura}
              onChange={(e) => texto('assinatura', e.target.value)}
            />
            <span className="campo__dica">Uma informação por linha. Vale {'{remetente}'} e links.</span>
          </div>
          <div className="campo">
            <label htmlFor="mc-rod">Rodapé</label>
            <textarea
              id="mc-rod"
              rows={2}
              maxLength={1000}
              placeholder="Razão social · CNPJ · endereço · site"
              value={f.rodape}
              onChange={(e) => texto('rodape', e.target.value)}
            />
            <span className="campo__dica">Letra pequena no fim, antes do “sair da lista”.</span>
          </div>
        </fieldset>

        <ErroDaApi erro={salvar.error ?? apagar.error} />
        {admin && (
          <div className="acoes">
            <Button
              type="submit"
              variant="primary"
              disabled={salvar.isPending || !mudou || !f.nome.trim() || !f.remetenteNome.trim()}
            >
              {salvar.isPending ? 'Salvando…' : m ? 'Salvar identidade' : 'Criar identidade'}
            </Button>
            {m &&
              (confirmar ? (
                <>
                  <Button variant="danger" disabled={apagar.isPending} onClick={() => apagar.mutate()}>
                    Apagar “{m.nome}”
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmar(false)}>
                    Manter
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  disabled={m.campanhas > 0}
                  title={m.campanhas > 0 ? 'Usada por campanhas de e-mail' : undefined}
                  onClick={() => setConfirmar(true)}
                >
                  Apagar
                </Button>
              ))}
          </div>
        )}
      </form>
      <div className="pilha" style={{ gap: 8 }}>
        <JanelaEmail previa={previa} />
        <p className="nota-rodape" style={{ margin: 0 }}>
          Texto de exemplo. A prévia com o modelo de verdade, o lead de verdade e a abertura da IA fica na
          campanha (botão “Prévia e teste”).
        </p>
      </div>
    </div>
  );
}

/** Aba "Identidade visual": cores, logo, capa, remetente e assinatura (white label por campanha). */
export function Marcas(props: { remetenteConta: string | null }) {
  const [params, setParams] = useSearchParams();
  const admin = useEhAdmin();
  const q = useMarcas();
  const pedido = params.get('marca');
  const nova = pedido === 'nova';
  const atual = nova ? null : (q.data?.find((m) => String(m.id) === pedido) ?? q.data?.[0] ?? null);
  const abrir = (v: string) => {
    const p = new URLSearchParams(params);
    v ? p.set('marca', v) : p.delete('marca');
    setParams(p, { replace: true });
  };
  if (q.isPending) return <div className="esqueleto" />;
  return (
    <div className="modelos-email">
      <nav className="modelos-email__lista" aria-label="Identidades visuais">
        {q.data?.map((m) => (
          <button
            key={m.id}
            type="button"
            className="modelo-item"
            aria-current={(!nova && atual?.id === m.id) || undefined}
            onClick={() => abrir(String(m.id))}
          >
            <span className="marca-item">
              <span className="marca-item__cor" style={{ background: m.corPrimaria }} aria-hidden="true" />
              <b>{m.nome}</b>
            </span>
            <span className="quieto">{m.remetenteNome}</span>
            <span className="quieto">
              {m.campanhas ? `${m.campanhas} campanha${m.campanhas === 1 ? '' : 's'}` : 'sem campanha'}
            </span>
          </button>
        ))}
        {admin && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => abrir('nova')}>
            Nova identidade
          </Button>
        )}
      </nav>
      <ErroDaApi erro={q.error} />
      <EditorMarca
        key={nova ? 'nova' : (atual?.id ?? 'vazia')}
        marca={atual}
        remetenteConta={props.remetenteConta}
        aoSalvar={(id) => abrir(String(id))}
        aoApagar={() => abrir('')}
      />
    </div>
  );
}

/* ───────────────────────── Campanha: prévia real e teste ───────────────────────── */

/** Prévia de um passo de WhatsApp ou ligação: o texto pronto para aquele lead. */
interface PreviaTexto {
  canal: 'whatsapp' | 'ligacao';
  texto: string;
  lead: PreviaEmail['lead'];
}
type PreviaPasso = (PreviaEmail & { canal: 'email' }) | PreviaTexto;

const ROTULO_PASSO: Record<CanalSequencia, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  ligacao: 'Ligação',
};

/** Como a mensagem aparece no WhatsApp do lead. */
function JanelaWhatsapp(props: { previa: PreviaTexto; carregando: boolean }) {
  return (
    <div className="previa-zap" aria-busy={props.carregando || undefined}>
      <div className="previa-zap__topo">
        <Icon name="message-circle" size={16} />
        <b>{fmtNome(props.previa.lead.empresa)}</b>
        {props.previa.lead.contato && <span className="quieto">· {props.previa.lead.contato}</span>}
      </div>
      <div className="previa-zap__conversa">
        <div className="previa-zap__bolha">
          {props.previa.texto || <span className="quieto">(sem mensagem)</span>}
        </div>
      </div>
      <p className="nota-rodape" style={{ margin: 0 }}>
        Sai pelo chip do lead (ou o menos usado hoje), no horário e no limite do WhatsApp da tela Agente.
      </p>
    </div>
  );
}

export function PreviaCampanha(props: {
  campanhaEmailId: number;
  campanhaId: number;
  passos: PassoSequencia[];
  emailPadrao: string;
  admin: boolean;
}) {
  const [passo, setPasso] = useState(1);
  const [lead, setLead] = useState<number | null>(null);
  const [para, setPara] = useState(props.emailPadrao);
  const canal = props.passos[passo - 1]?.canal ?? 'email';
  const q = useQuery({
    queryKey: ['email', 'previa', 'campanha', props.campanhaEmailId, passo, lead],
    queryFn: () =>
      api<PreviaPasso>(`/email/campanhas/${props.campanhaEmailId}/previa`, {
        metodo: 'POST',
        corpo: { passo, empresaId: lead },
      }),
    placeholderData: keepPreviousData,
    // A abertura da IA custa uma chamada: não refaz sozinha.
    staleTime: 10 * 60_000,
  });
  const teste = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; abertura: string | null }>(`/email/campanhas/${props.campanhaEmailId}/teste`, {
        metodo: 'POST',
        corpo: { passo, empresaId: lead ?? q.data?.lead.empresaId ?? null, para },
      }),
  });

  return (
    <div className="pilha" style={{ gap: 12 }}>
      <div className="barra-previa">
        {props.passos.length > 1 && (
          <div className="campo">
            <span className="campo__rotulo">Passo da sequência</span>
            <fieldset className="segmentos" aria-label="Passo da sequência">
              {props.passos.map((p, i) => (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: a posição é o próprio passo
                  key={i}
                  type="button"
                  className="segmento"
                  aria-pressed={passo === i + 1}
                  data-ativo={passo === i + 1 || undefined}
                  onClick={() => setPasso(i + 1)}
                  title={ROTULO_PASSO[p.canal ?? 'email']}
                >
                  {i + 1}º · {ROTULO_PASSO[p.canal ?? 'email']}
                </button>
              ))}
            </fieldset>
          </div>
        )}
        <EscolherLead campanhaId={props.campanhaId} valor={lead} aoMudar={setLead} />
        {canal === 'email' && (
          <div className="campo" style={{ alignSelf: 'end' }}>
            <Button
              size="sm"
              variant="ghost"
              icon="rotate-ccw"
              disabled={q.isFetching}
              onClick={() => q.refetch()}
              title="Pede uma abertura nova para a IA"
            >
              {q.isFetching ? 'Gerando…' : 'Gerar de novo'}
            </Button>
          </div>
        )}
      </div>
      {q.data && !q.data.lead.empresaId && (
        <Mensagem tipo="aviso">A campanha ainda não tem leads: a prévia usa uma loja de exemplo.</Mensagem>
      )}
      <ErroDaApi erro={q.error} />
      {q.data?.canal === 'whatsapp' ? (
        <JanelaWhatsapp previa={q.data} carregando={q.isFetching} />
      ) : q.data?.canal === 'ligacao' ? (
        <div className="previa-ligacao">
          <Icon name="phone" size={18} />
          <div>
            <b>Ligar para {fmtNome(q.data.lead.empresa)}</b>
            <p style={{ margin: '4px 0 0' }}>
              Vira uma tarefa de hoje para o dono do lead, com o telefone e este roteiro:
            </p>
            <p className="previa-ligacao__roteiro">{q.data.texto || '(sem roteiro)'}</p>
          </div>
        </div>
      ) : (
        <JanelaEmail previa={q.data?.canal === 'email' ? q.data : undefined} carregando={q.isFetching} />
      )}
      {props.admin && canal === 'email' && (
        <div className="confirmar">
          <label htmlFor="pc-teste" style={{ fontWeight: 500 }}>
            Mandar este e-mail (com este lead e esta abertura) para ver na caixa de entrada de verdade
          </label>
          <div className="barra">
            <input
              id="pc-teste"
              className="filtro"
              type="email"
              style={{ flex: '1 1 220px' }}
              value={para}
              onChange={(e) => setPara(e.target.value)}
            />
            <Button size="sm" icon="send" disabled={teste.isPending || !para} onClick={() => teste.mutate()}>
              {teste.isPending ? 'Enviando…' : 'Enviar teste'}
            </Button>
          </div>
          {teste.isSuccess && (
            <Mensagem tipo="ok">
              Teste enviado para {para} com “[TESTE]” no assunto. Confira também a pasta de spam.
              {teste.data.abertura &&
                q.data?.canal === 'email' &&
                q.data.abertura !== teste.data.abertura && (
                  <>
                    {' '}
                    A IA escreveu a abertura de novo para o teste, então ela pode estar um pouco diferente.
                  </>
                )}
            </Mensagem>
          )}
          <ErroDaApi erro={teste.error} />
        </div>
      )}
      {canal === 'email' && (
        <p className="nota-rodape" style={{ margin: 0 }}>
          No envio de verdade, os links passam pelo contador de cliques e o “sair da lista” leva ao
          descadastro do lead. O resto é exatamente isto.
        </p>
      )}
    </div>
  );
}
