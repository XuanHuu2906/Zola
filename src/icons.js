/* Minimal inline line icons. No remote CDN or network requests. */
window.GlassIcons = (function () {
  const paths = {
    message: '<path d="M21 11.4a8.4 8.4 0 0 1-8.4 8.4 8.8 8.8 0 0 1-4-.96L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.4Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    group: '<path d="M15 19v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8" cy="6" r="4"/><path d="M23 19v-2a4 4 0 0 0-3-3.87M17 2.13a4 4 0 0 1 0 7.75M18 12h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cloud: '<path d="M20 17.5a4.5 4.5 0 0 0-1-8.9 7 7 0 0 0-13.6 1.6A4.1 4.1 0 0 0 6 18.5h14"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    settings: '<path d="M12 3.5a2 2 0 0 1 2 2l.2.7 1.4.8.7-.2a2 2 0 0 1 2.6.9l.8 1.4a2 2 0 0 1-.5 2.7l-.6.6v1.6l.6.6a2 2 0 0 1 .5 2.7l-.8 1.4a2 2 0 0 1-2.6.9l-.7-.2-1.4.8-.2.7a2 2 0 0 1-2 2h-1.6a2 2 0 0 1-2-2l-.2-.7-1.4-.8-.7.2a2 2 0 0 1-2.6-.9l-.8-1.4a2 2 0 0 1 .5-2.7l.6-.6v-1.6l-.6-.6a2 2 0 0 1-.5-2.7l.8-1.4a2 2 0 0 1 2.6-.9l.7.2 1.4-.8.2-.7a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="2.9"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 0 1 5.1 1.25c0 2-2.6 2.2-2.6 4"/><path d="M12 17.8h.01"/>',
    search: '<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16.2 16.2 4.6 4.6"/>',
    sliders: '<path d="M4 7h8M17 7h3M4 17h3M12 17h8"/><circle cx="14.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>',
    phone: '<path d="M22 16.6v3.1a2 2 0 0 1-2.2 2A19 19 0 0 1 2.3 4.2 2 2 0 0 1 4.3 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.8L7.5 10a15.4 15.4 0 0 0 6.5 6.5l1.5-1.7a2 2 0 0 1 1.8-.6l3 .5a2 2 0 0 1 1.7 1.9Z"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    paperclip: '<path d="m20 11.4-7.6 7.6a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7L10 16.7a1.6 1.6 0 0 1-2.3-2.3l7.6-7.6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.6" cy="8.6" r="1.6"/><path d="m21 16-5.5-5.5L5 21"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5a5 5 0 0 0 8 0M8.5 9h.01M15.5 9h.01"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/>',
    send: '<path d="m22 2-7.3 20-4.3-8.4L2 9.3 22 2Z"/><path d="M10.4 13.6 22 2"/>',
    pin: '<path d="m16 3 5 5-3 1.5-3 4.5 1 3-1 1-3-1-4.5 3-1.5 3-5-5 3-1.5 3-4.5-1-3 1-1 3 1 4.5-3L16 3Z"/>',
    briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13a27 27 0 0 0 18 0"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    back: '<path d="m15 18-6-6 6-6M9 12h12"/>',
    x: '<path d="M5 5 19 19M19 5 5 19"/>',
    moon: '<path d="M20 16a8.5 8.5 0 0 1-12-12 8.5 8.5 0 1 0 12 12Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    checkcheck: '<path d="m2 12 5 5L18 6M11 17l2 2L23 8"/>',
    sparkle: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    arrowleft: '<path d="m14 5-7 7 7 7M7 12h14"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21h4"/>',
    shield: '<path d="m12 2 8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4Z"/><path d="m9 12 2 2 4-4"/>',
    rotate: '<path d="M3 11a9 9 0 1 1 2.6 6.4M3 4v7h7"/>',
    edit: '<path d="M12 20h9M4 16l12.5-12.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
  };
  function icon(name, size = 20, cls = '') {
    return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  }
  return { icon };
})();
