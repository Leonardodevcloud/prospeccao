/**
 * Item do Google Maps como o sistema guarda: o Google Places, o Serper e a planilha do Maps
 * convertem para ele.
 */
export interface ItemMaps {
  placeId: string;
  nome: string;
  categoria: string | null;
  telefone: string | null;
  endereco: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  lat: number | null;
  lng: number | null;
  nota: number | null;
  avaliacoes: number | null;
  site: string | null;
  url: string | null;
  fechada: boolean;
  entrega: boolean | null;
  dados: Record<string, unknown>;
}
