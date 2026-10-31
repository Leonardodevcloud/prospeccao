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
  /* Reuniões por vídeo (Lucide 1.64.0). */
  'video': [
    ['path', { d: 'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5' }],
    ['rect', { x: '2', y: '6', width: '14', height: '12', rx: '2' }],
  ],
  'video-off': [
    ['path', { d: 'M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196' }],
    ['path', { d: 'M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'm2 2 20 20' }],
  ],
  'mic-off': [
    ['path', { d: 'M12 19v3' }],
    ['path', { d: 'M15 9.34V5a3 3 0 0 0-5.68-1.33' }],
    ['path', { d: 'M16.95 16.95A7 7 0 0 1 5 12v-2' }],
    ['path', { d: 'M18.89 13.23A7 7 0 0 0 19 12v-2' }],
    ['path', { d: 'm2 2 20 20' }],
    ['path', { d: 'M9 9v3a3 3 0 0 0 5.12 2.12' }],
  ],
  'monitor-up': [
    ['path', { d: 'm9 10 3-3 3 3' }],
    ['path', { d: 'M12 13V7' }],
    ['rect', { width: '20', height: '14', x: '2', y: '3', rx: '2' }],
    ['path', { d: 'M12 17v4' }],
    ['path', { d: 'M8 21h8' }],
  ],
  'monitor-off': [
    ['path', { d: 'M12 17v4' }],
    ['path', { d: 'M17 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 1.184-1.826' }],
    ['path', { d: 'm2 2 20 20' }],
    ['path', { d: 'M8 21h8' }],
    ['path', { d: 'M8.656 3H20a2 2 0 0 1 2 2v10a2 2 0 0 1-.293 1.042' }],
  ],
  'hand': [
    ['path', { d: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2' }],
    ['path', { d: 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2' }],
    ['path', { d: 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8' }],
    ['path', { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15' }],
  ],
  'key-round': [
    ['path', { d: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z' }],
    ['circle', { cx: '16.5', cy: '7.5', r: '.5', fill: 'currentColor' }],
  ],
  'webhook': [
    ['path', { d: 'M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2' }],
    ['path', { d: 'm6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06' }],
    ['path', { d: 'm12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8' }],
  ],
  'plug': [
    ['path', { d: 'M12 22v-5' }],
    ['path', { d: 'M15 8V2' }],
    ['path', { d: 'M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z' }],
    ['path', { d: 'M9 8V2' }],
  ],
  'pause': [
    ['rect', { x: '14', y: '3', width: '5', height: '18', rx: '1' }],
    ['rect', { x: '5', y: '3', width: '5', height: '18', rx: '1' }],
  ],
  'headphones': [
    ['path', { d: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3' }],
  ],
  'phone-incoming': [
    ['path', { d: 'M16 2v6h6' }],
    ['path', { d: 'm22 2-6 6' }],
    ['path', { d: 'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384' }],
  ],
  'phone-off': [
    ['path', { d: 'M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272' }],
    ['path', { d: 'M22 2 2 22' }],
    ['path', { d: 'M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473' }],
  ],
  'download': [
    ['path', { d: 'M12 15V3' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm7 10 5 5 5-5' }],
  ],
  'layout-grid': [
    ['rect', { width: '7', height: '7', x: '3', y: '3', rx: '1' }],
    ['rect', { width: '7', height: '7', x: '14', y: '3', rx: '1' }],
    ['rect', { width: '7', height: '7', x: '14', y: '14', rx: '1' }],
    ['rect', { width: '7', height: '7', x: '3', y: '14', rx: '1' }],
  ],
  'switch-camera': [
    ['path', { d: 'M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5' }],
    ['path', { d: 'M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
    ['path', { d: 'm18 22-3-3 3-3' }],
    ['path', { d: 'm6 2 3 3-3 3' }],
  ],
  'wifi-off': [
    ['path', { d: 'M12 20h.01' }],
    ['path', { d: 'M8.5 16.429a5 5 0 0 1 7 0' }],
    ['path', { d: 'M5 12.859a10 10 0 0 1 5.17-2.69' }],
    ['path', { d: 'M19 12.859a10 10 0 0 0-2.007-1.523' }],
    ['path', { d: 'M2 8.82a15 15 0 0 1 4.177-2.643' }],
    ['path', { d: 'M22 8.82a15 15 0 0 0-11.288-3.764' }],
    ['path', { d: 'm2 2 20 20' }],
  ],
  'refresh-cw': [
    ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
    ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
    ['path', { d: 'M8 16H3v5' }],
  ],
  'user-x': [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '9', cy: '7', r: '4' }],
    ['line', { x1: '17', x2: '22', y1: '8', y2: '13' }],
    ['line', { x1: '22', x2: '17', y1: '8', y2: '13' }],
  ],
  'lock': [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  'radio': [
    ['path', { d: 'M16.247 7.761a6 6 0 0 1 0 8.478' }],
    ['path', { d: 'M19.075 4.933a10 10 0 0 1 0 14.134' }],
    ['path', { d: 'M4.925 19.067a10 10 0 0 1 0-14.134' }],
    ['path', { d: 'M7.753 16.239a6 6 0 0 1 0-8.478' }],
    ['circle', { cx: '12', cy: '12', r: '2' }],
  ],

  'bell': [
    ['path', { d: 'M10.268 21a2 2 0 0 0 3.464 0' }],
    ['path', { d: 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326' }],
  ],
  'paperclip': [
    ['path', { d: 'M13.234 20.252 21 12.3' }],
    ['path', { d: 'm16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486' }],
  ],
  'orbit': [
    ['circle', { cx: '12', cy: '12', r: '3' }],
    ['circle', { cx: '19', cy: '5', r: '2' }],
    ['circle', { cx: '5', cy: '19', r: '2' }],
    ['path', { d: 'M10.4 21.9a10 10 0 0 0 9.941-15.416' }],
    ['path', { d: 'M13.5 2.1a10 10 0 0 0-9.841 15.416' }],
  ],
  'keyboard': [
    ['path', { d: 'M10 8h.01' }],
    ['path', { d: 'M12 12h.01' }],
    ['path', { d: 'M14 8h.01' }],
    ['path', { d: 'M16 12h.01' }],
    ['path', { d: 'M18 8h.01' }],
    ['path', { d: 'M6 8h.01' }],
    ['path', { d: 'M7 16h10' }],
    ['path', { d: 'M8 12h.01' }],
    ['rect', { width: '20', height: '16', x: '2', y: '4', rx: '2' }],
  ],
  'volume-2': [
    ['path', { d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z' }],
    ['path', { d: 'M16 9a5 5 0 0 1 0 6' }],
    ['path', { d: 'M19.364 18.364a9 9 0 0 0 0-12.728' }],
  ],
  'volume-x': [
    ['path', { d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z' }],
    ['line', { x1: '22', x2: '16', y1: '9', y2: '15' }],
    ['line', { x1: '16', x2: '22', y1: '9', y2: '15' }],
  ],
  'maximize-2': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'm21 3-7 7' }],
    ['path', { d: 'm3 21 7-7' }],
    ['path', { d: 'M9 21H3v-6' }],
  ],
  'bar-chart-3': [
    ['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' }],
    ['path', { d: 'M18 17V9' }],
    ['path', { d: 'M13 17V5' }],
    ['path', { d: 'M8 17v-3' }],
  ],
  'database': [
    ['ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' }],
    ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }],
    ['path', { d: 'M3 12A9 3 0 0 0 21 12' }],
  ],
  'table-2': [
    ['path', { d: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18' }],
  ],
  'mic': [
    ['path', { d: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' }],
    ['path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }],
    ['line', { x1: '12', x2: '12', y1: '19', y2: '22' }],
  ],
  'square': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ],
  'user-plus': [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '9', cy: '7', r: '4' }],
    ['line', { x1: '19', x2: '19', y1: '8', y2: '14' }],
    ['line', { x1: '22', x2: '16', y1: '11', y2: '11' }],
  ],
  'check-check': [
    ['path', { d: 'M18 6 7 17l-5-5' }],
    ['path', { d: 'm22 10-7.5 7.5L13 16' }],
  ],
  'calendar-plus': [
    ['path', { d: 'M8 2v4' }],
    ['path', { d: 'M16 2v4' }],
    ['path', { d: 'M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8' }],
    ['path', { d: 'M3 10h18' }],
    ['path', { d: 'M16 19h6' }],
    ['path', { d: 'M19 16v6' }],
  ],
  'calendar-clock': [
    ['path', { d: 'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5' }],
    ['path', { d: 'M16 2v4' }],
    ['path', { d: 'M8 2v4' }],
    ['path', { d: 'M3 10h5' }],
    ['path', { d: 'M17.5 17.5 16 16.3V14' }],
    ['circle', { cx: '16', cy: '16', r: '6' }],
  ],
  'play': [
    ['polygon', { points: '6 3 20 12 6 21 6 3' }],
  ],
  'image': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }],
    ['circle', { cx: '9', cy: '9', r: '2' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
  ],
  'file-down': [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
    ['path', { d: 'M12 18v-6' }],
    ['path', { d: 'm9 15 3 3 3-3' }],
  ],
  'settings': [
    ['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  'log-out': [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['polyline', { points: '16 17 21 12 16 7' }],
    ['line', { x1: '21', x2: '9', y1: '12', y2: '12' }],
  ],
  'sun': [
    ['circle', { cx: '12', cy: '12', r: '4' }],
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'M12 20v2' }],
    ['path', { d: 'm4.93 4.93 1.41 1.41' }],
    ['path', { d: 'm17.66 17.66 1.41 1.41' }],
    ['path', { d: 'M2 12h2' }],
    ['path', { d: 'M20 12h2' }],
    ['path', { d: 'm6.34 17.66-1.41 1.41' }],
    ['path', { d: 'm19.07 4.93-1.41 1.41' }],
  ],
  'rotate-ccw': [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  'link': [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
  ],
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
  'chevron-left': [['path', { d: 'm15 18-6-6 6-6' }]],
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
  'layout-dashboard': [
    ['rect', { width: '7', height: '9', x: '3', y: '3', rx: '1' }],
    ['rect', { width: '7', height: '5', x: '14', y: '3', rx: '1' }],
    ['rect', { width: '7', height: '9', x: '14', y: '12', rx: '1' }],
    ['rect', { width: '7', height: '5', x: '3', y: '16', rx: '1' }],
  ],
  activity: [['path', { d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2' }]],
  navigation: [['polygon', { points: '3 11 22 2 13 21 11 13 3 11' }]],
  route: [
    ['circle', { cx: '6', cy: '19', r: '3' }],
    ['path', { d: 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15' }],
    ['circle', { cx: '18', cy: '5', r: '3' }],
  ],
  'grip-vertical': [
    ['circle', { cx: '9', cy: '12', r: '1' }],
    ['circle', { cx: '9', cy: '5', r: '1' }],
    ['circle', { cx: '9', cy: '19', r: '1' }],
    ['circle', { cx: '15', cy: '12', r: '1' }],
    ['circle', { cx: '15', cy: '5', r: '1' }],
    ['circle', { cx: '15', cy: '19', r: '1' }],
  ],
  'arrow-up': [
    ['path', { d: 'm5 12 7-7 7 7' }],
    ['path', { d: 'M12 19V5' }],
  ],
  'arrow-down': [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'm19 12-7 7-7-7' }],
  ],
  smartphone: [
    ['rect', { width: '14', height: '20', x: '5', y: '2', rx: '2', ry: '2' }],
    ['path', { d: 'M12 18h.01' }],
  ],
  'locate-fixed': [
    ['line', { x1: '2', x2: '5', y1: '12', y2: '12' }],
    ['line', { x1: '19', x2: '22', y1: '12', y2: '12' }],
    ['line', { x1: '12', x2: '12', y1: '2', y2: '5' }],
    ['line', { x1: '12', x2: '12', y1: '19', y2: '22' }],
    ['circle', { cx: '12', cy: '12', r: '7' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  'skip-forward': [
    ['polygon', { points: '5 4 15 12 5 20 5 4' }],
    ['line', { x1: '19', x2: '19', y1: '5', y2: '19' }],
  ],
  'trash-2': [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }],
    ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }],
    ['line', { x1: '10', x2: '10', y1: '11', y2: '17' }],
    ['line', { x1: '14', x2: '14', y1: '11', y2: '17' }],
  ],
  sparkles: [
    [
      'path',
      {
        d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
      },
    ],
    ['path', { d: 'M20 2v4' }],
    ['path', { d: 'M22 4h-4' }],
    ['circle', { cx: '4', cy: '20', r: '2' }],
  ],
  upload: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '17 8 12 3 7 8' }],
    ['line', { x1: '12', x2: '12', y1: '3', y2: '15' }],
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
  base_paga: 'Base paga',
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
  base_paga: 'Base de dados paga (Direct Data), atualizada',
};

var STATUS = {
  verificado: { icone: 'badge-check', rotulo: 'Confirmado' },
  nao_verificado: { icone: 'circle-dashed', rotulo: 'Fonte única' },
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
  // "@loja" ou "instagram.com/loja": o link vai para o perfil, não para "https://@loja".
  if (canal === 'instagram') {
    var usuario = String(valor)
      .replace(/^@/, '')
      .replace(/^(www\.)?instagram\.com\//i, '')
      .replace(/\/.*$/, '');
    return 'https://www.instagram.com/' + usuario + '/';
  }
  if (canal === 'linkedin' && !/linkedin\.com/i.test(valor)) return 'https://www.linkedin.com/in/' + valor;
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
      props.acoes || null,
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
          props.principal ? h(Badge, { tone: 'brand' }, 'Começar por aqui') : null,
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
      props.acoes || null,
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
