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

  const entrar = useMutation({
    mutationFn: () => api('/auth/login', { metodo: 'POST', corpo: { email, senha } }),
    // só caminhos internos, para o parâmetro não virar redirecionamento para fora
    onSuccess: async () => {
      if (voltar?.startsWith('/') && !voltar.startsWith('//')) return navegar(voltar, { replace: true });
      // Quem administra a plataforma começa pelo painel dela; o resto, pelos leads.
      const eu = await api<{ master: boolean }>('/auth/eu').catch(() => null);
      navegar(eu?.master ? '/plataforma' : '/', { replace: true });
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    entrar.mutate();
  };

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
