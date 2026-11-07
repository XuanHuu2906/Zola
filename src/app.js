/*
 * Zalo Apple Glass UI — local visual/interaction prototype.
 * No Zalo SDK, login, API, network, Electron injection, credentials or file uploads.
 * All names, conversations and content below are fictional demo data.
 */
(function () {
  'use strict';
  const { escapeHTML: e, selectChats, formatClock, safeFileName, formatFileSize } = window.GlassLogic;
  const { icon: ic } = window.GlassIcons;
  const $app = document.getElementById('app');

  const chats = [
    {
      id: 'minh-anh', name: 'Minh Anh', avatar: 'assets/avatar-minh-anh.png',
      online: true, pinned: true, unread: 0, isGroup: false, isWork: false,
      time: '14:27', preview: 'Ừm, tối mình họp nhé!',
      messages: [
        { id: 1, from: 'them', text: 'Chiều nay bạn rảnh không?\nMình cần trao đổi chút về dự án ấy.', time: '13:52' },
        { id: 2, from: 'me', text: 'Mình rảnh nhé!\nBạn gửi tài liệu trước cho mình xem với.', time: '13:55' },
        { id: 3, from: 'them', attachment: 'Kế hoạch dự án v2.pdf', size: '2,4 MB · PDF', time: '13:56' },
        { id: 4, from: 'them', text: 'Đây là bản cập nhật mới nhất nhé!\nBạn xem qua giúp mình, có gì góp ý thêm nha.', time: '13:56' },
        { id: 5, from: 'me', text: 'Ok, mình xem ngay đây.\nTối mình họp nhé!', time: '14:20', reaction: '👍 1' },
        { id: 6, from: 'them', text: 'Ừm, tối mình họp nhé!', time: '14:27', reaction: '❤️ 1' }
      ]
    },
    {
      id: 'du-an', name: 'Nhóm Dự án', avatar: null, online: false, pinned: false,
      unread: 0, isGroup: true, isWork: true, time: '13:40',
      preview: 'Nam: Đã cập nhật file thiết kế...', messages: [
        { id: 7, from: 'them', text: 'Nam: Đã cập nhật file thiết kế mới vào thư mục chung.', time: '13:40' },
        { id: 8, from: 'me', text: 'Cảm ơn cả nhóm! Mình sẽ kiểm tra trong hôm nay.', time: '13:42' }
      ]
    },
    {
      id: 'gia-dinh', name: 'Gia đình ❤️', avatar: 'assets/avatar-family.png',
      online: false, pinned: false, unread: 3, isGroup: true, isWork: false,
      time: '08:22', preview: 'Mẹ: Cuối tuần về ăn cơm nhé!', messages: [
        { id: 9, from: 'them', text: 'Mẹ: Cuối tuần về ăn cơm nhé!', time: '08:22' },
        { id: 10, from: 'them', text: 'Cả nhà nhớ về sớm nhé ❤️', time: '08:23' }
      ]
    },
    {
      id: 'cong-viec', name: 'Công việc', avatar: null, online: false,
      pinned: false, unread: 0, isGroup: true, isWork: true,
      time: 'Hôm qua', preview: 'Bạn: Gửi báo cáo cuối ngày nhé.', messages: [
        { id: 11, from: 'me', text: 'Gửi báo cáo cuối ngày nhé.', time: '17:44' }
      ]
    },
    {
      id: 'hoang-long', name: 'Hoàng Long', avatar: 'assets/avatar-hoang-long.png',
      online: false, pinned: false, unread: 0, isGroup: false, isWork: false,
      time: 'Hôm qua', preview: 'Ok bạn!', messages: [
        { id: 12, from: 'them', text: 'Ok bạn!', time: '18:15' }
      ]
    },
    {
      id: 'zalo', name: 'Zalo Official Account', avatar: null,
      verified: true, pinned: false, unread: 0, isGroup: false, isWork: false,
      time: 'Thứ 3', preview: 'Có gì mới trong Zalo? ✨', messages: [
        { id: 13, from: 'them', text: 'Đây là tin nhắn mẫu, không đến từ Zalo.', time: '10:20' }
      ]
    },
    {
      id: 'lop', name: 'Lớp 12A1', avatar: 'assets/avatar-class.png',
      online: false, pinned: false, unread: 0, isGroup: true, isWork: false,
      time: 'Thứ 2', preview: 'Lan: Ảnh hôm nay nè 📸', messages: [
        { id: 14, from: 'them', text: 'Lan: Ảnh hôm nay nè 📸', time: '09:07' }
      ]
    }
  ];

  const NAV = [
    { id: 'chats', title: 'Tin nhắn', icon: 'message' },
    { id: 'contacts', title: 'Danh bạ', icon: 'users' },
    { id: 'groups', title: 'Nhóm', icon: 'group' },
    { id: 'journal', title: 'Nhật ký', icon: 'clock', dot: true },
    { id: 'cloud', title: 'Cloud', icon: 'cloud' },
    { id: 'tools', title: 'Công cụ', icon: 'grid' }
  ];

  function readPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem('zalo-glass-prototype-prefs') || '{}');
      return { theme: raw.theme === 'light' ? 'light' : 'dark',
        glass: Math.min(95, Math.max(15, Number(raw.glass) || 68)),
        motion: raw.motion !== false };
    } catch (_) { return { theme: 'dark', glass: 68, motion: true }; }
  }

  const saved = readPrefs();
  const state = {
    view: 'chats', activeId: 'minh-anh', filter: 'all', query: '',
    settings: false, menu: false, chatInfo: false, toast: '',
    theme: saved.theme, glass: saved.glass, motion: saved.motion,
    searchInChat: false, chatQuery: ''
  };

  function savePrefs() {
    try { localStorage.setItem('zalo-glass-prototype-prefs', JSON.stringify({
      theme: state.theme, glass: state.glass, motion: state.motion
    })); } catch (_) { /* UI still works without storage. */ }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.setProperty('--glass-opacity', String(state.glass / 100));
    document.documentElement.classList.toggle('reduced-motion', !state.motion);
  }

  function getChat() { return chats.find(c => c.id === state.activeId) || chats[0]; }
  function getPreviewAvatar(chat, size = 'regular') {
    if (chat.avatar) return `<span class="avatar ${size}"><img src="${e(chat.avatar)}" alt="" />${chat.online ? '<i class="presence"></i>' : ''}</span>`;
    const emblem = chat.id === 'zalo' ? '<span class="za-mark">Zalo</span>' :
      ic(chat.isWork ? 'briefcase' : 'group', size === 'large' ? 28 : 25);
    return `<span class="avatar avatar-art avatar-${e(chat.id)} ${size}">${emblem}</span>`;
  }

  function renderRail() {
    return `<aside class="rail" aria-label="Điều hướng">
      <div class="brand"><span class="brand-logo">Z</span><span>Zalo<span class="brand-dot">.</span></span></div>
      <div class="rail-profile"><img src="assets/avatar-profile.png" alt="Ảnh đại diện demo" /><span class="presence"></span></div>
      <nav class="rail-nav" aria-label="Mục chính">
        ${NAV.map(n => `<button class="rail-button ${state.view === n.id ? 'is-active' : ''}" data-action="nav" data-view="${n.id}" aria-current="${state.view === n.id ? 'page' : 'false'}">${ic(n.icon, 23)}<span>${n.title}</span>${n.dot ? '<b class="nav-dot"></b>' : ''}</button>`).join('')}
      </nav>
      <div class="rail-foot">
        <button class="rail-button ${state.settings ? 'is-active' : ''}" data-action="settings">${ic('settings',23)}<span>Cài đặt</span></button>
        <button class="rail-button" data-action="help">${ic('help',23)}<span>Trợ giúp</span></button>
      </div>
    </aside>`;
  }

  function renderFilter() {
    const filters = [ ['all','Tất cả'],['unread','Chưa đọc'],['groups','Nhóm'],['work','Công việc'] ];
    return `<div class="filters" role="group" aria-label="Lọc hội thoại">${filters.map(([id,label]) =>
      `<button class="filter-chip ${state.filter === id ? 'selected' : ''}" data-action="filter" data-filter="${id}" aria-pressed="${state.filter === id}">${label}</button>`).join('')}</div>`;
  }

  function renderChatItem(chat) {
    const selected = state.activeId === chat.id && state.view === 'chats';
    return `<button class="conversation ${selected ? 'selected' : ''}" data-action="select-chat" data-chat="${chat.id}" aria-current="${selected ? 'true' : 'false'}">
      ${getPreviewAvatar(chat)}
      <span class="conversation-body"><span class="conversation-top"><strong>${e(chat.name)}${chat.verified ? '<span class="verified">✓</span>' : ''}</strong><time>${e(chat.time)}</time></span>
      <span class="conversation-bottom"><span>${e(chat.preview)}</span>${chat.unread ? `<b class="unread-count">${chat.unread}</b>` : chat.pinned ? ic('pin',14,'pinned-icon') : ''}</span></span>
    </button>`;
  }

  function renderConversationList() {
    const matches = selectChats(chats, state.query, state.filter);
    return matches.length ? matches.map(renderChatItem).join('') :
      `<div class="empty-list">${ic('search', 28)}<p>Không tìm thấy hội thoại</p><small>Hãy thử từ khóa hoặc bộ lọc khác.</small></div>`;
  }

  function renderListPanel() {
    return `<section class="list-panel" aria-label="Danh sách hội thoại">
      <div class="list-top"><div class="search-wrap">${ic('search',20)}<input id="chatSearch" type="search" value="${e(state.query)}" placeholder="Tìm kiếm tin nhắn, bạn bè..." aria-label="Tìm hội thoại" autocomplete="off" /><button class="filter-settings" data-action="filters-info" title="Lọc hội thoại">${ic('sliders',20)}</button></div>
      ${renderFilter()}</div>
      <div class="list-scroll" id="conversationList">${renderConversationList()}</div>
      <div class="list-foot">${ic('shield',14)} <span>Giao diện demo độc lập · Không kết nối Zalo</span></div>
    </section>`;
  }

  function messageText(message) {
    const txt = String(message.text || '');
    const found = state.searchInChat && state.chatQuery &&
      txt.toLocaleLowerCase('vi').includes(state.chatQuery.toLocaleLowerCase('vi'));
    return `<span class="bubble-copy ${found ? 'search-match' : ''}">${e(txt).replace(/\n/g,'<br>')}</span>`;
  }

  function renderMessage(message, chat) {
    const mine = message.from === 'me';
    const content = message.attachment ? `<div class="file-card"><div class="file-icon">PDF</div><div class="file-meta"><strong>${e(message.attachment)}</strong><small>${e(message.size || 'Tệp demo')}</small></div><span class="file-download" title="Tệp chỉ dùng minh họa">${ic('download',21)}</span></div>` : messageText(message);
    return `<div class="message-row ${mine ? 'outgoing' : 'incoming'}">
      ${mine ? '' : `<div class="message-mini-avatar">${getPreviewAvatar(chat, 'tiny')}</div>`}
      <div class="bubble-wrap"><div class="bubble ${message.attachment ? 'bubble-file' : ''}">${content}<div class="bubble-time">${e(message.time)}${mine ? ic('checkcheck',13) : ''}</div></div>
      ${message.reaction ? `<span class="reaction">${e(message.reaction)}</span>` : ''}</div>
    </div>`;
  }

  function renderChat() {
    const chat = getChat();
    return `<main class="chat-panel" aria-label="Nội dung hội thoại">
      <header class="chat-header">
        <div class="chat-identity">${getPreviewAvatar(chat,'large')}<span class="identity-label"><strong>${e(chat.name)}${chat.verified ? ' <span class="verified">✓</span>' : ''}</strong><small>${chat.online ? '<i class="tiny-dot"></i> Đang hoạt động' : chat.isGroup ? 'Hội thoại nhóm · Bản demo' : 'Hội thoại mẫu'}</small></span></div>
        <div class="chat-actions">
          <button class="icon-button" data-action="call" title="Gọi thoại (không kết nối)">${ic('phone',22)}</button>
          <button class="icon-button" data-action="video" title="Gọi video (không kết nối)">${ic('video',24)}</button>
          <button class="icon-button ${state.searchInChat ? 'highlight' : ''}" data-action="toggle-chat-search" title="Tìm trong cuộc hội thoại">${ic('search',23)}</button>
          <div class="menu-anchor"><button class="icon-button" data-action="more" title="Tùy chọn">${ic('more',24)}</button>
            ${state.menu ? `<div class="context-menu"><button data-action="toggle-pin">${ic('pin',16)} ${chat.pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại'}</button><button data-action="mark-unread">${ic('bell',16)} Đánh dấu chưa đọc</button><button data-action="chat-info">${ic('info',16)} Thông tin hội thoại</button></div>` : ''}</div>
        </div>
      </header>
      ${state.searchInChat ? `<div class="in-chat-search">${ic('search',17)}<input id="inChatSearch" type="search" placeholder="Tìm nội dung hội thoại mẫu..." value="${e(state.chatQuery)}" aria-label="Tìm nội dung hội thoại"/><button data-action="toggle-chat-search" aria-label="Đóng tìm kiếm">${ic('x',16)}</button></div>` : ''}
      <section class="messages" id="messagesScroll" aria-label="Các tin nhắn mẫu">
        <div class="day-label">Hôm nay</div>
        ${chat.messages.map(m => renderMessage(m,chat)).join('')}
      </section>
      <footer class="composer-zone">
        <div class="composer"><button class="composer-button" data-action="emoji" title="Thêm emoji">${ic('smile',23)}</button>
          <textarea id="messageInput" rows="1" maxlength="2000" placeholder="Nhập tin nhắn..." aria-label="Nội dung tin nhắn demo"></textarea>
          <button class="composer-button" data-action="attach" title="Chọn tệp demo">${ic('paperclip',24)}</button>
          <button class="composer-button" data-action="attach" title="Chọn hình ảnh demo">${ic('image',23)}</button>
          <button class="composer-button" data-action="voice" title="Giọng nói demo">${ic('mic',22)}</button>
          <button class="send-button" data-action="send" title="Gửi tin nhắn demo">${ic('send',20)}</button>
        </div>
        <div class="composer-hint">Nhấn Enter để gửi bản demo · Shift + Enter để xuống dòng</div>
      </footer>
    </main>`;
  }

  function renderFeaturePage() {
    const panels = {
      contacts: { icon:'users', title:'Danh bạ', sub:'Danh bạ mẫu của bản prototype', rows: chats.filter(c => !c.isGroup && c.id !== 'zalo') },
      groups: { icon:'group', title:'Nhóm', sub:'Nhóm trò chuyện trong dữ liệu demo', rows: chats.filter(c => c.isGroup) },
      journal: { icon:'clock', title:'Nhật ký', sub:'Khu vực mô phỏng cho giao diện Nhật ký', rows: [] },
      cloud: { icon:'cloud', title:'Cloud', sub:'Nơi thử nghiệm layout tệp lưu trữ', rows: [] },
      tools: { icon:'grid', title:'Công cụ', sub:'Mẫu thiết kế cho các tiện ích', rows: [] }
    };
    const p = panels[state.view] || panels.contacts;
    const content = p.rows.length ? `<div class="feature-grid">${p.rows.map(chat => `<button class="feature-card" data-action="select-chat" data-chat="${chat.id}">${getPreviewAvatar(chat,'large')}<span><strong>${e(chat.name)}</strong><small>${e(chat.isGroup ? 'Nhóm demo' : 'Liên hệ demo')}</small></span>${ic('chevron',18)}</button>`).join('')}</div>` :
      `<div class="feature-placeholder">${ic(p.icon,45)}<h3>${e(p.title)} Glass</h3><p>Đây là bố cục thử nghiệm. Chưa kết nối với dịch vụ Zalo thật.</p><button class="primary-btn" data-action="nav" data-view="chats">Về màn hình chat</button></div>`;
    return `<main class="chat-panel feature-panel"><div class="feature-head"><div class="feature-emblem">${ic(p.icon,28)}</div><div><h1>${e(p.title)}</h1><p>${e(p.sub)}</p></div></div>${content}</main>`;
  }

  function renderSettings() {
    if (!state.settings) return '';
    return `<div class="overlay" data-action="settings-backdrop"><section class="settings-modal" role="dialog" aria-modal="true" aria-label="Cài đặt giao diện">
      <div class="settings-head"><div><span class="eyebrow">PERSONALIZATION</span><h2>Apple Glass Settings</h2><p>Thiết lập chỉ lưu trên trình duyệt của bạn.</p></div><button class="icon-button" data-action="close-settings" aria-label="Đóng cài đặt">${ic('x',22)}</button></div>
      <div class="setting-row"><div><strong>Giao diện</strong><small>Chọn glass tối hoặc sáng</small></div><div class="theme-switch"><button class="${state.theme === 'dark' ? 'on' : ''}" data-action="theme" data-theme="dark" aria-label="Giao diện tối">${ic('moon',17)}</button><button class="${state.theme === 'light' ? 'on' : ''}" data-action="theme" data-theme="light" aria-label="Giao diện sáng">${ic('sun',17)}</button></div></div>
      <div class="setting-stack"><div class="setting-title"><span><strong>Độ trong suốt</strong><small>Điều chỉnh lớp kính mờ</small></span><b id="glassNumber">${state.glass}%</b></div><input type="range" id="glassSlider" min="15" max="95" step="1" value="${state.glass}" aria-label="Độ trong suốt của kính" /></div>
      <div class="setting-row"><div><strong>Hiệu ứng chuyển động</strong><small>Tắt để giảm chuyển động UI</small></div><button class="toggle ${state.motion ? 'on' : ''}" data-action="motion" role="switch" aria-checked="${state.motion}" aria-label="Bật tắt hiệu ứng chuyển động"><span></span></button></div>
      <div class="settings-warning">${ic('info',18)} Đây là prototype độc lập. Nút gọi, video và tệp không có kết nối hoặc tác động tới Zalo.</div>
      <div class="settings-footer"><button class="subtle-btn" data-action="reset">Khôi phục tùy chỉnh</button><button class="primary-btn" data-action="close-settings">Hoàn tất</button></div>
    </section></div>`;
  }

  function render() {
    applyTheme();
    $app.innerHTML = `<div class="window-shell">
      <div class="window-buttons" aria-hidden="true"><span class="minimize"></span><span class="maximize"></span><span class="close"></span></div>
      <div class="app-layout">${renderRail()}${renderListPanel()}${state.view === 'chats' ? renderChat() : renderFeaturePage()}</div>
      <div class="prototype-tag">${ic('sparkle',14)} APPLE GLASS · LOCAL UI PROTOTYPE</div>
      ${renderSettings()}
      <div id="toast" role="status" aria-live="polite"></div>
    </div>`;
    const list = document.getElementById('messagesScroll');
    if (list) list.scrollTop = list.scrollHeight;
  }

  let toastTimer;
  function notify(message) {
    const holder = document.getElementById('toast');
    if (!holder) return;
    holder.textContent = message;
    holder.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => holder.classList.remove('visible'), 3300);
  }

  function sendMessage() {
    const el = document.getElementById('messageInput');
    if (!el || !el.value.trim()) return;
    const chat = getChat();
    const text = el.value.trim().slice(0, 2000);
    const time = formatClock(new Date());
    chat.messages.push({ id: Date.now(), from: 'me', text, time });
    chat.preview = `Bạn: ${text.replace(/\s+/g, ' ').slice(0, 70)}`;
    chat.time = time;
    render();
    document.getElementById('messageInput')?.focus();
    notify('Đã thêm tin nhắn vào bản demo — không gửi qua Zalo.');
  }

  function sendFiles(fileList) {
    const selected = Array.from(fileList || []).slice(0, 5);
    if (!selected.length) return;
    const chat = getChat();
    selected.forEach(file => {
      const filename = safeFileName(file.name);
      chat.messages.push({ id: Date.now() + Math.random(), from:'me',
        attachment: filename, size: `${formatFileSize(file.size)} · Tệp demo`, time: formatClock(new Date()) });
      chat.preview = `Bạn: ${filename}`;
    });
    chat.time = formatClock(new Date());
    render();
    notify(`Đã thêm ${selected.length} tên tệp vào bản demo. Không tải lên mạng.`);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    switch(action) {
      case 'nav': state.view = button.dataset.view; state.menu = false; state.settings = false; render(); break;
      case 'select-chat': state.activeId = button.dataset.chat; state.view = 'chats';
        getChat().unread = 0; state.menu = false; state.searchInChat = false; state.chatQuery = ''; render(); break;
      case 'filter': state.filter = button.dataset.filter; render(); break;
      case 'settings': state.settings = true; render(); break;
      case 'close-settings': state.settings = false; render(); break;
      case 'settings-backdrop': if (event.target === button) { state.settings = false; render(); } break;
      case 'theme': state.theme = button.dataset.theme; savePrefs(); render(); break;
      case 'motion': state.motion = !state.motion; savePrefs(); render(); break;
      case 'reset': state.theme = 'dark'; state.glass = 68; state.motion = true; savePrefs(); render(); notify('Đã đặt lại giao diện mặc định.'); break;
      case 'send': sendMessage(); break;
      case 'emoji': { const txt = document.getElementById('messageInput'); if (txt) { txt.value += ' 😊'; txt.focus(); } break; }
      case 'attach': document.getElementById('attachmentPicker').click(); break;
      case 'call': notify('Gọi thoại chưa hỗ trợ: đây là prototype độc lập.'); break;
      case 'video': notify('Gọi video chưa hỗ trợ: đây là prototype độc lập.'); break;
      case 'voice': notify('Ghi âm chưa hỗ trợ: đây là prototype độc lập.'); break;
      case 'help': notify('Mở README.md để xem hướng dẫn và giới hạn của prototype.'); break;
      case 'filters-info': notify('Lọc theo Chưa đọc, Nhóm hoặc Công việc.'); break;
      case 'more': state.menu = !state.menu; render(); break;
      case 'toggle-pin': getChat().pinned = !getChat().pinned; state.menu = false; render(); notify('Đã cập nhật ghim trong dữ liệu demo.'); break;
      case 'mark-unread': getChat().unread = 1; state.menu = false; render(); notify('Đã đánh dấu chưa đọc trong bản demo.'); break;
      case 'toggle-chat-search': state.searchInChat = !state.searchInChat; state.chatQuery = ''; render(); if (state.searchInChat) document.getElementById('inChatSearch')?.focus(); break;
      case 'chat-info': state.menu = false; render(); notify('Hội thoại này chỉ chứa dữ liệu giả lập, không có thông tin thật.'); break;
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'chatSearch') {
      state.query = event.target.value;
      const list = document.getElementById('conversationList');
      if (list) list.innerHTML = renderConversationList();
    }
    if (event.target.id === 'inChatSearch') {
      state.chatQuery = event.target.value;
      const list = document.getElementById('messagesScroll');
      if (list) {
        const chat = getChat();
        list.innerHTML = `<div class="day-label">Hôm nay</div>${chat.messages.map(m => renderMessage(m,chat)).join('')}`;
      }
    }
    if (event.target.id === 'glassSlider') {
      state.glass = Number(event.target.value);
      applyTheme();
      document.getElementById('glassNumber').textContent = `${state.glass}%`;
      savePrefs();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.settings) { state.settings = false; render(); }
      else if (state.menu || state.searchInChat) { state.menu = false; state.searchInChat = false; render(); }
    }
    if (event.target.id === 'messageInput' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  document.getElementById('attachmentPicker').addEventListener('change', function () {
    sendFiles(this.files);
    this.value = '';
  });

  render();
})();
