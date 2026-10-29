import { Badge, Button } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { fmtQuando } from '../formatar';
import { Modal } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';
import { useSessao } from './Sessao';

/**
 * Segurança da conta da pessoa: verificação em duas etapas (app autenticador), sessões abertas e
 * aceite dos termos. Também aplica a marca do cliente (cor e logo) no sistema.
 */

/** Termos e política ficam no site institucional. */
export const LINK_TERMOS = 'https://prospectteam.com.br/termos';
export const LINK_PRIVACIDADE = 'https://prospectteam.com.br/privacidade';

interface SituacaoDuasEtapas {
  ativo: boolean;
  desde: string | null;
  codigos: number;
  exigido: boolean;
}

/** Códigos de recuperação: mostra uma vez, com copiar e baixar. */
function CodigosRecuperacao(props: { codigos: string[] }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Prospect Team · códigos de recuperação (cada um vale uma vez)\n\n${props.codigos.join('\n')}\n`;
  return (
    <div className="pilha" style={{ gap: 10 }}>
      <Mensagem tipo="aviso">
        Guarde estes códigos num lugar seguro (gerenciador de senhas, papel). Se perder o celular, cada um
        deixa você entrar uma vez. Eles não aparecem de novo.
      </Mensagem>
      <ul className="codigos-recuperacao mono">
        {props.codigos.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="acoes">
        <Button
          size="sm"
          icon={copiado ? 'check' : 'copy'}
          onClick={() => {
            void navigator.clipboard?.writeText(texto);
            setCopiado(true);
          }}
        >
          {copiado ? 'Copiados' : 'Copiar'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="file-down"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(texto)}`}
          download="prospect-team-codigos-de-recuperacao.txt"
        >
          Baixar
        </Button>
      </div>
    </div>
  );
}

/** Ligar, desligar e trocar os códigos da verificação em duas etapas. */
export function DuasEtapas(props: { obrigatorio?: boolean; aoAtivar?: () => void }) {
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['duas-etapas'],
    queryFn: () => api<SituacaoDuasEtapas>('/auth/duas-etapas'),
  });
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const iniciar = useMutation({
    mutationFn: () =>
      api<{ segredo: string; endereco: string; qr: string }>('/auth/duas-etapas/iniciar', { metodo: 'POST' }),
  });
  const ativar = useMutation({
    mutationFn: () =>
      api<{ codigos: string[] }>('/auth/duas-etapas/ativar', { metodo: 'POST', corpo: { codigo } }),
    onSuccess: (r) => {
      setCodigos(r.codigos);
      setCodigo('');
      iniciar.reset();
      cliente.invalidateQueries({ queryKey: ['duas-etapas'] });
    },
  });
  const desativar = useMutation({
    mutationFn: () => api('/auth/duas-etapas/desativar', { metodo: 'POST', corpo: { senha } }),
    onSuccess: () => {
      setSenha('');
      cliente.invalidateQueries({ queryKey: ['duas-etapas'] });
      cliente.invalidateQueries({ queryKey: ['sessao'] });
    },
  });
  const novos = useMutation({
    mutationFn: () =>
      api<{ codigos: string[] }>('/auth/duas-etapas/codigos', { metodo: 'POST', corpo: { codigo } }),
    onSuccess: (r) => {
      setCodigos(r.codigos);
      setCodigo('');
      cliente.invalidateQueries({ queryKey: ['duas-etapas'] });
    },
  });
  const s = q.data;

  return (
    <section className="pilha" style={{ gap: 12 }}>
      <h3 className="subtitulo">
        Verificação em duas etapas{' '}
        {s?.ativo ? <Badge tone="brand">Ligada</Badge> : <Badge tone="outline">Desligada</Badge>}
      </h3>
      <ErroDaApi erro={q.error ?? iniciar.error ?? ativar.error ?? desativar.error ?? novos.error} />
      {codigos ? (
        <>
          <CodigosRecuperacao codigos={codigos} />
          <Button
            variant="primary"
            onClick={() => {
              setCodigos(null);
              cliente.invalidateQueries({ queryKey: ['sessao'] });
              props.aoAtivar?.();
            }}
          >
            Já guardei os códigos
          </Button>
        </>
      ) : !s ? null : s.ativo ? (
        <>
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            Ligada {s.desde ? fmtQuando(s.desde) : ''}. Ao entrar, além da senha, o sistema pede o código do
            app autenticador. Restam {s.codigos} códigos de recuperação.
          </p>
          <form
            className="campo"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              novos.mutate();
            }}
          >
            <label htmlFor="de-novos">Gerar códigos de recuperação novos (digite o código do app)</label>
            <div className="copiar">
              <input
                id="de-novos"
                className="filtro mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
              <Button type="submit" disabled={novos.isPending || codigo.trim().length < 6}>
                Gerar
              </Button>
            </div>
          </form>
          {s.exigido ? (
            <span className="campo__dica">Sua organização exige a verificação em duas etapas.</span>
          ) : (
            <form
              className="campo"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                desativar.mutate();
              }}
            >
              <label htmlFor="de-senha">Desligar (confirme com a sua senha)</label>
              <div className="copiar">
                <input
                  id="de-senha"
                  className="filtro"
                  type="password"
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
                <Button type="submit" variant="ghost" disabled={desativar.isPending || !senha}>
                  Desligar
                </Button>
              </div>
            </form>
          )}
        </>
      ) : iniciar.data ? (
        <form
          className="pilha"
          style={{ gap: 12 }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            ativar.mutate();
          }}
        >
          <ol className="passos-2fa">
            <li>
              No celular, abra um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password…)
              e leia este QR code.
            </li>
            <li>Digite abaixo o código de 6 números que aparece no app.</li>
          </ol>
          {/* QR gerado pela própria api a partir do endereço otpauth. */}
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG do QR feito pela api (biblioteca qrcode), não vem do usuário. */}
          <div className="qr-2fa" dangerouslySetInnerHTML={{ __html: iniciar.data.qr }} />
          <details>
            <summary className="quieto" style={{ fontSize: 13 }}>
              Não consegue ler o QR? Digite a chave
            </summary>
            <code className="mono chave-2fa">{iniciar.data.segredo.replace(/(.{4})/g, '$1 ').trim()}</code>
          </details>
          <div className="campo">
            <label htmlFor="de-codigo">Código do app</label>
            <input
              id="de-codigo"
              className="filtro mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
          </div>
          <Button variant="primary" type="submit" disabled={ativar.isPending || codigo.trim().length < 6}>
            {ativar.isPending ? 'Conferindo…' : 'Ligar a verificação'}
          </Button>
        </form>
      ) : (
        <>
          <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
            {props.obrigatorio
              ? 'Sua organização exige: além da senha, o sistema vai pedir um código do app autenticador do seu celular.'
              : 'Proteja o acesso: além da senha, o sistema pede um código do app autenticador do seu celular. Mesmo que alguém descubra a senha, não entra.'}
          </p>
          <Button
            variant="primary"
            icon="badge-check"
            disabled={iniciar.isPending}
            onClick={() => iniciar.mutate()}
          >
            Configurar agora
          </Button>
        </>
      )}
    </section>
  );
}

interface SessaoAberta {
  id: string;
  criadoEm: string;
  ultimoUso: string;
  ip: string | null;
  aparelho: string | null;
  atual: boolean;
}

/** "Chrome no Windows", "Safari no iPhone"… */
function nomeDoAparelho(ua: string | null): string {
  if (!ua) return 'Aparelho desconhecido';
  const nav = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navegador';
  const so = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return so ? `${nav} no ${so}` : nav;
}

export function SessoesAbertas() {
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['sessoes'], queryFn: () => api<SessaoAberta[]>('/auth/sessoes') });
  const encerrar = useMutation({
    mutationFn: (id: string) => api(`/auth/sessoes/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['sessoes'] }),
  });
  const outras = useMutation({
    mutationFn: () => api('/auth/sessoes/encerrar-outras', { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['sessoes'] }),
  });
  const lista = q.data ?? [];
  return (
    <section className="pilha" style={{ gap: 12 }}>
      <h3 className="subtitulo">Onde você está conectado</h3>
      <ErroDaApi erro={q.error ?? encerrar.error ?? outras.error} />
      <ul className="sessoes">
        {lista.map((x) => (
          <li key={x.id} className="sessoes__item">
            <div>
              <b>{nomeDoAparelho(x.aparelho)}</b> {x.atual && <Badge tone="brand">Este aparelho</Badge>}
              <div className="quieto" style={{ fontSize: 12 }}>
                Entrou {fmtQuando(x.criadoEm)} · usado {fmtQuando(x.ultimoUso)}
                {x.ip ? ` · ${x.ip}` : ''}
              </div>
            </div>
            {!x.atual && (
              <Button
                size="sm"
                variant="ghost"
                disabled={encerrar.isPending}
                onClick={() => encerrar.mutate(x.id)}
              >
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>
      {lista.filter((x) => !x.atual).length > 0 && (
        <Button variant="ghost" icon="log-out" disabled={outras.isPending} onClick={() => outras.mutate()}>
          Sair de todos os outros aparelhos
        </Button>
      )}
    </section>
  );
}

/** Organização exige duas etapas e a pessoa não configurou: tela inteira até configurar. */
export function DuasEtapasObrigatoria() {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const sair = useMutation({
    mutationFn: () => api('/auth/logout', { metodo: 'POST' }),
    onSettled: () => {
      cliente.clear();
      navegar('/login');
    },
  });
  return (
    <div className="tela-obrigatoria">
      <div className="pp-panel tela-obrigatoria__caixa">
        <DuasEtapas obrigatorio aoAtivar={() => cliente.invalidateQueries()} />
        <Button variant="ghost" size="sm" icon="log-out" onClick={() => sair.mutate()}>
          Sair
        </Button>
      </div>
    </div>
  );
}

/** Termos de uso e política de privacidade: aceitar a versão em vigor para continuar. */
export function AceitarTermos(props: { versao: string }) {
  const cliente = useQueryClient();
  const [li, setLi] = useState(false);
  const aceitar = useMutation({
    mutationFn: () => api('/auth/termos', { metodo: 'POST', corpo: { versao: props.versao } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['sessao'] }),
  });
  return (
    <Modal
      titulo="Termos de uso e privacidade"
      aoFechar={() => undefined}
      rodape={
        <Button variant="primary" disabled={!li || aceitar.isPending} onClick={() => aceitar.mutate()}>
          Aceitar e continuar
        </Button>
      }
    >
      <div className="pilha" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>
          Para usar o Prospect Team, leia e aceite os{' '}
          <a href={LINK_TERMOS} target="_blank" rel="noopener noreferrer">
            Termos de uso
          </a>{' '}
          e a{' '}
          <a href={LINK_PRIVACIDADE} target="_blank" rel="noopener noreferrer">
            Política de privacidade
          </a>
          . Eles explicam como os dados das empresas prospectadas e da sua equipe são tratados (LGPD).
        </p>
        <label className="opcao">
          <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} />
          <span>Li e aceito os Termos de uso e a Política de privacidade.</span>
        </label>
        <ErroDaApi erro={aceitar.error} />
      </div>
    </Modal>
  );
}

/** Marca do cliente: a cor vira a cor do sistema (botões, links, destaques). */
export function useAplicarMarca() {
  const marca = useSessao().data?.marca;
  const cor = marca?.cor ?? null;
  useEffect(() => {
    const raiz = document.documentElement.style;
    const vars = ['--brand', '--brand-hover', '--brand-soft', '--focus-ring'];
    if (!cor) {
      for (const v of vars) raiz.removeProperty(v);
      return;
    }
    raiz.setProperty('--brand', cor);
    raiz.setProperty('--brand-hover', `color-mix(in srgb, ${cor} 85%, black)`);
    raiz.setProperty('--brand-soft', `color-mix(in srgb, ${cor} 12%, white)`);
    raiz.setProperty('--focus-ring', `0 0 0 2px #f7f7f5, 0 0 0 4px ${cor}`);
    return () => {
      for (const v of vars) raiz.removeProperty(v);
    };
  }, [cor]);
}
