const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHTML, normalizeText, selectChats, formatFileSize, safeFileName } = require('../src/logic.js');

test('HTML-escapes user-generated message content', () => {
  assert.equal(escapeHTML('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});
test('removes diacritics in Vietnamese search terms', () => {
  assert.equal(normalizeText('Đặng Minh Anh'), 'dang minh anh');
});
test('search matches normalized names', () => {
  const chats = [{name:'Minh Anh',preview:'Họp chiều nay',pinned:false,unread:0,isGroup:false,isWork:false}];
  assert.equal(selectChats(chats,'hop','all').length,1);
});
test('unread filter selects only unread', () => {
  const chats = [{name:'a',preview:'',unread:2,isGroup:false,isWork:false}, {name:'b',preview:'',unread:0,isGroup:false,isWork:false}];
  assert.deepEqual(selectChats(chats,'','unread').map(x=>x.name),['a']);
});
test('group and work filters use categories independently', () => {
  const chats = [{name:'a',preview:'',isGroup:true,isWork:false}, {name:'b',preview:'',isGroup:true,isWork:true}, {name:'c',preview:'',isGroup:false,isWork:true}];
  assert.deepEqual(selectChats(chats,'','groups').map(x=>x.name),['a','b']);
  assert.deepEqual(selectChats(chats,'','work').map(x=>x.name),['b','c']);
});
test('pinned chats are sorted before unpinned', () => {
  const chats = [{name:'a',preview:'',pinned:false}, {name:'b',preview:'',pinned:true}];
  assert.deepEqual(selectChats(chats,'','all').map(x=>x.name),['b','a']);
});
test('file metadata is textual and size-limited', () => {
  assert.equal(safeFileName('abc\nfile.pdf'), 'abc file.pdf');
  assert.equal(formatFileSize(2048), '2.0 KB');
});
