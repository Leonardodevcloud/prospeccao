import {
  CAMPOS_PLANILHA,
  type CampoPlanilha,
  detectarColunas,
  lerCsv,
  linhaParaItem,
  type MapaColunas,
  temCabecalho,
} from '@prospeccao/shared/planilha';
import { Button } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useMemo, useState } from 'react';
import { api, type Campanha } from '../api';
import { fmtCidade, fmtNumero } from '../formatar';
import { Drawer } from './Drawer';
import { ErroDaApi, Mensagem } from './Formulario';

const ROTULO_CAMPO: Record<CampoPlanilha, string> = {
  nome: 'Nome da loja',
  telefone: 'Telefone',
  endereco: 'Endereço',
  categoria: 'Categoria',
  nota: 'Nota',
  avaliacoes: 'Avaliações',
  url: 'Link do Maps',
  site: 'Site',
};

/**
 * Importa a planilha do Google Maps exportada pelo Instant Data Scraper: lê o CSV no navegador,
 * reconhece as colunas pelo conteúdo, mostra a prévia e manda para a campanha. O sistema cruza
 * cada loja com a base de CNPJ e enriquece como qualquer busca do Maps, sem gastar cota do Google.
 */
export function ImportarPlanilha(props: { campanha: Campanha; aoFechar: () => void }) {
  const { campanha } = props;
  const cliente = useQueryClient();
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<string[][]>([]);
  const [cabecalho, setCabecalho] = useState<string[] | null>(null);
  const [mapa, setMapa] = useState<MapaColunas | null>(null);
  const [cidade, setCidade] = useState(0);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  const ler = async (e: ChangeEvent<HTMLInputElement>) => {
    setErroArquivo(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) {
      setErroArquivo('Use o arquivo CSV (no Instant Data Scraper, clique em "Download CSV", não em XLSX).');
      return;
    }
    const todas = lerCsv(await f.text());
    const comCabecalho = temCabecalho(todas);
    const dados = comCabecalho ? todas.slice(1) : todas;
    if (!dados.length) {
      setErroArquivo('A planilha está vazia.');
      return;
    }
    setArquivo(f.name);
    setCabecalho(comCabecalho ? (todas[0] ?? null) : null);
    setLinhas(dados);
    setMapa(detectarColunas(dados));
  };

  const itens = useMemo(
    () => (mapa ? linhas.map((l) => linhaParaItem(l, mapa)).filter((x) => x != null) : []),
    [linhas, mapa],
  );
  const largura = Math.max(0, ...linhas.slice(0, 20).map((l) => l.length));
  const nomeColuna = (i: number) => {
    const exemplo = linhas.find((l) => (l[i] ?? '').trim())?.[i]?.trim() ?? '';
    const titulo = cabecalho?.[i]?.trim() || `Coluna ${i + 1}`;
    return `${titulo}${exemplo ? ` (ex.: ${exemplo.slice(0, 40)}${exemplo.length > 40 ? '…' : ''})` : ''}`;
  };
  const destino = campanha.cidades[cidade];

  const enviar = useMutation({
    mutationFn: () =>
      api<{ linhas: number; lotes: number }>('/importacoes/planilha-maps', {
        metodo: 'POST',
        corpo: { campanhaId: campanha.id, cidade: destino?.cidade, uf: destino?.uf, itens },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['campanhas'] });
      cliente.invalidateQueries({ queryKey: ['empresas'] });
    },
  });

  return (
    <Drawer titulo="Importar planilha do Maps" barra={campanha.nome} aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        {enviar.data ? (
          <div className="pilha">
            <Mensagem tipo="ok">
              {fmtNumero(enviar.data.linhas)} lojas enviadas. Em instantes elas aparecem nos leads da
              campanha: quem casar com a base de CNPJ ganha telefone e nota do Google, as outras entram como
              lojas do Maps, e todas vão para o enriquecimento.
            </Mensagem>
            <div className="acoes">
              <Button variant="primary" onClick={props.aoFechar}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <div className="pilha">
            <Mensagem tipo="aviso">
              <b>Como exportar:</b> no Google Maps, busque "autopeças em [bairro], [cidade]", role a lista até
              o fim, abra a extensão Instant Data Scraper e clique em "Download CSV". Repita por bairro para
              cobrir a cidade. Não gasta a cota do Google.
            </Mensagem>

            <div className="campo">
              <label htmlFor="planilha-arquivo">Arquivo CSV</label>
              <input id="planilha-arquivo" type="file" accept=".csv,.txt,.tsv,text/csv" onChange={ler} />
              {arquivo && (
                <span className="campo__dica">
                  {arquivo}: {fmtNumero(linhas.length)} linha(s), {fmtNumero(itens.length)} com nome.
                </span>
              )}
              {erroArquivo && <span className="campo__erro">{erroArquivo}</span>}
            </div>

            {campanha.cidades.length > 1 && (
              <div className="campo">
                <label htmlFor="planilha-cidade">Cidade das lojas</label>
                <select
                  id="planilha-cidade"
                  value={cidade}
                  onChange={(e) => setCidade(Number(e.target.value))}
                >
                  {campanha.cidades.map((c, i) => (
                    <option key={`${c.cidade}-${c.uf}`} value={i}>
                      {fmtCidade(c.cidade)} - {c.uf}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mapa && (
              <>
                <h3 className="subtitulo">Colunas</h3>
                <span className="campo__dica" style={{ marginTop: -8 }}>
                  O sistema reconheceu as colunas pelo conteúdo. Confira e troque se alguma estiver errada.
                </span>
                <div className="funil-ficha">
                  {CAMPOS_PLANILHA.map((campo) => (
                    <div className="campo" key={campo}>
                      <label htmlFor={`col-${campo}`}>
                        {ROTULO_CAMPO[campo]}
                        {campo === 'nome' ? ' *' : ''}
                      </label>
                      <select
                        id={`col-${campo}`}
                        value={mapa[campo] ?? ''}
                        onChange={(e) =>
                          setMapa({ ...mapa, [campo]: e.target.value === '' ? null : Number(e.target.value) })
                        }
                      >
                        <option value="">— não usar —</option>
                        {Array.from({ length: largura }, (_, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: colunas são posições fixas
                          <option key={i} value={i}>
                            {nomeColuna(i)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <h3 className="subtitulo">Prévia</h3>
                <div className="pp-tablewrap">
                  <table className="pp-table">
                    <thead>
                      <tr>
                        <th>Loja</th>
                        <th>Telefone</th>
                        <th>Endereço</th>
                        <th className="num">Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.slice(0, 5).map((it) => (
                        <tr key={`${it.nome}-${it.telefone ?? ''}-${it.endereco ?? ''}`}>
                          <td>
                            {it.nome}
                            {it.categoria && <div className="quieto">{it.categoria}</div>}
                          </td>
                          <td className="mono">{it.telefone ?? '—'}</td>
                          <td>{it.endereco ?? '—'}</td>
                          <td className="num mono">
                            {it.nota ?? '—'}
                            {it.avaliacoes != null ? ` (${fmtNumero(it.avaliacoes)})` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <ErroDaApi erro={enviar.error} />
            <div className="acoes">
              <Button
                variant="primary"
                icon="file-text"
                disabled={!itens.length || mapa?.nome == null || !destino || enviar.isPending}
                onClick={() => enviar.mutate()}
              >
                {enviar.isPending
                  ? 'Enviando…'
                  : itens.length
                    ? `Importar ${fmtNumero(itens.length)} lojas`
                    : 'Importar'}
              </Button>
              <Button variant="ghost" onClick={props.aoFechar}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
