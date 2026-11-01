import {
  DIAS_TESTE,
  LEADS_TESTE,
  REGRAS_SENHA_CADASTRO,
  USUARIOS_TESTE,
} from '@prospeccao/shared/assinatura';
import { NOME_PLANO, type PlanoPronto } from '@prospeccao/shared/planos';
import { Button, Icon, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api';
import { LINK_PRIVACIDADE, LINK_TERMOS } from '../componentes/ContaSegura';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { TelaAcesso } from '../componentes/Marca';

/**
 * Teste grátis (sem login): o cadastro, o "confira o seu e-mail" e o link de confirmação, que cria a
 * conta e já entra. Com ?assinar=start|time|escala (o "Assinar" do site): o mesmo cadastro, e depois
 * de confirmar abre Meu plano › Assinar com o plano escolhido (até pagar, a conta funciona como teste).
 */

const PLANOS_ASSINAR: PlanoPronto[] = ['start', 'time', 'escala'];
/** O plano do "Assinar" do site (ou null: é o teste grátis). */
export function planoDoLink(v: string | null): PlanoPronto | null {
  return PLANOS_ASSINAR.includes(v as PlanoPronto) ? (v as PlanoPronto) : null;
}

function ChamadaAssinar(props: { plano: PlanoPronto }) {
  return (
    <div className="teste__chamada">
      <h2>
        Assinar o plano {NOME_PLANO[props.plano]}.
        <br />
        <em>Sem fidelidade.</em>
      </h2>
      <p>Crie a conta, escolha quantas pessoas e quais módulos e pague na hora. Leva uns 3 minutos.</p>
      <ul className="teste__lista">
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>Preço na tela</b> conforme você escolhe usuários e módulos
          </span>
        </li>
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>Pix, boleto ou cartão</b>: com Pix, o plano libera na hora
          </span>
        </li>
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>Cada mês é um pagamento</b>: sem cobrança automática no cartão
          </span>
        </li>
        <li>
          <Icon name="check" size={14} />
          <span>Até o pagamento cair, a conta já funciona como teste</span>
        </li>
      </ul>
      <p className="teste__nota">
        Prefere testar antes? <Link to="/teste">Teste {DIAS_TESTE} dias grátis</Link>, sem cartão.
      </p>
    </div>
  );
}

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
        Encontre empresas do seu nicho, veja os possíveis decisores e organize o funil do seu time. Tudo do
        plano Time, para {USUARIOS_TESTE} pessoas.
      </p>
      <ul className="teste__lista">
        <li>
          <Icon name="check" size={14} />
          <span>
            <b>{LEADS_TESTE} leads enriquecidos</b> com telefone, site, Instagram e possíveis decisores
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
  const [params] = useSearchParams();
  const assinar = planoDoLink(params.get('assinar'));
  const chamada = assinar ? <ChamadaAssinar plano={assinar} /> : <Chamada />;
  const config = useQuery({
    queryKey: ['teste-config'],
    queryFn: () => api<{ captcha: string | null }>('/teste/config'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [d, setD] = useState({ nome: '', empresa: '', email: '', whatsapp: '', cnpj: '', senha: '' });
  const [aceite, setAceite] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [versaoCaptcha, setVersaoCaptcha] = useState(0);
  const [enviado, setEnviado] = useState<{ email: string; emailEnviado: boolean } | null>(null);
  const criar = useMutation({
    mutationFn: () =>
      api<{ email: string; emailEnviado: boolean }>('/teste', {
        metodo: 'POST',
        corpo: {
          ...d,
          empresa: d.empresa.trim() || null,
          cnpj: d.cnpj.trim(),
          aceite,
          captcha,
          assinar,
        },
      }),
    onSuccess: setEnviado,
    onError: () => {
      // O captcha vale uma vez: depois de um erro, a caixinha começa de novo.
      setCaptcha(null);
      setVersaoCaptcha((v) => v + 1);
    },
  });
  const reenviar = useMutation({
    mutationFn: () => api('/teste/reenviar', { metodo: 'POST', corpo: { email: enviado?.email, assinar } }),
  });
  const campo = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD((x) => ({ ...x, [k]: e.target.value }));
  const site = config.data?.captcha ?? null;
  const pronto =
    d.nome.trim().length >= 2 &&
    d.email.includes('@') &&
    [11, 14].includes(d.cnpj.replace(/\D/g, '').length) &&
    d.whatsapp.replace(/\D/g, '').length >= 10 &&
    REGRAS_SENHA_CADASTRO.every((r) => r.ok(d.senha)) &&
    aceite &&
    (!site || !!captcha);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (pronto) criar.mutate();
  };

  if (enviado)
    return (
      <TelaAcesso chamada={chamada}>
        <div className="login__caixa">
          <div className="teste__icone-email">
            <Icon name="mail" size={28} />
          </div>
          <div className="login__cabeca">
            <h1>Confira o seu e-mail</h1>
            <p>
              Mandamos um link para <b>{enviado.email}</b>.{' '}
              {assinar ? (
                <>
                  Abra e clique em <b>Confirmar e assinar</b>: a conta é criada e a assinatura do plano{' '}
                  {NOME_PLANO[assinar]} abre na hora.
                </>
              ) : (
                <>
                  Abra e clique em <b>Confirmar e entrar</b>: a conta é criada e o teste de {DIAS_TESTE} dias
                  começa na hora.
                </>
              )}
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
    <TelaAcesso chamada={chamada} largo>
      <form className="login__caixa teste__form" onSubmit={enviar} noValidate>
        <div className="login__cabeca">
          <h1>{assinar ? 'Criar a conta e assinar' : 'Criar a conta de teste'}</h1>
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
              rotulo="Empresa (opcional)"
              autoComplete="organization"
              dica="Trabalha por conta própria? Deixe em branco: a conta fica no seu nome."
              value={d.empresa}
              onChange={campo('empresa')}
            />
          </div>
          <TextField
            rotulo="E-mail"
            type="email"
            autoComplete="email"
            value={d.email}
            onChange={campo('email')}
          />
          <TextField
            rotulo="CNPJ ou CPF"
            dica="Autônomo? Use o CPF."
            inputMode="numeric"
            value={d.cnpj}
            onChange={campo('cnpj')}
          />
          <div className="teste__inteira">
            <div className="pp-tf teste__senha">
              <label htmlFor="teste-senha" className="pp-tf__label">
                Crie uma senha
              </label>
              <div className="pp-tf__wrap">
                <input
                  id="teste-senha"
                  className="pp-input"
                  type={verSenha ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-describedby="teste-senha-regras"
                  value={d.senha}
                  onChange={campo('senha')}
                />
                <button
                  type="button"
                  className="teste__olho"
                  aria-label={verSenha ? 'Esconder a senha' : 'Mostrar a senha'}
                  aria-pressed={verSenha}
                  title={verSenha ? 'Esconder a senha' : 'Mostrar a senha'}
                  onClick={() => setVerSenha((v) => !v)}
                >
                  <Icon name={verSenha ? 'eye-off' : 'eye'} size={18} />
                </button>
              </div>
              <ul id="teste-senha-regras" className="teste__regras" aria-live="polite">
                {REGRAS_SENHA_CADASTRO.map((r) => {
                  const ok = r.ok(d.senha);
                  return (
                    <li key={r.id} data-ok={ok || undefined}>
                      <Icon name={ok ? 'check' : 'circle-dashed'} size={14} />
                      <span>
                        {r.texto}
                        <span className="pp-sr">{ok ? ' (feito)' : ' (falta)'}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
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
          {criar.isPending ? 'Criando…' : assinar ? 'Criar conta e assinar' : 'Criar conta e começar o teste'}
        </Button>
        <p className="login__nota">
          {assinar
            ? 'Mandamos um link para confirmar o e-mail; depois, é só escolher e pagar.'
            : 'Um teste por empresa (e-mail, WhatsApp e CNPJ ou CPF). Mandamos um link para confirmar o e-mail.'}
        </p>
      </form>
    </TelaAcesso>
  );
}

/** /teste/confirmar/:token: o link do e-mail. Cria a conta e entra. */
export function ConfirmarTeste() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const assinar = planoDoLink(params.get('assinar'));
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const confirmar = useMutation({
    mutationFn: () => api(`/teste/confirmar/${encodeURIComponent(token)}`, { metodo: 'POST' }),
    onSuccess: () => {
      cliente.clear();
      navegar(assinar ? `/plano/assinar?plano=${assinar}` : '/hoje?bemvindo=1', { replace: true });
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
    <TelaAcesso chamada={assinar ? <ChamadaAssinar plano={assinar} /> : <Chamada />}>
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
              <Button onClick={() => navegar(assinar ? `/teste?assinar=${assinar}` : '/teste')}>
                Fazer o cadastro de novo
              </Button>
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
