import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MEDIA_MAX_BYTES, imageExtension, isMediaHost, mediaContentType, mediaExtension,
  mediaFileName, mediaFilePath, mediaJobsOf, mediaKey, mediaUrl, needsDownload, parseMediaUrl,
  pruneMediaTemp, readMedia, syncMedia, type MediaJob,
} from '../electron/media.ts';
import type { StoredAttachment } from '../electron/protocol/attachment.ts';

/**
 * Tầng tải tệp đính kèm. Mọi test ở đây là test **ranh giới**: URL nào được gọi,
 * byte nào được ghi xuống đĩa, và tên file nào không được rời khỏi hình dạng đã
 * khai. `fetch` được tiêm vào, nên không có lời gọi mạng nào trong bộ test.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const temp = () => mkdtemp(path.join(tmpdir(), 'glass-media-'));

/** `fetch` giả: mọi URL trả đúng `body`, ghi lại những URL đã bị gọi. */
function stubFetch(body: Uint8Array, calls: string[] = [], status = 200): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(body as unknown as BodyInit, { status, headers: { 'content-length': String(body.byteLength) } });
  }) as typeof fetch;
}

const job = (over: Partial<MediaJob> = {}): MediaJob => ({
  threadId: 'u-1', msgId: '1000', index: 0, kind: 'photo',
  remote: 'https://s120-ava-talk.zadn.vn/a/b.jpg', ...over,
});

test('host nội dung rộng hơn host avatar, nhưng vẫn so theo nhãn tên miền', () => {
  for (const host of ['zadn.vn', 'res-zalo.zadn.vn', 'f12-zpcloud.zdn.vn', 'f1-voice-talk.zdn.vn', 'STC-CHAT.ZDN.VN'])
    assert.equal(isMediaHost(host), true, host);
  // `endsWith('zdn.vn')` trơn cho `evilzdn.vn` lọt; `includes` cho `zdn.vn.evil.com` lọt.
  for (const host of ['evilzdn.vn', 'zdn.vn.evil.com', 'zadn.vn.', 'example.com', '', 'notzdn.vn'])
    assert.equal(isMediaHost(host), false, host);
});

test('URL phải https, không credential, không cổng lạ', () => {
  assert.equal(parseMediaUrl('https://f12-zpcloud.zdn.vn/a/b.pdf')?.hostname, 'f12-zpcloud.zdn.vn');
  const rejects: unknown[] = [
    '', null, undefined, 42, {},
    'http://f12-zpcloud.zdn.vn/a.pdf',
    'https://user:pw@f12-zpcloud.zdn.vn/a.pdf',
    'https://f12-zpcloud.zdn.vn:8443/a.pdf',
    'https://example.com/a.jpg',
    'https://zdn.vn.evil.com/a.jpg',
    'file:///etc/passwd',
    '/media/x.jpg',
    'not a url',
  ];
  for (const value of rejects) assert.equal(parseMediaUrl(value), null, String(value));
});

test('đuôi ghi xuống đĩa: chỉ danh sách đã biết, còn lại thành `bin`', () => {
  assert.equal(mediaExtension('file', 'PDF'), 'pdf');
  assert.equal(mediaExtension('file', 'jpeg'), 'jpg');
  assert.equal(mediaExtension('file', 'exe'), 'bin', 'đuôi lạ không thành đuôi thật');
  assert.equal(mediaExtension('photo'), 'jpg');
  assert.equal(mediaExtension('voice'), 'mp3');
  assert.equal(mediaExtension('video'), 'mp4');
  assert.equal(mediaExtension('location'), 'bin');
});

test('tên file chỉ nhận `[0-9A-Za-z_-]`, không đường dẫn, không dấu chấm', () => {
  assert.equal(mediaFileName('m1abc', 'jpg'), 'm1abc.jpg');
  for (const bad of ['', '../etc/passwd', 'a/b', 'a\\b', 'a.b', 'a\0b', 'x'.repeat(97)])
    assert.equal(mediaFileName(bad, 'jpg'), null, bad);
  assert.equal(mediaFileName('m1', '../x'), null);
  assert.equal(mediaUrl('m1.jpg'), 'glass://app/media/m1.jpg');
  assert.equal(mediaUrl(null), null);
});

test('loại ảnh đọc từ magic bytes; HTML của một URL hết hạn không là ảnh', () => {
  assert.equal(imageExtension(PNG), 'png');
  assert.equal(imageExtension(JPG), 'jpg');
  assert.equal(imageExtension(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'gif');
  // `RIFF....WEBP`
  assert.equal(imageExtension(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'webp');
  assert.equal(imageExtension(new TextEncoder().encode('<html>hết hạn</html>')), null);
  assert.equal(imageExtension(new Uint8Array()), null);
});

test('khoá nội dung ổn định, tách được từng mục, và không chứa dữ liệu người dùng', () => {
  const key = mediaKey('u-1', '1000', 0);
  assert.equal(key, mediaKey('u-1', '1000', 0), 'cùng đầu vào, cùng khoá');
  assert.notEqual(key, mediaKey('u-1', '1000', 1), 'hai tệp trong một tin là hai file');
  assert.notEqual(key, mediaKey('u-1', '1001', 0));
  assert.notEqual(key, mediaKey('u-2', '1000', 0));
  // Tên tệp là nội dung tin nhắn; nó không được xuất hiện trong tên file trên đĩa.
  assert.match(key, /^m[0-9a-z]+$/);
});

test('tải một ảnh: ghi file, báo đường dẫn cục bộ, không lộ URL xa', async () => {
  const dir = await temp();
  try {
    const stored: Array<{ src: string; msgId: string }> = [];
    const stats = await syncMedia({ dir, jobs: [job()], fetch: stubFetch(PNG), onStored: item => stored.push(item) });
    assert.deepEqual(stats, { downloaded: 1, skipped: 0, failed: 0 });
    assert.equal(stored.length, 1);
    assert.match(stored[0].src, /^glass:\/\/app\/media\/m[0-9a-z]+\.png$/);
    assert.deepEqual(await readdir(dir), [stored[0].src.replace('glass://app/media/', '')]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ảnh thu nhỏ tải trước, và cả hai đường dẫn cùng được báo', async () => {
  const dir = await temp();
  const calls: string[] = [];
  try {
    const stored: Array<{ src: string; thumb: string | null }> = [];
    await syncMedia({
      dir, fetch: stubFetch(PNG, calls), onStored: item => stored.push(item),
      jobs: [job({ remoteThumb: 'https://res-zalo.zadn.vn/a/thumb.jpg' })],
    });
    assert.deepEqual(calls, [
      'https://res-zalo.zadn.vn/a/thumb.jpg',
      'https://s120-ava-talk.zadn.vn/a/b.jpg',
    ], 'ảnh thu nhỏ đi trước để bong bóng có gì hiện sớm');
    assert.ok(stored[0].thumb?.startsWith('glass://app/media/'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('đã có file thì bỏ qua, không gọi mạng lần hai', async () => {
  const dir = await temp();
  const calls: string[] = [];
  try {
    await syncMedia({ dir, jobs: [job()], fetch: stubFetch(PNG, calls) });
    const again = await syncMedia({ dir, jobs: [job()], fetch: stubFetch(PNG, calls) });
    assert.equal(again.skipped, 1);
    assert.equal(calls.length, 1, 'lần hai không có lời gọi nào');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('host lạ và nội dung không phải ảnh đều là `failed`, không ghi gì', async () => {
  const dir = await temp();
  try {
    const weird = await syncMedia({ dir, fetch: stubFetch(PNG), jobs: [job({ remote: 'https://example.com/a.jpg' })] });
    assert.deepEqual(weird, { downloaded: 0, skipped: 0, failed: 1 });
    // CDN trả HTML cho một URL ảnh hết hạn: ghi nó là một ô ảnh hỏng vĩnh viễn.
    const html = await syncMedia({
      dir, fetch: stubFetch(new TextEncoder().encode('<html>hết hạn</html>')),
      jobs: [job({ remote: 'https://s120-talk.zadn.vn/a.jpg' })],
    });
    assert.deepEqual(html, { downloaded: 0, skipped: 0, failed: 1 });
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('trần dung lượng chặn trước khi đọc, và trần là 0 cho loại không tải được', async () => {
  const dir = await temp();
  const calls: string[] = [];
  try {
    // `content-length` khai quá trần: bỏ ngay, không đọc một byte nào vào RAM.
    const big = await syncMedia({
      dir, fetch: stubFetch(new Uint8Array(MEDIA_MAX_BYTES.photo + 1), calls, 200), jobs: [job()],
    });
    assert.equal(big.downloaded, 0);
    assert.equal(big.failed, 1, 'bỏ vì quá trần là một lần hỏng, không phải thành công');
    assert.equal(calls.length, 1);
    assert.deepEqual(await readdir(dir), [], 'không có tệp nào được ghi');
    for (const kind of ['location', 'contact'] as const) {
      assert.equal(MEDIA_MAX_BYTES[kind], 0);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('HTTP lỗi và fetch ném đều không làm hỏng hàng đợi', async () => {
  const dir = await temp();
  try {
    const dir2 = await temp();
    const notFound = await syncMedia({ dir, jobs: [job()], fetch: stubFetch(PNG, [], 404) });
    assert.equal(notFound.failed, 1);
    const throwing = (async () => { throw new Error('mạng hỏng'); }) as unknown as typeof fetch;
    const failed = await syncMedia({ dir: dir2, jobs: [job()], fetch: throwing });
    assert.equal(failed.failed, 1);
    await rm(dir2, { recursive: true, force: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('`mediaFilePath` từ chối mọi đường dẫn thoát khỏi thư mục', async () => {
  const dir = await temp();
  try {
    for (const bad of ['/media/../x.jpg', '/media/a/b.jpg', '/media/a.jpg\0', '/media/x', '/etc/passwd'])
      assert.equal(mediaFilePath(dir, bad), null, bad);
    assert.equal(mediaFilePath(dir, '/media/m1.jpg'), path.join(dir, 'm1.jpg'));
    assert.equal(await readMedia(dir, '/media/khong-co.jpg'), null);
    await writeFile(path.join(dir, 'm1.jpg'), JPG);
    assert.deepEqual(new Uint8Array(await readMedia(dir, '/media/m1.jpg') ?? []), JPG);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('MIME do đuôi quyết định, mặc định là octet-stream', () => {
  assert.equal(mediaContentType('m1.jpg'), 'image/jpeg');
  assert.equal(mediaContentType('m1.pdf'), 'application/pdf');
  assert.equal(mediaContentType('m1.mp4'), 'video/mp4');
  assert.equal(mediaContentType('m1.mp3'), 'audio/mpeg');
  // Một tệp `.bin` không bao giờ được trình duyệt hiểu thành HTML và chạy.
  assert.equal(mediaContentType('m1.bin'), 'application/octet-stream');
  assert.equal(mediaContentType('m1.html'), 'application/octet-stream');
});

test('chỉ mục còn thiếu mới vào hàng đợi; liên kết chỉ tải ảnh xem trước', () => {
  const items: StoredAttachment[] = [
    { kind: 'photo', remote: 'https://a.zadn.vn/1.jpg', src: null, thumb: null },
    { kind: 'photo', remote: 'https://a.zadn.vn/2.jpg', src: 'glass://app/media/x.jpg', thumb: null },
    { kind: 'location', src: null, thumb: null },
    { kind: 'link', url: 'https://vnexpress.net/a', remote: undefined,
      remoteThumb: 'https://zinst-stc.zadn.vn/t.jpg', src: null, thumb: null },
  ];
  const jobs = mediaJobsOf('u-1', '1000', items);
  assert.deepEqual(jobs.map(item => [item.index, item.kind]), [[0, 'photo'], [3, 'link']]);
  // Trang đích của liên kết không bao giờ được gọi; chỉ ảnh xem trước.
  assert.equal(jobs[1].remote, 'https://zinst-stc.zadn.vn/t.jpg');
  // Không có `msgId` thì không có khoá, nên không có việc nào.
  assert.deepEqual(mediaJobsOf('u-1', '', items), []);
  assert.equal(needsDownload(items[0]), true);
  assert.equal(needsDownload(items[1]), false, 'đã có `src` thì không cần tải');
  assert.equal(needsDownload(items[2]), false, 'loại không có nội dung tải được');
});

test('dọn `.part` còn lại từ một lần ghi hỏng', async () => {
  const dir = await temp();
  try {
    await writeFile(path.join(dir, 'm1.jpg.part'), PNG);
    await writeFile(path.join(dir, 'm2.jpg'), PNG);
    await pruneMediaTemp(dir);
    assert.deepEqual((await readdir(dir)).sort(), ['m2.jpg']);
    // Thư mục chưa có: không ném.
    await pruneMediaTemp(path.join(dir, 'khong-co'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('thư mục không tạo được thì trả về số 0, không ném vào đường khởi động', async () => {
  const dir = await temp();
  try {
    // Một tệp thường đứng ở vị trí thư mục: `mkdir` hỏng.
    const file = path.join(dir, 'la-tep');
    await writeFile(file, 'x');
    const stats = await syncMedia({ dir: path.join(file, 'media'), jobs: [job()], fetch: stubFetch(PNG) });
    assert.deepEqual(stats, { downloaded: 0, skipped: 0, failed: 0 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('JXL photo CDN is requested as JPEG and cached paths are restored after metadata refresh', async () => {
  const dir = await temp();
  const calls: string[] = [];
  const results: string[] = [];
  const jobs = [job({ remote: 'https://photo-stal-12.zdn.vn/gr/jxl/abc/photo.jxl' })];
  await syncMedia({ dir, jobs, fetch: stubFetch(JPG, calls), onStored: r => results.push(r.src) });
  assert.deepEqual(calls, ['https://photo-stal-12.zdn.vn/gr/jpg/abc/photo.jpg']);
  const again: string[] = [];
  await syncMedia({ dir, jobs, fetch: stubFetch(JPG, calls), onStored: r => again.push(r.src) });
  assert.equal(calls.length, 1);
  assert.deepEqual(again, results, 'cached file must be published when DB lost its local path');
});

test('a failed thumbnail does not prevent downloading the full image', async () => {
  const dir = await temp();
  const results: string[] = [];
  const stats = await syncMedia({ dir,
    jobs: [job({ remoteThumb: 'https://photo-stal-12.zdn.vn/thumb.jpg' })],
    fetch: (async input => {
      if (String(input).includes('thumb')) throw new Error('thumbnail expired');
      return new Response(JPG);
    }) as typeof fetch,
    onStored: result => results.push(result.src),
  });
  assert.equal(stats.downloaded, 1);
  assert.equal(results.length, 1);
});

test('failed CDN content is reported to end the loading state', async () => {
  const dir = await temp();
  const failed: string[] = [];
  await syncMedia({ dir, jobs: [job()],
    fetch: (async () => new Response('expired', { status: 404 })) as typeof fetch,
    onFailed: item => failed.push(item.msgId),
  });
  assert.deepEqual(failed, ['1000']);
});

test('document CDN accepts file-stal hosts and rejects lookalike domains', () => {
  assert.equal(parseMediaUrl('https://file-stal-8.dlfl.vn/document')?.hostname, 'file-stal-8.dlfl.vn');
  assert.equal(isMediaHost('file-stal-8-te-vnso-pt-39.flchat.vn'), true);
  for (const host of ['file-stal-8.dlfl.vn.evil.com', 'evildlfl.vn', 'other.dlfl.vn']) {
    assert.equal(isMediaHost(host), false);
  }
});

test('XLSX documents from the file CDN are downloaded with their extension', async () => {
  const dir = await temp();
  try {
    const results: string[] = [];
    const stats = await syncMedia({ dir, jobs: [job({ kind: 'file', ext: 'xlsx', remote: 'https://file-stal-8.dlfl.vn/document' })],
      fetch: stubFetch(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), onStored: result => results.push(result.src) });
    assert.equal(stats.downloaded, 1);
    assert.match(results[0], /\.xlsx$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('file redirects follow only approved HTTPS CDN hosts', async () => {
  for (const allowed of [true, false]) {
    const dir = await temp();
    const calls: string[] = [];
    try {
      const stats = await syncMedia({ dir, jobs: [job({ kind: 'file', ext: 'xlsx', remote: 'https://file-stal-8.dlfl.vn/document' })],
        fetch: (async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return calls.length === 1 ? new Response(null, {status: 301, headers: { location: allowed ? 'https://file-stal-8-te-vnso-pt-39.flchat.vn/document' : 'https://example.com/private' }})
            : new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
        }) as typeof fetch });
      assert.equal(stats.downloaded, allowed ? 1 : 0);
      assert.equal(calls.length, allowed ? 2 : 1);
    } finally { await rm(dir, {recursive: true, force: true}); }
  }
});
