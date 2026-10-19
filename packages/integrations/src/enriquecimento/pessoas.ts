/**
 * Prova de que uma pessoa citada no site/Instagram trabalha na empresa.
 *
 * Sites de loja estão cheios de nomes que não são da equipe: depoimentos, avaliações do Google
 * copiadas, autores de comentários. Nome solto não vira contato: só passa quem aparece no texto
 * com um cargo ao lado e fora de um bloco de depoimentos.
 */

/** Minúsculas, sem acento, espaços simples. */
export function textoComparavel(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"«»'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras de cargo de quem trabalha na empresa (sem acento). */
const CARGO =
  /\b(gerente|gerencia|diretor[a]?|diretoria|propriet[a-z]*|socio[a]?|socios|dono[a]?|fundador[a]?|co-?fundador[a]?|ceo|presidente|comprador[a]?|compras|suprimentos|supervisor[a]?|administrador[a]?|administrativo|gestor[a]?|coordenador[a]?|vendedor[a]?|vendas|comercial|consultor[a]?|representante|responsavel|financeiro|atendente|balconista|estoquista|equipe|colaborador[a]?|fundacao|fundou)\b/;

/** Sinais de que o nome é de cliente, não da equipe. */
const DEPOIMENTO =
  /depoimento|avaliac|avaliou|review|estrela|recomend|o que (nossos |os )?clientes|clientes dizem|clientes falam|cliente satisfeito|comentari|google|★|⭐/;

export interface PessoaCitada {
  nome: string;
  cargo: string | null;
  /** Trecho do texto que mostra a pessoa com o cargo, segundo a IA. */
  trecho?: string | null;
}

export interface ProvaPessoa {
  aceita: boolean;
  /** Trecho do texto original que comprova (quando aceita). */
  evidencia: string | null;
  motivo: string;
}

/**
 * Confere no texto do site/bio se a pessoa é mesmo da empresa:
 * 1. tem cargo informado;
 * 2. o nome aparece no texto;
 * 3. há palavra de cargo a poucas palavras do nome (no trecho da IA ou ao redor do nome);
 * 4. o texto logo antes do nome não tem cara de depoimento/avaliação (o nome do cliente vem
 *    depois das estrelas e do comentário).
 */
export function provarPessoa(p: PessoaCitada, textos: (string | null | undefined)[]): ProvaPessoa {
  const recusa = (motivo: string): ProvaPessoa => ({ aceita: false, evidencia: null, motivo });
  if (!p.cargo?.trim()) return recusa('sem cargo');
  const cargo = textoComparavel(p.cargo);
  if (!CARGO.test(cargo)) return recusa(`cargo não é da equipe (${p.cargo})`);

  const nome = textoComparavel(p.nome);
  const partes = nome.split(' ');
  if (partes.length < 2) return recusa('nome incompleto');

  for (const bruto of textos) {
    if (!bruto) continue;
    const texto = textoComparavel(bruto);
    let pos = texto.indexOf(nome);
    // Também aceita "Nome Sobrenome" quando o site escreve o nome completo (ou vice-versa).
    if (pos < 0) pos = texto.indexOf(`${partes[0]} ${partes[partes.length - 1]}`);
    while (pos >= 0) {
      const antes = texto.slice(Math.max(0, pos - 300), pos);
      const perto = texto.slice(Math.max(0, pos - 80), pos + nome.length + 80);
      if (!DEPOIMENTO.test(antes) && CARGO.test(perto)) {
        // Mostra o trecho da IA (com acentos) quando ele está mesmo no texto; senão, a vizinhança.
        const trecho = p.trecho?.trim();
        const evidencia = trecho && texto.includes(textoComparavel(trecho)) ? trecho : perto.trim();
        return { aceita: true, evidencia: evidencia.slice(0, 200), motivo: 'cargo ao lado do nome' };
      }
      pos = texto.indexOf(nome, pos + nome.length);
    }
  }
  return recusa('nome sem cargo por perto ou em bloco de depoimentos');
}
