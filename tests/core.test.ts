import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { formatClock, formatListTime, normalizeText, selectChats } from '../src/shared/logic.ts';
import { defaults, parsePreferences, serializePreferences } from '../src/shared/preferences.ts';
import { isAllowedRequest, isTrustedDocument, resourcePath } from '../electron/security.ts';

const conversations = [
  { name: 'Đặng Minh Ánh', preview: 'Họp dự án', unread: 0, isGroup: false, pinned: false, lastTs: 1_000 },
  { name: 'Hoàng Long', preview: 'Ok bạn!', unread: 0, isGroup: false, pinned: false, lastTs: 9_000 },
  { name: 'Nhóm gia đình', preview: 'Cuối tuần về nhé', unread: 3, isGroup: true, pinned: false, lastTs: 3_000 },
  { name: 'Nhóm ghim', preview: 'Đã cập nhật', unread: 0, isGroup: true, pinned: true, lastTs: 2_000 },
];

test('conversation search and filters handle Vietnamese text without mutating input', () => {
  assert.equal(normalizeText('Đặng Minh Ánh'), 'dang minh anh');
  assert.deepEqual(selectChats(conversations, 'hop', 'all').map(chat => chat.name), ['Đặng Minh Ánh']);
  assert.deepEqual(selectChats(conversations, '', 'unread').map(chat => chat.name), ['Nhóm gia đình']);
  assert.deepEqual(selectChats(conversations, '', 'groups').map(chat => chat.name), ['Nhóm ghim', 'Nhóm gia đình']);
  assert.deepEqual(conversations.map(chat => chat.name), ['Đặng Minh Ánh', 'Hoàng Long', 'Nhóm gia đình', 'Nhóm ghim']);
});

test('conversation list sorts pinned first and newest first', () => {
  assert.deepEqual(selectChats(conversations, '', 'all').map(chat => chat.name),
    ['Nhóm ghim', 'Hoàng Long', 'Nhóm gia đình', 'Đặng Minh Ánh']);
});

test('preferences tolerate corrupt storage, clamp values and serialize only supported fields', () => {
  for (const value of ['bad json', 'null', '42']) assert.deepEqual(parsePreferences(value), defaults);
  assert.equal(parsePreferences('{"glass":999}').glass, 95);
  assert.equal(parsePreferences('{"glass":0}').glass, 15);
  assert.equal(parsePreferences('{"glass":"oops"}').glass, 68);
  assert.equal(parsePreferences('{"motion":false}').motion, false);

  const prefs = { ...defaults, theme: 'light' as const, chats: ['private'], token: 'never persist' };
  assert.deepEqual(Object.keys(JSON.parse(serializePreferences(prefs))).sort(), ['glass', 'lowBlur', 'motion', 'theme']);
  assert.equal(parsePreferences(serializePreferences(prefs)).theme, 'light');
});

test('packaged protocol rejects external origins, credentials, unsafe paths and non-assets', () => {
  const root = path.resolve('dist');
  assert.equal(resourcePath(root, 'glass://app/index.html'), path.join(root, 'index.html'));
  assert.equal(resourcePath(root, 'glass://app/assets/approved-reference.jpg'), path.join(root, 'assets/approved-reference.jpg'));
  for (const url of ['https://example.com/', 'glass://evil/index.html', 'glass://user@app/index.html',
    'glass://app/assets/%2e%2e%5cpackage.json', 'glass://app/package.json', 'glass://app/assets/%00.png', 'glass://app/assets/a.js.map'])
    assert.equal(resourcePath(root, url), null, url);
});

test('IPC trust and network policy distinguish development from production', () => {
  assert.equal(isTrustedDocument('glass://app/index.html', false), true);
  assert.equal(isTrustedDocument('glass://app/assets/a.js', false), false);
  assert.equal(isTrustedDocument('http://127.0.0.1:5173/', false), false);
  assert.equal(isTrustedDocument('http://127.0.0.1:5173/', true), true);
  for (const url of ['https://example.com', 'http://127.0.0.1:5173.evil.com/', 'file:///C:/secret', 'data:text/html,x'])
    assert.equal(isAllowedRequest(url, false), false);
  assert.equal(isAllowedRequest('ws://127.0.0.1:5173', true), true);
});

test('conversation timestamps use local dates and reject invalid values', () => {
  const now = new Date(2026, 10, 11, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime();
  assert.equal(formatListTime(at(2026, 10, 11, 9), now), '09:00');
  assert.equal(formatListTime(at(2026, 10, 10, 23, 59), now), 'Hôm qua');
  assert.equal(formatListTime(at(2026, 10, 9), now), 'Thứ Hai');
  assert.equal(formatListTime(at(2026, 10, 4), now), '04/11');
  assert.equal(formatListTime(at(2025, 11, 31, 8), now), '31/12/2025');
  const date = new Date(2026, 10, 11, 9, 5);
  assert.equal(formatClock(date), '09:05');
  for (const bad of [0, -1, NaN, Infinity, -Infinity]) assert.equal(formatListTime(bad, now), '');
});
