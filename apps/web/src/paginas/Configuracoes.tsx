import { Badge, Button, Panel, TextField } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api, type Base, type Importacao } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtHora, fmtHoraCompleta, fmtMes, fmtNumero } from '../formatar';
import { useAtividade } from './Atividade';

const STATUS_IMPORTACAO: Record<
  Importacao['status'],
  { rotulo: string; tom: 'brand' | 'warning' | 'danger' | 'neutral' }
> = {
  na_fila: { rotulo: 'Na fila', tom: 'neutral' },
  rodando: { rotulo: 'Rodando', tom: 'warning' },
  concluida: { rotulo: 'Concluída', tom: 'brand' },
  erro: { rotulo: 'Falhou', tom: 'danger' },
};

function Bases() {
  const cliente = useQueryClient();
  const bases = useQuery({ queryKey: ['bases'], queryFn: () => api<Base[]>('/bases') });
  const [f, setF] = useState({ nome: '', endereco: '', lat: '', lng: '' });
  const criar = useMutation({
    mutationFn: () =>
      api<Base>('/bases', {
        metodo: 'POST',
        corpo: {
          nome: f.nome,
          endereco: f.endereco || undefined,
          lat: f.lat ? Number(f.lat.replace(',', '.')) : undefined,
          lng: f.lng ? Number(f.lng.replace(',', '.')) : undefined,
        },
      }),
    onSuccess: () => {
      setF({ nome: '', endereco: '', lat: '', lng: '' });
      cliente.invalidateQueries({ queryKey: ['bases'] });
    },
  });
  const desativar = useMutation({
    mutationFn: (id: number) => api(`/bases/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['bases'] }),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate();
  };
  const ativas = bases.data?.filter((b) => b.ativa) ?? [];

  return (
    <Panel titulo="Bases de operação" contagem={ativas.length}>
      <div className="pilha">
        <p className="quieto" style={{ margin: 0, fontSize: 13, lineHeight: '18px' }}>
          Opcional. Só campanhas com raio usam as bases: a distância de cada lead é medida até a mais próxima.
          Campanhas nacionais ignoram a distância.
        </p>
        {ativas.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: '24px' }}>
            {ativas.map((b) => (
              <li key={b.id}>
                <b style={{ fontWeight: 500 }}>{b.nome}</b>{' '}
                <span className="quieto">
                  {b.endereco ?? ''}{' '}
                  <span className="mono">
                    ({b.lat.toFixed(4)}, {b.lng.toFixed(4)})
                  </span>
                </span>{' '}
                <Button variant="ghost" size="sm" onClick={() => desativar.mutate(b.id)}>
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="form"
          onSubmit={enviar}
          noValidate
          style={{ paddingTop: 12, borderTop: '1px solid var(--line)' }}
        >
          <TextField
            rotulo="Nome da base"
            value={f.nome}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, nome: e.target.value })}
            placeholder="Ex.: Base Centro"
          />
          <TextField
            rotulo="Endereço"
            value={f.endereco}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, endereco: e.target.value })}
            placeholder="Rua, número, bairro, cidade"
            dica="Localizamos pelo endereço. Se preferir, informe as coordenadas abaixo."
          />
          <div className="form__duas">
            <TextField
              rotulo="Latitude (opcional)"
              inputMode="decimal"
              value={f.lat}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, lat: e.target.value })}
              placeholder="-12.9714"
            />
            <TextField
              rotulo="Longitude (opcional)"
              inputMode="decimal"
              value={f.lng}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, lng: e.target.value })}
              placeholder="-38.5108"
            />
          </div>
          <ErroDaApi erro={criar.error ?? desativar.error} />
          <div>
            <Button type="submit" icon="plus" disabled={criar.isPending || !f.nome}>
              {criar.isPending ? 'Adicionando…' : 'Adicionar base'}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function BaseCnpj() {
  const cliente = useQueryClient();
  const [mes, setMes] = useState('');
  const [pedido, setPedido] = useState<string | null>(null);
  const importacoes = useQuery({
    queryKey: ['importacoes'],
    queryFn: () => api<Importacao[]>('/importacoes'),
    refetchInterval: (q) =>
      q.state.data?.some((i) => i.status === 'rodando' || i.status === 'na_fila') ? 5_000 : false,
  });
  const importar = useMutation({
    mutationFn: () =>
      api<{ mensagem: string }>('/importacoes/cnpj', { metodo: 'POST', corpo: mes ? { mes } : {} }),
    onSuccess: (r) => {
      setPedido(r.mensagem);
      cliente.invalidateQueries({ queryKey: ['importacoes'] });
    },
  });
  const ultima = importacoes.data?.[0];
  const agendada = useAtividade(15_000).data?.importacaoAgendada;

  return (
    <Panel
      titulo="Base de CNPJ da Receita"
      acoes={
        <Button size="sm" icon="loader" disabled={importar.isPending} onClick={() => importar.mutate()}>
          Importar agora
        </Button>
      }
    >
      <div className="pilha">
        <p className="quieto" style={{ margin: 0, fontSize: 13, lineHeight: '18px' }}>
          Cópia dos dados abertos só com as UFs das campanhas e os CNAEs dos nichos. Atualiza sozinha todo
          mês; use "Importar agora" depois de criar um nicho ou uma campanha numa UF nova.
        </p>
        <div style={{ maxWidth: 260 }}>
          <TextField
            rotulo="Mês da publicação (opcional)"
            placeholder="Ex.: 2026-09"
            value={mes}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMes(e.target.value)}
            dica="Vazio usa a publicação mais recente."
          />
        </div>
        {pedido && <Mensagem tipo="ok">{pedido}</Mensagem>}
        <ErroDaApi erro={importar.error ?? importacoes.error} />
        {ultima?.status === 'erro' && (
          <Mensagem tipo="erro">A última importação falhou: {ultima.erro}</Mensagem>
        )}
        {agendada?.estado === 'nova_tentativa' && (
          <Mensagem tipo="aviso">
            Nova tentativa automática {fmtHora(agendada.quando)} (tentativa {agendada.falhas + 1} de{' '}
            {agendada.limiteTentativas + 1}). Não precisa clicar de novo.
          </Mensagem>
        )}
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          Acompanhe o andamento ao vivo em <Link to="/atividade">Atividade</Link>.
        </p>
        {importacoes.data?.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Status</th>
                  <th>UFs</th>
                  <th>Estabelecimentos</th>
                  <th>Sócios</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {importacoes.data.map((i) => (
                  <tr key={i.id} style={{ cursor: 'default' }}>
                    <td>{fmtMes(i.mes)}</td>
                    <td>
                      <Badge tone={STATUS_IMPORTACAO[i.status].tom}>
                        {STATUS_IMPORTACAO[i.status].rotulo}
                      </Badge>
                      {i.etapa && (
                        <span className="quieto" style={{ fontSize: 12 }}>
                          {' '}
                          {i.etapa}
                        </span>
                      )}
                    </td>
                    <td className="mono">{i.ufs.join(', ') || '—'}</td>
                    <td className="mono">{fmtNumero(i.estabelecimentos)}</td>
                    <td className="mono">{fmtNumero(i.socios)}</td>
                    <td className="quieto" style={{ whiteSpace: 'nowrap' }}>
                      <time
                        dateTime={i.concluidoEm ?? i.criadoEm}
                        title={fmtHoraCompleta(i.concluidoEm ?? i.criadoEm)}
                      >
                        {fmtHora(i.concluidoEm ?? i.criadoEm)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13 }}>Nenhuma importação ainda.</p>
        )}
      </div>
    </Panel>
  );
}

export function Configuracoes() {
  return (
    <>
      <div className="topo">
        <div>
          <h1>Configurações</h1>
          <p>Bases de operação e a base de CNPJ usada na descoberta.</p>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <Bases />
        <BaseCnpj />
      </div>
    </>
  );
}
