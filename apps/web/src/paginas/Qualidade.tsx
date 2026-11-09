import { CRITERIO_ATENDIMENTO, inicioDaSemana } from '@prospeccao/shared/atendimento';
import { Button, EmptyState, Stat } from '@prospeccao/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, qs } from '../api';
import { ResumoDaPessoa, SeloNota, textoDoResumo } from '../atendimento/Atendimento';
import {
  fmtDiferenca,
  fmtNota,
  semanasRecentes,
  usePainelAtendimento,
  useResumoAtendimento,
} from '../atendimento/dados';
import { LinkAjuda } from '../componentes/Ajuda';
import { Drawer } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin } from '../componentes/Sessao';
import { fmtNumero } from '../formatar';

/**
 * Qualidade do atendimento: o gestor vê a equipe na semana (a nota, o que mais pesou e cada
 * pessoa, com o resumo que dá para mandar para ela); quem não é gestor vê o próprio resumo.
 */
export function Qualidade() {
  const admin = useEhAdmin();
  const [params, setParams] = useSearchParams();
  const atual = inicioDaSemana(new Date());
  const semana = params.get('semana') ?? atual;
  const opcoes = semanasRecentes(atual);
  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const seletorSemana = (
    <div className="campo">
      <label htmlFor="qa-semana">Período</label>
      <select
        id="qa-semana"
        className="filtro"
        value={semana}
        onChange={(e) => mudar({ semana: e.target.value === atual ? null : e.target.value })}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="qualidade">
      <div className="topo">
        <div>
          <h1>{admin ? 'Qualidade do atendimento' : 'Seu atendimento'}</h1>
          <p>
            {admin
              ? 'A IA avalia cada conversa e ligação com a mesma régua. Você vê onde a equipe vai bem e onde treinar.'
              : 'A nota que a IA dá aos seus atendimentos, com o que foi bem e o que treinar.'}
          </p>
        </div>
        <div className="acoes">
          <LinkAjuda artigo="atendimento">Como funciona</LinkAjuda>
        </div>
      </div>
      {admin ? (
        <PainelDaEquipe
          semana={semana}
          seletorSemana={seletorSemana}
          grupo={Number(params.get('grupo')) || null}
          aoGrupo={(g) => mudar({ grupo: g ? String(g) : null })}
        />
      ) : (
        <MeuResumo semana={semana} seletorSemana={seletorSemana} />
      )}
    </div>
  );
}

function MeuResumo(props: { semana: string; seletorSemana: React.ReactNode }) {
  const q = useResumoAtendimento('eu', props.semana);
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <div className="qualidade__filtros">{props.seletorSemana}</div>
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : q.error ? (
        <ErroDaApi erro={q.error} />
      ) : (
        <div className="qualidade__meu">
          <ResumoDaPessoa d={q.data} voce />
        </div>
      )}
    </div>
  );
}

function PainelDaEquipe(props: {
  semana: string;
  seletorSemana: React.ReactNode;
  grupo: number | null;
  aoGrupo: (g: number | null) => void;
}) {
  const q = usePainelAtendimento(props.semana, props.grupo);
  const [aberto, setAberto] = useState<{ id: number; nome: string } | null>(null);
  const d = q.data;
  const dif = d ? fmtDiferenca(d.equipe.nota, d.equipe.notaAnterior) : null;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="qualidade__filtros">
        {props.seletorSemana}
        {!!d?.grupos.length && (
          <div className="campo">
            <label htmlFor="qa-grupo">Loja ou grupo</label>
            <select
              id="qa-grupo"
              className="filtro"
              value={props.grupo ?? ''}
              onChange={(e) => props.aoGrupo(Number(e.target.value) || null)}
            >
              <option value="">Todos</option>
              {d.grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <ErroDaApi erro={q.error} />
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : !d ? null : !d.equipe.atendimentos ? (
        <EmptyState
          icone="badge-check"
          titulo="Nenhum atendimento avaliado nesta semana"
          texto="A IA dá a nota quando a conversa fica parada por 2 horas e tem pelo menos 3 mensagens da equipe, e quando a ligação é transcrita. As notas aparecem aqui ao longo da semana."
        />
      ) : (
        <>
          <section className="secao">
            <div className="kpis">
              <Stat
                rotulo="Nota média da equipe"
                valor={fmtNota(d.equipe.nota)}
                delta={
                  dif
                    ? dif.texto === 'igual'
                      ? 'igual à semana anterior'
                      : `${dif.texto} na semana`
                    : undefined
                }
                tendencia={dif?.sinal === 1 ? 'sobe' : dif?.sinal === -1 ? 'desce' : undefined}
              />
              <Stat
                rotulo="Atendimentos avaliados"
                valor={fmtNumero(d.equipe.atendimentos)}
                delta={`${fmtNumero(d.equipe.conversas)} conversas e ${fmtNumero(d.equipe.ligacoes)} ligações`}
              />
              <Stat
                rotulo="Primeira resposta, em média"
                valor={d.equipe.primeiraRespostaMin == null ? '–' : `${d.equipe.primeiraRespostaMin} min`}
                delta="seg. a sáb., das 7h às 19h"
              />
              <Stat
                rotulo="Saíram com próximo passo"
                valor={d.equipe.proximoPassoPct == null ? '–' : `${d.equipe.proximoPassoPct}%`}
              />
            </div>
          </section>

          {d.pesou.length > 0 && (
            <section className="pp-panel qualidade__pesou" aria-labelledby="qa-pesou">
              <h2 id="qa-pesou">O que mais pesou na semana</h2>
              <ol>
                {d.pesou.map((p) => (
                  <li key={p.criterio}>
                    <b>{p.texto}</b>{' '}
                    <span className="quieto">
                      · {fmtNumero(p.quantos)} {p.quantos === 1 ? 'atendimento' : 'atendimentos'} abaixo de 6
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="secao" aria-labelledby="qa-vendedores">
            <h2 id="qa-vendedores">Por pessoa</h2>
            <div className="pp-tablewrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    {d.grupos.length > 0 && <th>Loja</th>}
                    <th>Atendimentos</th>
                    <th>Nota</th>
                    <th>1ª resposta</th>
                    <th>Próximo passo</th>
                    <th>Ponto a treinar</th>
                    <th>
                      <span className="pp-sr">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.vendedores.map((v) => {
                    const dv = fmtDiferenca(v.nota, v.notaAnterior);
                    return (
                      <tr key={v.usuarioId}>
                        <td>
                          <b>{v.nome}</b>
                        </td>
                        {d.grupos.length > 0 && <td className="quieto">{v.grupo ?? '–'}</td>}
                        <td className="num">{fmtNumero(v.atendimentos)}</td>
                        <td>
                          <span className="qualidade__nota">
                            {v.nota != null && <SeloNota nota={v.nota} />}
                            {dv && (
                              <span className="quieto" data-sinal={dv.sinal}>
                                {dv.texto}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="num">
                          {v.primeiraRespostaMin == null ? '–' : `${v.primeiraRespostaMin} min`}
                        </td>
                        <td className="num">{v.proximoPassoPct == null ? '–' : `${v.proximoPassoPct}%`}</td>
                        <td className="quieto">
                          {v.treinar ? CRITERIO_ATENDIMENTO[v.treinar.criterio].treinar : 'Nada abaixo de 8'}
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAberto({ id: v.usuarioId, nome: v.nome })}
                          >
                            Ver resumo
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {aberto && (
        <ResumoNoPainel
          usuarioId={aberto.id}
          nome={aberto.nome}
          semana={props.semana}
          aoFechar={() => setAberto(null)}
        />
      )}
    </div>
  );
}

function ResumoNoPainel(props: { usuarioId: number; nome: string; semana: string; aoFechar: () => void }) {
  const q = useResumoAtendimento(props.usuarioId, props.semana);
  const [copiado, setCopiado] = useState(false);
  const primeiro = props.nome.split(' ')[0];
  const enviar = useMutation({
    mutationFn: () =>
      api(`/atendimento/vendedor/${props.usuarioId}/enviar${qs({ semana: props.semana })}`, {
        metodo: 'POST',
        corpo: {},
      }),
  });
  return (
    <Drawer titulo={`Resumo de ${props.nome}`} barra="Resumo da semana" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {q.isPending ? (
          <div className="esqueleto" style={{ height: 320 }} />
        ) : q.error ? (
          <ErroDaApi erro={q.error} />
        ) : (
          <>
            <ResumoDaPessoa d={q.data} />
            {q.data.resumo.atendimentos > 0 && (
              <footer className="qualidade__enviar">
                <span className="quieto">
                  {primeiro} vê as próprias notas no Meu dia. Só o gestor vê a equipe toda.
                </span>
                <div className="acoes">
                  <Button
                    variant="secondary"
                    icon="copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(textoDoResumo(q.data));
                      setCopiado(true);
                    }}
                  >
                    {copiado ? 'Copiado' : 'Copiar resumo'}
                  </Button>
                  <Button
                    variant="primary"
                    icon="send"
                    disabled={enviar.isPending || enviar.isSuccess}
                    onClick={() => enviar.mutate()}
                  >
                    {enviar.isSuccess ? 'Enviado' : `Enviar para ${primeiro}`}
                  </Button>
                </div>
                <ErroDaApi erro={enviar.error} />
                {enviar.isSuccess && (
                  <Mensagem tipo="ok">{primeiro} recebeu o aviso com o link do resumo.</Mensagem>
                )}
              </footer>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
