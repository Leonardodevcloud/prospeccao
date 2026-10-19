/**
 * Componentes do design system "CRM de Prospecção" (React).
 * Fonte da verdade visual: o design system publicado; este arquivo é a versão
 * em módulo usada pelo app web. Classes CSS com prefixo pp- (componentes.css).
 * Ícones: Lucide 1.49.0 (ISC).
 */
import * as React from 'react';

var h = React.createElement;
var F = React.Fragment;

/* Ícones: Lucide 1.49.0 (ISC). Nós copiados do pacote lucide-static. */
var ICONS = {
  'message-circle': [
    [
      'path',
      {
        d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
      },
    ],
  ],
  mail: [
    ['path', { d: 'm22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7' }],
    ['rect', { x: '2', y: '4', width: '20', height: '16', rx: '2' }],
  ],
  phone: [
    [
      'path',
      {
        d: 'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384',
      },
    ],
  ],
  'user-round': [
    ['circle', { cx: '12', cy: '8', r: '5' }],
    ['path', { d: 'M20 21a8 8 0 0 0-16 0' }],
  ],
  'id-card': [
    ['path', { d: 'M13 19a4 4 0 00-8 0' }],
    ['path', { d: 'M16 10h2' }],
    ['path', { d: 'M16 14h2' }],
    ['circle', { cx: '9', cy: '12', r: '3' }],
    ['rect', { x: '2', y: '5', width: '20', height: '14', rx: '2' }],
  ],
  globe: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
    ['path', { d: 'M2 12h20' }],
  ],
  camera: [
    [
      'path',
      {
        d: 'M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z',
      },
    ],
    ['circle', { cx: '12', cy: '13', r: '3' }],
  ],
  'map-pin': [
    [
      'path',
      {
        d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
      },
    ],
    ['circle', { cx: '12', cy: '10', r: '3' }],
  ],
  'building-2': [
    ['path', { d: 'M10 12h4' }],
    ['path', { d: 'M10 8h4' }],
    ['path', { d: 'M14 21v-3a2 2 0 0 0-4 0v3' }],
    ['path', { d: 'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2' }],
    ['path', { d: 'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16' }],
  ],
  'badge-check': [
    [
      'path',
      {
        d: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z',
      },
    ],
    ['path', { d: 'm16 9-5.5 5.5L8 12' }],
  ],
  'circle-help': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  'circle-x': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm15 9-6 6' }],
    ['path', { d: 'm9 9 6 6' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  copy: [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ],
  'external-link': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  ],
  search: [
    ['path', { d: 'm21 21-4.34-4.34' }],
    ['circle', { cx: '11', cy: '11', r: '8' }],
  ],
  'list-filter': [
    ['path', { d: 'M2 5h20' }],
    ['path', { d: 'M6 12h12' }],
    ['path', { d: 'M9 19h6' }],
  ],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  ellipsis: [
    ['circle', { cx: '12', cy: '12', r: '1' }],
    ['circle', { cx: '19', cy: '12', r: '1' }],
    ['circle', { cx: '5', cy: '12', r: '1' }],
  ],
  clock: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 6v6l4 2' }],
  ],
  calendar: [
    ['path', { d: 'M8 2v3' }],
    ['path', { d: 'M16 2v3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
  ],
  bot: [
    ['path', { d: 'M12 8V4H8' }],
    ['rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }],
    ['path', { d: 'M2 14h2' }],
    ['path', { d: 'M20 14h2' }],
    ['path', { d: 'M15 13v2' }],
    ['path', { d: 'M9 13v2' }],
  ],
  'arrow-right': [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'm12 5 7 7-7 7' }],
  ],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  layers: [
    [
      'path',
      {
        d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
      },
    ],
    ['path', { d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12' }],
    ['path', { d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' }],
  ],
  store: [
    ['path', { d: 'M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5' }],
    [
      'path',
      {
        d: 'M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244',
      },
    ],
    ['path', { d: 'M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05' }],
  ],
  package: [
    [
      'path',
      {
        d: 'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
      },
    ],
    ['path', { d: 'M12 22V12' }],
    ['polyline', { points: '3.29 7 12 12 20.71 7' }],
    ['path', { d: 'm7.5 4.27 9 5.15' }],
  ],
  star: [
    [
      'path',
      {
        d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
      },
    ],
  ],
  send: [
    [
      'path',
      {
        d: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
      },
    ],
    ['path', { d: 'm21.854 2.147-10.94 10.939' }],
  ],
  'file-text': [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
      },
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M10 9H8' }],
    ['path', { d: 'M16 13H8' }],
    ['path', { d: 'M16 17H8' }],
  ],
  landmark: [
    ['path', { d: 'M10 18v-7' }],
    ['path', { d: 'M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z' }],
    ['path', { d: 'M14 18v-7' }],
    ['path', { d: 'M18 18v-7' }],
    ['path', { d: 'M3 22h18' }],
    ['path', { d: 'M6 18v-7' }],
  ],
  'circle-dashed': [
    ['path', { d: 'M10.1 2.182a10 10 0 0 1 3.8 0' }],
    ['path', { d: 'M13.9 21.818a10 10 0 0 1-3.8 0' }],
    ['path', { d: 'M17.609 3.721a10 10 0 0 1 2.69 2.7' }],
    ['path', { d: 'M2.182 13.9a10 10 0 0 1 0-3.8' }],
    ['path', { d: 'M20.279 17.609a10 10 0 0 1-2.7 2.69' }],
    ['path', { d: 'M21.818 10.1a10 10 0 0 1 0 3.8' }],
    ['path', { d: 'M3.721 6.391a10 10 0 0 1 2.7-2.69' }],
    ['path', { d: 'M6.391 20.279a10 10 0 0 1-2.69-2.7' }],
  ],
  loader: [
    ['path', { d: 'M12 2v4' }],
    ['path', { d: 'm16.2 7.8 2.9-2.9' }],
    ['path', { d: 'M18 12h4' }],
    ['path', { d: 'm16.2 16.2 2.9 2.9' }],
    ['path', { d: 'M12 18v4' }],
    ['path', { d: 'm4.9 19.1 2.9-2.9' }],
    ['path', { d: 'M2 12h4' }],
    ['path', { d: 'm4.9 4.9 2.9 2.9' }],
  ],
  'sticky-note': [
    [
      'path',
      {
        d: 'M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z',
      },
    ],
    ['path', { d: 'M15 3v5a1 1 0 0 0 1 1h5' }],
  ],
  'trending-up': [
    ['path', { d: 'M16 7h6v6' }],
    ['path', { d: 'm22 7-8.5 8.5-5-5L2 17' }],
  ],
  'trending-down': [
    ['path', { d: 'M16 17h6v-6' }],
    ['path', { d: 'm22 17-8.5-8.5-5 5L2 7' }],
  ],
  inbox: [
    ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
    [
      'path',
      {
        d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
      },
    ],
  ],
  users: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['path', { d: 'M16 3.128a4 4 0 0 1 0 7.744' }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
    ['circle', { cx: '9', cy: '7', r: '4' }],
  ],
  kanban: [
    ['path', { d: 'M5 3v14' }],
    ['path', { d: 'M12 3v8' }],
    ['path', { d: 'M19 3v18' }],
  ],
};

/* Canal de contato → ícone e rótulo. Ícones genéricos: nunca logos de marca. */
var CANAIS = {
  whatsapp: { icone: 'message-circle', rotulo: 'WhatsApp' },
  telefone: { icone: 'phone', rotulo: 'Telefone' },
  email: { icone: 'mail', rotulo: 'E-mail' },
  linkedin: { icone: 'id-card', rotulo: 'LinkedIn' },
  site: { icone: 'globe', rotulo: 'Site' },
  instagram: { icone: 'camera', rotulo: 'Instagram' },
};

var FONTES = {
  cnpj: 'CNPJ',
  receita: 'Receita',
  qsa: 'QSA',
  maps: 'Maps',
  places: 'Places',
  site: 'Site',
  instagram: 'Insta',
  linkedin: 'LinkedIn',
  ifood: 'iFood',
  manual: 'Manual',
  ia: 'IA',
  google: 'Google',
  whatsapp: 'WhatsApp',
};
var FONTES_LONGAS = {
  cnpj: 'Base de CNPJ da Receita',
  receita: 'Cadastro da Receita (pode ser do contador)',
  qsa: 'Quadro de sócios (QSA) do CNPJ',
  maps: 'Google Maps (descoberta)',
  places: 'Google Places (validado)',
  site: 'Site da empresa',
  instagram: 'Instagram da empresa',
  linkedin: 'LinkedIn',
  ifood: 'iFood',
  manual: 'Cadastro manual',
  ia: 'Inferido pela IA',
  google: 'Busca no Google (diretórios de empresas)',
  whatsapp: 'Perfil comercial do WhatsApp',
};

var STATUS = {
  verificado: { icone: 'badge-check', rotulo: 'Verificado' },
  nao_verificado: { icone: 'circle-help', rotulo: 'Não verificado' },
  atencao: { icone: 'circle-help', rotulo: 'Verificar' },
  invalido: { icone: 'circle-x', rotulo: 'Inválido' },
};

function cx() {
  var out = [];
  for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
  return out.join(' ');
}

function soDigitos(v) {
  return String(v || '').replace(/\D+/g, '');
}

function hrefDoContato(canal, valor) {
  if (!valor) return null;
  if (canal === 'whatsapp') {
    var d = soDigitos(valor);
    return 'https://wa.me/' + (d.length <= 11 ? '55' + d : d);
  }
  if (canal === 'telefone') return 'tel:+55' + soDigitos(valor);
  if (canal === 'email') return 'mailto:' + valor;
  if (/^https?:\/\//.test(valor)) return valor;
  return 'https://' + valor;
}

function iniciais(nome) {
  var partes = String(nome || '')
    .trim()
    .split(/\s+/);
  var a = partes[0] ? partes[0][0] : '';
  var b = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (a + b).toUpperCase();
}

/* ---------- Icon ---------- */
function Icon(props) {
  var nodes = ICONS[props.name] || ICONS['circle-dashed'];
  var size = props.size || 16;
  var label = props.label;
  return h(
    'svg',
    {
      className: cx('pp-icon', props.spin && 'pp-spin', props.className),
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.strokeWidth || 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      role: label ? 'img' : undefined,
      'aria-label': label || undefined,
      'aria-hidden': label ? undefined : 'true',
      focusable: 'false',
    },
    nodes.map((n, i) => h(n[0], Object.assign({ key: i }, n[1]))),
  );
}

/* ---------- Button ---------- */
function Button(props) {
  var variant = props.variant || 'secondary';
  var size = props.size || 'md';
  var iconOnly = props.icon && !props.children;
  var rest = Object.assign({}, props);
  ['variant', 'size', 'icon', 'iconRight', 'children', 'className', 'href'].forEach((k) => {
    delete rest[k];
  });
  var cls = cx(
    'pp-btn',
    'pp-btn--' + variant,
    size === 'sm' && 'pp-btn--sm',
    iconOnly && 'pp-btn--icon',
    props.className,
  );
  var isz = size === 'sm' ? 14 : 16;
  var kids = [
    props.icon ? h(Icon, { key: 'i', name: props.icon, size: isz }) : null,
    props.children,
    props.iconRight ? h(Icon, { key: 'r', name: props.iconRight, size: isz }) : null,
  ];
  if (iconOnly && !rest.title && rest['aria-label']) rest.title = rest['aria-label'];
  if (props.href) return h('a', Object.assign({ className: cls, href: props.href }, rest), kids);
  return h('button', Object.assign({ type: 'button', className: cls }, rest), kids);
}

/* ---------- Badge ---------- */
function Badge(props) {
  return h(
    'span',
    {
      className: cx(
        'pp-badge',
        props.tone && props.tone !== 'neutral' && 'pp-badge--' + props.tone,
        props.className,
      ),
    },
    props.icon ? h(Icon, { name: props.icon, size: 12 }) : null,
    props.children,
  );
}

/* ---------- ScoreBadge ---------- */
function ScoreBadge(props) {
  var faixa = props.faixa || 'C';
  if (props.size === 'lg') {
    return h(
      'div',
      {
        className: cx('pp-score-lg', 'pp-score-lg--' + faixa),
        role: 'img',
        'aria-label': 'Faixa ' + faixa + ', score ' + props.score + ' de 100',
      },
      h('span', { className: 'pp-score-lg__faixa', 'aria-hidden': 'true' }, faixa),
      h(
        'span',
        { className: 'pp-score-lg__num', 'aria-hidden': 'true' },
        props.score,
        h('span', { className: 'pp-score-lg__de' }, 'Faixa ' + faixa + ' · de 100'),
      ),
    );
  }
  return h(
    'span',
    {
      className: cx('pp-score', 'pp-score--' + faixa),
      title: 'Faixa ' + faixa + ' · score ' + props.score,
      'aria-label': 'Faixa ' + faixa + ', score ' + props.score,
    },
    h('span', { className: 'pp-score__faixa', 'aria-hidden': 'true' }, faixa),
    props.score != null
      ? h('span', { className: 'pp-score__num', 'aria-hidden': 'true' }, props.score)
      : null,
  );
}

/* ---------- SourceTag ---------- */
function SourceTag(props) {
  var f = props.fonte;
  return h('span', { className: 'pp-source', title: 'Fonte: ' + (FONTES_LONGAS[f] || f) }, FONTES[f] || f);
}

/* ---------- ContactStatus ---------- */
function ContactStatus(props) {
  var s = STATUS[props.status] || STATUS.nao_verificado;
  return h(
    'span',
    { className: cx('pp-status', 'pp-status--' + (props.status || 'nao_verificado')) },
    h(Icon, { name: s.icone, size: 14 }),
    props.compact ? h('span', { className: 'pp-sr' }, s.rotulo) : s.rotulo,
  );
}

/* ---------- Avatar ---------- */
function Avatar(props) {
  var size = props.size || 36;
  return h(
    'span',
    {
      className: 'pp-avatar',
      style: { width: size, height: size, fontSize: Math.round(size * 0.36) },
      'aria-hidden': 'true',
    },
    iniciais(props.nome),
  );
}

/* ---------- Panel ---------- */
function Panel(props) {
  return h(
    'section',
    { className: cx('pp-panel', props.className) },
    props.titulo
      ? h(
          'header',
          { className: 'pp-panel__head' },
          h(
            'h3',
            { className: 'pp-panel__title' },
            props.titulo,
            props.contagem != null ? h('span', { className: 'pp-panel__count' }, props.contagem) : null,
          ),
          props.acoes || null,
        )
      : null,
    props.semPadding ? props.children : h('div', { className: 'pp-panel__body' }, props.children),
  );
}

/* ---------- ContactRow ---------- */
function ContactRow(props) {
  var canal = CANAIS[props.canal] || CANAIS.telefone;
  var href = props.status === 'invalido' ? null : hrefDoContato(props.canal, props.valor);
  var copiar = () => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(props.valor);
    } catch (e) {
      /* sem área de transferência */
    }
    if (props.onCopy) props.onCopy(props.valor);
  };
  return h(
    'li',
    {
      className: cx(
        'pp-contact',
        props.principal && 'pp-contact--principal',
        props.status === 'invalido' && 'pp-contact--invalido',
      ),
    },
    h(
      'span',
      { className: 'pp-contact__icon', title: canal.rotulo },
      h(Icon, { name: canal.icone, size: 16, label: canal.rotulo }),
    ),
    h(
      'div',
      { className: 'pp-contact__main' },
      h('span', { className: 'pp-contact__valor' }, props.valor),
      h(
        'span',
        { className: 'pp-contact__rotulo' },
        props.principal ? h('b', { style: { color: 'var(--brand)', fontWeight: 600 } }, 'Principal') : null,
        props.principal && props.rotulo ? ' · ' : null,
        props.rotulo || (props.principal ? null : canal.rotulo),
      ),
    ),
    h(
      'div',
      { className: 'pp-contact__meta' },
      h(ContactStatus, { status: props.status }),
      props.fonte ? h(SourceTag, { fonte: props.fonte }) : null,
    ),
    h(
      'div',
      { className: 'pp-contact__acoes' },
      h(Button, {
        variant: 'ghost',
        size: 'sm',
        icon: 'copy',
        'aria-label': 'Copiar ' + canal.rotulo.toLowerCase(),
        onClick: copiar,
      }),
      href
        ? h(Button, {
            variant: 'ghost',
            size: 'sm',
            icon: props.canal === 'whatsapp' ? 'send' : 'external-link',
            href: href,
            target: '_blank',
            rel: 'noreferrer',
            'aria-label': props.canal === 'whatsapp' ? 'Abrir conversa no WhatsApp' : 'Abrir ' + canal.rotulo,
          })
        : null,
    ),
  );
}

/* ---------- DecisorCard ---------- */
function DecisorCard(props) {
  var contatos = props.contatos || [];
  return h(
    'article',
    { className: 'pp-panel pp-decisor' },
    h(
      'div',
      { className: 'pp-decisor__head' },
      h(Avatar, { nome: props.nome, size: 40 }),
      h(
        'div',
        { className: 'pp-decisor__id' },
        h(
          'h4',
          { className: 'pp-decisor__nome' },
          props.nome,
          props.principal ? h(Badge, { tone: 'brand' }, 'Decisor principal') : null,
        ),
        h(
          'p',
          { className: 'pp-decisor__cargo' },
          props.cargo,
          props.desde ? ' · desde ' + props.desde : null,
        ),
        props.evidencia
          ? h('p', { className: 'pp-decisor__evidencia' }, '“' + props.evidencia + '”')
          : null,
        props.fontes && props.fontes.length
          ? h(
              'div',
              { className: 'pp-decisor__fontes' },
              props.fontes.map((f) => h(SourceTag, { key: f, fonte: f })),
            )
          : null,
      ),
      props.linkedin
        ? h(
            Button,
            {
              size: 'sm',
              icon: 'id-card',
              href: hrefDoContato('linkedin', props.linkedin),
              target: '_blank',
              rel: 'noreferrer',
            },
            'LinkedIn',
          )
        : null,
    ),
    contatos.length
      ? h(
          'ul',
          { className: 'pp-contacts' },
          contatos.map((c, i) => h(ContactRow, Object.assign({ key: i }, c))),
        )
      : h(
          'p',
          {
            className: 'pp-panel__body pp-muted',
            style: { margin: 0, borderTop: '1px solid var(--line)', fontSize: 13 },
          },
          'Nenhum contato pessoal encontrado ainda.',
        ),
  );
}

/* ---------- DataFields ---------- */
function DataFields(props) {
  return h(
    'dl',
    {
      className: 'pp-fields',
      style: props.colunas
        ? { gridTemplateColumns: 'repeat(' + props.colunas + ', minmax(0, 1fr))' }
        : undefined,
    },
    (props.itens || []).map((it, i) => {
      var vazio = it.valor == null || it.valor === '';
      return h(
        'div',
        { key: i, className: 'pp-field', style: it.largo ? { gridColumn: '1 / -1' } : undefined },
        h(
          'dt',
          { className: 'pp-field__rotulo' },
          it.rotulo,
          it.fonte ? h(SourceTag, { fonte: it.fonte }) : null,
        ),
        h(
          'dd',
          { className: cx('pp-field__valor', it.mono && 'pp-field__valor--mono') },
          vazio ? h('span', { className: 'pp-field__vazio' }, 'Não encontrado') : it.valor,
        ),
      );
    }),
  );
}

/* ---------- LeadHeader ---------- */
function LeadHeader(props) {
  return h(
    'header',
    { className: 'pp-leadhead' },
    h(
      'div',
      { className: 'pp-leadhead__top' },
      h('span', { className: 'pp-leadhead__tile' }, h(Icon, { name: 'store', size: 22 })),
      h(
        'div',
        { className: 'pp-leadhead__id' },
        h('h2', { className: 'pp-leadhead__nome' }, props.nome),
        h(
          'p',
          { className: 'pp-leadhead__sub' },
          props.razaoSocial ? h('span', null, props.razaoSocial) : null,
          props.cnpj ? h('span', { className: 'pp-mono' }, props.cnpj) : null,
        ),
      ),
      props.score != null ? h(ScoreBadge, { faixa: props.faixa, score: props.score, size: 'lg' }) : null,
    ),
    h(
      'div',
      { className: 'pp-leadhead__chips' },
      props.etapa ? h(Badge, { tone: 'brand' }, props.etapa) : null,
      props.nicho ? h(Badge, { icon: 'store' }, props.nicho) : null,
      props.cidade ? h(Badge, { icon: 'map-pin' }, props.cidade) : null,
      props.sinalEntrega ? h(Badge, { icon: 'package' }, props.sinalEntrega) : null,
      props.distancia ? h(Badge, { tone: 'outline' }, props.distancia) : null,
    ),
    props.motivo
      ? h(
          'p',
          { className: 'pp-leadhead__motivo' },
          h(Icon, { name: 'bot', size: 16, className: 'pp-muted' }),
          h('span', null, h('b', null, 'Por que faixa ' + props.faixa + ': '), props.motivo),
        )
      : null,
    props.acoes ? h('div', { className: 'pp-leadhead__acoes' }, props.acoes) : null,
  );
}

/* ---------- EnrichmentTrail ---------- */
var TRILHA = {
  encontrado: { icone: 'check', rotulo: 'Encontrado' },
  sem_resultado: { icone: null, rotulo: 'Sem resultado' },
  pulada: { icone: 'circle-dashed', rotulo: 'Pulada' },
  erro: { icone: 'x', rotulo: 'Falhou' },
  em_andamento: { icone: 'loader', rotulo: 'Buscando' },
};
function EnrichmentTrail(props) {
  return h(
    'ol',
    { className: 'pp-trail' },
    (props.camadas || []).map((c, i) => {
      var t = TRILHA[c.status] || TRILHA.sem_resultado;
      return h(
        'li',
        { key: i, className: 'pp-trail__item pp-trail__item--' + c.status },
        h(
          'span',
          { className: 'pp-trail__mark' },
          t.icone
            ? h(Icon, {
                name: t.icone,
                size: c.status === 'pulada' ? 20 : 12,
                strokeWidth: c.status === 'pulada' ? 1.5 : 3,
                spin: c.status === 'em_andamento',
              })
            : null,
        ),
        h(
          'div',
          null,
          h(
            'div',
            { className: 'pp-trail__linha' },
            h('span', { className: 'pp-trail__nome' }, c.nome),
            h('span', { className: 'pp-trail__estado' }, t.rotulo),
            c.fonte ? h(SourceTag, { fonte: c.fonte }) : null,
          ),
          c.detalhe ? h('p', { className: 'pp-trail__detalhe' }, c.detalhe) : null,
        ),
      );
    }),
  );
}

/* ---------- Timeline ---------- */
var TL = {
  mensagem_enviada: 'send',
  mensagem_recebida: 'message-circle',
  etapa: 'arrow-right',
  nota: 'sticky-note',
  ligacao: 'phone',
  email: 'mail',
  ia: 'bot',
  tarefa: 'calendar',
};
function Timeline(props) {
  return h(
    'ol',
    { className: 'pp-timeline' },
    (props.itens || []).map((it, i) => {
      var msg = it.tipo === 'mensagem_enviada' || it.tipo === 'mensagem_recebida' || it.tipo === 'email';
      return h(
        'li',
        { key: i, className: 'pp-tl pp-tl--' + it.tipo },
        h('span', { className: 'pp-tl__mark' }, h(Icon, { name: TL[it.tipo] || 'circle-dashed', size: 14 })),
        h(
          'div',
          null,
          h(
            'div',
            { className: 'pp-tl__linha' },
            h('span', { className: 'pp-tl__titulo' }, it.titulo),
            h('time', { className: 'pp-tl__quando' }, it.quando),
          ),
          it.texto
            ? h(
                'div',
                { className: 'pp-tl__corpo' },
                msg
                  ? h('p', { className: 'pp-msg' }, it.texto)
                  : h('p', { className: 'pp-trail__detalhe', style: { marginTop: 0 } }, it.texto),
              )
            : null,
        ),
      );
    }),
  );
}

/* ---------- LeadCard ---------- */
function LeadCard(props) {
  var c = props.melhorContato;
  var canal = c ? CANAIS[c.canal] || CANAIS.telefone : null;
  return h(
    'button',
    {
      type: 'button',
      className: cx('pp-card', props.selecionado && 'pp-card--selecionado'),
      onClick: props.onClick,
      'aria-pressed': props.selecionado ? 'true' : 'false',
    },
    h(
      'span',
      { className: 'pp-card__top' },
      h(
        'span',
        { style: { minWidth: 0 } },
        h('span', { className: 'pp-card__nome', style: { display: 'block' } }, props.nome),
        h(
          'span',
          { className: 'pp-card__sub', style: { display: 'block' } },
          [props.cidade, props.nicho].filter(Boolean).join(' · '),
        ),
      ),
      h(ScoreBadge, { faixa: props.faixa, score: props.score }),
    ),
    c
      ? h(
          'span',
          { className: 'pp-card__contato' },
          h(Icon, { name: canal.icone, size: 14, label: canal.rotulo }),
          h('span', null, c.valor),
          h(ContactStatus, { status: c.status, compact: true }),
        )
      : h('span', { className: 'pp-card__sub' }, 'Sem contato do decisor'),
    h(
      'span',
      { className: 'pp-card__rodape' },
      props.proximoPasso
        ? h('span', null, h(Icon, { name: 'calendar', size: 12 }), props.proximoPasso)
        : h('span', null),
      props.ultimaAtividade ? h('span', { className: 'pp-mono' }, props.ultimaAtividade) : null,
    ),
  );
}

/* ---------- LeadTable ---------- */
function LeadTable(props) {
  var leads = props.leads || [];
  var sel = props.selecionado;
  var marcados = props.marcados || [];
  return h(
    'div',
    { className: 'pp-tablewrap' },
    h(
      'table',
      { className: 'pp-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h(
            'th',
            { className: 'pp-col-check' },
            h('input', { type: 'checkbox', 'aria-label': 'Selecionar todos' }),
          ),
          h('th', null, 'Empresa'),
          h('th', null, 'Score'),
          h('th', null, 'Melhor contato'),
          props.compacta ? null : h('th', null, 'Decisor'),
          h('th', null, 'Etapa'),
          props.compacta ? null : h('th', null, 'Atividade'),
        ),
      ),
      h(
        'tbody',
        null,
        leads.map((l) => {
          var c = l.melhorContato;
          var canal = c ? CANAIS[c.canal] || CANAIS.telefone : null;
          return h(
            'tr',
            {
              key: l.id,
              'aria-selected': sel === l.id ? 'true' : 'false',
              onClick: () => {
                if (props.onSelect) props.onSelect(l.id);
              },
            },
            h(
              'td',
              {
                className: 'pp-col-check',
                onClick: (e) => {
                  e.stopPropagation();
                },
              },
              h('input', {
                type: 'checkbox',
                defaultChecked: marcados.indexOf(l.id) >= 0,
                'aria-label': 'Selecionar ' + l.nome,
              }),
            ),
            h(
              'td',
              null,
              h(
                'span',
                { className: 'pp-cell-empresa' },
                h('b', null, l.nome),
                h('span', null, [l.cidade, l.nicho].filter(Boolean).join(' · ')),
              ),
            ),
            h('td', null, h(ScoreBadge, { faixa: l.faixa, score: l.score })),
            h(
              'td',
              null,
              c
                ? h(
                    'span',
                    { className: 'pp-cell-contato' },
                    h(Icon, { name: canal.icone, size: 14, label: canal.rotulo }),
                    h('span', { className: 'pp-cell-valor', title: c.valor }, c.valor),
                    h(ContactStatus, { status: c.status, compact: true }),
                  )
                : h('span', { className: 'pp-muted' }, 'Sem contato'),
            ),
            props.compacta
              ? null
              : h(
                  'td',
                  null,
                  l.decisor
                    ? h(
                        'span',
                        { className: 'pp-cell-empresa' },
                        h('b', null, l.decisor.nome),
                        h('span', null, l.decisor.cargo),
                      )
                    : h('span', { className: 'pp-muted' }, 'Não encontrado'),
                ),
            h('td', null, h(Badge, { tone: l.etapaTom }, l.etapa)),
            props.compacta
              ? null
              : h('td', null, h('span', { className: 'pp-cell-quando' }, l.ultimaAtividade)),
          );
        }),
      ),
    ),
  );
}

/* ---------- Tabs ---------- */
function Tabs(props) {
  var estado = React.useState(props.ativo || (props.itens && props.itens[0] && props.itens[0].id));
  var ativo = props.onChange ? props.ativo : estado[0];
  var mudar = (id) => {
    if (props.onChange) props.onChange(id);
    else estado[1](id);
  };
  return h(
    'div',
    { className: 'pp-tabs', role: 'tablist', 'aria-label': props.rotulo },
    (props.itens || []).map((t) =>
      h(
        'button',
        {
          key: t.id,
          type: 'button',
          role: 'tab',
          className: 'pp-tab',
          'aria-selected': ativo === t.id ? 'true' : 'false',
          onClick: () => {
            mudar(t.id);
          },
        },
        t.rotulo,
        t.contagem != null ? h('span', { className: 'pp-tab__n' }, t.contagem) : null,
      ),
    ),
  );
}

/* ---------- TextField ---------- */
function TextField(props) {
  var gerado = React.useId();
  var id = props.id || gerado;
  var rest = Object.assign({}, props);
  ['rotulo', 'dica', 'erro', 'icone', 'rotuloOculto', 'className', 'id'].forEach((k) => {
    delete rest[k];
  });
  var msg = props.erro || props.dica;
  return h(
    'div',
    { className: cx('pp-tf', props.icone && 'pp-tf--icone', props.erro && 'pp-tf--erro', props.className) },
    h('label', { htmlFor: id, className: cx('pp-tf__label', props.rotuloOculto && 'pp-sr') }, props.rotulo),
    h(
      'div',
      { className: 'pp-tf__wrap' },
      props.icone ? h(Icon, { name: props.icone, size: 16, className: 'pp-tf__icon' }) : null,
      h(
        'input',
        Object.assign(
          {
            id: id,
            className: 'pp-input',
            'aria-invalid': props.erro ? 'true' : undefined,
            'aria-describedby': msg ? id + '-msg' : undefined,
          },
          rest,
        ),
      ),
    ),
    msg
      ? h(
          'span',
          { id: id + '-msg', className: 'pp-tf__dica' },
          props.erro ? h(Icon, { name: 'circle-x', size: 14 }) : null,
          msg,
        )
      : null,
  );
}

/* ---------- Stat ---------- */
function Stat(props) {
  return h(
    'div',
    { className: 'pp-stat' },
    h('span', { className: 'pp-stat__rotulo' }, props.rotulo),
    h('span', { className: 'pp-stat__valor' }, props.valor),
    props.delta
      ? h(
          'span',
          { className: cx('pp-stat__delta', props.tendencia && 'pp-stat__delta--' + props.tendencia) },
          props.tendencia
            ? h(Icon, { name: props.tendencia === 'sobe' ? 'trending-up' : 'trending-down', size: 14 })
            : null,
          props.delta,
        )
      : null,
  );
}

/* ---------- EmptyState ---------- */
function EmptyState(props) {
  return h(
    'div',
    { className: 'pp-empty' },
    h('span', { className: 'pp-empty__icon' }, h(Icon, { name: props.icone || 'inbox', size: 20 })),
    h('h3', { className: 'pp-empty__titulo' }, props.titulo),
    props.texto ? h('p', { className: 'pp-empty__texto' }, props.texto) : null,
    props.acao || null,
  );
}

export const ICONES = Object.keys(ICONS);
export {
  Avatar,
  Badge,
  Button,
  CANAIS,
  ContactRow,
  ContactStatus,
  DataFields,
  DecisorCard,
  EmptyState,
  EnrichmentTrail,
  FONTES,
  Icon,
  LeadCard,
  LeadHeader,
  LeadTable,
  Panel,
  ScoreBadge,
  SourceTag,
  Stat,
  Tabs,
  TextField,
  Timeline,
};
