import { contrasteComBranco } from '@prospeccao/shared/seguranca';
import { Badge, Button, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Modal } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { SeloDaMarca } from '../componentes/Marca';
import { fmtQuando } from '../formatar';

/**
 * Marca e domínio (white label): o cliente coloca o nome, a cor, o logo, o ícone e a imagem de
 * divulgação, e escolhe o endereço próprio (crm.empresa.com.br). Ele mesmo faz tudo: a tela mostra o
 * registro de DNS, o passo a passo de cada provedor, e confere sozinha até ativar.
 */

interface RegistroDns {
  tipo: 'CNAME' | 'A' | 'TXT';
  nome: string;
  host: string;
  valor: string;
}

interface DadosMarca {
  organizacaoNome: string;
  nome: string | null;
  cor: string | null;
  logo: boolean;
  icone: boolean;
  imagem: boolean;
  versao: string;
  dominio: {
    endereco: string;
    situacao: 'pendente' | 'ativo';
    registros: RegistroDns[];
    erro: string | null;
    desde: string | null;
    ativoEm: string | null;
    conferidoEm: string | null;
  } | null;
  podeEditar: boolean;
  dominioDisponivel: boolean;
}

const COR_PADRAO = '#0b6b63';
const CORES = ['#c2410c', '#0b6b63', '#1d4ed8', '#6d28d9', '#be123c', '#334155'];

type Arquivo = 'logo' | 'icone' | 'imagem';

/** Como cada imagem é preparada no navegador antes de subir (ninguém precisa redimensionar nada). */
const FORMATO: Record<
  Arquivo,
  { largura: number; altura: number; modo: 'cobrir' | 'caber'; tipo: 'image/png' | 'image/jpeg' }
> = {
  logo: { largura: 720, altura: 240, modo: 'caber', tipo: 'image/png' },
  icone: { largura: 512, altura: 512, modo: 'cobrir', tipo: 'image/png' },
  imagem: { largura: 1200, altura: 630, modo: 'cobrir', tipo: 'image/jpeg' },
};

/** Lê a imagem e devolve um data URL no tamanho certo (o ícone sai quadrado; a imagem, 1200×630). */
async function prepararImagem(arquivo: File, qual: Arquivo): Promise<string> {
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
      // Corta o que sobra, mantendo o centro.
      const escala = Math.max(f.largura / w, f.altura / h);
      sw = f.largura / escala;
      sh = f.altura / escala;
      sx = (w - sw) / 2;
      sy = (h - sh) / 2;
    } else {
      // Cabe inteiro, sem aumentar logo pequeno.
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

function useDadosMarca() {
  return useQuery({
    queryKey: ['marca'],
    queryFn: () => api<DadosMarca>('/marca'),
    // Esperando o DNS: a tela acompanha a conferência automática.
    refetchInterval: (q) => (q.state.data?.dominio?.situacao === 'pendente' ? 60_000 : false),
  });
}

export function MarcaEDominio() {
  const q = useDadosMarca();
  return (
    <>
      <div className="topo">
        <div>
          <h1>Marca e domínio</h1>
          <p>O sistema com o nome, as cores e o endereço da sua empresa, para toda a equipe e os clientes.</p>
        </div>
        <LinkAjuda artigo="marca-dominio">Como funciona</LinkAjuda>
      </div>
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : q.error || !q.data ? (
        <ErroDaApi erro={q.error} />
      ) : (
        <Conteudo dados={q.data} />
      )}
    </>
  );
}

function Conteudo(props: { dados: DadosMarca }) {
  const d = props.dados;
  const [nome, setNome] = useState(d.nome ?? '');
  const [cor, setCor] = useState(d.cor ?? COR_PADRAO);
  const [novos, setNovos] = useState<Partial<Record<Arquivo, string | null>>>({});
  const previa = (a: Arquivo): string | null =>
    novos[a] !== undefined ? novos[a]! : d[a] ? `/api/marca/arquivo/${a}?v=${d.versao}` : null;
  const nomeMostrado = nome.trim() || d.organizacaoNome;
  const corValida = /^#[0-9a-fA-F]{6}$/.test(cor);
  return (
    <>
      {!d.podeEditar && (
        <Mensagem tipo="aviso">
          Só o gestor da organização muda a marca e o domínio (vale para todas as unidades). Você pode ver
          como está.
        </Mensagem>
      )}
      <div className="marca-grade">
        <div className="pilha" style={{ gap: 'var(--space-4)' }}>
          <PainelMarca
            dados={d}
            nome={nome}
            setNome={setNome}
            cor={cor}
            setCor={setCor}
            novos={novos}
            setNovos={setNovos}
            previa={previa}
          />
          <PainelDominio dados={d} />
        </div>
        <ComoFica
          nome={nomeMostrado}
          cor={corValida ? cor : COR_PADRAO}
          logo={previa('logo')}
          icone={previa('icone')}
          imagem={previa('imagem')}
          endereco={d.dominio?.situacao === 'ativo' ? d.dominio.endereco : location.host}
        />
      </div>
    </>
  );
}

/* ---------- Marca ---------- */

function PainelMarca(props: {
  dados: DadosMarca;
  nome: string;
  setNome: (v: string) => void;
  cor: string;
  setCor: (v: string) => void;
  novos: Partial<Record<Arquivo, string | null>>;
  setNovos: (v: Partial<Record<Arquivo, string | null>>) => void;
  previa: (a: Arquivo) => string | null;
}) {
  const d = props.dados;
  const cliente = useQueryClient();
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => api<DadosMarca>('/marca', { metodo: 'PUT', corpo }),
    onSuccess: () => {
      props.setNovos({});
      cliente.invalidateQueries({ queryKey: ['marca'] });
      cliente.invalidateQueries({ queryKey: ['sessao'] });
      cliente.invalidateQueries({ queryKey: ['organizacao'] });
    },
  });
  const corValida = /^#[0-9a-fA-F]{6}$/.test(props.cor);
  const corClara = corValida && contrasteComBranco(props.cor) < 4.5;
  const temAlgo = !!(d.nome || d.cor || d.logo || d.icone || d.imagem);
  const escolher = async (a: Arquivo, f: File | undefined) => {
    setErroArquivo(null);
    if (!f) return;
    try {
      props.setNovos({ ...props.novos, [a]: await prepararImagem(f, a) });
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : 'Não deu para usar esta imagem.');
    }
  };
  const editar = d.podeEditar;
  return (
    <Panel titulo="Marca">
      <form
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          salvar.mutate({ nome: props.nome.trim() || null, cor: props.cor, ...props.novos });
        }}
      >
        <div className="form__duas">
          <div className="campo">
            <label htmlFor="mk-nome">Nome que aparece no sistema</label>
            <input
              id="mk-nome"
              className="filtro"
              maxLength={60}
              placeholder={d.organizacaoNome}
              value={props.nome}
              disabled={!editar}
              onChange={(e) => props.setNome(e.target.value)}
            />
          </div>
          <fieldset className="campo marca-campo-cor">
            <legend className="campo__rotulo">Cor principal</legend>
            <div className="marca-cores">
              {CORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="marca-cor"
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                  aria-pressed={props.cor.toLowerCase() === c}
                  disabled={!editar}
                  onClick={() => props.setCor(c)}
                />
              ))}
              <label className="marca-cor marca-cor--outra" title="Outra cor">
                <input
                  type="color"
                  aria-label="Escolher outra cor"
                  value={corValida ? props.cor : COR_PADRAO}
                  disabled={!editar}
                  onChange={(e) => props.setCor(e.target.value)}
                />
                <Icon name="plus" size={14} />
              </label>
              <input
                className="filtro mono marca-hex"
                aria-label="Cor em hexadecimal"
                value={props.cor}
                maxLength={7}
                disabled={!editar}
                onChange={(e) => props.setCor(e.target.value.trim())}
              />
            </div>
            {corClara && (
              <span className="campo__erro">
                Cor clara demais: o texto branco dos botões fica ilegível. Escolha um tom mais escuro.
              </span>
            )}
          </fieldset>
        </div>

        <div className="form__duas">
          <CartaoArquivo
            id="mk-logo"
            titulo="Logo"
            texto="PNG com fundo transparente fica melhor. Vai no menu, no login, na sala de reunião e nos relatórios."
            previa={props.previa('logo')}
            largo
            editar={editar}
            aoEscolher={(f) => escolher('logo', f)}
            aoTirar={() => props.setNovos({ ...props.novos, logo: null })}
          />
          <CartaoArquivo
            id="mk-icone"
            titulo="Ícone (aba e celular)"
            texto="Quadrado (ajustamos para 512×512). Vira o ícone da aba do navegador e do app no celular."
            previa={props.previa('icone')}
            editar={editar}
            aoEscolher={(f) => escolher('icone', f)}
            aoTirar={() => props.setNovos({ ...props.novos, icone: null })}
          />
        </div>
        <CartaoArquivo
          id="mk-imagem"
          titulo="Imagem de divulgação"
          texto="1200×630 (ajustamos sozinhos). Aparece ao lado do login e na prévia quando alguém manda um link do sistema no WhatsApp (convite, reunião). Sem ela, usamos a cor com o logo."
          previa={props.previa('imagem')}
          banner
          editar={editar}
          aoEscolher={(f) => escolher('imagem', f)}
          aoTirar={() => props.setNovos({ ...props.novos, imagem: null })}
        />

        {erroArquivo && <Mensagem tipo="erro">{erroArquivo}</Mensagem>}
        <ErroDaApi erro={salvar.error} />
        {salvar.isSuccess && <Mensagem tipo="ok">Marca salva. Já vale para todo mundo.</Mensagem>}
        {editar && (
          <div className="acoes">
            <Button variant="primary" type="submit" disabled={salvar.isPending || !corValida || corClara}>
              {salvar.isPending ? 'Salvando…' : 'Salvar marca'}
            </Button>
            {temAlgo && (
              <Button
                variant="ghost"
                disabled={salvar.isPending}
                onClick={() => {
                  props.setNome('');
                  props.setCor(COR_PADRAO);
                  salvar.mutate({ nome: null, cor: null, logo: null, icone: null, imagem: null });
                }}
              >
                Voltar ao padrão
              </Button>
            )}
          </div>
        )}
      </form>
    </Panel>
  );
}

function CartaoArquivo(props: {
  id: string;
  titulo: string;
  texto: string;
  previa: string | null;
  largo?: boolean;
  banner?: boolean;
  editar: boolean;
  aoEscolher: (f: File | undefined) => void;
  aoTirar: () => void;
}) {
  return (
    <div className={`marca-arquivo${props.banner ? ' marca-arquivo--banner' : ''}`}>
      <span
        className={`marca-arquivo__previa${props.largo ? ' marca-arquivo__previa--larga' : ''}${
          props.banner ? ' marca-arquivo__previa--banner' : ''
        }`}
      >
        {props.previa ? (
          <img src={props.previa} alt={`${props.titulo} atual`} />
        ) : (
          <Icon name="image" size={20} label="Sem imagem" />
        )}
      </span>
      <span className="marca-arquivo__texto">
        <b>{props.titulo}</b>
        <span>{props.texto}</span>
        {props.editar && (
          <span className="marca-arquivo__acoes">
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
                Tirar
              </Button>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/* ---------- Prévia ---------- */

function ComoFica(props: {
  nome: string;
  cor: string;
  logo: string | null;
  icone: string | null;
  imagem: string | null;
  endereco: string;
}) {
  const selo = { nome: props.nome, cor: props.cor, icone: null };
  const Icone = () =>
    props.icone ? (
      <img className="previa-nav__icone" src={props.icone} alt="" />
    ) : (
      <SeloDaMarca marca={selo} tamanho={16} />
    );
  return (
    <Panel titulo="Como fica">
      <div className="previa-navegador" aria-hidden="true">
        <div className="previa-navegador__aba">
          <Icone />
          <span>{props.nome} · Meu dia</span>
        </div>
        <div className="previa-navegador__barra">
          <Icon name="badge-check" size={12} />
          <span className="mono">{props.endereco}/hoje</span>
        </div>
        <div className="previa-navegador__corpo">
          <div className="previa-nav">
            <div className="previa-nav__marca">
              {props.logo ? (
                <img src={props.logo} alt="" />
              ) : (
                <>
                  <SeloDaMarca marca={selo} tamanho={20} />
                  <b>{props.nome}</b>
                </>
              )}
            </div>
            <span className="previa-nav__item" style={{ background: `${props.cor}1f` }} />
            <span className="previa-nav__linha" />
            <span className="previa-nav__linha" style={{ width: '50%' }} />
            <span className="previa-nav__linha" style={{ width: '70%' }} />
            <span className="previa-nav__rodape">Tecnologia Prospect Team</span>
          </div>
          <div className="previa-conteudo">
            <b>Bom dia!</b>
            <span className="previa-conteudo__botao" style={{ background: props.cor }} />
            <span className="previa-conteudo__cartao" />
          </div>
        </div>
      </div>

      <p className="quieto marca-previa-titulo">Link no WhatsApp</p>
      <div className="previa-whats" aria-hidden="true">
        <div
          className="previa-whats__imagem"
          style={
            props.imagem
              ? { backgroundImage: `url("${props.imagem}")` }
              : {
                  background: `linear-gradient(135deg, color-mix(in srgb, ${props.cor} 55%, black), ${props.cor} 55%, color-mix(in srgb, ${props.cor} 65%, white))`,
                }
          }
        >
          {!props.imagem &&
            (props.logo ? (
              <span className="previa-whats__logo">
                <img src={props.logo} alt="" />
              </span>
            ) : (
              <span className="previa-whats__nome">
                <SeloDaMarca marca={selo} tamanho={36} claro />
                {props.nome}
              </span>
            ))}
        </div>
        <div className="previa-whats__texto">
          <b>Reunião com {props.nome}</b>
          <span>Entre pelo navegador, sem instalar nada</span>
          <span>{props.endereco}</span>
        </div>
      </div>
      <p className="quieto marca-previa-nota">
        No celular, o app instalado fica com o seu ícone e o seu nome. O Prospect Team aparece só num discreto
        “Tecnologia Prospect Team” no rodapé do login, do menu e da sala de reunião.
      </p>
    </Panel>
  );
}

/* ---------- Domínio ---------- */

function PainelDominio(props: { dados: DadosMarca }) {
  const d = props.dados;
  const dom = d.dominio;
  const [trocando, setTrocando] = useState(false);
  const [tirando, setTirando] = useState(false);
  const cliente = useQueryClient();
  const atualizar = (r: DadosMarca) => {
    cliente.setQueryData(['marca'], r);
    cliente.invalidateQueries({ queryKey: ['sessao'] });
  };
  const tirar = useMutation({
    mutationFn: () => api<DadosMarca>('/marca/dominio', { metodo: 'DELETE' }),
    onSuccess: (r) => {
      atualizar(r);
      setTirando(false);
      setTrocando(false);
    },
  });
  const chip =
    dom?.situacao === 'ativo' ? (
      <Badge tone="brand" icon="check">
        Ativo
      </Badge>
    ) : dom ? (
      <Badge tone="warning">Aguardando o DNS</Badge>
    ) : null;
  return (
    <Panel titulo="Domínio próprio" acoes={chip}>
      {!d.dominioDisponivel ? (
        <Mensagem tipo="aviso">
          O domínio próprio ainda não está liberado na plataforma. Fale com o suporte do Prospect Team.
        </Mensagem>
      ) : !dom || trocando ? (
        <EscolherEndereco
          atual={dom?.endereco ?? null}
          editar={d.podeEditar}
          aoSalvar={(r) => {
            atualizar(r);
            setTrocando(false);
          }}
          aoCancelar={dom ? () => setTrocando(false) : undefined}
        />
      ) : dom.situacao === 'ativo' ? (
        <div className="pilha" style={{ gap: 12 }}>
          <div className="dominio-ativo">
            <span className="mono dominio-ativo__endereco">{dom.endereco}</span>
            <Button
              size="sm"
              variant="ghost"
              iconRight="external-link"
              href={`https://${dom.endereco}`}
              target="_blank"
              rel="noopener"
            >
              Abrir
            </Button>
          </div>
          <p className="quieto dominio-texto">
            Login, links de reunião, convites e “esqueci a senha” saem com este endereço. O cadeado (HTTPS) é
            renovado sozinho. O endereço de antes continua funcionando. Na primeira vez no endereço novo, cada
            pessoa entra de novo com e-mail e senha.
          </p>
          {dom.ativoEm && <p className="quieto dominio-texto">Ativo desde {fmtQuando(dom.ativoEm)}.</p>}
          {d.podeEditar && (
            <div className="acoes">
              <Button size="sm" onClick={() => setTrocando(true)}>
                Trocar endereço
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTirando(true)}>
                Tirar domínio
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Assistente
          dados={d}
          aoAtualizar={atualizar}
          aoTrocar={() => setTrocando(true)}
          aoDesistir={() => setTirando(true)}
        />
      )}
      {tirando && dom && (
        <Modal
          titulo="Tirar o domínio próprio?"
          aoFechar={() => setTirando(false)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setTirando(false)}>
                Manter
              </Button>
              <Button variant="danger" disabled={tirar.isPending} onClick={() => tirar.mutate()}>
                {tirar.isPending ? 'Tirando…' : 'Tirar domínio'}
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            O sistema deixa de abrir em <b className="mono">{dom.endereco}</b> e os links novos voltam a sair
            com o endereço do Prospect Team. Links já enviados com o seu endereço param de funcionar.
          </p>
          <p className="quieto" style={{ marginBottom: 0 }}>
            Depois, se quiser, apague o registro no DNS do seu domínio.
          </p>
          <ErroDaApi erro={tirar.error} />
        </Modal>
      )}
    </Panel>
  );
}

function EscolherEndereco(props: {
  atual: string | null;
  editar: boolean;
  aoSalvar: (r: DadosMarca) => void;
  aoCancelar?: () => void;
}) {
  const [endereco, setEndereco] = useState('');
  const definir = useMutation({
    mutationFn: () => api<DadosMarca>('/marca/dominio', { metodo: 'POST', corpo: { dominio: endereco } }),
    onSuccess: props.aoSalvar,
  });
  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (endereco.trim()) definir.mutate();
      }}
    >
      <div className="campo">
        <label htmlFor="mk-dominio">Endereço do sistema</label>
        <div className="dominio-linha">
          <input
            id="mk-dominio"
            className="filtro mono"
            placeholder="crm.suaempresa.com.br"
            autoComplete="off"
            spellCheck={false}
            value={endereco}
            disabled={!props.editar}
            onChange={(e) => setEndereco(e.target.value)}
          />
          {props.editar && (
            <Button variant="primary" type="submit" disabled={definir.isPending || !endereco.trim()}>
              {definir.isPending ? 'Preparando…' : 'Usar este endereço'}
            </Button>
          )}
        </div>
        <span className="campo__dica">
          Use um subdomínio do site da empresa (crm., sistema., app.). O site continua igual: só esse endereço
          novo passa a abrir o sistema.
          {props.atual ? ` Hoje: ${props.atual}.` : ''}
        </span>
      </div>
      <ErroDaApi erro={definir.error} />
      {props.aoCancelar && (
        <div className="acoes">
          <Button size="sm" variant="ghost" onClick={props.aoCancelar}>
            Cancelar
          </Button>
        </div>
      )}
    </form>
  );
}

const PROVEDORES = ['Registro.br', 'Cloudflare', 'Hostinger', 'GoDaddy', 'Outro'] as const;
type Provedor = (typeof PROVEDORES)[number];

/** O passo a passo de cada lugar onde o domínio costuma estar. */
function passos(p: Provedor, r: RegistroDns): ReactNode[] {
  const campos = (
    <>
      tipo <b>{r.tipo}</b>, nome <b className="mono">{r.nome}</b> e, no valor, o que está na tabela acima
    </>
  );
  switch (p) {
    case 'Registro.br':
      return [
        <>
          Entre em <b>registro.br</b> › seu domínio › <b>DNS</b> › <b>Editar zona</b> (modo avançado).
        </>,
        <>
          <b>Nova entrada</b>: {campos}.
        </>,
        <>
          <b>Salvar alterações</b> no fim da página. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    case 'Cloudflare':
      return [
        <>
          Entre no <b>Cloudflare</b> › seu domínio › <b>DNS</b> › <b>Records</b> › <b>Add record</b>.
        </>,
        <>
          Preencha {campos}. Deixe a nuvem <b>cinza</b> (Proxy desligado, “DNS only”).
        </>,
        <>
          <b>Save</b>. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    case 'Hostinger':
      return [
        <>
          No <b>hPanel</b> › <b>Domínios</b> › seu domínio › <b>DNS / Nameservers</b>.
        </>,
        <>
          Em <b>Gerenciar registros DNS</b>, preencha {campos} (“Aponta para”). TTL pode ficar o padrão.
        </>,
        <>
          <b>Adicionar registro</b>. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    case 'GoDaddy':
      return [
        <>
          Em <b>Meus produtos</b> › seu domínio › <b>DNS</b> › <b>Adicionar novo registro</b>.
        </>,
        <>Preencha {campos}.</>,
        <>
          <b>Salvar</b>. Pronto: o resto a gente confere sozinho.
        </>,
      ];
    default:
      return [
        <>
          Abra o painel onde o domínio está registrado e procure <b>DNS</b>, <b>Zona DNS</b> ou{' '}
          <b>Gerenciar registros</b>.
        </>,
        <>Crie um registro novo com {campos}.</>,
        <>
          Salve. Se o painel completa o nome sozinho com o domínio, digite só <b className="mono">{r.nome}</b>
          .
        </>,
      ];
  }
}

/** Texto para mandar a quem cuida do site da empresa. */
function instrucoesEmTexto(endereco: string, registros: RegistroDns[]): string {
  const linhas = registros.map((r) => `- Tipo ${r.tipo} | Nome: ${r.nome} | Valor: ${r.valor}`);
  return [
    `Preciso que o endereço ${endereco} aponte para o nosso sistema comercial.`,
    'Por favor, crie no DNS do domínio:',
    ...linhas,
    '',
    'Não precisa apagar nada do que já existe (site e e-mail continuam iguais). Se usar Cloudflare, deixe o proxy desligado (nuvem cinza, "DNS only").',
  ].join('\n');
}

function Copiar(props: { valor: string; rotulo?: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className={['link-botao', props.className].filter(Boolean).join(' ')}
      onClick={() => {
        void navigator.clipboard?.writeText(props.valor);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
    >
      {copiado ? 'Copiado' : (props.rotulo ?? 'Copiar')}
    </button>
  );
}

function Assistente(props: {
  dados: DadosMarca;
  aoAtualizar: (r: DadosMarca) => void;
  aoTrocar: () => void;
  aoDesistir: () => void;
}) {
  const dom = props.dados.dominio!;
  const [provedor, setProvedor] = useState<Provedor>('Registro.br');
  const conferir = useMutation({
    mutationFn: () => api<DadosMarca>('/marca/dominio/conferir', { metodo: 'POST' }),
    onSuccess: props.aoAtualizar,
  });
  const principal = dom.registros.find((r) => r.tipo !== 'TXT') ?? dom.registros[0];
  const txt = dom.registros.filter((r) => r.tipo === 'TXT');
  const semanaPassou = !!dom.desde && Date.now() - new Date(dom.desde).getTime() > 7 * 86_400_000;
  const editar = props.dados.podeEditar;
  return (
    <ol className="dominio-passos">
      <li className="dominio-passo dominio-passo--feito">
        <span className="dominio-passo__num" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
        <div className="dominio-passo__corpo">
          <b>1. Escolha o endereço</b>
          <div className="dominio-ativo">
            <span className="mono dominio-ativo__endereco">{dom.endereco}</span>
            {editar && (
              <button type="button" className="link-botao" onClick={props.aoTrocar}>
                Trocar
              </button>
            )}
          </div>
        </div>
      </li>
      <li className="dominio-passo">
        <span className="dominio-passo__num" aria-hidden="true">
          2
        </span>
        <div className="dominio-passo__corpo">
          <b>
            2. Crie {dom.registros.length > 1 ? 'estes registros' : 'este registro'} no DNS do seu domínio
          </b>
          <div className="dominio-tabela">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Nome</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {dom.registros.map((r) => (
                  <tr key={`${r.tipo}-${r.host}-${r.valor}`}>
                    <td className="mono">{r.tipo}</td>
                    <td>
                      <span className="mono">{r.nome}</span> <Copiar valor={r.nome} />
                    </td>
                    <td className="dominio-tabela__valor">
                      <span className="mono">{r.valor}</span> <Copiar valor={r.valor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {txt.length > 0 && (
            <p className="quieto dominio-texto">
              O registro TXT prova que o endereço é seu (ele já foi usado em outro site). Crie os dois.
            </p>
          )}
          <p className="quieto dominio-texto" id="mk-provedor">
            Onde o seu domínio está?
          </p>
          <div className="chips-provedor" role="tablist" aria-labelledby="mk-provedor">
            {PROVEDORES.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={provedor === p}
                className={`chip-provedor${provedor === p ? ' chip-provedor--ativo' : ''}`}
                onClick={() => setProvedor(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {principal && (
            <ol className="dominio-instrucoes" role="tabpanel">
              {passos(provedor, principal).map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: passos fixos de cada provedor
                <li key={i}>{p}</li>
              ))}
              {txt.length > 0 && <li>Repita com o registro TXT da tabela.</li>}
            </ol>
          )}
          <p className="quieto dominio-texto">
            Não tem acesso ao DNS? Mande este passo a passo para quem cuida do site da empresa.{' '}
            <Copiar valor={instrucoesEmTexto(dom.endereco, dom.registros)} rotulo="Copiar instruções" />
          </p>
        </div>
      </li>
      <li className="dominio-passo">
        <span className="dominio-passo__num" aria-hidden="true">
          3
        </span>
        <div className="dominio-passo__corpo">
          <b>3. Conferência</b>
          <div className="dominio-conferencia">
            <Badge tone="warning">Aguardando o DNS</Badge>
            <span className="quieto dominio-texto">
              {semanaPassou
                ? 'Já passou uma semana: agora só conferimos quando você clica em Conferir agora.'
                : 'Conferimos sozinhos a cada 5 minutos e o domínio passa a valer assim que o DNS chegar (pode levar de minutos a algumas horas).'}
            </span>
            {editar && (
              <Button size="sm" disabled={conferir.isPending} onClick={() => conferir.mutate()}>
                {conferir.isPending ? 'Conferindo…' : 'Conferir agora'}
              </Button>
            )}
          </div>
          {dom.erro && (
            <p className="dominio-texto dominio-erro">
              {dom.erro}
              {dom.conferidoEm ? ` (conferido ${fmtQuando(dom.conferidoEm)})` : ''}
            </p>
          )}
          <ErroDaApi erro={conferir.error} />
          <p className="quieto dominio-texto">
            Enquanto isso, o sistema segue no endereço de sempre,{' '}
            <span className="mono">{location.host}</span>. Quando ativar, os dois funcionam e os links novos
            saem com o seu.
          </p>
          {editar && (
            <div className="acoes">
              <Button size="sm" variant="ghost" onClick={props.aoDesistir}>
                Desistir deste endereço
              </Button>
            </div>
          )}
        </div>
      </li>
    </ol>
  );
}
