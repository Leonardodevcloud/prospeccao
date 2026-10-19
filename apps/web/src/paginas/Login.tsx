import { Button, TextField } from '@prospeccao/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';

export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const voltar = params.get('voltar');

  const entrar = useMutation({
    mutationFn: () => api('/auth/login', { metodo: 'POST', corpo: { email, senha } }),
    // só caminhos internos, para o parâmetro não virar redirecionamento para fora
    onSuccess: () =>
      navegar(voltar?.startsWith('/') && !voltar.startsWith('//') ? voltar : '/', { replace: true }),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    entrar.mutate();
  };

  return (
    <main className="login">
      <form className="login__caixa" onSubmit={enviar} noValidate>
        <div>
          <h1>Entrar na Prospecção</h1>
          <p className="quieto" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Use o e-mail e a senha configurados no servidor.
          </p>
        </div>
        <TextField
          rotulo="E-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
        />
        <TextField
          rotulo="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)}
        />
        <ErroDaApi erro={entrar.error} />
        <Button variant="primary" type="submit" disabled={entrar.isPending || !email || !senha}>
          {entrar.isPending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </main>
  );
}
