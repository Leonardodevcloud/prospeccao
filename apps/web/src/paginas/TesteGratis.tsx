import { DIAS_TESTE, LEADS_TESTE, USUARIOS_TESTE } from '@prospeccao/shared/assinatura';
import { Button, Icon, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { LINK_PRIVACIDADE, LINK_TERMOS } from '../componentes/ContaSegura';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { TelaAcesso } from '../componentes/Marca';

/**
 * Teste grátis (sem login): o cadastro, o "confira o seu e-mail" e o link de confirmação, que cria a
 * conta e já entra.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, o: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

/** A caixinha "não sou um robô" (Cloudflare Turnstile). */
function Captcha(props: { site: string; aoConfirmar: (token: string | null) => void; versao: number }) {
  const caixa = useRef<HTMLDivElement>(null);
  const aoConfirmar = useRef(props.aoConfirmar);
  aoConfirmar.current = props.aoConfirmar;
  // biome-ignore lint/correctness/useExhaustiveDependencies: versao refaz a caixinha depois de um erro
  useEffect(() => {
    let id: string | undefined;
    let vivo = true;
    const desenhar = () => {
      if (!vivo || !caixa.current || !window.turnstile) return;
      id = window.turnstile.render(caixa.current, {
        sitekey: props.site,
        language: 'pt-br',
        callback: (t: string) => aoConfirmar.current(t),
        'expired-callback': () => aoConfirmar.current(null),
        'error-callback': () => aoConfirmar.current(null),
      });
    };
    if (window.turnstile) desenhar();
    else {
      let s = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
      if (!s) {
        s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.dataset.turnstile = '1';
        document.head.appendChild(s);
      }
      s.addEventListener('load', desenhar);
    }
    return () => {
      vivo = false;
      if (id) window.turnstile?.remove(id);
    };
  }, [props.site, props.versao]);
  return <div ref={caixa} className="teste__captcha" />;
}

function Chamada() {
  return (
    <div className="teste__chamada">
      <h2>
        Teste {DIAS_TESTE} dias grátis.
        <br />
        <em>Sem cartão.</em>
      </h2>
      <p>
        Encontre empresas do seu nicho, veja quem decide e organize o funil do seu time. Tudo do plano Time,
        para {USUARIOS_TESTE} pessoas.
      </p>
      <ul className="teste__lista">
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>{LEADS_TESTE} leads enriquecidos</b> com telefone, site, Instagram e quem decide
          </span>
        </li>
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>Funil, cadência e Meu dia</b> para cada vendedor
          </span>
        </li>
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>Reuniões por vídeo</b> com gravação e resumo da IA
          </span>
        </li>
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>Formulário do site e API</b> direto no funil
          </span>
        </li>
        <li>
          <Icon name="check" size={14} />
          <span>WhatsApp com IA e Ligações ficam para quando assinar</span>
        </li>
      </ul>
      <p className="teste__nota">
        Gostou? Assine pelo próprio sistema (Pix, boleto ou cartão) e continue de onde parou. Não gostou? Não
        faça nada: não cobramos nada.
      </p>
    </div>
  );
}

/** /teste: o cadastro do teste grátis. */
export function TesteGratis() {
  const config = useQuery({
    queryKey: ['teste-config'],
    queryFn: () => api<{ captcha: string | null }>('/teste/config'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [d, setD] = useState({ nome: '', empresa: '', email: '', whatsapp: '', cnpj: '', senha: '' });
  const [aceite, setAceite] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [versaoCaptcha, setVersaoCaptcha] = useState(0);
  const [enviado, setEnviado] = useState<{ email: string; emailEnviado: boolean } | null>(null);
  const criar = useMutation({
    mutationFn: () =>
      api<{ email: string; emailEnviado: boolean }>('/teste', {
        metodo: 'POST',
        corpo: { ...d, cnpj: d.cnpj.trim() || null, aceite, captcha },
      }),
    onSuccess: setEnviado,
    onError: () => {
      // O captcha vale uma vez: depois de um erro, a caixinha começa de novo.
      setCaptcha(null);
      setVersaoCaptcha((v) => v + 1);
    },
  });
  const reenviar = useMutation({
    mutationFn: () => api('/teste/reenviar', { metodo: 'POST', corpo: { email: enviado?.email } }),
  });
  const campo = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD((x) => ({ ...x, [k]: e.target.value }));
  const site = config.data?.captcha ?? null;
  const pronto =
    d.nome.trim().length >= 2 &&
    d.empresa.trim().length >= 2 &&
    d.email.includes('@') &&
    d.whatsapp.replace(/\D/g, '').length >= 10 &&
    d.senha.length >= 10 &&
    aceite &&
    (!site || !!captcha);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (pronto) criar.mutate();
  };

  if (enviado)
    return (
      <TelaAcesso chamada={<Chamada />}>
        <div className="login__caixa">
          <div className="teste__icone-email">
            <Icon name="mail" size={28} />
          </div>
          <div className="login__cabeca">
            <h1>Confira o seu e-mail</h1>
            <p>
              Mandamos um link para <b>{enviado.email}</b>. Abra e clique em <b>Confirmar e entrar</b>: a
              conta é criada e o teste de {DIAS_TESTE} dias começa na hora.
            </p>
          </div>
          {!enviado.emailEnviado && (
            <Mensagem tipo="aviso">
              O e-mail não saiu agora. Clique em "Mandar de novo" em alguns minutos ou fale com a gente pelo
              WhatsApp.
            </Mensagem>
          )}
          <p className="login__nota">
            Não chegou? Olhe a caixa de spam ou promoções. O link vale 48 horas.{' '}
            <button
              type="button"
              className="link-botao"
              disabled={reenviar.isPending || reenviar.isSuccess}
              onClick={() => reenviar.mutate()}
            >
              {reenviar.isSuccess ? 'Mandamos de novo' : 'Mandar de novo'}
            </button>
          </p>
          <ErroDaApi erro={reenviar.error} />
          <p className="login__nota">
            E-mail errado?{' '}
            <button
              type="button"
              className="link-botao"
              onClick={() => {
                setEnviado(null);
                reenviar.reset();
              }}
            >
              Corrigir o cadastro
            </button>
          </p>
        </div>
      </TelaAcesso>
    );

  return (
    <TelaAcesso chamada={<Chamada />} largo>
      <form className="login__caixa teste__form" onSubmit={enviar} noValidate>
        <div className="login__cabeca">
          <h1>Criar a conta de teste</h1>
          <p>
            Já tem conta? <Link to="/login">Entrar</Link>
          </p>
        </div>
        <div className="teste__grade">
          <TextField
            rotulo="Seu nome"
            autoComplete="name"
            autoFocus
            value={d.nome}
            onChange={campo('nome')}
          />
          <TextField
            rotulo="WhatsApp"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="(00) 00000-0000"
            value={d.whatsapp}
            onChange={campo('whatsapp')}
          />
          <div className="teste__inteira">
            <TextField
              rotulo="Empresa"
              autoComplete="organization"
              value={d.empresa}
              onChange={campo('empresa')}
            />
          </div>
          <TextField
            rotulo="E-mail de trabalho"
            type="email"
            autoComplete="email"
            value={d.email}
            onChange={campo('email')}
          />
          <TextField
            rotulo="CNPJ (opcional)"
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={d.cnpj}
            onChange={campo('cnpj')}
          />
          <div className="teste__inteira">
            <TextField
              rotulo="Crie uma senha"
              type="password"
              autoComplete="new-password"
              dica="10 caracteres ou mais."
              value={d.senha}
              onChange={campo('senha')}
            />
          </div>
        </div>
        {site && <Captcha site={site} aoConfirmar={setCaptcha} versao={versaoCaptcha} />}
        <label className="teste__aceite">
          <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
          <span>
            Li e aceito os{' '}
            <a href={LINK_TERMOS} target="_blank" rel="noopener noreferrer">
              termos de uso
            </a>{' '}
            e a{' '}
            <a href={LINK_PRIVACIDADE} target="_blank" rel="noopener noreferrer">
              política de privacidade
            </a>
            .
          </span>
        </label>
        <ErroDaApi erro={criar.error} />
        <Button
          className="login__entrar"
          variant="primary"
          type="submit"
          disabled={criar.isPending || !pronto}
        >
          {criar.isPending ? 'Criando…' : 'Criar conta e começar o teste'}
        </Button>
        <p className="login__nota">
          Um teste por empresa (e-mail, WhatsApp e CNPJ). Mandamos um link para confirmar o e-mail.
        </p>
      </form>
    </TelaAcesso>
  );
}

/** /teste/confirmar/:token: o link do e-mail. Cria a conta e entra. */
export function ConfirmarTeste() {
  const { token = '' } = useParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const confirmar = useMutation({
    mutationFn: () => api(`/teste/confirmar/${encodeURIComponent(token)}`, { metodo: 'POST' }),
    onSuccess: () => {
      cliente.clear();
      navegar('/hoje?bemvindo=1', { replace: true });
    },
  });
  const foi = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: confirma uma vez ao abrir o link
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    confirmar.mutate();
  }, []);

  return (
    <TelaAcesso chamada={<Chamada />}>
      <div className="login__caixa">
        {confirmar.error ? (
          <>
            <div className="login__cabeca">
              <h1>Não deu para confirmar</h1>
            </div>
            <ErroDaApi erro={confirmar.error} />
            <div className="teste__botoes">
              <Button variant="primary" onClick={() => navegar('/login')}>
                Ir para o login
              </Button>
              <Button onClick={() => navegar('/teste')}>Fazer o cadastro de novo</Button>
            </div>
          </>
        ) : (
          <div className="login__cabeca">
            <h1>Criando a sua conta…</h1>
            <p>Só um instante: estamos preparando o Prospect Team para a sua empresa.</p>
          </div>
        )}
      </div>
    </TelaAcesso>
  );
}
