import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { demoAdapter } from '../src/renderer/adapters/demo.ts';
import { normalizeText, selectChats, safeFileName, formatFileSize } from '../src/shared/logic.ts';
import { buildOlderPage, clampPageSize, MAX_HISTORY_PAGE } from '../src/shared/history.ts';
import { defaults, parsePreferences, serializePreferences } from '../src/shared/preferences.ts';
import { parseSession, serializeSession } from '../src/shared/session.ts';
import { incomingLine, INCOMING_LINES, pickIncomingTarget } from '../src/shared/inbox.ts';
import { advanceProgress, clampProgress, isTransferActive, transferLabel, transferStep } from '../src/shared/transfer.ts';
import { callStatusLabel, connectCall, createCall, endCall, formatCallDuration, tickCall, toggleCallFlag } from '../src/shared/call.ts';
import { canSend, connectionLabel, markPendingSent, nextConnection } from '../src/shared/network.ts';
import { isAllowedRequest, isTrustedDocument, resourcePath } from '../electron/security.ts';

test('TS search retains Vietnamese name and preview matching', () => {
  assert.equal(normalizeText('Đặng Minh Ánh'), 'dang minh anh');
  assert.deepEqual(selectChats(demoAdapter.list(), 'hop', 'all').map(c => c.id), ['minh-anh']);
  assert.deepEqual(selectChats(demoAdapter.list(), 'hoang long', 'all').map(c => c.id), ['hoang-long']);
});
test('TS filters retain independent group/work/unread categories and pinned order', () => {
  const chats = demoAdapter.list();
  assert.deepEqual(selectChats(chats, '', 'unread').map(c => c.id), ['gia-dinh']);
  assert.equal(selectChats(chats, '', 'groups').length, 4);
  assert.equal(selectChats(chats, '', 'work').length, 2);
  chats[4].pinned = true;
  assert.deepEqual(selectChats(chats, '', 'all').slice(0, 2).map(c => c.id), ['minh-anh', 'hoang-long']);
});
test('sending is immutable, bounded and local to the selected chat', () => {
  const original = demoAdapter.list();
  assert.equal(demoAdapter.send(original, 'minh-anh', ' \n '), original);
  const sent = demoAdapter.send(original, 'minh-anh', ' x '.repeat(1000));
  assert.equal(sent[0].messages.at(-1)!.text!.length, 2000);
  assert.equal(original[0].messages.length, 6);
  assert.equal(sent[1], original[1]);
  const again = demoAdapter.send(sent, 'minh-anh', '<img src=x onerror=alert(1)>');
  assert.equal(again[0].messages.at(-1)!.text, '<img src=x onerror=alert(1)>');
  assert.notEqual(again[0].messages.at(-1)!.id, sent[0].messages.at(-1)!.id);
});
test('delivery settles one message without touching the rest of the dataset', () => {
  const saved = demoAdapter.list();
  const pending = demoAdapter.send(saved, 'minh-anh', 'hello', undefined, 'pending');
  const message = pending[0].messages.at(-1)!;
  assert.equal(message.status, 'pending');
  const sent = demoAdapter.settle(pending, 'minh-anh', message.id, 'sent');
  assert.equal(sent[0].messages.at(-1)!.status, 'sent');
  assert.equal(sent[0].messages.at(-2), pending[0].messages.at(-2));
  assert.equal(sent[1], pending[1], 'untouched chats keep object identity');
  const failed = demoAdapter.settle(sent, 'minh-anh', message.id, 'failed');
  assert.equal(failed[0].messages.at(-1)!.status, 'failed');
  assert.equal(demoAdapter.settle(failed, 'minh-anh', -999, 'sent')[0].messages.at(-1)!.status, 'failed');
});
test('incoming simulation targets another chat, rotates, and bumps only its unread', () => {
  const chats = demoAdapter.list();
  assert.equal(pickIncomingTarget(chats, 'minh-anh', 0)!.id, 'du-an', 'never lands on the open chat');
  assert.notEqual(pickIncomingTarget(chats, 'minh-anh', 1)!.id, 'du-an', 'cycles senders');
  assert.equal(pickIncomingTarget([] as typeof chats, 'minh-anh', 0), null);
  assert.equal(pickIncomingTarget([chats[0]], 'minh-anh', 3), null, 'no other chat means no target');
  assert.equal(incomingLine(0), INCOMING_LINES[0]);
  assert.equal(incomingLine(INCOMING_LINES.length), INCOMING_LINES[0], 'line index wraps');
  assert.equal(incomingLine(-1), INCOMING_LINES[1], 'negative seq is normalised by magnitude');

  const target = pickIncomingTarget(chats, 'minh-anh', 0)!;
  const received = demoAdapter.receive(chats, target.id, 'ping', new Date());
  const bumped = received.find(c => c.id === target.id)!;
  assert.equal(bumped.unread, target.unread + 1);
  assert.equal(bumped.messages.at(-1)!.from, 'them');
  assert.equal(received.find(c => c.id === 'minh-anh')!.unread, 0, 'open chat must not gain unread');
  assert.equal(
    demoAdapter.receive(chats, target.id, '   ').find(c => c.id === target.id)!.messages.length,
    target.messages.length, 'blank text is a no-op');
});
test('attachments retain names and sizes only, with bounded display metadata', () => {
  const result = demoAdapter.attach(demoAdapter.list(), 'minh-anh', [{ name: 'C:\\private\\abc\nfile.pdf', size: 2048 }]);
  const last = result[0].messages.at(-1)!;
  assert.equal(last.attachment, 'abc file.pdf');
  assert.equal(last.size, '2.0 KB · Chỉ metadata');
  assert.equal(safeFileName('a'.repeat(200)).length, 90);
  assert.equal(formatFileSize(-1), 'Không rõ');
  assert.deepEqual(Object.keys(last).sort(), ['attachment', 'from', 'id', 'progress', 'size', 'time', 'transfer']);
  assert.equal(last.transfer, 'upload');
  assert.equal(last.progress, 0);
});
test('transfer progress advances on a fixed step, clamps, and settles at 100', () => {
  assert.equal(transferStep('upload'), 13);
  assert.equal(transferStep('download'), 18);
  assert.equal(advanceProgress(0, 'upload'), 13);
  assert.equal(advanceProgress(95, 'upload'), 100, 'never overshoots the end');
  assert.equal(advanceProgress(100, 'download'), 100, 'a finished transfer stays finished');
  assert.equal(advanceProgress(Number.NaN, 'upload'), 13, 'a broken start is treated as zero');
  assert.equal(advanceProgress(-40, 'download'), 18, 'negative input is clamped to zero before stepping');
  assert.equal(clampProgress(63.4), 63);
  assert.equal(clampProgress(999), 100);
  assert.equal(clampProgress(Number.NaN), 0);
  assert.equal(transferLabel('upload', 39), 'Đang tải lên 39%');
  assert.equal(transferLabel('download', 39), 'Đang tải xuống 39%');
  assert.equal(transferLabel('upload', 100), 'Đã tải lên');
  assert.equal(transferLabel('download', 100), 'Đã tải xuống');
  assert.equal(isTransferActive(99), true);
  assert.equal(isTransferActive(100), false);
  assert.equal(isTransferActive(undefined), false, 'a plain attachment is not a transfer');
});
test('setTransfer only touches the addressed message and clamps its progress', () => {
  const chats = demoAdapter.attach(demoAdapter.list(), 'minh-anh', [{ name: 'a.pdf', size: 10 }]);
  const id = chats[0].messages.at(-1)!.id;
  const started = demoAdapter.setTransfer(chats, 'minh-anh', id, { transfer: 'download', progress: 0 });
  const message = started[0].messages.at(-1)!;
  assert.equal(message.transfer, 'download');
  assert.equal(message.progress, 0);
  assert.equal(started[0].messages.at(-2), chats[0].messages.at(-2), 'siblings keep identity');
  assert.equal(started[1], chats[1], 'other chats keep identity');
  assert.equal(demoAdapter.setTransfer(started, 'minh-anh', id, { progress: 240 })[0].messages.at(-1)!.progress, 100);
  assert.equal(demoAdapter.setTransfer(started, 'minh-anh', id, { progress: -5 })[0].messages.at(-1)!.progress, 0);
  assert.equal(demoAdapter.setTransfer(started, 'minh-anh', id, { progress: Number.NaN })[0].messages.at(-1)!.progress, 0);
  const kindOnly = demoAdapter.setTransfer(started, 'minh-anh', id, { transfer: 'upload' })[0].messages.at(-1)!;
  assert.equal(kindOnly.transfer, 'upload');
  assert.equal(kindOnly.progress, 0, 'a kind-only patch leaves progress untouched');
  assert.deepEqual(demoAdapter.setTransfer(started, 'khong-ton-tai', id, { progress: 5 }), started,
    'an unknown chat id is a no-op');
});
test('a call rings, connects, counts only connected seconds, and ends once', () => {
  const ringing = createCall('voice');
  assert.equal(ringing.phase, 'ringing');
  assert.equal(ringing.seconds, 0);
  assert.equal(ringing.speaker, true);
  assert.equal(ringing.camera, false, 'voice calls never expose a camera');
  assert.equal(callStatusLabel(ringing), 'Đang đổ chuông');
  assert.equal(tickCall(ringing), ringing, 'ringing time is not call time');

  const connected = connectCall(ringing);
  assert.equal(connected.phase, 'connected');
  assert.equal(callStatusLabel(connected), '00:00');
  assert.equal(tickCall(connected).seconds, 1);
  assert.equal(connectCall(connected), connected, 'connecting twice is a no-op');

  let state = connected;
  for (let i = 0; i < 61; i += 1) state = tickCall(state);
  assert.equal(formatCallDuration(state.seconds), '01:01');
  assert.equal(callStatusLabel(state), '01:01');
  const ended = endCall(tickCall(connected));
  assert.equal(ended.phase, 'ended');
  assert.equal(callStatusLabel(ended), 'Đã kết thúc · 00:01');
  assert.equal(endCall(ended), ended, 'ending twice keeps identity');
  assert.equal(tickCall(ended), ended, 'an ended call stops counting');
});
test('call toggles are independent, and camera only exists in a video call', () => {
  const voice = createCall('voice');
  const muted = toggleCallFlag(voice, 'muted');
  assert.equal(muted.muted, true);
  assert.equal(toggleCallFlag(muted, 'muted').muted, false);
  assert.equal(muted.speaker, true, 'muting does not touch the speaker');
  assert.equal(toggleCallFlag(voice, 'speaker').speaker, false);
  assert.equal(toggleCallFlag(voice, 'camera'), voice, 'voice calls cannot toggle a camera');

  const video = createCall('video');
  assert.equal(video.camera, true, 'video calls start with the camera on');
  assert.equal(toggleCallFlag(video, 'camera').camera, false);
  assert.equal(formatCallDuration(0), '00:00');
  assert.equal(formatCallDuration(3599), '59:59');
  assert.equal(formatCallDuration(-5), '00:00');
  assert.equal(formatCallDuration(Number.NaN), '00:00');
  assert.equal(formatCallDuration(75.9), '01:15');
});
test('connection state gates sending and only reconnects from offline', () => {
  assert.equal(canSend('online'), true);
  assert.equal(canSend('syncing'), true, 'syncing still queues mail');
  assert.equal(canSend('offline'), false);
  assert.equal(connectionLabel('online'), '', 'a healthy link shows no banner');
  assert.match(connectionLabel('offline'), /Ngoại tuyến/);
  assert.match(connectionLabel('syncing'), /Đang đồng bộ/);

  assert.equal(nextConnection('online', 'loss'), 'offline');
  assert.equal(nextConnection('syncing', 'loss'), 'syncing', 'a sync in progress is not lost');
  assert.equal(nextConnection('online', 'reconnect'), 'online', 'reconnecting an online link is a no-op');
  assert.equal(nextConnection('offline', 'reconnect'), 'syncing');
  assert.equal(nextConnection('syncing', 'reconnect'), 'syncing');
});
test('recovery flushes pending sends but never rewrites failed ones', () => {
  let chats = demoAdapter.list();
  chats = demoAdapter.send(chats, 'minh-anh', 'waiting', undefined, 'pending');
  chats = demoAdapter.send(chats, 'minh-anh', 'rejected', undefined, 'failed');
  chats = demoAdapter.send(chats, 'minh-anh', 'already fine', undefined, 'sent');
  const before = chats[0].messages.length;
  const flushed = markPendingSent(chats);
  const statuses = flushed[0].messages.slice(-3).map(m => m.status);
  assert.deepEqual(statuses, ['sent', 'failed', 'sent']);
  assert.equal(flushed[0].messages.length, before, 'recovery never adds or drops a message');
  assert.equal(flushed[1], chats[1], 'chats without pending mail keep identity');
  assert.equal(markPendingSent(flushed), flushed, 'a second flush is idempotent');
});
test('history pages keep every id positive and unique across the whole dataset', () => {
  let chats = demoAdapter.list();
  let pages = 0;
  while (chats[0].historyRemaining > 0 && pages < 10) { chats = demoAdapter.loadOlder(chats, 'minh-anh'); pages += 1; }
  assert.equal(chats[0].historyRemaining, 0, 'history must drain to exactly zero');
  assert.equal(chats[0].messages.length, 6 + 24, 'every older message is loaded once');
  const ids = chats.flatMap(c => c.messages.map(m => m.id));
  assert.ok(ids.every(id => Number.isInteger(id) && id > 0), 'ids must stay positive');
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique across chats');
  const alreadyEmpty = demoAdapter.loadOlder(chats, 'minh-anh');
  assert.deepEqual(alreadyEmpty[0].messages, chats[0].messages, 'an exhausted chat must not change');
  const untouched = demoAdapter.loadOlder(chats, 'khong-ton-tai');
  assert.deepEqual(untouched, chats, 'an unknown chat id must be a no-op');
});
test('page size is clamped to 1..50 and pages never overshoot historyRemaining', () => {
  assert.equal(clampPageSize(0), 1);
  assert.equal(clampPageSize(999), MAX_HISTORY_PAGE);
  assert.equal(clampPageSize(Number.NaN), 1);
  const chats = demoAdapter.list();
  const zalo = chats.find(c => c.id === 'zalo')!;
  const page = buildOlderPage(zalo, chats, 50);
  assert.equal(page.messages.length, zalo.historyRemaining, 'a big page stops at what is left');
  assert.equal(page.remaining, 0);
  assert.deepEqual(buildOlderPage(zalo, chats, 0).messages.length, 1);
});
test('demo seeds are independent across sessions', () => {
  const one = demoAdapter.list(); one[0].messages[0].text = 'changed';
  assert.notEqual(demoAdapter.list()[0].messages[0].text, 'changed');
});
test('preferences tolerate corrupt storage and clamp values', () => {
  for (const value of ['bad json', 'null', '42']) assert.deepEqual(parsePreferences(value), defaults);
  assert.equal(parsePreferences('{"glass":999}').glass, 95);
  assert.equal(parsePreferences('{"glass":0}').glass, 15);
  assert.equal(parsePreferences('{"glass":"oops"}').glass, 68);
  assert.equal(parsePreferences('{"motion":false}').motion, false);
});
test('preference serialization excludes chat, draft and arbitrary fields', () => {
  const prefs = { ...defaults, theme: 'light' as const, chats: ['private'], token: 'never persist' };
  assert.deepEqual(Object.keys(JSON.parse(serializePreferences(prefs))).sort(), ['glass', 'lowBlur', 'motion', 'theme']);
  assert.equal(parsePreferences(serializePreferences(prefs)).theme, 'light');
});
test('session parse accepts only a signed-in record and never invents one', () => {
  for (const value of [null, '', 'bad json', 'null', '{}', '{"signedIn":false}', '{"signedIn":"true","label":"X"}'])
    assert.equal(parseSession(value), null, String(value));
  assert.deepEqual(parseSession('{"signedIn":true,"label":"  Minh   Anh  "}'), { signedIn: true, label: 'Minh Anh' });
  assert.deepEqual(parseSession('{"signedIn":true}'), { signedIn: true, label: 'Người dùng Demo' });
  const long = serializeSession({ signedIn: true, label: 'a'.repeat(90) });
  assert.equal(JSON.parse(long).label.length, 40);
});
test('packaged protocol rejects external origins, credentials, unsafe paths and non-assets', () => {
  const root = path.resolve('dist');
  assert.equal(resourcePath(root, 'glass://app/index.html'), path.join(root, 'index.html'));
  assert.equal(resourcePath(root, 'glass://app/assets/avatar-family.png'), path.join(root, 'assets/avatar-family.png'));
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
