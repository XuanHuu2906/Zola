/* Pure helpers: safe for the browser and Node's built-in test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlassLogic = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').trim();
  }

  function selectChats(chats, query, filter) {
    const term = normalizeText(query);
    return chats.filter(chat => {
      if (filter === 'unread' && !chat.unread) return false;
      if (filter === 'groups' && !chat.isGroup) return false;
      if (filter === 'work' && !chat.isWork) return false;
      return !term || normalizeText(chat.name).includes(term) ||
        normalizeText(chat.preview).includes(term);
    }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }

  function formatClock(date) {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function safeFileName(filename) {
    return String(filename || 'Tệp không tên').replace(/[\r\n\t]/g, ' ').slice(0, 90);
  }

  function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return 'Không rõ';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  return { escapeHTML, normalizeText, selectChats, formatClock, safeFileName, formatFileSize };
});
