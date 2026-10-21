import { interpretarLinkedin, type PessoaLinkedin, palavrasDoNome, type ResultadoGoogle } from './apify.js';

/**
 * Regras para ligar um perfil do LinkedIn a uma empresa (e a um sócio dela) sem cair em homônimo.
 *
 * Nome igual não prova nada: "Antonio Carlos dos Santos" (sócio na Receita) e "Antonio Carlos dos
 * Santos Caldas" (operador de produção em outra empresa) são pessoas diferentes. Um perfil só vale
 * quando o próprio resultado do LinkedIn diz que a pessoa trabalha NESTA empresa.
 */

/** Minúsculas, sem acento, só letras/números e espaço. */
function comparavel(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const SUFIXOS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'mei', 'cia', 'filial', 'matriz']);

/** Partes do nome de pessoa que contam (sem "de", "da", "dos"…). */
function partesDoNome(nome: string): string[] {
  return comparavel(nome)
    .split(' ')
    .filter((p) => p && !PARTICULAS.has(p));
}

/**
 * O nome do perfil é o mesmo do sócio? O LinkedIn costuma abreviar ("Antonio Santos" para
 * "Antonio Carlos dos Santos"), então o perfil pode ter MENOS nomes, nunca um que o sócio não tem:
 * "Antonio Carlos dos Santos Caldas" não é "Antonio Carlos dos Santos".
 */
export function mesmoNome(nomeReceita: string, nomePerfil: string): boolean {
  const receita = partesDoNome(nomeReceita);
  const perfil = partesDoNome(nomePerfil);
  if (perfil.length < 2 || receita.length < 2) return false;
  if (perfil[0] !== receita[0]) return false;
  // Último nome do perfil precisa ser um sobrenome do sócio, e nenhum nome do perfil pode sobrar.
  return perfil.every((p) => receita.includes(p));
}

/**
 * Palavras que identificam a empresa, do nome fantasia e da razão social
 * ("Adual Baterias" / "ADUAL BATERIAS 24 HORAS LTDA" → ["adual", "baterias", "horas"]).
 * Palavras genéricas do ramo e sufixos societários ficam de fora.
 */
export function palavrasDaEmpresa(nome: string, razaoSocial?: string | null): string[] {
  const todas = [...palavrasDoNome(nome), ...palavrasDoNome(razaoSocial ?? '')];
  return [...new Set(todas.filter((p) => !SUFIXOS.has(p) && !/^\d+$/.test(p)))];
}

/**
 * Primeira linha do trecho do Google, no formato do LinkedIn: "Localidade · Cargo · Empresa"
 * ("Brasil · Assistente administrativo · Alcoolmaq Rolamentos e Peças LTDA"). É o emprego ATUAL.
 * Linha com "Experiência:" ou texto corrido não é cabeçalho e fica de fora.
 */
export function cabecalhoDoTrecho(descricao: string): { cargo: string | null; empresa: string } | null {
  const linha = (descricao.split(/\n|\.\s/)[0] ?? '').trim();
  const partes = linha
    .split(/\s+·\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length < 2 || partes.length > 3) return null;
  if (partes.some((p) => p.includes(':') || p.length > 80)) return null;
  const empresa = partes[partes.length - 1] ?? '';
  const cargo = partes.length === 3 ? (partes[1] ?? null) : null;
  return empresa ? { cargo, empresa } : null;
}

/** Trecho do resultado que fala do emprego ATUAL: título, cabeçalho e "Experiência: X" do resumo. */
function textoDoEmprego(perfil: PessoaLinkedin, r: ResultadoGoogle): string {
  const experiencia = r.descricao.match(/experi[eê]ncia:\s*([^·|\n]+)/i)?.[1] ?? '';
  const cabecalho = cabecalhoDoTrecho(r.descricao)?.empresa ?? '';
  return comparavel(`${perfil.empresa ?? ''} ${cabecalho} ${experiencia}`);
}

/** "Alcoolmaq Rolamentos e Peças LTDA. fev. de 2018 - o momento": a empresa com emprego em aberto. */
function empregoEmAberto(r: ResultadoGoogle, palavras: string[]): boolean {
  const texto = comparavel(r.descricao);
  return palavras.some((p) =>
    new RegExp(`\\b${p}\\b[a-z0-9 ]{0,80}?\\b(19|20)\\d{2} (o momento|presente|atual|hoje)\\b`).test(texto),
  );
}

/**
 * O perfil diz que a pessoa trabalha nesta empresa? Precisa de uma palavra própria da empresa
 * (não "auto", "peças") no emprego atual: título, cabeçalho do trecho, "Experiência: X" ou um
 * período "desde 2018 - o momento". Quem só passou pela empresa (período fechado) fica de fora.
 */
export function trabalhaNaEmpresa(perfil: PessoaLinkedin, r: ResultadoGoogle, palavras: string[]): boolean {
  if (!palavras.length) return false;
  if (empregoEmAberto(r, palavras)) return true;
  const texto = textoDoEmprego(perfil, r);
  if (!texto) return false;
  const juntos = texto.replace(/\s+/g, '');
  const termos = new Set(texto.split(' '));
  // Palavra curta (≤4 letras) só vale inteira; longa vale também colada ("adualbaterias").
  return palavras.some((p) => termos.has(p) || (p.length > 4 && juntos.includes(p)));
}

/** Pessoas dos resultados que trabalham hoje na empresa (busca por cargo + empresa). */
export function pessoasDaEmpresa(resultados: ResultadoGoogle[], palavras: string[]): PessoaLinkedin[] {
  const vistos = new Set<string>();
  const saida: PessoaLinkedin[] = [];
  for (const r of resultados) {
    const p = interpretarLinkedin(r);
    if (!p || vistos.has(p.url) || !trabalhaNaEmpresa(p, r, palavras)) continue;
    vistos.add(p.url);
    // Título só com o nome ("Tatiane Santos Rocha"): cargo e empresa vêm do cabeçalho do trecho.
    const cab = cabecalhoDoTrecho(r.descricao);
    saida.push({ ...p, cargo: p.cargo ?? cab?.cargo ?? null, empresa: p.empresa ?? cab?.empresa ?? null });
  }
  return saida;
}

/** Perfil do sócio: mesmo nome E trabalhando nesta empresa. Homônimo de outra empresa fica de fora. */
export function perfilDoSocio(
  nomeSocio: string,
  resultados: ResultadoGoogle[],
  palavras: string[],
): PessoaLinkedin | null {
  for (const r of resultados) {
    const p = interpretarLinkedin(r);
    if (p && mesmoNome(nomeSocio, p.nome) && trabalhaNaEmpresa(p, r, palavras)) return p;
  }
  return null;
}
