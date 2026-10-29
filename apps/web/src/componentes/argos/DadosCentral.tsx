import type { DadosAssistenteDTO, GraficoDTO } from '@prospeccao/shared/assistente';
import { Icon } from '@prospeccao/ui';
import { useEffect, useRef, useState } from 'react';
import css from './DadosCentral.module.css';
import { Grafico, sugerirGrafico } from './Grafico';
import { Prosa } from './Prosa';
import { rotularColuna, textoDoCodigo } from './rotulos';

const MOEDA = /(valor|fatur|cobrado|pago|amount|receita|custo|preco|ticket|saldo)/i;
const PERCENTUAL = /(pct|percent|sla|taxa|margem)/i;
const LINHAS_VISIVEIS = 8;
/** No chat do Argos a tabela começa curta; o resto abre em "Ampliar". */
const LINHAS_COMPACTO = 5;

const rotular = rotularColuna;

/** Formata a célula conforme o nome da coluna: reais, %, datas, sim/não. */
function formatar(coluna: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  const numero =
    typeof valor === 'number'
      ? valor
      : typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor)
        ? Number(valor)
        : null;
  if (numero !== null) {
    if (MOEDA.test(coluna)) return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (PERCENTUAL.test(coluna)) return `${numero.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    return numero.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) {
    return new Date(valor).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    });
  }
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return new Date(`${valor}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }
  // Códigos ("a_abordar", "reuniao") viram texto legível.
  if (typeof valor === 'string' && /status|situacao|etapa|papel|tipo|direcao/i.test(coluna))
    return textoDoCodigo(valor);
  return typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
}

const numerica = (coluna: string, linhas: Record<string, unknown>[]) =>
  linhas
    .slice(0, 5)
    .every(
      (l) =>
        l[coluna] === null ||
        typeof l[coluna] === 'number' ||
        (typeof l[coluna] === 'string' && /^-?\d+(\.\d+)?$/.test(l[coluna] as string)),
    );

function Tabela({
  dados,
  linhas,
  compacto,
}: {
  dados: DadosAssistenteDTO;
  linhas: Record<string, unknown>[];
  compacto?: boolean;
}) {
  return (
    <table className={`${css.tabela} ${compacto ? css.tabelaCompacta : ''}`}>
      <thead>
        <tr>
          {dados.colunas.map((c) => (
            <th key={c} scope="col" className={numerica(c, dados.linhas) ? css.num : undefined}>
              {rotular(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: linhas de uma consulta, sem id e sem reordenar
          <tr key={i}>
            {dados.colunas.map((c) => {
              const valor = formatar(c, l[c]);
              return (
                <td
                  key={c}
                  className={numerica(c, dados.linhas) ? css.num : undefined}
                  title={compacto && valor.length > 22 ? valor : undefined}
                >
                  {valor}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A tabela inteira numa janela grande, com cabeçalho fixo. */
function Ampliada({
  dados,
  grafico,
  fechar,
}: {
  dados: DadosAssistenteDTO;
  grafico: GraficoDTO | null;
  fechar: () => void;
}) {
  const caixa = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = caixa.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={caixa} className={css.janela} onClose={fechar} aria-label={dados.titulo}>
      <div className={css.janelaTopo}>
        <div>
          <strong>{dados.titulo}</strong>
          <span>
            {dados.linhas.length} {dados.linhas.length === 1 ? 'linha' : 'linhas'}
            {dados.cortado ? ' (há mais no banco)' : ''}
          </span>
        </div>
        <button type="button" className={css.fecharJanela} onClick={fechar} aria-label="Fechar">
          <Icon name="x" size={18} />
        </button>
      </div>
      {dados.destaques.length > 0 && (
        <dl className={css.destaques}>
          {dados.destaques.map((d) => (
            <div key={d.rotulo} className={css.destaque}>
              <dt>{d.rotulo}</dt>
              <dd>{d.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className={css.rolagemJanela}>
        {grafico && (
          <div className={css.graficoJanela}>
            <Grafico dados={dados} grafico={grafico} alto={320} />
          </div>
        )}
        <Tabela dados={dados} linhas={dados.linhas} />
      </div>
    </dialog>
  );
}

/** O que o Argos encontrou no banco da Central: números, tabela e como chegou neles. */
export function DadosCentral({ dados, compacto = false }: { dados: DadosAssistenteDTO; compacto?: boolean }) {
  const [tudo, setTudo] = useState(false);
  const [bastidor, setBastidor] = useState(false);
  const [ampliada, setAmpliada] = useState(false);
  const limite = compacto ? LINHAS_COMPACTO : LINHAS_VISIVEIS;
  // O gráfico que o Argos escolheu; sem ele, um que os dados sugerem (fica como opção, não abre sozinho).
  const grafico = dados.grafico ?? sugerirGrafico(dados);
  const [vista, setVista] = useState<'grafico' | 'tabela'>(dados.grafico?.principal ? 'grafico' : 'tabela');
  const mostrandoGrafico = vista === 'grafico' && grafico !== null;
  const linhas = tudo && !compacto ? dados.linhas : dados.linhas.slice(0, limite);

  return (
    <div className={css.dados}>
      {dados.destaques.length > 0 && (
        <dl className={css.destaques}>
          {dados.destaques.map((d) => (
            <div key={d.rotulo} className={css.destaque}>
              <dt>{d.rotulo}</dt>
              <dd>{d.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {dados.analise && (
        <div className={css.analise}>
          <Prosa texto={dados.analise} />
        </div>
      )}

      {dados.linhas.length > 0 ? (
        <div className={css.tabelaCaixa}>
          <div className={css.cabecaTabela}>
            <p className={css.tituloTabela}>{(mostrandoGrafico && grafico?.titulo) || dados.titulo}</p>
            <div className={css.acoesTabela}>
              {grafico && (
                <div className={css.abas} role="tablist" aria-label="Ver como">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mostrandoGrafico}
                    className={css.aba}
                    onClick={() => setVista('grafico')}
                  >
                    <Icon name="bar-chart-3" size={13} /> Gráfico
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!mostrandoGrafico}
                    className={css.aba}
                    onClick={() => setVista('tabela')}
                  >
                    <Icon name="table-2" size={13} /> Tabela
                  </button>
                </div>
              )}
              <button
                type="button"
                className={css.ampliar}
                onClick={() => setAmpliada(true)}
                title="Ver tudo numa janela grande"
              >
                <Icon name="maximize-2" size={13} /> Ampliar
              </button>
            </div>
          </div>
          {mostrandoGrafico ? (
            <Grafico dados={dados} grafico={grafico} alto={compacto ? 200 : 240} />
          ) : (
            <div className={`${css.rolagem} ${compacto ? css.rolagemCompacta : ''}`}>
              <Tabela dados={dados} linhas={linhas} compacto={compacto} />
            </div>
          )}
          {!mostrandoGrafico &&
            dados.linhas.length > limite &&
            (compacto ? (
              <button type="button" className={css.link} onClick={() => setAmpliada(true)}>
                Ver as {dados.linhas.length} linhas{dados.cortado ? ' (há mais no banco)' : ''}
              </button>
            ) : (
              <button type="button" className={css.link} onClick={() => setTudo((v) => !v)}>
                {tudo ? 'Mostrar menos' : `Mostrar as ${dados.linhas.length} linhas`}
                {dados.cortado && !tudo ? ' (há mais no banco)' : ''}
              </button>
            ))}
        </div>
      ) : (
        <p className={css.vazio}>Nenhum registro encontrado para isso.</p>
      )}

      <button
        type="button"
        className={css.link}
        onClick={() => setBastidor((v) => !v)}
        aria-expanded={bastidor}
      >
        <Icon name="database" size={13} /> Como cheguei nisso
        <span style={{ display: 'inline-flex', transform: bastidor ? 'rotate(180deg)' : undefined }}>
          <Icon name="chevron-down" size={13} />
        </span>
      </button>
      {bastidor && (
        <div className={css.bastidor}>
          <p>
            {dados.origem === 'pronta'
              ? 'Consulta pronta e testada'
              : 'Consulta escrita pela IA para esta pergunta'}{' '}
            · banco da Central, só leitura · {dados.ms} ms
            {dados.tabelas.length > 0 && ` · tabelas: ${dados.tabelas.join(', ')}`}
          </p>
          {dados.explicacao && <p>{dados.explicacao}</p>}
          <pre className={css.sql}>
            <code>{dados.sql.replace(/\n\s+/g, '\n  ')}</code>
          </pre>
        </div>
      )}
      {ampliada && (
        <Ampliada
          dados={dados}
          grafico={mostrandoGrafico ? grafico : null}
          fechar={() => setAmpliada(false)}
        />
      )}
    </div>
  );
}
