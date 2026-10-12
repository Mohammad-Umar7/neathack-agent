// Inline stroke icons (24x24, currentColor).

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS = {
  play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>'),
  stepBack: svg('<path d="M18 5v14L8 12z" fill="currentColor" stroke="none"/><path d="M6 5v14"/>'),
  stepFwd: svg('<path d="M6 5v14l10-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>'),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  think: svg('<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
  read: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  tests: svg('<path d="M9 3h6"/><path d="M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 14h9"/>'),
  cex: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5L16 16"/><path d="M11 8v3.5M11 14h.01"/>'),
  simulate: svg('<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>'),
  prove: svg('<path d="M12 3l7.5 3v6c0 4.5-3.2 7.8-7.5 9-4.3-1.2-7.5-4.5-7.5-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  patch: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  rollback: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  submit: svg('<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>'),
  error: svg('<path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  recover: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M4.9 4.9l4.3 4.3M14.8 14.8l4.3 4.3M14.8 9.2l4.3-4.3M4.9 19.1l4.3-4.3"/>'),
  tool: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  github: svg('<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>'),
  trace: svg('<path d="M3 6h7M3 12h11M3 18h5"/><circle cx="14" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="12" cy="18" r="2"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  book: svg('<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 19.5V4.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  box: svg('<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  hand: svg('<path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4 15a1.6 1.6 0 0 1 2.5-2L8 14.5"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  door: svg('<path d="M4 21h16"/><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M14 12h.01"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  sparkle: svg('<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3.5 3.5M15.5 15.5L19 19M5 19l3.5-3.5M15.5 8.5L19 5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
};

export function stepIcon(kind: string, tool?: string): string {
  if (kind === 'think') return ICONS.think;
  if (kind === 'error') return ICONS.error;
  if (kind === 'recover') return ICONS.recover;
  if (kind === 'rollback') return ICONS.rollback;
  if (kind === 'submit') return ICONS.submit;
  if (kind === 'patch') return ICONS.patch;
  switch (tool) {
    case 'read_program':
    case 'read_spec':
      return ICONS.read;
    case 'run_tests':
      return ICONS.tests;
    case 'get_counterexample':
      return ICONS.cex;
    case 'simulate':
      return ICONS.simulate;
    case 'prove':
      return ICONS.prove;
    case 'propose_patch':
      return ICONS.patch;
    case 'rollback':
      return ICONS.rollback;
    case 'submit':
      return ICONS.submit;
  }
  return ICONS.tool;
}
