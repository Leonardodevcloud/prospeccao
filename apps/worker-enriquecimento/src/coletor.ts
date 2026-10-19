import { ehCelular, normalizarNome } from '@prospeccao/shared';

/**
 * Junta o que as fontes acham numa rodada, sem duplicar: o mesmo telefone visto no Maps e no
 * site vira um contato só, com as duas fontes. No fim, escolhe o decisor e o melhor contato.
 * Tudo em memória; o repositório grava de uma vez.
 */

export type Canal = 'whatsapp' | 'telefone' | 'email' | 'instagram' | 'linkedin' | 'site' | 'facebook';
export type FonteContato =
  | 'receita'
  | 'maps'
  | 'site'
  | 'instagram'
  | 'linkedin'
  | 'google'
  | 'ia'
  | 'places'
  | 'whatsapp'
  | 'base_paga';
export type Papel = 'socio' | 'compras' | 'gestao' | 'outro';
export type StatusContato = 'verificado' | 'nao_verificado' | 'atencao' | 'invalido';

export interface Contato {
  canal: Canal;
  valor: string;
  rotulo: string | null;
  fonte: FonteContato;
  fontes: Set<FonteContato>;
  urlOrigem: string | null;
  confianca: number;
  status: StatusContato;
  whatsapp: boolean | null;
  pessoa: string | null; // nome da pessoa dona do contato (ex.: LinkedIn pessoal)
  principal: boolean;
}

export interface Pessoa {
  nome: string;
  cargo: string | null;
  papel: Papel;
  /** Qualificação na Receita: 1 administra a empresa, 2 sócio, 3 outros. */
  prioridadeReceita: number | null;
  desde: string | null;
  linkedin: string | null;
  fontes: Set<FonteContato>;
  urlOrigem: string | null;
  /** Trecho do site/bio que mostra a pessoa com o cargo. */
  evidencia: string | null;
  decisor: boolean;
  prioridade: number;
}

const COMPRAS = /compr|suprim|purchas|procurement|abastec/i;
const GESTAO = /gerent|diretor|propriet|s[óo]ci|dono|ceo|fundador|founder|presidente|administra|gest/i;

export function papelPeloCargo(cargo: string | null | undefined): Papel {
  if (!cargo) return 'outro';
  if (COMPRAS.test(cargo)) return 'compras';
  if (GESTAO.test(cargo)) return 'gestao';
  return 'outro';
}

export class Coletor {
  readonly contatos = new Map<string, Contato>();
  readonly pessoas = new Map<string, Pessoa>();

  contato(c: {
    canal: Canal;
    valor: string | null | undefined;
    fonte: FonteContato;
    confianca: number;
    rotulo?: string | null;
    urlOrigem?: string | null;
    status?: StatusContato;
    pessoa?: string | null;
  }): void {
    if (!c.valor) return;
    const chave = `${c.canal}:${c.valor}`;
    const atual = this.contatos.get(chave);
    if (atual) {
      atual.fontes.add(c.fonte);
      // Visto em mais de uma fonte: mais confiável.
      atual.confianca = Math.min(100, Math.max(atual.confianca, c.confianca) + 10);
      atual.rotulo ??= c.rotulo ?? null;
      if (atual.status === 'atencao' && c.status !== 'atencao') atual.status = c.status ?? 'nao_verificado';
      return;
    }
    this.contatos.set(chave, {
      canal: c.canal,
      valor: c.valor,
      rotulo: c.rotulo ?? null,
      fonte: c.fonte,
      fontes: new Set([c.fonte]),
      urlOrigem: c.urlOrigem ?? null,
      confianca: c.confianca,
      status: c.status ?? 'nao_verificado',
      whatsapp: null,
      pessoa: c.pessoa ?? null,
      principal: false,
    });
  }

  pessoa(p: {
    nome: string;
    fonte: FonteContato;
    cargo?: string | null;
    papel?: Papel;
    prioridadeReceita?: number | null;
    desde?: string | null;
    linkedin?: string | null;
    urlOrigem?: string | null;
    evidencia?: string | null;
  }): void {
    const chave = normalizarNome(p.nome);
    if (!chave || chave.split(' ').length < 2) return;
    const atual = this.pessoas.get(chave);
    const papel = p.papel ?? papelPeloCargo(p.cargo);
    if (atual) {
      atual.fontes.add(p.fonte);
      atual.cargo ??= p.cargo ?? null;
      atual.linkedin ??= p.linkedin ?? null;
      atual.desde ??= p.desde ?? null;
      atual.prioridadeReceita ??= p.prioridadeReceita ?? null;
      atual.evidencia ??= p.evidencia ?? null;
      // "compras" é o papel mais útil para a abordagem; sócio vence "outro".
      if (papel === 'compras' || (atual.papel === 'outro' && papel !== 'outro')) atual.papel = papel;
      return;
    }
    this.pessoas.set(chave, {
      nome: p.nome.trim(),
      cargo: p.cargo ?? null,
      papel,
      prioridadeReceita: p.prioridadeReceita ?? null,
      desde: p.desde ?? null,
      linkedin: p.linkedin ?? null,
      fontes: new Set([p.fonte]),
      urlOrigem: p.urlOrigem ?? null,
      evidencia: p.evidencia ?? null,
      decisor: false,
      prioridade: 9,
    });
  }

  /**
   * O mesmo número achado como WhatsApp (botão do site, bio) e como telefone (Google, Receita)
   * vira um contato só, de WhatsApp, com todas as fontes.
   */
  juntarTelefonesDeWhatsapp(): void {
    for (const [chave, tel] of [...this.contatos]) {
      if (tel.canal !== 'telefone') continue;
      const wpp = this.contatos.get(`whatsapp:${tel.valor}`);
      if (!wpp) continue;
      for (const f of tel.fontes) wpp.fontes.add(f);
      wpp.confianca = Math.min(100, Math.max(wpp.confianca, tel.confianca) + 10);
      if (tel.whatsapp === false) wpp.whatsapp = false;
      this.contatos.delete(chave);
    }
  }

  /** Telefones a conferir no WhatsApp: os mais confiáveis primeiro, celulares antes de fixos. */
  telefonesParaConferir(limite = 6): string[] {
    return [...this.contatos.values()]
      .filter((c) => c.canal === 'telefone' || c.canal === 'whatsapp')
      .sort((a, b) => Number(ehCelular(b.valor)) - Number(ehCelular(a.valor)) || b.confianca - a.confianca)
      .map((c) => c.valor)
      .filter((v, i, todos) => todos.indexOf(v) === i)
      .slice(0, limite);
  }

  /** Resultado do WhatsApp: telefone com WhatsApp vira contato de WhatsApp verificado. */
  aplicarWhatsapp(resultado: Map<string, boolean>): void {
    for (const [numero, tem] of resultado) {
      const tel = this.contatos.get(`telefone:${numero}`);
      const wpp = this.contatos.get(`whatsapp:${numero}`);
      if (tem) {
        const base = wpp ?? tel;
        if (!base) continue;
        if (tel && wpp) {
          for (const f of tel.fontes) wpp.fontes.add(f);
          wpp.confianca = Math.max(wpp.confianca, tel.confianca);
          this.contatos.delete(`telefone:${numero}`);
        } else if (tel) {
          this.contatos.delete(`telefone:${numero}`);
          tel.canal = 'whatsapp';
          this.contatos.set(`whatsapp:${numero}`, tel);
        }
        const c = this.contatos.get(`whatsapp:${numero}`);
        if (c) {
          c.status = 'verificado';
          c.whatsapp = true;
          c.confianca = Math.max(c.confianca, 90);
        }
      } else {
        if (wpp) {
          wpp.status = 'invalido';
          wpp.whatsapp = false;
        }
        if (tel) tel.whatsapp = false;
      }
    }
  }

  /**
   * Decisor: quem cuida de compras (se aparecer), senão quem administra a empresa na Receita,
   * senão um gestor citado no site ou no LinkedIn, senão o primeiro sócio.
   */
  escolherDecisor(): Pessoa | null {
    const nota = (p: Pessoa) =>
      p.papel === 'compras'
        ? 1
        : p.prioridadeReceita === 1
          ? 2
          : p.papel === 'gestao'
            ? 3
            : p.papel === 'socio'
              ? 4
              : 5;
    const ordenadas = [...this.pessoas.values()].sort(
      (a, b) =>
        nota(a) - nota(b) ||
        Number(!!b.linkedin) - Number(!!a.linkedin) ||
        (a.desde ?? '9').localeCompare(b.desde ?? '9'),
    );
    // Só vira "decisor" quem tem prova de que decide (nunca por nome parecido em outra fonte).
    // Decide quem administra a empresa na Receita (sócio-administrador) ou quem tem cargo de
    // compras/gestão/dono comprovado. Sócio sem poder de administração, só na Receita, não decide.
    const podeDecidir = (p: Pessoa) =>
      p.prioridadeReceita === 1 ||
      p.papel === 'compras' ||
      p.papel === 'gestao' ||
      (p.papel === 'socio' && p.prioridadeReceita == null);
    const decisor = ordenadas.find(podeDecidir) ?? null;
    ordenadas.forEach((p, i) => {
      p.prioridade = i + 1;
      p.decisor = p === decisor;
    });
    return decisor;
  }

  /**
   * Telefone que só existe no cadastro da Receita, numa empresa aberta há anos, quase sempre está
   * desatualizado (ninguém atualiza o CNPJ). Sem WhatsApp, é tratado como desativado; nunca vira
   * o contato principal se houver outro.
   */
  marcarReceitaAntiga(anos: number | null): void {
    if (anos == null || anos < 5) return;
    for (const c of this.contatos.values()) {
      if (c.canal !== 'telefone' || c.fontes.size !== 1 || !c.fontes.has('receita')) continue;
      if (c.whatsapp === true) continue;
      c.status = 'atencao';
      c.confianca = Math.min(c.confianca, 10);
      c.rotulo =
        c.whatsapp === false
          ? `Provavelmente desativado (sem WhatsApp; CNPJ de ${anos} anos)`
          : `Cadastro antigo da Receita (CNPJ de ${anos} anos)`;
    }
  }

  /** Melhor contato da empresa para a primeira abordagem. */
  escolherPrincipal(): Contato | null {
    this.juntarTelefonesDeWhatsapp();
    const peso = (c: Contato): number => {
      if (c.status === 'invalido') return -1;
      const base =
        c.canal === 'whatsapp'
          ? c.status === 'verificado'
            ? 100
            : 75
          : c.canal === 'telefone'
            ? c.fonte === 'receita' && c.fontes.size === 1
              ? c.status === 'atencao'
                ? 5
                : 30
              : 60
            : c.canal === 'email'
              ? /^(compras|comercial|vendas|contato)@/.test(c.valor)
                ? 55
                : 45
              : 0;
      return base + c.confianca / 100;
    };
    let melhor: Contato | null = null;
    for (const c of this.contatos.values()) {
      c.principal = false;
      if (peso(c) > 0 && (!melhor || peso(c) > peso(melhor))) melhor = c;
    }
    if (melhor) melhor.principal = true;
    return melhor;
  }
}

/**
 * Nota por regras, para quando a IA não está configurada ou falhou. Mesma escala da IA:
 * A ≥ 70, B 40–69, C < 40.
 */
export function notaPorRegras(s: {
  avaliacoes: number | null;
  nota: number | null;
  entrega: boolean | null;
  temWhatsapp: boolean;
  temInstagram: boolean;
  temSite: boolean;
  anos: number | null;
  porte: string | null;
}): { faixa: 'A' | 'B' | 'C'; score: number; motivo: string } {
  let score = 25;
  const sinais: string[] = [];
  if (s.entrega) {
    score += 20;
    sinais.push('faz entrega');
  }
  if ((s.avaliacoes ?? 0) >= 200) {
    score += 20;
    sinais.push(`${s.avaliacoes} avaliações no Google`);
  } else if ((s.avaliacoes ?? 0) >= 50) {
    score += 12;
    sinais.push(`${s.avaliacoes} avaliações no Google`);
  }
  if (s.temWhatsapp) {
    score += 10;
    sinais.push('WhatsApp encontrado');
  }
  if (s.temInstagram) {
    score += 8;
    sinais.push('Instagram ativo');
  }
  if (s.temSite) score += 4;
  if ((s.anos ?? 0) >= 3) {
    score += 8;
    sinais.push(`${s.anos} anos de empresa`);
  }
  if (s.porte === 'me' || s.porte === 'epp') score += 5;
  if (s.nota != null && s.nota < 3.5) {
    score -= 10;
    sinais.push(`nota baixa no Google (${s.nota})`);
  }
  score = Math.max(0, Math.min(100, score));
  const faixa = score >= 70 ? 'A' : score >= 40 ? 'B' : 'C';
  return {
    faixa,
    score,
    motivo: sinais.length ? `Por regras: ${sinais.join(', ')}.` : 'Por regras: poucos sinais públicos.',
  };
}
