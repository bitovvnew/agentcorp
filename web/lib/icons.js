// Hand-drawn 16px stroke icons. One visual language, no emoji.
const P = {
  play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M5 3.5v9M11 3.5v9"/>',
  live: '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="6"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  upload: '<path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10"/>',
  bolt: '<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>',
  board: '<path d="M2 3.5h12v7H2zM5.5 14l2.5-3.5 2.5 3.5"/>',
  card: '<path d="M2 3.5h12v9H2zM2 6.5h12M4.5 10h3"/>',
  deck: '<path d="M3 2.5h10v8H3zM8 10.5v3M5.5 13.5h5M5.5 5.5h5M5.5 8h3"/>',
  film: '<path d="M2 3.5h12v9H2zM5 3.5v9M11 3.5v9M2 6.5h3M2 9.5h3M11 6.5h3M11 9.5h3"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
  next: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  prev: '<path d="M10 3.5 5.5 8 10 12.5"/>',
  check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
  warn: '<path d="M8 2 14.5 13.5h-13zM8 6.5v3.5M8 11.6v.1"/>',
  dead: '<path d="M4 4l8 8M12 4l-8 8"/>',
  unicorn: '<path d="M8 1.5 9.6 6.2 14.5 6.3 10.6 9.2 12 14 8 11.1 4 14 5.4 9.2 1.5 6.3 6.4 6.2z"/>',
  money: '<path d="M8 1.5v13M11 4.5H6.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H5"/>',
  people: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5c.6-2.5 2.3-4 4.5-4s3.9 1.5 4.5 4M11 3.2a2.4 2.4 0 0 1 0 4.6M12.5 9.6c1.1.6 1.8 1.9 2 3.9"/>',
  ship: '<path d="M2 10.5h12l-1.8 3H3.8zM8 2.5v8M8 3l4 6H8"/>',
  pivot: '<path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5M11.5 1.5v3h-3M4.5 14.5v-3h3"/>',
  chart: '<path d="M2 13.5h12M3.5 11l3-4 2.5 2.5 4-5.5"/>',
  globe: '<circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4"/>',
  key: '<circle cx="5" cy="10.5" r="3"/><path d="M7.2 8.3 13.5 2M11 4.5l2 2M9.5 6l1.5 1.5"/>',
  cpu: '<path d="M4.5 4.5h7v7h-7zM6.5 1.5v3M9.5 1.5v3M6.5 11.5v3M9.5 11.5v3M1.5 6.5h3M1.5 9.5h3M11.5 6.5h3M11.5 9.5h3"/>',
  shield: '<path d="M8 1.5 13.5 3.5v4c0 3.4-2.3 5.9-5.5 7-3.2-1.1-5.5-3.6-5.5-7v-4z"/>',
  news: '<path d="M2.5 3.5h9v10h-9zM11.5 6h2v6a1.5 1.5 0 0 1-3 0M4.5 6h5M4.5 8.5h5M4.5 11h3"/>',
  chat: '<path d="M2 3h12v8H6l-3 2.5V11H2z"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

/** Map an event kind to its glyph. */
export const KIND_ICON = {
  raise: 'money', bridge: 'money', raise_rejected: 'money', hire: 'people', fire: 'dead', quit: 'people',
  ceo_ousted: 'board', board: 'board', review: 'people', ship: 'ship', bounty: 'check', pivot: 'pivot', price: 'chart',
  milestone: 'chart', unicorn: 'unicorn', bankrupt: 'dead', market: 'news', shock: 'bolt', memo: 'chat', chat: 'chat',
  focus: 'chart', founded: 'ship', brain_error: 'warn', budget: 'shield',
};
