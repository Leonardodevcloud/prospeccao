import { normalizarTelefone } from '@prospeccao/shared/normalizar';
import { Button, Icon } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { useSoLeitura } from '../componentes/Sessao';
import { fmtCidade, fmtNome, formatarTelefone } from '../formatar';
import { useLigacoesDoLead } from './LigacoesDoLead';
import { telefone } from './ligacao';
import { MOTIVO_INDISPONIVEL, useModuloLigacoes, useSituacaoTelefonia, useTelefone } from './tipos';

/**
 * Discador (v176): o atalho com o telefone no canto da tela, ao lado do Argos. Abre um teclado para
 * digitar o número ou o nome do lead: com o lead, liga para os números dele (a ligação fica na ficha);
 * com um número solto, liga avulso (o "Como foi?" deixa ligar a um lead depois).
 */

interface LeadAchado {
  empresaId: number;
  nome: string;
  cidade: string | null;
  etapa: string;
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export function Discador(props: { acimaDoArgos: boolean }) {
  const modulo = useModuloLigacoes();
  const soLeitura = useSoLeitura();
  const [aberto, setAberto] = useState(false);
  const e = useTelefone();
  if (!modulo || soLeitura) return null;
  return (
    <>
      {!aberto && !e.aberto && (
        <button
          type="button"
          className={`atalho-lancador atalho-lancador--discador${props.acimaDoArgos ? ' atalho-lancador--acima' : ''}`}
          onClick={() => setAberto(true)}
          aria-label="Abrir o discador"
          title="Ligar"
        >
          <Icon name="phone" size={18} />
          <span className="atalho-lancador__dica" role="tooltip">
            Ligar
          </span>
        </button>
      )}
      {aberto && <PainelDiscador aoFechar={() => setAberto(false)} />}
    </>
  );
}

function PainelDiscador(props: { aoFechar: () => void }) {
  const [texto, setTexto] = useState('');
  const [lead, setLead] = useState<LeadAchado | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const situacao = useSituacaoTelefonia();
  const s = situacao.data;
  const ehNome = /[a-zà-ú]/i.test(texto);
  const numero = ehNome ? null : normalizarTelefone(texto);
  const busca = texto.trim();
  const achados = useQuery({
    queryKey: ['discador', 'leads', busca],
    queryFn: () => api<LeadAchado[]>(`/conversas/leads?busca=${encodeURIComponent(busca)}`),
    enabled: ehNome && busca.length >= 2 && !lead,
    staleTime: 30_000,
  });

  useEffect(() => {
    campo.current?.focus();
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && props.aoFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [props.aoFechar]);

  const tecla = (t: string) => {
    setLead(null);
    setTexto((v) => v + t);
    campo.current?.focus();
  };
  const ligarNumero = (pelo: 'telefone' | 'whatsapp') => {
    if (!numero) return;
    props.aoFechar();
    void telefone.ligar({ telefone: numero, empresaId: null, pelo });
  };
  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (numero) ligarNumero(s?.telefone === false && s.whatsapp ? 'whatsapp' : 'telefone');
  };
  const indisponivel = s && !s.disponivel && s.motivo ? MOTIVO_INDISPONIVEL[s.motivo] : null;

  return (
    <section className="discador" aria-label="Discador">
      <header className="discador__topo">
        <b>Ligar</b>
        <Button size="sm" variant="ghost" icon="x" aria-label="Fechar o discador" onClick={props.aoFechar} />
      </header>
      {indisponivel ? (
        <p className="discador__aviso">{indisponivel}</p>
      ) : (
        <form className="discador__corpo" onSubmit={enviar}>
          <div className="campo">
            <label htmlFor="discador-numero">Número com DDD ou nome do lead</label>
            <input
              ref={campo}
              id="discador-numero"
              className="filtro discador__numero"
              autoComplete="off"
              placeholder="(71) 99999-0000"
              value={texto}
              onChange={(ev) => {
                setLead(null);
                setTexto(ev.target.value);
              }}
            />
          </div>

          {lead ? (
            <NumerosDoLead lead={lead} aoVoltar={() => setLead(null)} aoLigar={props.aoFechar} />
          ) : ehNome ? (
            <ul className="discador__achados" aria-label="Leads encontrados">
              {busca.length < 2 && <li className="quieto">Digite pelo menos 2 letras.</li>}
              {achados.isFetching && !achados.data && <li className="quieto">Procurando…</li>}
              {achados.data?.length === 0 && <li className="quieto">Nenhum lead com esse nome.</li>}
              {achados.data?.map((l) => (
                <li key={l.empresaId}>
                  <button type="button" className="discador__lead" onClick={() => setLead(l)}>
                    <b>{fmtNome(l.nome)}</b>
                    {l.cidade && <span className="quieto">{fmtCidade(l.cidade)}</span>}
                  </button>
                </li>
              ))}
              <ErroDaApi erro={achados.error} />
            </ul>
          ) : (
            <>
              <div className="discador__teclado">
                {TECLAS.map((t) => (
                  <button key={t} type="button" className="discador__tecla" onClick={() => tecla(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="discador__acoes">
                <Button
                  type="button"
                  variant="ghost"
                  icon="delete"
                  aria-label="Apagar o último número"
                  disabled={!texto}
                  onClick={() => setTexto((v) => v.slice(0, -1))}
                />
                {s?.whatsapp && (
                  <Button
                    type="button"
                    variant="secondary"
                    icon="message-circle"
                    disabled={!numero}
                    onClick={() => ligarNumero('whatsapp')}
                  >
                    WhatsApp
                  </Button>
                )}
                {s?.telefone !== false && (
                  <Button type="submit" variant="primary" icon="phone" disabled={!numero}>
                    Ligar
                  </Button>
                )}
              </div>
              <p className="discador__dica">
                Para um lead, digite o nome: a ligação fica na ficha dele e a IA sugere o próximo passo.
              </p>
            </>
          )}
        </form>
      )}
    </section>
  );
}

function NumerosDoLead(props: { lead: LeadAchado; aoVoltar: () => void; aoLigar: () => void }) {
  const q = useLigacoesDoLead(props.lead.empresaId);
  const s = useSituacaoTelefonia().data;
  const ligar = (numero: string, pelo: 'telefone' | 'whatsapp') => {
    props.aoLigar();
    void telefone.ligar({ telefone: numero, empresaId: props.lead.empresaId, lead: props.lead.nome, pelo });
  };
  const numeros = (q.data?.telefones ?? []).filter((t) => !t.errado);
  return (
    <div className="pilha" style={{ gap: 8 }}>
      <div className="discador__lead-topo">
        <b>{fmtNome(props.lead.nome)}</b>
        <Button size="sm" variant="ghost" onClick={props.aoVoltar}>
          Trocar
        </Button>
      </div>
      {q.isPending && <div className="esqueleto" style={{ height: 80 }} />}
      <ErroDaApi erro={q.error} />
      {q.data?.naoLigar && <p className="discador__aviso">Este lead pediu para não receber ligações.</p>}
      {q.data && !q.data.naoLigar && !numeros.length && (
        <p className="quieto" style={{ margin: 0 }}>
          Sem telefone neste lead.
        </p>
      )}
      {q.data && !q.data.naoLigar && (
        <ul className="discador__numeros">
          {numeros.slice(0, 5).map((t) => (
            <li key={t.numero}>
              <span className="mono">{formatarTelefone(t.numero)}</span>
              <span className="discador__numeros-acoes">
                {s?.whatsapp && (t.whatsapp || t.tipo === 'celular') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="message-circle"
                    aria-label={`Ligar pelo WhatsApp para ${formatarTelefone(t.numero)}`}
                    title="Ligar pelo WhatsApp"
                    onClick={() => ligar(t.numero, 'whatsapp')}
                  />
                )}
                {s?.telefone !== false && (
                  <Button
                    size="sm"
                    variant={t.ordem === 1 ? 'primary' : 'secondary'}
                    icon="phone"
                    aria-label={`Ligar para ${formatarTelefone(t.numero)}`}
                    onClick={() => ligar(t.numero, 'telefone')}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
