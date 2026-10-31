import {
  CENAS_FUNDO,
  type ConfigFundos,
  ESTILOS_LOGO,
  type EstiloLogo,
  LUGARES_FOTO,
  lugarDaLogo,
  nomeDoFundo,
  SEM_LOGO,
} from '@prospeccao/shared/fundos';
import { Button, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Modal } from '../componentes/Drawer';
import { ForaDoPlano } from '../componentes/ForaDoPlano';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import type { MarcaDoFundo } from '../reuniao/fundosImagem';
import { useMiniatura } from '../reuniao/SeletorFundo';

/**
 * Fundos das reuniões (aba de Marca e domínio): o gestor escolhe quais fundos com a logo o time usa,
 * qual vem marcado ao entrar, se fica travado, onde a logo entra em cada cenário e envia fotos da
 * empresa. A logo é a da Marca: mudou lá, todos os fundos mudam.
 */

interface FotoFundo {
  id: number;
  nome: string;
}

interface TelaFundos {
  config: ConfigFundos;
  fotos: FotoFundo[];
  limiteFotos: number;
  podeEditar: boolean;
  comMarca: boolean;
  logo: string | null;
  cor: string | null;
}

/** A foto vira 1920×1080 em JPG no navegador (corta o que sobra, mantendo o centro). */
async function prepararFoto(arquivo: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) throw new Error('Use uma foto JPG ou PNG.');
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falhou) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falhou(new Error('Não deu para abrir esta foto. Tente outra.'));
      i.src = url;
    });
    const W = 1920;
    const H = 1080;
    const e = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const sw = W / e;
    const sh = H / e;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FundosDasReunioes() {
  const q = useQuery({ queryKey: ['marca-fundos'], queryFn: () => api<TelaFundos>('/marca/fundos') });
  if (q.isPending) return <div className="esqueleto" style={{ height: 360 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  if (!q.data.comMarca) return <ForaDoPlano recurso="marca" compacto />;
  return <Configurar tela={q.data} />;
}

function Configurar(props: { tela: TelaFundos }) {
  const t = props.tela;
  const cliente = useQueryClient();
  const [cfg, setCfg] = useState<ConfigFundos>(t.config);
  const ids = useMemo(
    () => [...CENAS_FUNDO.map((c) => `logo:${c.id}`), ...t.fotos.map((f) => `foto:${f.id}`)],
    [t.fotos],
  );
  const [selecionado, setSelecionado] = useState<string>(() => t.config.padrao ?? ids[0]!);
  const sel = ids.includes(selecionado) ? selecionado : ids[0]!;
  const m: MarcaDoFundo = useMemo(
    () => ({
      cor: t.cor,
      logo: t.logo ? `/api${t.logo}` : null,
      config: cfg,
      fotos: t.fotos.map((f) => ({ id: f.id, url: `/api/marca/fundos/fotos/${f.id}` })),
    }),
    [t.cor, t.logo, t.fotos, cfg],
  );
  const mudou = JSON.stringify(cfg) !== JSON.stringify(t.config);
  const editar = t.podeEditar;
  const atualizar = (r: TelaFundos) => cliente.setQueryData(['marca-fundos'], r);
  const salvar = useMutation({
    mutationFn: () => api<TelaFundos>('/marca/fundos', { metodo: 'PUT', corpo: cfg }),
    onSuccess: (r) => {
      atualizar(r);
      setCfg(r.config);
    },
  });
  const liberado = (id: string) => cfg.liberados.includes(id);
  const alternar = (id: string) =>
    setCfg((c) => ({
      ...c,
      liberados: c.liberados.includes(id) ? c.liberados.filter((x) => x !== id) : [...c.liberados, id],
      padrao: c.padrao === id && c.liberados.includes(id) ? null : c.padrao,
    }));
  return (
    <>
      {!t.logo && (
        <Mensagem tipo="aviso">
          Coloque a logo na aba Marca: é ela que entra nos fundos. Sem logo, os cenários aparecem sem ela.
        </Mensagem>
      )}
      <div className="fundos-gestor">
        <Panel
          titulo="Fundos liberados para a equipe"
          acoes={<span className="quieto fundos-gestor__dica">A logo entra sozinha em cada fundo</span>}
        >
          <div className="fundos-painel">
            <div className="fundos-cartoes">
              {ids.map((id) => (
                <CartaoFundo
                  key={id}
                  id={id}
                  nome={nomeDoFundo(id, t.fotos)}
                  m={m}
                  liberado={liberado(id)}
                  padrao={cfg.padrao === id}
                  selecionado={sel === id}
                  editar={editar}
                  aoSelecionar={() => setSelecionado(id)}
                  aoAlternar={() => alternar(id)}
                />
              ))}
              {editar && t.fotos.length < t.limiteFotos && (
                <EnviarFoto
                  aoEnviar={(r) => {
                    atualizar(r);
                    // A foto nova já vem liberada (o resto do que não foi salvo continua como está).
                    const nova = r.fotos[r.fotos.length - 1];
                    if (nova) {
                      setCfg((c) => ({ ...c, liberados: [...c.liberados, `foto:${nova.id}`] }));
                      setSelecionado(`foto:${nova.id}`);
                    }
                  }}
                />
              )}
            </div>
            <label className="opcao fundos-opcao">
              <input
                type="checkbox"
                checked={cfg.simples}
                disabled={!editar}
                onChange={(e) => setCfg((c) => ({ ...c, simples: e.target.checked }))}
              />
              <span>
                <b>Desfoque e cenários sem logo</b>
                <span className="campo__dica" style={{ display: 'block' }}>
                  Cada pessoa do time também pode usar o desfoque e os cenários sem a logo.
                </span>
              </span>
            </label>
            <label className="opcao fundos-opcao">
              <input
                type="checkbox"
                checked={cfg.travar}
                disabled={!editar || !cfg.padrao}
                onChange={(e) => setCfg((c) => ({ ...c, travar: e.target.checked }))}
              />
              <span>
                <b>Travar o fundo padrão</b>
                <span className="campo__dica" style={{ display: 'block' }}>
                  {cfg.padrao
                    ? `Todo mundo do time entra e fica com "${nomeDoFundo(cfg.padrao, t.fotos)}" (ninguém troca). Convidados de fora escolhem o deles.`
                    : 'Escolha primeiro um fundo como padrão ao entrar.'}
                </span>
              </span>
            </label>
            <ErroDaApi erro={salvar.error} />
            {salvar.isSuccess && !mudou && (
              <Mensagem tipo="ok">Fundos salvos. Valem na próxima reunião.</Mensagem>
            )}
            {editar && (
              <div className="acoes">
                <Button
                  variant="primary"
                  disabled={!mudou || salvar.isPending}
                  onClick={() => salvar.mutate()}
                >
                  {salvar.isPending ? 'Salvando…' : 'Salvar fundos'}
                </Button>
                {mudou && (
                  <Button variant="ghost" onClick={() => setCfg(t.config)}>
                    Desfazer
                  </Button>
                )}
              </div>
            )}
          </div>
        </Panel>
        <Detalhe
          id={sel}
          nome={nomeDoFundo(sel, t.fotos)}
          m={m}
          cfg={cfg}
          editar={editar}
          aoMudar={setCfg}
          aoTirarFoto={(r, foto) => {
            atualizar(r);
            setCfg((c) => ({
              ...c,
              liberados: c.liberados.filter((x) => x !== foto),
              padrao: c.padrao === foto ? null : c.padrao,
              travar: c.padrao === foto ? false : c.travar,
              lugares: Object.fromEntries(Object.entries(c.lugares).filter(([k]) => k !== foto)),
            }));
            setSelecionado(ids[0]!);
          }}
        />
      </div>
    </>
  );
}

function CartaoFundo(props: {
  id: string;
  nome: string;
  m: MarcaDoFundo;
  liberado: boolean;
  padrao: boolean;
  selecionado: boolean;
  editar: boolean;
  aoSelecionar: () => void;
  aoAlternar: () => void;
}) {
  const url = useMiniatura(props.id, props.m, 480);
  return (
    <div
      className="fundo-cartao"
      data-selecionado={props.selecionado || undefined}
      data-fora={!props.liberado || undefined}
    >
      <button
        type="button"
        className="fundo-cartao__img"
        onClick={props.aoSelecionar}
        aria-label={`Ver ${props.nome}`}
      >
        {url ? <img src={url} alt="" /> : <span className="esqueleto" />}
        {props.padrao && <span className="fundo-cartao__padrao">Padrão ao entrar</span>}
      </button>
      <label className="fundo-cartao__rodape">
        <span>{props.nome}</span>
        <input
          type="checkbox"
          checked={props.liberado}
          disabled={!props.editar}
          aria-label={`Liberar ${props.nome} para a equipe`}
          onChange={props.aoAlternar}
        />
      </label>
    </div>
  );
}

function EnviarFoto(props: { aoEnviar: (r: TelaFundos) => void }) {
  const [imagem, setImagem] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const enviar = useMutation({
    mutationFn: () =>
      api<TelaFundos>('/marca/fundos/fotos', { metodo: 'POST', corpo: { nome: nome.trim(), imagem } }),
    onSuccess: (r) => {
      setImagem(null);
      setNome('');
      props.aoEnviar(r);
    },
  });
  if (imagem)
    return (
      <form
        className="fundo-cartao fundo-cartao--nova"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          enviar.mutate();
        }}
      >
        <span className="fundo-cartao__img">
          <img src={imagem} alt="Foto nova" />
        </span>
        <div className="fundo-cartao__form">
          <input
            className="filtro"
            aria-label="Nome da foto"
            placeholder="Nome (ex.: Recepção)"
            maxLength={40}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <ErroDaApi erro={enviar.error} />
          <div className="acoes">
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={enviar.isPending || nome.trim().length < 2}
            >
              {enviar.isPending ? 'Enviando…' : 'Enviar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setImagem(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      </form>
    );
  return (
    <label className="fundo-novo">
      <input
        className="pp-sr"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          setErro(null);
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setImagem(await prepararFoto(f));
            setNome(
              f.name
                .replace(/\.[^.]+$/, '')
                .replace(/[-_]+/g, ' ')
                .slice(0, 40),
            );
          } catch (x) {
            setErro(x instanceof Error ? x.message : 'Não deu para usar esta foto.');
          }
        }}
      />
      <Icon name="upload" size={20} />
      <b>Enviar foto da empresa</b>
      <span>Recepção, fachada, showroom. A gente ajusta para 1920×1080.</span>
      {erro && <span className="fundo-novo__erro">{erro}</span>}
    </label>
  );
}

function Detalhe(props: {
  id: string;
  nome: string;
  m: MarcaDoFundo;
  cfg: ConfigFundos;
  editar: boolean;
  aoMudar: (f: (c: ConfigFundos) => ConfigFundos) => void;
  aoTirarFoto: (r: TelaFundos, foto: string) => void;
}) {
  const { id, cfg } = props;
  const url = useMiniatura(id, props.m, 960);
  const foto = id.startsWith('foto:');
  const cena = CENAS_FUNDO.find((c) => `logo:${c.id}` === id);
  const lugares = foto ? LUGARES_FOTO : (cena?.lugares ?? []);
  const atual = lugarDaLogo(cfg, id);
  const lugarAtual = atual.lugar?.id ?? SEM_LOGO;
  const [camera, setCamera] = useState(false);
  const [tirando, setTirando] = useState(false);
  const mudar = (x: { lugar?: string; estilo?: EstiloLogo }) =>
    props.aoMudar((c) => ({
      ...c,
      lugares: { ...c.lugares, [id]: { lugar: x.lugar ?? lugarAtual, estilo: x.estilo ?? atual.estilo } },
    }));
  const tirar = useMutation({
    mutationFn: () => api<TelaFundos>(`/marca/fundos/fotos/${id.slice(5)}`, { metodo: 'DELETE' }),
    onSuccess: (r) => {
      setTirando(false);
      props.aoTirarFoto(r, id);
    },
  });
  const ehPadrao = cfg.padrao === id;
  return (
    <Panel titulo={props.nome}>
      <div className="fundos-painel">
        <div className="fundo-previa">
          {url ? <img src={url} alt={`Fundo ${props.nome}`} /> : <span className="esqueleto" />}
          {atual.lugar && (
            <span
              className="fundo-previa__lugar"
              aria-hidden="true"
              style={{
                left: `${atual.lugar.x * 100}%`,
                top: `${atual.lugar.y * 100}%`,
                width: `${atual.lugar.w * 100}%`,
                height: `${atual.lugar.h * 100}%`,
              }}
            />
          )}
        </div>
        <fieldset className="fundo-escolha">
          <legend>Onde a logo fica</legend>
          <div className="chips-provedor">
            {[...lugares, { id: SEM_LOGO, nome: 'Sem logo' }].map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={lugarAtual === l.id}
                disabled={!props.editar}
                className={`chip-provedor${lugarAtual === l.id ? ' chip-provedor--ativo' : ''}`}
                onClick={() => mudar({ lugar: l.id })}
              >
                {l.nome}
              </button>
            ))}
          </div>
        </fieldset>
        {atual.lugar && (
          <fieldset className="fundo-escolha">
            <legend>Estilo da logo</legend>
            <div className="chips-provedor">
              {ESTILOS_LOGO.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={atual.estilo === e.id}
                  disabled={!props.editar}
                  className={`chip-provedor${atual.estilo === e.id ? ' chip-provedor--ativo' : ''}`}
                  onClick={() => mudar({ estilo: e.id })}
                >
                  {e.nome}
                </button>
              ))}
            </div>
            {atual.estilo === 'adesivo' && (
              <span className="campo__dica">
                O adesivo pinta a logo com a cor da marca (funciona com logo de fundo transparente).
              </span>
            )}
          </fieldset>
        )}
        <p className="quieto dominio-texto">
          Os lugares da logo ficam fora de onde a pessoa aparece (em cima e nos cantos). Mudou a logo em
          Marca, os fundos mudam juntos.
        </p>
        <div className="acoes">
          {props.editar && (
            <Button
              size="sm"
              variant={ehPadrao ? 'secondary' : 'primary'}
              icon={ehPadrao ? 'check' : undefined}
              disabled={!cfg.liberados.includes(id) && !ehPadrao}
              onClick={() =>
                props.aoMudar((c) => ({
                  ...c,
                  padrao: ehPadrao ? null : id,
                  travar: ehPadrao ? false : c.travar,
                  liberados: c.liberados.includes(id) ? c.liberados : [...c.liberados, id],
                }))
              }
            >
              {ehPadrao ? 'Padrão ao entrar' : 'Usar como padrão ao entrar'}
            </Button>
          )}
          <Button size="sm" icon="video" onClick={() => setCamera(true)}>
            Ver na minha câmera
          </Button>
          {foto && props.editar && (
            <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setTirando(true)}>
              Tirar esta foto
            </Button>
          )}
        </div>
      </div>
      {camera && <CameraComFundo id={id} nome={props.nome} m={props.m} aoFechar={() => setCamera(false)} />}
      {tirando && (
        <Modal
          titulo="Tirar esta foto?"
          aoFechar={() => setTirando(false)}
          rodape={
            <>
              <Button variant="ghost" onClick={() => setTirando(false)}>
                Manter
              </Button>
              <Button variant="danger" disabled={tirar.isPending} onClick={() => tirar.mutate()}>
                {tirar.isPending ? 'Tirando…' : 'Tirar a foto'}
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            “{props.nome}” sai da lista de fundos do time. Quem estava usando volta para o padrão na próxima
            reunião.
          </p>
          <ErroDaApi erro={tirar.error} />
        </Modal>
      )}
    </Panel>
  );
}

/** Testa o fundo na própria câmera, antes de liberar para o time (carrega o motor só aqui). */
function CameraComFundo(props: { id: string; nome: string; m: MarcaDoFundo; aoFechar: () => void }) {
  const el = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<'ligando' | 'pronto' | 'erro'>('ligando');
  const [erro, setErro] = useState<string | null>(null);
  const { id, m } = props;
  useEffect(() => {
    let vivo = true;
    let parar: (() => void) | null = null;
    (async () => {
      try {
        const [{ createLocalVideoTrack, VideoPresets }, motor] = await Promise.all([
          import('livekit-client'),
          import('../reuniao/fundos'),
        ]);
        if (!motor.suportaFundos()) throw new Error('Este navegador não consegue trocar o fundo da câmera.');
        const faixa = await createLocalVideoTrack({ resolution: VideoPresets.h720.resolution });
        parar = () => faixa.stop();
        if (!vivo) return parar();
        if (el.current) faixa.attach(el.current);
        await motor.aplicarFundo(faixa, id, m);
        if (vivo) setEstado('pronto');
      } catch (x) {
        if (!vivo) return;
        setEstado('erro');
        setErro(
          x instanceof Error && /notallowed|permission/i.test(`${x.name} ${x.message}`)
            ? 'O navegador não deixou usar a câmera. Permita a câmera no cadeado ao lado do endereço.'
            : x instanceof Error && x.message.startsWith('Este navegador')
              ? x.message
              : 'Não deu para ligar a câmera agora.',
        );
      }
    })();
    return () => {
      vivo = false;
      parar?.();
    };
  }, [id, m]);
  return (
    <Modal titulo={`Na sua câmera: ${props.nome}`} aoFechar={props.aoFechar} largura="larga">
      <div className="fundo-camera">
        <video ref={el} muted playsInline autoPlay />
        {estado === 'ligando' && (
          <span className="fundo-camera__estado" role="status">
            <Icon name="loader" spin size={16} /> Ligando a câmera e aplicando o fundo…
          </span>
        )}
      </div>
      {erro && <Mensagem tipo="aviso">{erro}</Mensagem>}
      <p className="quieto dominio-texto">
        É assim que as pessoas veem você na reunião (sem espelho). A câmera desliga ao fechar.
      </p>
    </Modal>
  );
}
