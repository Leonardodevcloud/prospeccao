import type * as React from 'react';

export type Canal = 'whatsapp' | 'telefone' | 'email' | 'linkedin' | 'site' | 'instagram';
export type Fonte =
  | 'cnpj'
  | 'receita'
  | 'qsa'
  | 'maps'
  | 'places'
  | 'site'
  | 'instagram'
  | 'linkedin'
  | 'ifood'
  | 'manual'
  | 'ia'
  | 'google'
  | 'whatsapp'
  | 'base_paga';
export type StatusContato = 'verificado' | 'nao_verificado' | 'atencao' | 'invalido';
export type Faixa = 'A' | 'B' | 'C';

/** Ícone Lucide 1.49.0 em currentColor. */
export interface IconProps {
  name: string;
  size?: number;
  label?: string;
  spin?: boolean;
  strokeWidth?: number;
  className?: string;
}
export declare function Icon(props: IconProps): React.ReactElement;

/** Botão com rótulo verbal. Só ícone exige aria-label. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: string;
  iconRight?: string;
  href?: string;
  target?: string;
  rel?: string;
  /** Com href: baixa o arquivo com este nome. */
  download?: string;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface BadgeProps {
  tone?: 'neutral' | 'brand' | 'warning' | 'danger' | 'outline';
  icon?: string;
  children?: React.ReactNode;
  className?: string;
}
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface ScoreBadgeProps {
  faixa: Faixa;
  score?: number;
  size?: 'md' | 'lg';
}
export declare function ScoreBadge(props: ScoreBadgeProps): React.ReactElement;

export interface SourceTagProps {
  fonte: Fonte;
}
export declare function SourceTag(props: SourceTagProps): React.ReactElement;

export interface ContactStatusProps {
  status: StatusContato;
  compact?: boolean;
}
export declare function ContactStatus(props: ContactStatusProps): React.ReactElement;

export interface AvatarProps {
  nome: string;
  size?: number;
}
export declare function Avatar(props: AvatarProps): React.ReactElement;

export interface PanelProps {
  titulo?: React.ReactNode;
  contagem?: number;
  acoes?: React.ReactNode;
  semPadding?: boolean;
  className?: string;
  children?: React.ReactNode;
}
export declare function Panel(props: PanelProps): React.ReactElement;

/** Renderiza um <li>: use dentro de <ul class="pp-contacts">. */
export interface ContactRowProps {
  canal: Canal;
  valor: string;
  rotulo?: string;
  status?: StatusContato;
  fonte?: Fonte;
  principal?: boolean;
  onCopy?: (valor: string) => void;
  /** Botões extras no fim da linha (ex.: "número errado"). */
  acoes?: React.ReactNode;
}
export declare function ContactRow(props: ContactRowProps): React.ReactElement;

export interface DecisorCardProps {
  nome: string;
  cargo?: string;
  desde?: string;
  principal?: boolean;
  fontes?: Fonte[];
  linkedin?: string | null;
  /** Trecho da fonte que comprova o cargo (ex.: frase do site). */
  evidencia?: string;
  contatos?: ContactRowProps[];
  /** Botões extras no cabeçalho (ex.: "não é a pessoa certa"). */
  acoes?: React.ReactNode;
}
export declare function DecisorCard(props: DecisorCardProps): React.ReactElement;

export interface DataFieldItem {
  rotulo: string;
  valor?: React.ReactNode | null;
  mono?: boolean;
  fonte?: Fonte;
  largo?: boolean;
}
export interface DataFieldsProps {
  itens: DataFieldItem[];
  colunas?: number;
}
export declare function DataFields(props: DataFieldsProps): React.ReactElement;

export interface LeadHeaderProps {
  nome: string;
  razaoSocial?: string;
  cnpj?: string;
  faixa?: Faixa;
  score?: number;
  etapa?: string;
  nicho?: string;
  cidade?: string;
  sinalEntrega?: string;
  distancia?: string;
  motivo?: string;
  acoes?: React.ReactNode;
}
export declare function LeadHeader(props: LeadHeaderProps): React.ReactElement;

export interface Camada {
  nome: string;
  status: 'encontrado' | 'sem_resultado' | 'pulada' | 'erro' | 'em_andamento';
  detalhe?: string;
  fonte?: Fonte;
}
export interface EnrichmentTrailProps {
  camadas: Camada[];
}
export declare function EnrichmentTrail(props: EnrichmentTrailProps): React.ReactElement;

export interface TimelineItem {
  tipo: 'mensagem_enviada' | 'mensagem_recebida' | 'email' | 'ligacao' | 'etapa' | 'nota' | 'ia' | 'tarefa';
  titulo: string;
  quando: string;
  texto?: string;
}
export interface TimelineProps {
  itens: TimelineItem[];
}
export declare function Timeline(props: TimelineProps): React.ReactElement;

export interface MelhorContato {
  canal: Canal;
  valor: string;
  status?: StatusContato;
}
export interface LeadCardProps {
  nome: string;
  cidade?: string;
  nicho?: string;
  faixa: Faixa;
  score?: number;
  melhorContato?: MelhorContato | null;
  proximoPasso?: string | null;
  ultimaAtividade?: string;
  selecionado?: boolean;
  onClick?: () => void;
}
export declare function LeadCard(props: LeadCardProps): React.ReactElement;

export interface LeadLinha {
  id: string | number;
  nome: string;
  cidade?: string;
  nicho?: string;
  faixa: Faixa;
  score?: number;
  melhorContato?: MelhorContato | null;
  decisor?: { nome: string; cargo?: string } | null;
  etapa: string;
  etapaTom?: BadgeProps['tone'];
  ultimaAtividade?: string;
}
export interface LeadTableProps {
  leads: LeadLinha[];
  selecionado?: string | number;
  marcados?: Array<string | number>;
  onSelect?: (id: string | number) => void;
  compacta?: boolean;
}
export declare function LeadTable(props: LeadTableProps): React.ReactElement;

export interface TabsProps {
  itens: Array<{ id: string; rotulo: string; contagem?: number }>;
  ativo?: string;
  onChange?: (id: string) => void;
  rotulo?: string;
}
export declare function Tabs(props: TabsProps): React.ReactElement;

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  rotulo: string;
  dica?: string;
  erro?: string;
  icone?: string;
  rotuloOculto?: boolean;
}
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface StatProps {
  rotulo: string;
  valor: React.ReactNode;
  delta?: string;
  tendencia?: 'sobe' | 'desce';
}
export declare function Stat(props: StatProps): React.ReactElement;

export interface EmptyStateProps {
  icone?: string;
  titulo: string;
  texto?: string;
  acao?: React.ReactNode;
}
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

export declare const ICONES: string[];
export declare const CANAIS: Record<Canal, { icone: string; rotulo: string }>;
export declare const FONTES: Record<Fonte, string>;
