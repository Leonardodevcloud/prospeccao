import { type TelefoniaConfigEntrada, textoDoMenu } from '@prospeccao/shared/ligacoes';
import { Badge, Button, EmptyState } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
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
import { ComprarMinutos } from './Assinar';

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
  const franquia =
    s.minutos.franquia == null ? null : s.minutos.franquia + (s.minutos.compraPacote ? s.minutos.pacote : 0);
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
          {s.minutos.compraPacote && s.minutos.pacote > 0 && (
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              Inclui {fmtNumero(s.minutos.pacote)} minutos de pacote (não vencem: o que sobrar fica para os
              próximos meses).
            </p>
          )}
          {s.minutos.compraPacote
            ? admin && pct >= 80 && <ComprarMinutos />
            : franquia != null &&
              usados > franquia && (
                <Mensagem tipo="aviso">
                  Passou {fmtNumero(usados - franquia)} minutos da franquia: o excedente entra na próxima
                  fatura.
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

          <h2 className="tel-card__sub">Ligações que chegam</h2>
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.receber}
              disabled={ro}
              onChange={(e) => set('receber', e.target.checked)}
            />
            <span>
              <b>Atender pelo CRM</b> as ligações para os números da empresa (aparece um aviso na tela de quem
              estiver no sistema)
            </span>
          </label>
          {f.receber && (
            <>
              <div className="form__duas">
                <div className="campo">
                  <label htmlFor="tel-dono">Tocar só para o dono do lead por</label>
                  <select
                    id="tel-dono"
                    disabled={ro}
                    value={f.toqueDono}
                    onChange={(e) => set('toqueDono', Number(e.target.value))}
                  >
                    <option value={0}>Tocar para o time já</option>
                    {[10, 15, 20, 30, 45, 60].map((n) => (
                      <option key={n} value={n}>
                        {n} segundos
                      </option>
                    ))}
                  </select>
                  <span className="campo__dica">
                    Depois, toca para todo o time; quem atender primeiro leva.
                  </span>
                </div>
                <div className="campo">
                  <label htmlFor="tel-entrada">Tocar no CRM por até</label>
                  <select
                    id="tel-entrada"
                    disabled={ro}
                    value={f.toqueEntrada}
                    onChange={(e) => set('toqueEntrada', Number(e.target.value))}
                  >
                    {[20, 30, 40, 60, 90, 120].map((n) => (
                      <option key={n} value={n}>
                        {n} segundos
                      </option>
                    ))}
                  </select>
                  <span className="campo__dica">
                    Ninguém atendeu: vai para o celular ou vira ligação perdida.
                  </span>
                </div>
              </div>
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={f.sigaMe}
                  disabled={ro}
                  onChange={(e) => set('sigaMe', e.target.checked)}
                />
                <span>
                  <b>Siga-me:</b> se ninguém atender no CRM, tocar no celular do dono do lead (o cadastrado em
                  Equipe). Atendida no celular, a ligação não é gravada.
                </span>
              </label>
              <span className="campo__dica">
                Ligação perdida avisa o dono do lead (ou o time, se o número não é de nenhum lead) e vira uma
                tarefa de retorno na agenda.
              </span>
              <MenuDeVoz s={s} f={f} ro={ro} set={set} />
            </>
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

/** Menu de voz: "para a loja Centro, digite 1"; toca só para quem é do grupo escolhido. */
function MenuDeVoz(p: {
  s: SituacaoTelefonia;
  f: TelefoniaConfigEntrada;
  ro: boolean;
  set: <K extends keyof TelefoniaConfigEntrada>(k: K, v: TelefoniaConfigEntrada[K]) => void;
}) {
  const { grupos, disponivel } = p.s.menu;
  return (
    <div className="tel-menu">
      <label className="opcao">
        <input
          type="checkbox"
          checked={p.f.menu}
          disabled={p.ro}
          onChange={(e) => p.set('menu', e.target.checked)}
        />
        <span>
          <b>Menu de voz:</b> quem liga escolhe a loja ou o setor pela tecla do telefone e só toca para quem é
          daquele grupo
        </span>
      </label>
      {p.f.menu && (
        <>
          {!disponivel && (
            <Mensagem tipo="aviso">
              A voz do menu ainda não está ligada na plataforma. Até lá, as ligações tocam para todo o time.
            </Mensagem>
          )}
          {grupos.length === 0 ? (
            <Mensagem tipo="aviso">
              Crie os grupos de atendimento em <Link to="/equipe">Equipe</Link> (por exemplo, uma loja por
              grupo, com os vendedores dela). Sem grupos, o menu não toca.
            </Mensagem>
          ) : (
            <>
              <div className="campo">
                <label htmlFor="tel-saudacao">Primeira frase</label>
                <input
                  id="tel-saudacao"
                  maxLength={200}
                  disabled={p.ro}
                  placeholder="Ex.: Olá! Você ligou para a Autopeças Silva."
                  value={p.f.menuSaudacao}
                  onChange={(e) => p.set('menuSaudacao', e.target.value)}
                />
              </div>
              <div className="tel-menu__previa">
                <small>Quem ligar vai ouvir</small>
                <p>“{textoDoMenu(p.f.menuSaudacao, grupos)}”</p>
                <ol>
                  {grupos.map((g, i) => (
                    <li key={g.id}>
                      <kbd>{i + 1}</kbd> {g.nome}{' '}
                      <span className="quieto">
                        · toca para {g.pessoas} {g.pessoas === 1 ? 'pessoa' : 'pessoas'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <span className="campo__dica">
                {grupos.length === 1
                  ? 'Com um grupo só, não pergunta nada: toca direto para ele.'
                  : 'Sem apertar nada (o menu repete uma vez) ou com tecla errada, toca para todo o time. O dono do lead toca primeiro se for do grupo escolhido.'}{' '}
                A ordem e quem é de cada grupo ficam em <Link to="/equipe">Equipe</Link>.
              </span>
            </>
          )}
        </>
      )}
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
