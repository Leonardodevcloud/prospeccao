import { Button, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { fmtNumero } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

/*
 * A conta da plataforma (onde ficam os administradores): não é cliente nem CRM de uso. Se sobrou algo
 * de quando ela era usada como CRM, dá para zerar aqui.
 */

interface ContaPrincipal {
  id: number;
  nome: string;
  dados: {
    campanhas: number;
    noFunil: number;
    mensagens: number;
    tarefas: number;
    reunioes: number;
    avisos: number;
  };
  temDados: boolean;
}

const ROTULOS: [keyof ContaPrincipal['dados'], string, string][] = [
  ['campanhas', 'campanha', 'campanhas'],
  ['noFunil', 'lead no funil', 'leads no funil'],
  ['mensagens', 'mensagem', 'mensagens'],
  ['tarefas', 'tarefa', 'tarefas'],
  ['reunioes', 'reunião', 'reuniões'],
  ['avisos', 'aviso', 'avisos'],
];

export function ContaDaPlataforma() {
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const q = useQuery({
    queryKey: ['master', 'conta-principal'],
    queryFn: () => api<ContaPrincipal>('/master/plataforma/conta-principal'),
  });
  const zerar = useMutation({
    mutationFn: () =>
      api<ContaPrincipal>('/master/plataforma/conta-principal/zerar', {
        metodo: 'POST',
        corpo: { confirmacao: texto },
      }),
    onSuccess: () => {
      setAberto(false);
      setTexto('');
      // O nome da conta e os avisos mudaram: recarrega tudo.
      cliente.invalidateQueries();
    },
  });
  const d = q.data;
  if (!d) return null;
  const itens = ROTULOS.filter(([k]) => d.dados[k] > 0).map(
    ([k, um, varios]) => `${fmtNumero(d.dados[k])} ${d.dados[k] === 1 ? um : varios}`,
  );

  return (
    <Panel titulo="Conta da plataforma">
      <div className="pilha" style={{ gap: 12 }}>
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          <b>{d.nome}</b> é a conta onde ficam os administradores e as chaves da plataforma. Ela não é cliente
          e não aparece em Clientes nem no Financeiro: você trabalha no painel e apresenta pelo CRM de
          demonstração.
        </p>
        {zerar.isSuccess && <Mensagem tipo="ok">Pronto: a conta da plataforma está zerada.</Mensagem>}
        {d.temDados ? (
          aberto ? (
            <div className="confirmar confirmar--perigo">
              <b>Zerar os dados antigos de {d.nome}?</b>
              <span>
                Saem {itens.join(', ')} e o resto do uso como CRM (conversas, contatos, roteiros, memória do
                Argos). Ficam os administradores, as chaves, o domínio de e-mail, os números de WhatsApp, as
                configurações e o histórico de custo. A conta passa a se chamar Prospect Team.{' '}
                <b>Não tem como desfazer.</b>
              </span>
              <div className="campo">
                <label htmlFor="zerar-principal">
                  Para confirmar, digite <b>ZERAR</b>
                </label>
                <input
                  id="zerar-principal"
                  className="filtro"
                  autoComplete="off"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
              </div>
              <ErroDaApi erro={zerar.error} />
              <div className="acoes">
                <Button
                  variant="danger"
                  disabled={texto.trim().toUpperCase() !== 'ZERAR' || zerar.isPending}
                  onClick={() => zerar.mutate()}
                >
                  {zerar.isPending ? 'Zerando…' : 'Zerar os dados antigos'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAberto(false);
                    setTexto('');
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="gerenciar-linha">
              <span>
                Sobrou do uso antigo como CRM: <b>{itens.join(', ')}</b>.
              </span>
              <Button variant="secondary" icon="trash-2" onClick={() => setAberto(true)}>
                Zerar dados antigos
              </Button>
            </div>
          )
        ) : (
          !zerar.isSuccess && (
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              Nada sobrando do uso antigo como CRM.
            </p>
          )
        )}
      </div>
    </Panel>
  );
}
