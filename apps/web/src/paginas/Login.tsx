import { Button, Icon, TextField } from '@prospeccao/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { TelaAcesso } from '../componentes/Marca';

export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const voltar = params.get('voltar');

  const [desafio, setDesafio] = useState<string | null>(params.get('desafio'));
  const [codigo, setCodigo] = useState('');

  const seguir = async () => {
    // só caminhos internos, para o parâmetro não virar redirecionamento para fora
    if (voltar?.startsWith('/') && !voltar.startsWith('//')) return navegar(voltar, { replace: true });
    // Quem administra a plataforma começa pelo painel dela; o gestor, pelo da organização.
    const eu = await api<{ master: boolean; papelOrganizacao: string | null }>('/auth/eu').catch(() => null);
    navegar(eu?.master ? '/plataforma' : eu?.papelOrganizacao ? '/organizacao' : '/', { replace: true });
  };
  const entrar = useMutation({
    mutationFn: () =>
      api<{ ok?: boolean; duasEtapas?: boolean; desafio?: string }>('/auth/login', {
        metodo: 'POST',
        corpo: { email, senha },
      }),
    onSuccess: (r) => {
      if (r?.duasEtapas && r.desafio) setDesafio(r.desafio);
      else void seguir();
    },
  });
  const confirmar = useMutation({
    mutationFn: () => api('/auth/login/duas-etapas', { metodo: 'POST', corpo: { desafio, codigo } }),
    onSuccess: () => void seguir(),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    entrar.mutate();
  };

  if (desafio)
    return (
      <TelaAcesso>
        <form
          className="login__caixa"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            confirmar.mutate();
          }}
          noValidate
        >
          <div className="login__cabeca">
            <h1>Verificação em duas etapas</h1>
            <p>Abra o app autenticador no celular e digite o código de 6 números que aparece nele.</p>
          </div>
          <TextField
            rotulo="Código"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={codigo}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCodigo(e.target.value)}
          />
          <ErroDaApi erro={confirmar.error} />
          <Button
            className="login__entrar"
            variant="primary"
            type="submit"
            disabled={confirmar.isPending || codigo.trim().length < 6}
          >
            {confirmar.isPending ? 'Conferindo…' : 'Entrar'}
          </Button>
          <p className="login__nota">
            Perdeu o celular? Use um dos códigos de recuperação (formato xxxx-xxxx) que você guardou ao ligar
            a verificação, ou peça ao gestor para zerar a sua.{' '}
            <button
              type="button"
              className="link-botao"
              onClick={() => {
                setDesafio(null);
                setCodigo('');
              }}
            >
              Voltar
            </button>
          </p>
        </form>
      </TelaAcesso>
    );

  return (
    <TelaAcesso>
      <form className="login__caixa" onSubmit={enviar} noValidate>
        <div className="login__cabeca">
          <h1>Bom te ver de novo</h1>
          <p>Entre com seu e-mail e senha para continuar de onde parou.</p>
        </div>
        <TextField
          rotulo="E-mail"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
        />
        <div className="login__senha">
          <TextField
            rotulo="Senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)}
          />
          <Link className="login__link" to={`/esqueci${email ? `?email=${encodeURIComponent(email)}` : ''}`}>
            Esqueci minha senha
          </Link>
        </div>
        <ErroDaApi erro={entrar.error} />
        <Button
          className="login__entrar"
          variant="primary"
          type="submit"
          disabled={entrar.isPending || !email || !senha}
        >
          {entrar.isPending ? 'Entrando…' : 'Entrar'}
          {!entrar.isPending && (
            <span className="login__seta">
              <Icon name="arrow-right" size={16} />
            </span>
          )}
        </Button>
        <p className="login__nota">
          Primeiro acesso? Abra o link do convite que você recebeu para criar a sua senha.
        </p>
      </form>
    </TelaAcesso>
  );
}
