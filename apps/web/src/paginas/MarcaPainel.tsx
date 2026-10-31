import { contrasteComBranco, contrasteComEscuro } from '@prospeccao/shared/seguranca';
import { Button, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { iniciais } from '../marcaPublica';

/**
 * Aba Marca (white label completo): nome, duas logos (fundo escuro e fundo claro), três ícones (aba
 * do navegador, ícone da marca e app instalado), a imagem de divulgação e quatro cores, cada uma
 * dizendo onde aparece. A prévia ao lado mostra o painel, o login, o celular, a aba, a reunião, o
 * link no WhatsApp e o e-mail com o que está na tela (antes de salvar).
 */

export type ArquivoMarca = 'logo' | 'logoEscuro' | 'icone' | 'favicon' | 'app' | 'imagem';

export interface MarcaDados {
  organizacaoNome: string;
  nome: string | null;
  cor: string | null;
  corSecundaria: string | null;
  corDestaque: string | null;
  corClara: string | null;
  menuEscuro: boolean;
  logo: boolean;
  logoEscuro: boolean;
  icone: boolean;
  favicon: boolean;
  app: boolean;
  imagem: boolean;
  versao: string;
  podeEditar: boolean;
}

/** Cores do sistema quando a empresa não escolhe (a prévia mostra o que vale de verdade). */
const PADRAO = { cor: '#0b6b63', corSecundaria: '#1f2a37', corDestaque: '#0b6b63', corClara: '#e3f1ef' };

type CampoCor = 'cor' | 'corSecundaria' | 'corDestaque' | 'corClara';
const CORES: { campo: CampoCor; nome: string; onde: string }[] = [
  { campo: 'cor', nome: 'Primária', onde: 'Botões e ações principais' },
  { campo: 'corSecundaria', nome: 'Secundária', onde: 'Menu lateral, login e abertura do app' },
  { campo: 'corDestaque', nome: 'Destaque', onde: 'Links, gráficos e rota no mapa' },
  { campo: 'corClara', nome: 'Clara', onde: 'Etiquetas e fundos de chips' },
];

const hexValido = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

/** O que está errado em cada cor (o mesmo que o servidor confere). */
function problemaDaCor(campo: CampoCor, c: string): string | null {
  if (!c) return null;
  if (!hexValido(c)) return 'Use o formato #1a2b3c.';
  if (campo === 'cor' && contrasteComBranco(c) < 4.5)
    return 'Primária clara demais: o texto branco dos botões fica ilegível.';
  if (campo === 'corSecundaria' && contrasteComBranco(c) < 4.5)
    return 'Secundária clara demais: o texto branco do menu fica ilegível.';
  if (campo === 'corDestaque' && contrasteComBranco(c) < 3)
    return 'Destaque claro demais: os links somem no fundo branco.';
  if (campo === 'corClara' && contrasteComEscuro(c) < 9)
    return 'Clara escura demais: as etiquetas ficam difíceis de ler.';
  return null;
}

/** Como cada imagem é preparada no navegador antes de subir (ninguém precisa redimensionar nada). */
const FORMATO: Record<
  ArquivoMarca,
  { largura: number; altura: number; modo: 'cobrir' | 'caber'; tipo: 'image/png' | 'image/jpeg' }
> = {
  logo: { largura: 720, altura: 240, modo: 'caber', tipo: 'image/png' },
  logoEscuro: { largura: 720, altura: 240, modo: 'caber', tipo: 'image/png' },
  icone: { largura: 512, altura: 512, modo: 'cobrir', tipo: 'image/png' },
  favicon: { largura: 256, altura: 256, modo: 'cobrir', tipo: 'image/png' },
  app: { largura: 512, altura: 512, modo: 'cobrir', tipo: 'image/png' },
  imagem: { largura: 1200, altura: 630, modo: 'cobrir', tipo: 'image/jpeg' },
};

async function prepararImagem(arquivo: File, qual: ArquivoMarca): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(arquivo.type)) throw new Error('Use uma imagem PNG ou JPG.');
  const f = FORMATO[qual];
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falhou) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falhou(new Error('Não deu para abrir esta imagem. Tente outra.'));
      i.src = url;
    });
    const { naturalWidth: w, naturalHeight: h } = img;
    let largura = f.largura;
    let altura = f.altura;
    let sx = 0;
    let sy = 0;
    let sw = w;
    let sh = h;
    if (f.modo === 'cobrir') {
      const escala = Math.max(f.largura / w, f.altura / h);
      sw = f.largura / escala;
      sh = f.altura / escala;
      sx = (w - sw) / 2;
      sy = (h - sh) / 2;
    } else {
      const escala = Math.min(1, f.largura / w, f.altura / h);
      largura = Math.max(1, Math.round(w * escala));
      altura = Math.max(1, Math.round(h * escala));
    }
    const tela = document.createElement('canvas');
    tela.width = largura;
    tela.height = altura;
    const ctx = tela.getContext('2d');
    if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem.');
    if (f.tipo === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, largura, altura);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, largura, altura);
    return tela.toDataURL(f.tipo, 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Tudo o que a prévia precisa (o que está na tela, salvo ou não). */
interface Visual {
  nome: string;
  cor: string;
  sec: string;
  dest: string;
  clara: string;
  menuEscuro: boolean;
  logo: string | null;
  logoEscuro: string | null;
  icone: string | null;
  favicon: string | null;
  app: string | null;
  imagem: string | null;
  endereco: string;
}

export function MarcaCompleta(props: { dados: MarcaDados; endereco: string }) {
  const d = props.dados;
  const cliente = useQueryClient();
  const [nome, setNome] = useState(d.nome ?? '');
  const [cores, setCores] = useState<Record<CampoCor, string>>({
    cor: d.cor ?? '',
    corSecundaria: d.corSecundaria ?? '',
    corDestaque: d.corDestaque ?? '',
    corClara: d.corClara ?? '',
  });
  const [menuEscuro, setMenuEscuro] = useState(d.menuEscuro);
  const [novos, setNovos] = useState<Partial<Record<ArquivoMarca, string | null>>>({});
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const previa = (a: ArquivoMarca): string | null =>
    novos[a] !== undefined ? novos[a]! : d[a] ? `/api/marca/arquivo/${a}?v=${d.versao}` : null;
  const problemas = CORES.map((c) => ({ ...c, erro: problemaDaCor(c.campo, cores[c.campo]) })).filter(
    (c) => c.erro,
  );
  const salvar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => api('/marca', { metodo: 'PUT', corpo }),
    onSuccess: () => {
      setNovos({});
      cliente.invalidateQueries({ queryKey: ['marca'] });
      cliente.invalidateQueries({ queryKey: ['sessao'] });
      cliente.invalidateQueries({ queryKey: ['organizacao'] });
      cliente.invalidateQueries({ queryKey: ['marca-fundos'] });
    },
  });
  const escolher = async (a: ArquivoMarca, f: File | undefined) => {
    setErroArquivo(null);
    if (!f) return;
    try {
      const url = await prepararImagem(f, a);
      setNovos((x) => ({ ...x, [a]: url }));
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : 'Não deu para usar esta imagem.');
    }
  };
  const editar = d.podeEditar;
  const valor = (campo: CampoCor) => (hexValido(cores[campo]) ? cores[campo] : null);
  const sec = valor('corSecundaria');
  const visual: Visual = {
    nome: nome.trim() || d.organizacaoNome,
    cor: valor('cor') ?? PADRAO.cor,
    sec: sec ?? PADRAO.corSecundaria,
    dest: valor('corDestaque') ?? valor('cor') ?? PADRAO.corDestaque,
    clara: valor('corClara') ?? PADRAO.corClara,
    menuEscuro: menuEscuro && !!sec,
    logo: previa('logo'),
    logoEscuro: previa('logoEscuro'),
    icone: previa('icone'),
    favicon: previa('favicon') ?? previa('icone'),
    app: previa('app') ?? previa('icone'),
    imagem: previa('imagem'),
    endereco: props.endereco,
  };
  const temAlgo = !!(
    d.nome ||
    d.cor ||
    d.corSecundaria ||
    d.corDestaque ||
    d.corClara ||
    d.logo ||
    d.logoEscuro ||
    d.icone ||
    d.favicon ||
    d.app ||
    d.imagem
  );
  const arquivo = (a: ArquivoMarca) => ({
    previa: previa(a),
    editar,
    aoEscolher: (f: File | undefined) => escolher(a, f),
    aoTirar: () => setNovos((x) => ({ ...x, [a]: null })),
  });
  return (
    <form
      className="marca-grade"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        salvar.mutate({
          nome: nome.trim() || null,
          cor: cores.cor || null,
          corSecundaria: cores.corSecundaria || null,
          corDestaque: cores.corDestaque || null,
          corClara: cores.corClara || null,
          menuEscuro: menuEscuro && !!cores.corSecundaria,
          ...novos,
        });
      }}
    >
      <div className="pilha marca-coluna">
        <div className="marca-nome">
          <label htmlFor="mk-nome">Nome da marca</label>
          <input
            id="mk-nome"
            className="filtro"
            maxLength={60}
            placeholder={d.organizacaoNome}
            value={nome}
            disabled={!editar}
            onChange={(e) => setNome(e.target.value)}
          />
          <span className="quieto">No menu, na aba do navegador, nos e-mails e nas reuniões.</span>
        </div>

        <Panel
          titulo="Logos"
          acoes={<span className="quieto marca-dica">PNG com fundo transparente fica melhor</span>}
        >
          <div className="marca-cartoes marca-cartoes--2">
            <CartaoImagem
              id="mk-logo-escuro"
              titulo="Logo para fundo escuro"
              texto="Menu lateral na cor secundária, login e abertura do app. Use a versão branca."
              fundo={visual.sec}
              larga
              {...arquivo('logoEscuro')}
            />
            <CartaoImagem
              id="mk-logo"
              titulo="Logo para fundo claro"
              texto="Menu claro, e-mails, relatório em PDF e telas brancas."
              xadrez
              larga
              {...arquivo('logo')}
            />
          </div>
        </Panel>

        <Panel
          titulo="Ícones"
          acoes={
            <span className="quieto marca-dica">
              Quadrados (ajustamos sozinhos): o símbolo, sem o nome escrito
            </span>
          }
        >
          <div className="marca-cartoes marca-cartoes--3">
            <CartaoImagem
              id="mk-favicon"
              titulo="Aba do navegador"
              texto="Ao lado do título da aba. Sem ele, usamos o ícone da marca."
              xadrez
              {...arquivo('favicon')}
            />
            <CartaoImagem
              id="mk-icone"
              titulo="Ícone da marca"
              texto="Sala de reunião e selos pequenos."
              xadrez
              {...arquivo('icone')}
            />
            <CartaoImagem
              id="mk-app"
              titulo="App instalado"
              texto="Tela inicial do celular. O fundo é a cor secundária."
              xadrez
              redondo={visual.sec}
              {...arquivo('app')}
            />
          </div>
        </Panel>

        <Panel titulo="Imagem de divulgação">
          <CartaoImagem
            id="mk-imagem"
            titulo="1200×630 (ajustamos sozinhos)"
            texto="Ao lado do login e na prévia quando alguém manda um link do sistema no WhatsApp (convite, reunião). Sem ela, usamos a cor secundária com a logo."
            banner
            {...arquivo('imagem')}
          />
        </Panel>

        <Panel
          titulo="Cores"
          acoes={<span className="quieto marca-dica">Cada cor diz onde aparece. Mude e veja a prévia.</span>}
        >
          <div className="marca-cartoes marca-cartoes--2">
            {CORES.map((c) => (
              <LinhaCor
                key={c.campo}
                nome={c.nome}
                onde={c.onde}
                valor={cores[c.campo]}
                padrao={c.campo === 'corDestaque' ? (valor('cor') ?? PADRAO.cor) : PADRAO[c.campo]}
                errada={!!problemaDaCor(c.campo, cores[c.campo])}
                editar={editar}
                aoMudar={(v) => setCores((x) => ({ ...x, [c.campo]: v }))}
              />
            ))}
          </div>
          {problemas.length ? (
            <Mensagem tipo="erro">
              {problemas.map((p) => (
                <span key={p.campo} style={{ display: 'block' }}>
                  {p.erro}
                </span>
              ))}
            </Mensagem>
          ) : (
            <p className="marca-legivel">
              <Icon name="check" size={14} /> Texto branco fica legível nos botões e no menu; as etiquetas
              ficam fáceis de ler.
            </p>
          )}
          <label className="opcao">
            <input
              type="checkbox"
              checked={menuEscuro && !!cores.corSecundaria}
              disabled={!editar || !hexValido(cores.corSecundaria)}
              onChange={(e) => setMenuEscuro(e.target.checked)}
            />
            <span>
              <b>Menu lateral na cor secundária</b>
              <span className="campo__dica" style={{ display: 'block' }}>
                {hexValido(cores.corSecundaria)
                  ? 'Com a logo para fundo escuro. Desligado, o menu fica claro com a logo para fundo claro.'
                  : 'Escolha a cor secundária para ligar.'}
              </span>
            </span>
          </label>
        </Panel>

        {erroArquivo && <Mensagem tipo="erro">{erroArquivo}</Mensagem>}
        <ErroDaApi erro={salvar.error} />
        {salvar.isSuccess && (
          <Mensagem tipo="ok">Marca salva. Já vale para todo mundo, em todas as unidades.</Mensagem>
        )}
        {editar && (
          <div className="marca-barra">
            <span className="quieto">Mudanças valem para todas as unidades.</span>
            {temAlgo && (
              <Button
                variant="ghost"
                disabled={salvar.isPending}
                onClick={() => {
                  setNome('');
                  setCores({ cor: '', corSecundaria: '', corDestaque: '', corClara: '' });
                  setMenuEscuro(false);
                  salvar.mutate({
                    nome: null,
                    cor: null,
                    corSecundaria: null,
                    corDestaque: null,
                    corClara: null,
                    menuEscuro: false,
                    logo: null,
                    logoEscuro: null,
                    icone: null,
                    favicon: null,
                    app: null,
                    imagem: null,
                  });
                }}
              >
                Voltar ao padrão
              </Button>
            )}
            <Button variant="primary" type="submit" disabled={salvar.isPending || problemas.length > 0}>
              {salvar.isPending ? 'Salvando…' : 'Salvar marca'}
            </Button>
          </div>
        )}
      </div>
      <Previa v={visual} />
    </form>
  );
}

function CartaoImagem(props: {
  id: string;
  titulo: string;
  texto: string;
  previa: string | null;
  editar: boolean;
  /** Fundo da área da imagem (a logo para fundo escuro aparece na cor secundária). */
  fundo?: string;
  xadrez?: boolean;
  larga?: boolean;
  banner?: boolean;
  /** App instalado: mostra o ícone num círculo com esta cor de fundo. */
  redondo?: string;
  aoEscolher: (f: File | undefined) => void;
  aoTirar: () => void;
}) {
  return (
    <div className={`marca-cartao${props.banner ? ' marca-cartao--banner' : ''}`}>
      <b>{props.titulo}</b>
      <span
        className={`marca-cartao__area${props.xadrez ? ' marca-cartao__area--xadrez' : ''}${props.larga ? ' marca-cartao__area--larga' : ''}${props.banner ? ' marca-cartao__area--banner' : ''}`}
        style={props.fundo ? { background: props.fundo } : undefined}
      >
        {props.previa ? (
          props.redondo ? (
            <span className="marca-cartao__app" style={{ background: props.redondo }}>
              <img src={props.previa} alt="" />
            </span>
          ) : (
            <img src={props.previa} alt={`${props.titulo}: atual`} />
          )
        ) : (
          <span className="marca-cartao__vazio">
            <Icon name="image" size={18} label="Sem imagem" />
          </span>
        )}
      </span>
      <span className="quieto marca-cartao__texto">{props.texto}</span>
      {props.editar && (
        <span className="marca-cartao__acoes">
          <label className="pp-btn pp-btn--sm botao-arquivo" htmlFor={props.id}>
            {props.previa ? 'Trocar' : 'Escolher'}
          </label>
          <input
            id={props.id}
            className="pp-sr"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              props.aoEscolher(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {props.previa && (
            <Button size="sm" variant="ghost" onClick={props.aoTirar}>
              Remover
            </Button>
          )}
        </span>
      )}
    </div>
  );
}

function LinhaCor(props: {
  nome: string;
  onde: string;
  valor: string;
  padrao: string;
  errada: boolean;
  editar: boolean;
  aoMudar: (v: string) => void;
}) {
  const mostrada = hexValido(props.valor) ? props.valor : props.padrao;
  const id = `mk-cor-${props.nome.toLowerCase()}`;
  return (
    <div className="marca-cor-linha" data-errada={props.errada || undefined}>
      <label
        className="marca-cor-linha__amostra"
        style={{ background: mostrada }}
        title={`Escolher a cor ${props.nome}`}
      >
        <input
          type="color"
          aria-label={`Escolher a cor ${props.nome}`}
          value={mostrada}
          disabled={!props.editar}
          onChange={(e) => props.aoMudar(e.target.value)}
        />
      </label>
      <span className="marca-cor-linha__texto">
        <b>{props.nome}</b>
        <span className="quieto">{props.onde}</span>
      </span>
      <input
        id={id}
        className="filtro mono marca-cor-linha__hex"
        aria-label={`Cor ${props.nome} em hexadecimal`}
        placeholder="Padrão"
        maxLength={7}
        value={props.valor}
        disabled={!props.editar}
        onChange={(e) => props.aoMudar(e.target.value.trim())}
      />
    </div>
  );
}

/* ---------- Prévia em cada lugar ---------- */

type Lugar = 'painel' | 'login' | 'celular' | 'aba' | 'reuniao' | 'whatsapp' | 'email';
const LUGARES: { id: Lugar; nome: string; legenda: string }[] = [
  {
    id: 'painel',
    nome: 'Painel',
    legenda:
      'Botão na primária, etiquetas na clara, links e barras no destaque; o menu na secundária quando ligado.',
  },
  {
    id: 'login',
    nome: 'Login',
    legenda: 'No seu domínio: painel na secundária com a logo para fundo escuro (ou a imagem de divulgação).',
  },
  {
    id: 'celular',
    nome: 'Celular',
    legenda: 'O app instalado com o ícone e o nome; a abertura na cor secundária.',
  },
  { id: 'aba', nome: 'Aba', legenda: 'O ícone da aba e o nome da marca no título.' },
  {
    id: 'reuniao',
    nome: 'Reunião',
    legenda: 'A sala com o ícone e o nome; os fundos com a logo ficam na aba Fundos.',
  },
  {
    id: 'whatsapp',
    nome: 'WhatsApp',
    legenda: 'A imagem de divulgação (ou a secundária com a logo) quando alguém manda um link.',
  },
  {
    id: 'email',
    nome: 'E-mail',
    legenda: 'Convites e "esqueci a senha": logo para fundo claro e botão na primária.',
  },
];

/** A logo que vai num fundo escuro: a própria, ou a clara numa plaquinha branca, ou o nome. */
function LogoNoEscuro(props: { v: Visual; tamanho?: number }) {
  const { v } = props;
  const t = props.tamanho ?? 18;
  if (v.logoEscuro) return <img className="pv-logo" style={{ height: t }} src={v.logoEscuro} alt="" />;
  if (v.logo)
    return (
      <span className="pv-placa">
        <img className="pv-logo" style={{ height: t * 0.8 }} src={v.logo} alt="" />
      </span>
    );
  return <NomeComSelo v={v} claro tamanho={t} />;
}

function LogoNoClaro(props: { v: Visual; tamanho?: number }) {
  const { v } = props;
  const t = props.tamanho ?? 18;
  if (v.logo) return <img className="pv-logo" style={{ height: t }} src={v.logo} alt="" />;
  return <NomeComSelo v={v} tamanho={t} />;
}

function NomeComSelo(props: { v: Visual; claro?: boolean; tamanho: number }) {
  const { v } = props;
  return (
    <span
      className="pv-nome"
      style={{ color: props.claro ? '#fff' : '#18181b', fontSize: props.tamanho * 0.7 }}
    >
      <Selo v={v} tamanho={props.tamanho} />
      {v.nome}
    </span>
  );
}

function Selo(props: { v: Visual; tamanho: number; tipo?: 'icone' | 'favicon' | 'app' }) {
  const { v } = props;
  const src = props.tipo === 'favicon' ? v.favicon : props.tipo === 'app' ? v.app : v.icone;
  const t = props.tamanho;
  return src ? (
    <img className="pv-selo" src={src} alt="" style={{ width: t, height: t }} />
  ) : (
    <span className="pv-selo" style={{ width: t, height: t, background: v.cor, fontSize: t * 0.45 }}>
      {iniciais(v.nome)}
    </span>
  );
}

function Previa(props: { v: Visual }) {
  const [lugar, setLugar] = useState<Lugar>('painel');
  const { v } = props;
  const atual = LUGARES.find((l) => l.id === lugar)!;
  let tela: ReactNode;
  if (lugar === 'painel')
    tela = (
      <div className="pv-painel">
        <div
          className="pv-menu"
          style={
            v.menuEscuro ? { background: v.sec, color: '#fff' } : { background: '#fff', color: '#18181b' }
          }
        >
          <span className="pv-menu__logo">
            {v.menuEscuro ? <LogoNoEscuro v={v} /> : <LogoNoClaro v={v} />}
          </span>
          {['Meu dia', 'Leads', 'Funil', 'Conversas', 'Reuniões', 'Relatórios'].map((i, n) => (
            <span
              key={i}
              className="pv-menu__item"
              data-on={n === 0 || undefined}
              style={n === 0 ? { boxShadow: `inset 2px 0 0 ${v.cor}` } : undefined}
            >
              {i}
            </span>
          ))}
        </div>
        <div className="pv-conteudo">
          <div className="pv-topo">
            <b>Bom dia, Paulo</b>
            <span className="pv-botao" style={{ background: v.cor }}>
              + Nova campanha
            </span>
          </div>
          <div className="pv-kpis">
            {[
              ['Hoje', '18'],
              ['Respostas', '6'],
              ['Reuniões', '3'],
            ].map(([a, b]) => (
              <span key={a}>
                {a}
                <b>{b}</b>
              </span>
            ))}
          </div>
          {[
            ['Auto Peças Bahia', 'Respondeu', 62],
            ['Clínica Sorriso', 'Reunião', 34],
          ].map(([n, e, p]) => (
            <div key={n as string} className="pv-lead">
              <span className="pv-lead__l1">
                {n}
                <span className="pv-chip" style={{ background: v.clara, color: v.cor }}>
                  {e}
                </span>
              </span>
              <span className="pv-trilho">
                <i style={{ width: `${p}%`, background: v.dest }} />
              </span>
              <span className="pv-link" style={{ color: v.dest }}>
                Ver conversa
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  else if (lugar === 'login')
    tela = (
      <div className="pv-login">
        <div
          className="pv-login__marca"
          style={{ background: `linear-gradient(135deg, ${v.sec}, ${v.sec} 55%, ${v.cor})` }}
        >
          <LogoNoEscuro v={v} tamanho={20} />
          {v.imagem ? <img className="pv-login__imagem" src={v.imagem} alt="" /> : <b>{v.nome}</b>}
        </div>
        <div className="pv-login__form">
          <Selo v={v} tamanho={26} />
          <b>Bom te ver de novo</b>
          <i />
          <i />
          <em style={{ background: v.cor }} />
          <small>Tecnologia Prospect Team</small>
        </div>
      </div>
    );
  else if (lugar === 'celular')
    tela = (
      <div className="pv-celular">
        <div className="pv-fone">
          <div className="pv-casa">
            {['Fotos', 'Mapas', 'app', 'Agenda', 'Câmera', 'Notas'].map((a) => (
              <span key={a}>
                {a === 'app' ? (
                  <span className="pv-app" style={{ background: v.sec }}>
                    {v.app ? <img src={v.app} alt="" /> : iniciais(v.nome)}
                  </span>
                ) : (
                  <i />
                )}
                {a === 'app' ? v.nome.slice(0, 12) : a}
              </span>
            ))}
          </div>
        </div>
        <div className="pv-fone">
          <div className="pv-abertura" style={{ background: v.sec }}>
            <LogoNoEscuro v={v} tamanho={18} />
          </div>
        </div>
      </div>
    );
  else if (lugar === 'aba')
    tela = (
      <div className="pv-navegador">
        <div className="pv-navegador__aba">
          <Selo v={v} tamanho={14} tipo="favicon" />
          {v.nome} · Meu dia
        </div>
        <div className="pv-navegador__barra mono">{v.endereco}/hoje</div>
        <div className="pv-navegador__corpo" />
      </div>
    );
  else if (lugar === 'reuniao')
    tela = (
      <div className="pv-reuniao">
        <div className="pv-reuniao__video" />
        <div className="pv-reuniao__texto">
          <span className="pv-nome" style={{ color: '#fff', fontSize: 12 }}>
            <Selo v={v} tamanho={22} />
            {v.nome}
          </span>
          <b>Reunião com {v.nome}</b>
          <em style={{ background: v.cor }} />
          <small>Tecnologia Prospect Team</small>
        </div>
      </div>
    );
  else if (lugar === 'whatsapp')
    tela = (
      <div className="pv-whats">
        <div className="pv-bolha">
          <div
            className="pv-bolha__img"
            style={v.imagem ? { backgroundImage: `url("${v.imagem}")` } : { background: v.sec }}
          >
            {!v.imagem && <LogoNoEscuro v={v} tamanho={22} />}
          </div>
          <div className="pv-bolha__tx">
            <b>Reunião com {v.nome} · Apresentação</b>
            {v.endereco}
          </div>
          <p>Oi, Carla! Segue o link da nossa conversa.</p>
        </div>
      </div>
    );
  else
    tela = (
      <div className="pv-email">
        <div className="pv-email__corpo">
          <LogoNoClaro v={v} tamanho={20} />
          <i style={{ width: '80%' }} />
          <i style={{ width: '60%' }} />
          <em style={{ background: v.cor }}>Criar senha</em>
          <i style={{ width: '40%' }} />
        </div>
      </div>
    );
  return (
    <div className="marca-previa">
      <Panel>
        <div className="pv-abas" role="tablist" aria-label="Onde a marca aparece">
          {LUGARES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={lugar === l.id}
              className="pv-abas__aba"
              style={lugar === l.id ? { background: v.sec, color: '#fff' } : undefined}
              onClick={() => setLugar(l.id)}
            >
              {l.nome}
            </button>
          ))}
        </div>
        <div className="pv-tela" aria-hidden="true">
          {tela}
        </div>
        <p className="quieto pv-legenda">{atual.legenda}</p>
      </Panel>
    </div>
  );
}
