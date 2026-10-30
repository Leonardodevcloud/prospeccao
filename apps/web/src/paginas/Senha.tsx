import { Button, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { TelaAcesso } from '../componentes/Marca';

/** "Esqueci minha senha": o link para criar uma nova chega por e-mail. */
export function EsqueciSenha() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const pedir = useMutation({
    mutationFn: () => api('/auth/esqueci', { metodo: 'POST', corpo: { email } }),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    pedir.mutate();
  };
  return (
    <TelaAcesso>
      <form className="login__caixa" onSubmit={enviar} noValidate>
        <div>
          <h1>Esqueci minha senha</h1>
          <p className="quieto" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Informe o e-mail que você usa para entrar. Se ele estiver cadastrado, chega um link para criar uma
            senha nova (vale 1 hora). Sua senha atual continua valendo até lá.
          </p>
        </div>
        {pedir.isSuccess ? (
          <Mensagem tipo="ok">
            Pronto. Se {email} tiver acesso, o e-mail chega em instantes. Confira também a pasta de spam.
          </Mensagem>
        ) : (
          <>
            <TextField
              rotulo="E-mail"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            />
            <ErroDaApi erro={pedir.error} />
            <Button variant="primary" type="submit" disabled={pedir.isPending || !email.includes('@')}>
              {pedir.isPending ? 'Enviando…' : 'Mandar o link'}
            </Button>
          </>
        )}
        <Link className="login__link" to="/login">
          Voltar para o login
        </Link>
      </form>
    </TelaAcesso>
  );
}

/** Link do e-mail: cria a senha nova e já entra. */
export function RedefinirSenha() {
  const { token = '' } = useParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const link = useQuery({
    queryKey: ['redefinir', token],
    queryFn: () =>
      api<{ nome: string; email: string; conta: string }>(`/auth/redefinir/${encodeURIComponent(token)}`),
    retry: false,
  });
  const criar = useMutation({
    mutationFn: () =>
      api(`/auth/redefinir/${encodeURIComponent(token)}`, { metodo: 'POST', corpo: { senha } }),
    onSuccess: (r) => {
      cliente.clear();
      // Verificação em duas etapas ligada: falta o código do app (tela de login).
      const desafio = (r as { desafio?: string } | null)?.desafio;
      if (desafio) navegar(`/login?desafio=${encodeURIComponent(desafio)}`, { replace: true });
      else navegar('/hoje', { replace: true });
    },
  });
  const diferentes = !!repetir && senha !== repetir;
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!diferentes) criar.mutate();
  };

  return (
    <TelaAcesso>
      <form className="login__caixa" onSubmit={enviar} noValidate>
        {link.isPending ? (
          <div className="esqueleto" />
        ) : link.error ? (
          <>
            <h1>Link inválido</h1>
            <Mensagem tipo="aviso">
              Este link expirou ou já foi usado. Peça outro: ele vale 1 hora e funciona uma vez só.
            </Mensagem>
            <Button onClick={() => navegar('/esqueci')}>Pedir outro link</Button>
          </>
        ) : (
          <>
            <div>
              <h1>Senha nova</h1>
              <p className="quieto" style={{ margin: '4px 0 0', fontSize: 13 }}>
                {link.data.nome.split(' ')[0]}, crie a senha nova para {link.data.email} no sistema da{' '}
                {link.data.conta}.
              </p>
            </div>
            <TextField
              rotulo="Senha nova"
              type="password"
              autoComplete="new-password"
              dica="Pelo menos 8 caracteres, com letras e números."
              value={senha}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)}
            />
            <TextField
              rotulo="Repita a senha"
              type="password"
              autoComplete="new-password"
              erro={diferentes ? 'As senhas não são iguais.' : undefined}
              value={repetir}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepetir(e.target.value)}
            />
            <ErroDaApi erro={criar.error} />
            <Button variant="primary" type="submit" disabled={criar.isPending || !senha || senha !== repetir}>
              {criar.isPending ? 'Salvando…' : 'Salvar e entrar'}
            </Button>
          </>
        )}
      </form>
    </TelaAcesso>
  );
}
