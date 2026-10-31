import { fmtDuracaoLigacao, RESULTADOS_LIGACAO, ROTULO_RESULTADO_LIGACAO } from '@prospeccao/shared/ligacoes';
import { normalizarTelefone } from '@prospeccao/shared/normalizar';
import { Button, EmptyState } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, qs } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Modal } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useEquipe, useSessao, useSoLeitura, useSoPropriaBase } from '../componentes/Sessao';
import { fmtNumero } from '../formatar';
import { ItemLigacao } from '../telefone/LigacoesDoLead';
import { ListaDeLigacao } from '../telefone/ListaDeLigacao';
import { telefone } from '../telefone/ligacao';
import { RelatorioLigacoes } from '../telefone/RelatorioLigacoes';
import {
  type LigacaoResumida,
  MOTIVO_INDISPONIVEL,
  useModuloLigacoes,
  useSituacaoTelefonia,
  useTelefone,
} from '../telefone/tipos';
import { ComprarMinutos } from './Assinar';

/**
 * Vendas › Ligações: a lista de ligação (o CRM disca um lead depois do outro), tudo o que foi
 * ligado e recebido (com o resultado, a gravação e o resumo de cada uma), as perdidas, o relatório
 * e o atalho para ligar para um número avulso.
 */

interface Lista {
  ligacoes: LigacaoResumida[];
  totais: { feitas: number; atendidas: number; conversas: number; segundos: number; perdidas?: number };
}

const ABAS = [
  { id: 'lista', rotulo: 'Lista de ligação' },
  { id: 'historico', rotulo: 'Histórico' },
  { id: 'recebidas', rotulo: 'Recebidas' },
  { id: 'perdidas', rotulo: 'Perdidas' },
  { id: 'relatorio', rotulo: 'Relatório' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

const VER: Partial<Record<Aba, string>> = {
  historico: 'todas',
  recebidas: 'recebidas',
  perdidas: 'perdidas',
};

export function Ligacoes() {
  const [busca, setBusca] = useSearchParams();
  const sessao = useSessao();
  const equipe = useEquipe();
  const soLeitura = useSoLeitura();
  const soPropria = useSoPropriaBase();
  const admin = useEhAdmin();
  const modulo = useModuloLigacoes();
  const situacao = useSituacaoTelefonia(modulo);
  const e = useTelefone();
  const de = busca.get('de') ?? 'eu';
  const resultado = busca.get('resultado') ?? '';
  const dias = busca.get('dias') ?? '30';
  const lead = busca.get('lead');
  const abaUrl = busca.get('aba') as Aba | null;
  const aba: Aba = lead ? 'historico' : ABAS.some((a) => a.id === abaUrl) ? abaUrl! : 'lista';
  const ver = VER[aba];
  const [aberta, setAberta] = useState<number | null>(null);
  const [avulso, setAvulso] = useState(false);
  const mudar = (x: Record<string, string | null>) => {
    const p = new URLSearchParams(busca);
    for (const [k, v] of Object.entries(x)) v === null || v === '' ? p.delete(k) : p.set(k, v);
    setBusca(p, { replace: true });
  };
  const q = useQuery({
    queryKey: ['ligacoes', de, resultado, dias, lead, ver],
    queryFn: () => api<Lista>(`/ligacoes${qs({ usuario: de, resultado, dias, lead, ver })}`),
    refetchInterval: 20_000,
    enabled: !!ver,
  });
  const ativos = equipe.data?.usuarios.filter((u) => u.ativo) ?? [];
  const t = q.data?.totais;
  const s = situacao.data;

  return (
    <>
      <div className="topo">
        <div>
          <h1>Ligações</h1>
          <p>
            Ligue e receba ligações pelo CRM com o número da empresa: a ligação é gravada e a IA resume no
            histórico do lead. <LinkAjuda artigo="ligacoes" />
          </p>
        </div>
        {modulo && !soLeitura && (
          <div className="acoes">
            <Button
              variant="secondary"
              icon="phone"
              disabled={!s?.disponivel || telefone.ocupado || e.aberto}
              onClick={() => setAvulso(true)}
            >
              Ligar para um número
            </Button>
          </div>
        )}
      </div>

      {!modulo ? (
        <EmptyState
          icone="phone"
          titulo="Ligações é um módulo à parte"
          texto="Ligue pelo CRM com o número da empresa, com gravação, transcrição e resumo da IA de cada ligação. Fale com a gente para liberar."
        />
      ) : (
        <>
          {s && !s.disponivel && s.motivo && s.motivo !== 'fora_do_plano' && (
            <Mensagem tipo="aviso">{MOTIVO_INDISPONIVEL[s.motivo]}</Mensagem>
          )}
          {s?.motivo === 'sem_minutos' && admin && <ComprarMinutos />}
          <div className="pipelines lig-abas" role="tablist" aria-label="Seções de ligações">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={aba === a.id}
                className="pipelines__aba"
                onClick={() => mudar({ aba: a.id, lead: null, resultado: null })}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          {aba === 'lista' && <ListaDeLigacao />}
          {aba === 'relatorio' && (
            <>
              <div className="lig-filtros">
                <label className="pp-sr" htmlFor="lig-dias-rel">
                  Período
                </label>
                <select
                  id="lig-dias-rel"
                  className="filtro"
                  value={dias}
                  onChange={(ev) => mudar({ dias: ev.target.value })}
                >
                  <option value="7">7 dias</option>
                  <option value="30">30 dias</option>
                  <option value="90">90 dias</option>
                </select>
              </div>
              <RelatorioLigacoes dias={dias === '1' ? '7' : dias} />
            </>
          )}
          {ver && lead && (
            <Mensagem tipo="ok">
              Mostrando as ligações de um lead.{' '}
              <button type="button" className="link-botao" onClick={() => mudar({ lead: null })}>
                Ver todas
              </button>
            </Mensagem>
          )}
          {ver && (
            <>
              <div className="lig-filtros">
                {!soPropria && ativos.length > 1 && !lead && (
                  <>
                    <label className="pp-sr" htmlFor="lig-de">
                      De quem
                    </label>
                    <select
                      id="lig-de"
                      className="filtro"
                      value={de}
                      onChange={(ev) => mudar({ de: ev.target.value })}
                    >
                      <option value="eu">Minhas</option>
                      <option value="todos">Toda a equipe</option>
                      {ativos
                        .filter((u) => u.id !== sessao.data?.id)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.nome}
                          </option>
                        ))}
                    </select>
                  </>
                )}
                <label className="pp-sr" htmlFor="lig-resultado">
                  Resultado
                </label>
                {aba !== 'perdidas' && (
                  <select
                    id="lig-resultado"
                    className="filtro"
                    value={resultado}
                    onChange={(ev) => mudar({ resultado: ev.target.value })}
                  >
                    <option value="">Todos os resultados</option>
                    {RESULTADOS_LIGACAO.map((r) => (
                      <option key={r} value={r}>
                        {ROTULO_RESULTADO_LIGACAO[r]}
                      </option>
                    ))}
                    <option value="sem_resultado">Sem "Como foi?"</option>
                  </select>
                )}
                {!lead && (
                  <>
                    <label className="pp-sr" htmlFor="lig-dias">
                      Período
                    </label>
                    <select
                      id="lig-dias"
                      className="filtro"
                      value={dias}
                      onChange={(ev) => mudar({ dias: ev.target.value })}
                    >
                      <option value="1">Hoje</option>
                      <option value="7">7 dias</option>
                      <option value="30">30 dias</option>
                      <option value="90">90 dias</option>
                    </select>
                  </>
                )}
              </div>

              {t && aba === 'historico' && (
                <div className="lig-totais">
                  <div>
                    <small>Ligações</small>
                    <b>{fmtNumero(t.feitas)}</b>
                  </div>
                  <div>
                    <small>Atendidas</small>
                    <b>{fmtNumero(t.atendidas)}</b>
                    <span>{t.feitas ? `${Math.round((t.atendidas / t.feitas) * 100)}%` : '—'}</span>
                  </div>
                  <div>
                    <small>Conversas</small>
                    <b>{fmtNumero(t.conversas)}</b>
                  </div>
                  <div>
                    <small>Tempo falando</small>
                    <b>{fmtDuracaoLigacao(t.segundos)}</b>
                  </div>
                  {s?.minutos.franquia != null && (
                    <div>
                      <small>Minutos do mês (empresa)</small>
                      <b>{fmtNumero(s.minutos.usados)}</b>
                      <span>
                        de {fmtNumero(s.minutos.franquia + (s.minutos.compraPacote ? s.minutos.pacote : 0))}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {q.isPending ? (
                <div className="esqueleto" style={{ height: 240 }} />
              ) : !q.data ? (
                <ErroDaApi erro={q.error} />
              ) : !q.data.ligacoes.length ? (
                <EmptyState
                  icone="phone"
                  titulo={
                    aba === 'perdidas'
                      ? 'Nenhuma ligação perdida no período'
                      : aba === 'recebidas'
                        ? 'Nenhuma ligação recebida no período'
                        : 'Nenhuma ligação no período'
                  }
                  texto={
                    aba === 'perdidas'
                      ? 'Quando ninguém atende uma ligação que chega, ela aparece aqui e vira uma tarefa de retorno para o dono do lead.'
                      : aba === 'recebidas'
                        ? 'Quando alguém liga para o número da empresa, o CRM avisa o dono do lead e depois o time.'
                        : 'Monte uma lista de ligação ou abra um lead no funil e clique em Ligar.'
                  }
                />
              ) : (
                <ul className="lig-historico lig-historico--pagina">
                  {q.data.ligacoes.map((l) => (
                    <li key={l.id}>
                      <ItemLigacao
                        l={l}
                        comLead
                        aberta={aberta === l.id}
                        aoAlternar={() => setAberta(aberta === l.id ? null : l.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      {avulso && <LigarAvulso aoFechar={() => setAvulso(false)} />}
    </>
  );
}

/** Ligar para um número que não é de nenhum lead (fornecedor, indicação…). */
function LigarAvulso(props: { aoFechar: () => void }) {
  const [numero, setNumero] = useState('');
  const valido = normalizarTelefone(numero);
  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (!valido) return;
    props.aoFechar();
    void telefone.ligar({ telefone: valido, empresaId: null });
  };
  return (
    <Modal titulo="Ligar para um número" aoFechar={props.aoFechar}>
      <form className="form" onSubmit={enviar}>
        <div className="campo">
          <label htmlFor="lig-avulso">Número com DDD</label>
          <input
            id="lig-avulso"
            className="filtro mono"
            inputMode="tel"
            autoComplete="off"
            placeholder="(71) 99999-0000"
            value={numero}
            onChange={(ev) => setNumero(ev.target.value)}
          />
          <span className="campo__dica">
            Para falar com um lead, ligue pela ficha dele: a ligação fica no histórico e a IA sugere o próximo
            passo.
          </span>
        </div>
        <div className="acoes">
          <Button type="button" variant="ghost" onClick={props.aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" icon="phone" disabled={!valido}>
            Ligar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
