import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { Faixa, Partida, Ponto } from './api';

/**
 * Mapa de vendas na rua (Leaflet + OpenStreetMap, sem chave nem custo): os leads da campanha em
 * pontinhos (cor da nota), as visitas do roteiro numeradas e o caminho entre elas.
 * Outro provedor de mapa: VITE_MAPA_TILES com {z}/{x}/{y} (e VITE_MAPA_CREDITO).
 */

const TILES = import.meta.env.VITE_MAPA_TILES ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CREDITO =
  import.meta.env.VITE_MAPA_CREDITO ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface PontoFundo extends Ponto {
  id: number;
  nome: string;
  faixa: Faixa | null;
  /** Já está no roteiro (não aparece como pontinho, aparece numerado). */
  noRoteiro?: boolean;
  /** Não entra pelos filtros (fica mais apagado). */
  apagado?: boolean;
}

export interface PontoParada extends Ponto {
  id: number;
  ordem: number;
  nome: string;
  situacao?: 'pendente' | 'em_visita' | 'feita' | 'pulada';
  /** A próxima (destacada). */
  proxima?: boolean;
}

const COR_FAIXA: Record<Faixa, string> = { A: '#0b6b63', B: '#8f5300', C: '#8a8a83' };

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function MapaRua(props: {
  partida: Partida | null;
  fundo?: PontoFundo[];
  paradas: PontoParada[];
  tracado?: [number, number][] | null;
  /** Clicar num lead do fundo (para pôr no roteiro). */
  aoEscolher?: (id: number) => void;
  rotulo: string;
  className?: string;
}) {
  const caixa = useRef<HTMLElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camadas = useRef<{ fundo: L.LayerGroup; rota: L.LayerGroup } | null>(null);
  const escolher = useRef(props.aoEscolher);
  escolher.current = props.aoEscolher;
  const enquadrado = useRef('');

  useEffect(() => {
    if (!caixa.current) return;
    const m = L.map(caixa.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
    L.tileLayer(TILES, { maxZoom: 19, attribution: CREDITO }).addTo(m);
    m.setView([-14.2, -51.9], 4);
    camadas.current = { fundo: L.layerGroup().addTo(m), rota: L.layerGroup().addTo(m) };
    mapa.current = m;
    // O mapa nasce dentro de uma área que ainda está se ajeitando (grade, aba).
    const ajuste = new ResizeObserver(() => m.invalidateSize());
    ajuste.observe(caixa.current);
    return () => {
      ajuste.disconnect();
      m.remove();
      mapa.current = null;
      camadas.current = null;
    };
  }, []);

  // Leads da campanha (pontinhos).
  useEffect(() => {
    const c = camadas.current;
    if (!c) return;
    c.fundo.clearLayers();
    for (const p of props.fundo ?? []) {
      if (p.noRoteiro) continue;
      const cor = COR_FAIXA[p.faixa ?? 'C'];
      const marca = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: '#ffffff',
        weight: 1.5,
        fillColor: cor,
        fillOpacity: p.apagado ? 0.25 : 0.9,
        opacity: p.apagado ? 0.4 : 1,
      });
      marca.bindTooltip(
        `${escapar(p.nome)}${p.faixa ? ` · Nota ${p.faixa}` : ''}${escolher.current && !p.apagado ? '<br><small>Clique para pôr no roteiro</small>' : ''}`,
        { direction: 'top', offset: [0, -4] },
      );
      if (escolher.current) marca.on('click', () => escolher.current?.(p.id));
      marca.addTo(c.fundo);
    }
  }, [props.fundo]);

  // Partida, visitas numeradas e o caminho.
  useEffect(() => {
    const c = camadas.current;
    const m = mapa.current;
    if (!c || !m) return;
    c.rota.clearLayers();
    if (props.tracado && props.tracado.length > 1)
      L.polyline(props.tracado, { color: '#0b6b63', weight: 4, opacity: 0.85 }).addTo(c.rota);
    if (props.partida)
      L.marker([props.partida.lat, props.partida.lng], {
        icon: L.divIcon({
          className: 'rua-pino-caixa',
          html: '<span class="rua-pino rua-pino--partida"></span>',
          iconSize: [22, 22],
        }),
        keyboard: false,
        title: `Saída: ${props.partida.rotulo}`,
      }).addTo(c.rota);
    for (const p of props.paradas) {
      const estado = p.proxima ? 'proxima' : (p.situacao ?? 'pendente');
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: 'rua-pino-caixa',
          html: `<span class="rua-pino" data-estado="${estado}">${p.ordem}</span>`,
          iconSize: [28, 28],
        }),
        title: `${p.ordem}. ${p.nome}`,
        zIndexOffset: p.proxima ? 1000 : 0,
      }).addTo(c.rota);
    }

    // Enquadra quando o conjunto muda (não a cada reordenação, para não "pular" o mapa).
    const pontos: L.LatLngExpression[] = [
      ...(props.partida ? [[props.partida.lat, props.partida.lng] as [number, number]] : []),
      ...props.paradas.map((p) => [p.lat, p.lng] as [number, number]),
    ];
    const todos =
      pontos.length > 1
        ? pontos
        : [...pontos, ...(props.fundo ?? []).map((p) => [p.lat, p.lng] as [number, number])];
    const chave =
      [...props.paradas.map((p) => p.id)].sort().join(',') +
      (props.partida ? `@${props.partida.lat},${props.partida.lng}` : '') +
      `#${todos.length}`;
    if (todos.length && chave !== enquadrado.current) {
      enquadrado.current = chave;
      if (todos.length === 1) m.setView(todos[0]!, 14);
      else m.fitBounds(L.latLngBounds(todos), { padding: [36, 36], maxZoom: 15 });
    }
  }, [props.partida, props.paradas, props.tracado, props.fundo]);

  return <section ref={caixa} className={`rua-mapa ${props.className ?? ''}`} aria-label={props.rotulo} />;
}
