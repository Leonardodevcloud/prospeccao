import type { TelefoniaConfigEntrada } from '@prospeccao/shared/ligacoes';
import { Badge, Button, EmptyState } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin } from '../componentes/Sessao';
import { fmtNumero, formatarTelefone } from '../formatar';
import {
  MOTIVO_INDISPONIVEL,
  type SituacaoTelefonia,
  useModuloLigacoes,
  useSituacaoTelefonia,
} from '../telefone/tipos';

/**
 * Gestão › Telefonia: os números da empresa (cadastrados pelo Prospect Team), os minutos do mês e
 * como as ligações funcionam (gravação, aviso, transcrição, quanto tempo deixa tocar).
 */
export function Telefonia() {
  const modulo = useModuloLigacoes();
  const q = useSituacaoTelefonia(modulo);
  if (!modulo)
    return (
      <>
        <Topo />
        <EmptyState
          icone="phone"
          titulo="Ligações é um módulo à parte"
          texto="Com ele, o time liga pelo CRM com o número da empresa e cada ligação fica gravada, transcrita e resumida pela IA. Fale com a gente para liberar."
        />
      </>
    );
  return (
    <>
      <Topo />
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : q.data ? (
        <Conteudo s={q.data} />
      ) : (
        <ErroDaApi erro={q.error} />
      )}
    </>
  );
}

function Topo() {
  return (
    <div className="topo">
      <div>
        <h1>Telefonia</h1>
        <p>
          Números da empresa, minutos do mês e como as ligações são gravadas. <LinkAjuda artigo="ligacoes" />
        </p>
      </div>
    </div>
  );
}

function Conteudo(props: { s: SituacaoTelefonia }) {
  const { s } = props;
  const admin = useEhAdmin();
  const cliente = useQueryClient();
  const [f, setF] = useState<TelefoniaConfigEntrada>(s.config);
  useEffect(() => setF(s.config), [s.config]);
  const salvar = useMutation({
    mutationFn: () => api<SituacaoTelefonia>('/ligacoes/config', { metodo: 'PUT', corpo: f }),
    onSuccess: (r) => cliente.setQueryData(['telefonia'], r),
  });
  const usados = s.minutos.usados;
  const franquia = s.minutos.franquia;
  const pct = franquia ? Math.min(100, Math.round((usados / franquia) * 100)) : 0;
  const ro = !admin;
  const set = <K extends keyof TelefoniaConfigEntrada>(k: K, v: TelefoniaConfigEntrada[K]) =>
    setF({ ...f, [k]: v });
  return (
    <div className="pilha" style={{ gap: 16 }}>
      {s.motivo && s.motivo !== 'fora_do_plano' && (
        <Mensagem tipo="aviso">{MOTIVO_INDISPONIVEL[s.motivo]}</Mensagem>
      )}
      <div className="tel-grade">
        <section className="tel-card">
          <h2>Números da empresa</h2>
          <p className="quieto">
            Aparecem para o lead nas ligações. Para um número novo (outro DDD) ou para trazer o número que a
            empresa já usa, fale com o suporte do Prospect Team.
          </p>
          {s.numeros.length ? (
            <ul className="tel-numeros">
              {s.numeros.map((n) => (
                <li key={n.id}>
                  <span className="mono">{formatarTelefone(n.numero)}</span>
                  <span className="quieto">
                    {[n.rotulo, n.principal ? 'principal' : null].filter(Boolean).join(' · ')}
                  </span>
                  <Badge tone="brand">ativo</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quieto">Nenhum número ainda.</p>
          )}
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.mesmoDdd}
              disabled={ro}
              onChange={(e) => set('mesmoDdd', e.target.checked)}
            />
            Ligar com o número do mesmo DDD do lead, quando houver
          </label>
        </section>

        <section className="tel-card">
          <h2>Minutos do mês</h2>
          <p className="quieto">
            Somam todas as unidades. Cada ligação atendida conta arredondada para cima; as que não atendem não
            contam.
          </p>
          <div className="tel-franquia">
            <b>{fmtNumero(usados)}</b>
            <span className="quieto">
              {franquia != null ? `de ${fmtNumero(franquia)} minutos` : 'minutos (sem limite)'}
            </span>
          </div>
          {franquia != null && (
            <div
              className="tel-barra"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${pct}%` }} data-alerta={pct >= 80 || undefined} />
            </div>
          )}
          {franquia != null && usados > franquia && (
            <Mensagem tipo="aviso">
              Passou {fmtNumero(usados - franquia)} minutos da franquia: o excedente entra na próxima fatura.
            </Mensagem>
          )}
        </section>

        <form
          className="tel-card tel-card--largo"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <h2>Gravação e resumo</h2>
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.gravar}
              disabled={ro}
              onChange={(e) => set('gravar', e.target.checked)}
            />
            <span>
              <b>Gravar as ligações</b> (no navegador de quem liga; fica na ficha do lead)
            </span>
          </label>
          {f.gravar && (
            <>
              <div className="campo">
                <label htmlFor="tel-aviso">Aviso no começo da ligação</label>
                <input
                  id="tel-aviso"
                  className="filtro"
                  maxLength={300}
                  disabled={ro}
                  value={f.avisoGravacao}
                  onChange={(e) => set('avisoGravacao', e.target.value)}
                />
                <span className="campo__dica">
                  A lei (LGPD) pede que a pessoa saiba que a ligação é gravada.{' '}
                  {s.avisoFalado || f.avisoFalado
                    ? 'Com o aviso falado, o sistema toca esta frase assim que atendem.'
                    : 'O comercial lê a frase na tela.'}
                </span>
              </div>
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={f.avisoFalado}
                  disabled={ro}
                  onChange={(e) => set('avisoFalado', e.target.checked)}
                />
                Tocar o aviso com voz (senão, o comercial lê)
              </label>
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={f.transcrever}
                  disabled={ro}
                  onChange={(e) => set('transcrever', e.target.checked)}
                />
                <span>
                  <b>Transcrever e resumir</b> depois de desligar (o que foi dito, o clima da conversa e o
                  próximo passo)
                </span>
              </label>
            </>
          )}
          <div className="form__duas">
            <div className="campo">
              <label htmlFor="tel-toque">Deixar tocar por</label>
              <select
                id="tel-toque"
                disabled={ro}
                value={f.toqueSegundos}
                onChange={(e) => set('toqueSegundos', Number(e.target.value))}
              >
                {[15, 20, 25, 30, 40, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} segundos
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="tel-guardar">Guardar as gravações por</label>
              <select
                id="tel-guardar"
                disabled={ro}
                value={f.guardarMeses}
                onChange={(e) => set('guardarMeses', Number(e.target.value))}
              >
                {[3, 6, 12, 24, 36].map((n) => (
                  <option key={n} value={n}>
                    {n} meses
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!s.gravacao && f.gravar && (
            <span className="campo__dica">
              A gravação ainda não está ligada na plataforma; as ligações saem sem gravar.
            </span>
          )}
          <ErroDaApi erro={salvar.error} />
          {salvar.isSuccess && <Mensagem tipo="ok">Salvo. Vale a partir da próxima ligação.</Mensagem>}
          {admin && (
            <div className="acoes">
              <Button type="submit" variant="primary" disabled={salvar.isPending}>
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

/** Painel master: os números da empresa desta conta (comprados no provedor e ligados ao LiveKit). */
export function NumerosDaConta(props: { contaId: number }) {
  const cliente = useQueryClient();
  const chave = ['master', 'telefonia', props.contaId];
  const [numero, setNumero] = useState('');
  const [rotulo, setRotulo] = useState('');
  const q = useQueryMaster(props.contaId);
  const mexer = useMutation({
    mutationFn: (p: { metodo: string; caminho: string; corpo?: unknown }) =>
      api<{ numeros: SituacaoTelefonia['numeros'] }>(
        `/master/contas/${props.contaId}/telefonia${p.caminho}`,
        {
          metodo: p.metodo,
          corpo: p.corpo,
        },
      ),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: chave });
      setNumero('');
      setRotulo('');
    },
  });
  if (q.isPending) return <div className="esqueleto" />;
  if (!q.data) return <ErroDaApi erro={q.error} />;
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <Mensagem tipo={q.data.telefonia?.startsWith('ok') ? 'ok' : 'aviso'}>
        {q.data.telefonia
          ? `Telefonia da plataforma: ${q.data.telefonia}`
          : 'A telefonia da plataforma está desligada (falta TELEFONIA_TRONCO_SAIDA e as chaves do LiveKit na api).'}
      </Mensagem>
      <p className="quieto" style={{ margin: 0 }}>
        Compre o número no provedor (Nvoip, Twilio…), aponte para o tronco do LiveKit e cadastre aqui. O
        módulo Ligações precisa estar no plano da conta.
      </p>
      {q.data.numeros.length ? (
        <ul className="tel-numeros">
          {q.data.numeros.map((n) => (
            <li key={n.id}>
              <span className="mono">{formatarTelefone(n.numero)}</span>
              <span className="quieto">{n.rotulo ?? ''}</span>
              {n.principal ? (
                <Badge tone="brand">principal</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => mexer.mutate({ metodo: 'PATCH', caminho: `/numeros/${n.id}` })}
                >
                  Tornar principal
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon="trash-2"
                aria-label={`Tirar o número ${formatarTelefone(n.numero)}`}
                onClick={() => mexer.mutate({ metodo: 'DELETE', caminho: `/numeros/${n.id}` })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="quieto">Nenhum número nesta conta.</p>
      )}
      <form
        className="form__duas"
        onSubmit={(e) => {
          e.preventDefault();
          mexer.mutate({ metodo: 'POST', caminho: '/numeros', corpo: { numero, rotulo: rotulo || null } });
        }}
      >
        <div className="campo">
          <label htmlFor="mt-numero">Número com DDD</label>
          <input
            id="mt-numero"
            className="filtro mono"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="mt-rotulo">Nome (opcional)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="mt-rotulo"
              className="filtro"
              placeholder="Ex.: Salvador"
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
            />
            <Button type="submit" variant="primary" disabled={!numero.trim() || mexer.isPending}>
              Cadastrar
            </Button>
          </div>
        </div>
      </form>
      <ErroDaApi erro={mexer.error} />
    </div>
  );
}

function useQueryMaster(contaId: number) {
  return useQuery({
    queryKey: ['master', 'telefonia', contaId],
    queryFn: () =>
      api<{ numeros: SituacaoTelefonia['numeros']; telefonia: string | null }>(
        `/master/contas/${contaId}/telefonia`,
      ),
  });
}
