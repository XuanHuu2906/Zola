import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AVATAR_MAX_BYTES, avatarExtension, avatarFileName, avatarFilePath, avatarUrl,
  isAvatarHost, parseAvatarUrl, readAvatar, syncAvatars,
} from '../electron/avatars.ts';

/**
 * Avatar là chỗ duy nhất trong app tải nội dung từ một host bên ngoài, nên mọi
 * kiểm tra ở đây là kiểm tra ranh giới: URL nào được phép, byte nào được ghi,
 * và cái gì không bao giờ rời khỏi đĩa dưới dạng "ảnh".
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const temp = () => mkdtemp(path.join(tmpdir(), 'glass-avatar-'));

test('chỉ CDN ảnh của Zalo là host hợp lệ, và so theo nhãn tên miền', () => {
  for (const host of ['zadn.vn', 's120-ava-talk.zadn.vn', 'res-zalo.zadn.vn', 'COVER-TALK.ZADN.VN'])
    assert.equal(isAvatarHost(host), true, host);
  // `endsWith('zadn.vn')` trơn sẽ cho `evilzadn.vn` lọt; `includes` sẽ cho
  // `zadn.vn.evil.com` lọt. Cả hai đều là host của kẻ khác.
  for (const host of ['evilzadn.vn', 'zadn.vn.evil.com', 'zadn.vn.', 'notzadn.vn', '', 'example.com'])
    assert.equal(isAvatarHost(host), false, host);
});

test('URL avatar phải https, không credential, không cổng lạ', () => {
  assert.equal(parseAvatarUrl('https://s120-ava-talk.zadn.vn/a/b.jpg')?.hostname, 's120-ava-talk.zadn.vn');
  const rejects: unknown[] = [
    '', null, undefined, 42, {},
    'http://s120-ava-talk.zadn.vn/a.png', // không phải https
    'https://user:pw@s120-ava-talk.zadn.vn/a.png', // credential
    'https://s120-ava-talk.zadn.vn:8443/a.png', // cổng lạ
    'https://example.com/a.png',
    'https://zadn.vn.evil.com/a.png',
    'javascript:alert(1)',
    '/relative/avatar.png',
    'not a url',
  ];
  for (const value of rejects) assert.equal(parseAvatarUrl(value), null, String(value));
});

test('tên file chỉ nhận id an toàn, không đường dẫn', () => {
  assert.equal(avatarFileName('188436612101457701', 'png'), '188436612101457701.png');
  assert.equal(avatarFileName('AbC-_9', 'jpg'), 'AbC-_9.jpg');
  for (const bad of ['', '../etc/passwd', 'a/b', 'a\\b', 'a.b', 'a\0b', 'x'.repeat(65)])
    assert.equal(avatarFileName(bad, 'png'), null, bad);
  assert.equal(avatarUrl('188.png'), 'glass://app/avatars/188.png');
  assert.equal(avatarUrl(null), null);
});

test('loại ảnh đọc từ magic bytes, không từ Content-Type', () => {
  assert.equal(avatarExtension(PNG), 'png');
  assert.equal(avatarExtension(JPG), 'jpg');
  // Máy chủ trả HTML cho một URL ảnh hết hạn là ca thật: ghi nó vào `avatars/`
  // là có một ô ảnh hỏng vĩnh viễn trong cache.
  assert.equal(avatarExtension(new TextEncoder().encode('<html>hết hạn</html>')), null);
  assert.equal(avatarExtension(new Uint8Array([0x89])), null);
  assert.equal(avatarExtension(new Uint8Array([])), null);
  // GIF/WebP không được nhận: chúng không nằm trong `img-src 'self'` allow-list
  // của đường phục vụ (chỉ png/jpg), nên nhận chúng là ghi file không đọc được.
  assert.equal(avatarExtension(new TextEncoder().encode('GIF89a')), null);
});

test('đường dẫn phục vụ không thoát khỏi thư mục avatar', () => {
  const dir = path.resolve('/tmp/glass-avatars');
  assert.equal(avatarFilePath(dir, '/avatars/188.png'), path.join(dir, '188.png'));
  for (const bad of [
    '/avatars/../etc/passwd', '/avatars/a/b.png', '/avatars/188.gif', '/avatars/188.png/../x',
    '/assets/188.png', '/avatars/', '/avatars/188.PNG',
  ]) assert.equal(avatarFilePath(dir, bad), null, bad);
});

test('tải và ghi đĩa: bỏ qua ảnh đã có, ghi nguyên tử, đếm đúng', async () => {
  const dir = await temp();
  // Ảnh đã có trên đĩa từ lần mở trước: không được tải lại.
  await writeFile(path.join(dir, 'u-1.png'), PNG);
  const calls: string[] = [];
  // Giả lập phân biệt bằng **số cuối của đường dẫn**, không bằng id hội thoại:
  // URL thật chỉ mang id của Zalo, không mang id hội thoại của repo.
  const fakeFetch = (async (url: URL | Request) => {
    calls.push(String(url));
    const tail = String(url).split('/').pop();
    if (tail === '2.jpg') return new Response(JPG, { status: 200 });
    if (tail === '3.png') return new Response('<html>nope</html>', { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  const stored: [string, string][] = [];
  const stats = await syncAvatars({
    dir, fetch: fakeFetch,
    jobs: [
      { threadId: 'u-1', remote: 'https://s120-ava-talk.zadn.vn/1.png', current: 'u-1.png' },
      { threadId: 'u-2', remote: 'https://s120-ava-talk.zadn.vn/2.jpg', current: null },
      { threadId: 'u-3', remote: 'https://s120-ava-talk.zadn.vn/3.png', current: null },
      { threadId: 'u-4', remote: 'https://s120-ava-talk.zadn.vn/4.png', current: null },
      { threadId: 'u-5', remote: 'https://evil.example.com/5.png', current: null },
    ],
    onStored: (threadId, fileName) => { stored.push([threadId, fileName]); },
  });

  assert.equal(stats.skipped, 1, 'ảnh đã có thì bỏ qua');
  assert.equal(stats.downloaded, 1, 'chỉ u-2 là ảnh thật');
  assert.equal(stats.failed, 3, '404, HTML và host lạ đều hỏng');
  assert.deepEqual(stored, [['u-2', 'u-2.jpg']]);
  assert.deepEqual(calls, [
    'https://s120-ava-talk.zadn.vn/2.jpg',
    'https://s120-ava-talk.zadn.vn/3.png',
    'https://s120-ava-talk.zadn.vn/4.png',
  ], 'ảnh đã có và host lạ không được gọi mạng');
  // Ghi nguyên tử: không còn file `.part` nào sau khi xong.
  const left = await readdir(dir);
  assert.equal(left.some(name => name.endsWith('.part')), false, left.join(','));
  assert.deepEqual(new Uint8Array(await readFile(path.join(dir, 'u-2.jpg'))), JPG);
});

test('ảnh vượt trần bị cắt, không ghi vào đĩa', async () => {
  const dir = await temp();
  const huge = new Uint8Array(AVATAR_MAX_BYTES + 1);
  huge.set(PNG.subarray(0, 8));
  // Hai đường: `Content-Length` khai báo vượt trần, và body thật sự vượt trần
  // dù header nói dối. Cả hai phải bị từ chối — tin header là đủ để đầy đĩa.
  // Mỗi lần gọi dựng một `Response` mới: `fetch` thật không dùng lại body, và
  // `clone()` một body lớn hai lần là chuyện chỉ có trong test.
  const cases: (() => Response)[] = [
    () => new Response(huge, { status: 200, headers: { 'content-length': String(huge.byteLength) } }),
    () => new Response(huge, { status: 200 }),
  ];
  for (const make of cases) {
    const stats = await syncAvatars({
      dir, fetch: (async () => make()) as typeof fetch,
      jobs: [{ threadId: 'u-9', remote: 'https://s120-ava-talk.zadn.vn/9.png', current: null }],
    });
    assert.equal(stats.downloaded, 0);
    assert.equal(stats.failed, 1);
  }
  assert.deepEqual(await readdir(dir).then(names => names.filter(n => !n.endsWith('.part'))), []);
});

test('file đã mất khỏi đĩa thì được tải lại thay vì trỏ vào hư không', async () => {
  const dir = await temp();
  const stats = await syncAvatars({
    dir, fetch: (async () => new Response(PNG, { status: 200 })) as typeof fetch,
    jobs: [{ threadId: 'u-1', remote: 'https://s120-ava-talk.zadn.vn/1.png', current: 'u-1.png' }],
  });
  assert.equal(stats.downloaded, 1, 'DB nói có ảnh nhưng đĩa không có');
  assert.equal(stats.skipped, 0);
  assert.ok(await readAvatar(dir, '/avatars/u-1.png'));
});

test('avatar thành viên được nhận lại từ đĩa dù chưa có đường dẫn trong DB', async () => {
  const dir = await temp();
  await writeFile(path.join(dir, 'member-7.jpg'), JPG);
  let calls = 0;
  const stored: [string, string][] = [];
  const stats = await syncAvatars({
    dir,
    fetch: (async () => { calls += 1; return new Response(PNG, { status: 200 }); }) as typeof fetch,
    jobs: [{ threadId: 'member-7', remote: 'https://s120-ava-talk.zadn.vn/7.jpg', current: null }],
    onStored: (id, name) => stored.push([id, name]),
  });
  assert.deepEqual(stats, { downloaded: 0, skipped: 1, failed: 0 });
  assert.equal(calls, 0);
  assert.deepEqual(stored, [['member-7', 'member-7.jpg']]);
});

test('readAvatar trả null thay vì ném khi đường dẫn sai hoặc file vắng', async () => {
  const dir = await temp();
  assert.equal(await readAvatar(dir, '/avatars/khong-co.png'), null);
  assert.equal(await readAvatar(dir, '/avatars/../secret.png'), null);
  assert.equal(await readAvatar(dir, '/avatars/a.gif'), null);
});
