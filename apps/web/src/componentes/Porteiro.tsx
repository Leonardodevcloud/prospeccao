import type { DetalhesPorteiro, PorteiroEntrada } from '@prospeccao/shared/porteiro';
import { Button, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ErroApi } from '../api';
import { fmtHora, fmtNumero, fmtQuando } from '../formatar';
import { LinkAjuda } from './Ajuda';
import { ErroDaApi, Mensagem } from './Formulario';
import { useEhAdmin } from './Sessao';

/*
 * Porteiro do WhatsApp na tela: o aviso no compositor da conversa (o que foi segurado e o que dá
 * para fazer) e o painel "Proteção do número" em Agente › Atendimento.
 */

/** O erro é do porteiro? Devolve os detalhes. */
export function doPorteiro(erro: unknown): (DetalhesPorteiro & { codigo: string; mensagem: string }) | null {
  if (!(erro instanceof ErroApi) || !erro.codigo.startsWith('porteiro_')) return null;
  const d = erro.detalhes as unknown as DetalhesPorteiro | undefined;
  return { ...(d ?? { porteiro: true }), codigo: erro.codigo, mensagem: erro.message };
}

/** Aviso no compositor: o que o porteiro segurou e o que dá para fazer. */
export function AvisoPorteiro(props: {
  erro: NonNullable<ReturnType<typeof doPorteiro>>;
  ocupado: boolean;
  aoVariar: () => void;
  variando: boolean;
  aoMandarMesmoAssim: () => void;
  aoLiberar: () => void;
}) {
  const { erro } = props;
  const [falta, setFalta] = useState(erro.segundos ?? 0);
  useEffect(() => {
    if (erro.codigo !== 'porteiro_espera' || !erro.segundos) return;
    const fim = Date.now() + erro.segundos * 1000;
    setFalta(erro.segundos);
    const t = setInterval(() => {
      const s = Math.ceil((fim - Date.now()) / 1000);
      setFalta(Math.max(0, s));
      if (s <= 0) {
        clearInterval(t);
        props.aoLiberar();
      }
    }, 500);
    return () => clearInterval(t);
  }, [erro.codigo, erro.segundos, props.aoLiberar]);

  return (
    <div className="porteiro-aviso" role="alert">
      <Icon name="lock" size={16} />
      <div className="porteiro-aviso__texto">
        <b>Proteção do número</b>
        <span>
          {erro.codigo === 'porteiro_espera'
            ? `Espere ${falta} s para abordar outro contato novo por este número.`
            : erro.mensagem}
        </span>
        {erro.liberaEm && erro.codigo !== 'porteiro_espera' && (
          <span className="quieto">Libera {fmtHora(erro.liberaEm)}.</span>
        )}
        {erro.codigo === 'porteiro_repetida' && (
          <div className="acoes">
            <Button
              size="sm"
              variant="primary"
              icon="sparkles"
              disabled={props.variando}
              onClick={props.aoVariar}
            >
              {props.variando ? 'Reescrevendo…' : 'Variar com a IA'}
            </Button>
            {erro.podeForcar && (
              <Button size="sm" variant="ghost" disabled={props.ocupado} onClick={props.aoMandarMesmoAssim}>
                Mandar mesmo assim
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface PainelPorteiro {
  config: PorteiroEntrada;
  numeros: {
    id: number;
    nome: string;
    novosHoje: number;
    limiteHoje: number;
    friosAte: string | null;
    friosMotivo: string | null;
  }[];
  eventos: {
    id: number;
    tipo: string;
    detalhe: string | null;
    criadoEm: string;
    lead: string | null;
    usuario: string | null;
    numero: string | null;
  }[];
  hoje: Record<string, number>;
}

const ROTULO_EVENTO: Record<string, string> = {
  repetida: 'Texto repetido segurado',
  limite: 'Limite de contatos novos',
  espera: 'Espera entre contatos novos',
  pausado: 'Número em pausa',
  mesmo_assim: 'Mandou mesmo assim',
  variou: 'Variou com a IA',
  risco: 'Sinal de risco',
};

/** Painel "Proteção do número" (Agente › Atendimento): todos veem; o administrador configura. */
export function ProtecaoDoNumero() {
  const admin = useEhAdmin();
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['porteiro'], queryFn: () => api<PainelPorteiro>('/porteiro') });
  const [f, setF] = useState<PorteiroEntrada | null>(null);
  useEffect(() => {
    if (q.data && !f) setF(q.data.config);
  }, [q.data, f]);
  const salvar = useMutation({
    mutationFn: (c: PorteiroEntrada) => api<PainelPorteiro>('/porteiro', { metodo: 'PUT', corpo: c }),
    onSuccess: (d) => {
      cliente.setQueryData(['porteiro'], d);
      setF(d.config);
    },
  });
  const liberar = useMutation({
    mutationFn: (id: number) => api<PainelPorteiro>(`/porteiro/numeros/${id}/liberar`, { metodo: 'POST' }),
    onSuccess: (d) => cliente.setQueryData(['porteiro'], d),
  });
  const set = <K extends keyof PorteiroEntrada>(k: K, v: PorteiroEntrada[K]) =>
    setF((x) => (x ? { ...x, [k]: v } : x));
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (f) salvar.mutate(f);
  };
  const d = q.data;
  return (
    <Panel titulo="Proteção do número" acoes={<LinkAjuda artigo="whatsapp-numeros" />}>
      <div className="porteiro">
        <p className="quieto" style={{ margin: 0 }}>
          Segura o que mais derruba número no WhatsApp: o mesmo texto para muita gente, contatos novos demais
          e em sequência, e continuar abordando quando os contatos pedem para parar. Responder quem já
          conversa é sempre livre.
        </p>
        <ErroDaApi erro={q.error} />
        {!d || !f ? (
          <div className="esqueleto" style={{ height: 120 }} />
        ) : (
          <>
            {d.numeros.length > 0 && (
              <ul className="porteiro__numeros">
                {d.numeros.map((n) => (
                  <li key={n.id}>
                    <b>{n.nome}</b>
                    <span className="quieto">
                      {fmtNumero(n.novosHoje)} de {fmtNumero(n.limiteHoje)} contatos novos hoje
                    </span>
                    {n.friosAte && (
                      <span className="porteiro__pausa">
                        <Icon name="pause" size={12} /> Sem contatos novos até {fmtHora(n.friosAte)}:{' '}
                        {n.friosMotivo}
                        {admin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={liberar.isPending}
                            onClick={() => liberar.mutate(n.id)}
                          >
                            Liberar agora
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form className="form" onSubmit={enviar}>
              <label className="opcao">
                <input
                  type="checkbox"
                  checked={f.ativo}
                  disabled={!admin}
                  onChange={(e) => set('ativo', e.target.checked)}
                />
                <span>
                  <b>Ligar a proteção do número</b> nas conversas desta conta
                </span>
              </label>
              {f.ativo && (
                <>
                  <fieldset className="porteiro__grupo" disabled={!admin}>
                    <legend>Mesmo texto para muita gente</legend>
                    <div className="form__duas">
                      <div className="campo">
                        <label htmlFor="port-contatos">Segurar a partir de</label>
                        <select
                          id="port-contatos"
                          value={f.repetidasContatos}
                          onChange={(e) => set('repetidasContatos', Number(e.target.value))}
                        >
                          {[3, 5, 8, 10, 15, 20, 30].map((n) => (
                            <option key={n} value={n}>
                              {n} contatos
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="campo">
                        <label htmlFor="port-janela">Dentro de</label>
                        <select
                          id="port-janela"
                          value={f.repetidasJanelaMin}
                          onChange={(e) => set('repetidasJanelaMin', Number(e.target.value))}
                        >
                          {[
                            [30, '30 minutos'],
                            [60, '1 hora'],
                            [180, '3 horas'],
                            [720, '12 horas'],
                            [1440, '24 horas'],
                          ].map(([v, r]) => (
                            <option key={v} value={v}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <label className="opcao">
                      <input
                        type="radio"
                        name="port-acao"
                        checked={f.repetidasAcao === 'segurar'}
                        onChange={() => set('repetidasAcao', 'segurar')}
                      />
                      <span>
                        <b>Segurar</b>: não manda; sugere variar o texto com a IA (recomendado com API não
                        oficial)
                      </span>
                    </label>
                    <label className="opcao">
                      <input
                        type="radio"
                        name="port-acao"
                        checked={f.repetidasAcao === 'avisar'}
                        onChange={() => set('repetidasAcao', 'avisar')}
                      />
                      <span>
                        <b>Avisar</b>: pergunta e deixa mandar mesmo assim (fica registrado)
                      </span>
                    </label>
                    <span className="campo__dica">Mensagem curta (“bom dia”, “ok, obrigado”) não conta.</span>
                  </fieldset>
                  <fieldset className="porteiro__grupo" disabled={!admin}>
                    <legend>Contatos novos (primeira mensagem para quem nunca conversou)</legend>
                    <div className="form__duas">
                      <div className="campo">
                        <label htmlFor="port-dia">Por número, por dia</label>
                        <input
                          id="port-dia"
                          className="filtro"
                          type="number"
                          min={1}
                          max={500}
                          value={f.novosDia}
                          onChange={(e) => set('novosDia', Number(e.target.value))}
                        />
                        <span className="campo__dica">
                          Número em aquecimento usa o teto menor do aquecimento.
                        </span>
                      </div>
                      <div className="campo">
                        <label htmlFor="port-espera">Espera entre um e outro</label>
                        <select
                          id="port-espera"
                          value={f.novosIntervaloSeg}
                          onChange={(e) => set('novosIntervaloSeg', Number(e.target.value))}
                        >
                          {[0, 15, 30, 60, 120, 300].map((n) => (
                            <option key={n} value={n}>
                              {n === 0 ? 'Sem espera' : n < 60 ? `${n} segundos` : `${n / 60} min`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </fieldset>
                  <label className="opcao">
                    <input
                      type="checkbox"
                      checked={f.pausarRisco}
                      disabled={!admin}
                      onChange={(e) => set('pausarRisco', e.target.checked)}
                    />
                    <span>
                      <b>Pausar com sinal de risco</b>: 3 contatos pedindo para parar ou falando em denunciar,
                      ou quase ninguém respondendo os contatos novos, e o número fica 6 horas sem abordar
                      contatos novos (equipe e automáticos), com aviso para os administradores
                    </span>
                  </label>
                </>
              )}
              <ErroDaApi erro={salvar.error ?? liberar.error} />
              {salvar.isSuccess && <Mensagem tipo="ok">Salvo. Vale a partir da próxima mensagem.</Mensagem>}
              {admin && (
                <div className="acoes">
                  <Button type="submit" variant="primary" disabled={salvar.isPending}>
                    {salvar.isPending ? 'Salvando…' : 'Salvar'}
                  </Button>
                </div>
              )}
            </form>
            {d.eventos.length > 0 && (
              <details className="porteiro__eventos">
                <summary>
                  O que a proteção fez nos últimos 7 dias
                  {Object.keys(d.hoje).length > 0 &&
                    ` · hoje: ${Object.entries(d.hoje)
                      .map(([t, n]) => `${ROTULO_EVENTO[t] ?? t} ${n}`)
                      .join(', ')}`}
                </summary>
                <ul>
                  {d.eventos.map((e) => (
                    <li key={e.id}>
                      <b>{ROTULO_EVENTO[e.tipo] ?? e.tipo}</b>{' '}
                      <span className="quieto">
                        {fmtQuando(e.criadoEm)}
                        {e.usuario ? ` · ${e.usuario}` : ''}
                        {e.lead ? ` · ${e.lead}` : ''}
                        {e.numero ? ` · ${e.numero}` : ''}
                      </span>
                      {e.detalhe && <p>{e.detalhe}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
