import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { signIn } from './signIn';

test.beforeEach(async ({ page }) => { await page.goto('/'); await signIn(page); });
test('fake sign-in gates the app, accepts a display name and signs out cleanly', async ({ page }) => {
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const signInButton = page.getByRole('button', { name: 'Vào bản demo' });
  await expect(signInButton).toBeVisible();
  await expect(page.locator('.conversation')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Tên hiển thị demo' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Tên hiển thị demo' }).fill('  Trần   Demo  ');
  await signInButton.click();
  await expect(page.locator('.conversation')).toHaveCount(7);
  await expect(page.locator('.titlebar')).toBeVisible();
  await page.getByRole('button', { name: 'Mở hồ sơ demo' }).click();
  const profile = page.getByRole('dialog', { name: 'Người dùng demo' });
  await expect(profile).toContainText('Trần Demo');
  await profile.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(signInButton).toBeVisible();
  await expect(page.locator('.conversation')).toHaveCount(0);
  // The session lives in sessionStorage, so a reload returns to the gate.
  await page.reload();
  await expect(signInButton).toBeVisible();
});
test('chat selection, diacritic search, independent filters and unread state', async ({ page }) => {
  const list = page.getByRole('region', { name: 'Danh sách hội thoại' });
  await page.getByRole('searchbox', { name: 'Tìm hội thoại', exact: true }).fill('hoang long');
  await expect(list.locator('.conversation')).toHaveCount(1);
  await list.getByRole('button', { name: /Hoàng Long/ }).click();
  await expect(page.locator('.chat-identity')).toContainText('Hoàng Long');
  await page.getByRole('searchbox', { name: 'Tìm hội thoại', exact: true }).fill('');
  await page.getByRole('button', { name: 'Tùy chọn hội thoại', exact: true }).click();
  await page.getByRole('button', { name: 'Đánh dấu chưa đọc', exact: true }).click();
  await page.getByRole('button', { name: 'Chưa đọc', exact: true }).click();
  await expect(list.locator('.conversation')).toHaveCount(2);
  await page.getByRole('group', { name: 'Lọc hội thoại' }).getByRole('button', { name: 'Nhóm', exact: true }).click();
  await expect(list.locator('.conversation')).toHaveCount(4);
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(list.locator('.conversation')).toHaveCount(2);
});
test('older history loads page by page without moving the reader', async ({ page }) => {
  const more = page.getByRole('button', { name: 'Tải tin nhắn cũ hơn' });
  const rows = page.locator('.messages .message-row');
  await expect(rows).toHaveCount(6);
  // Park the reader mid-thread: a prepend must not yank them to the bottom.
  await page.locator('.messages').evaluate(el => { el.scrollTop = 0; });
  const before = await page.locator('.messages').evaluate(el => el.scrollTop);
  await more.click();
  await expect(rows).toHaveCount(16);
  const after = await page.locator('.messages').evaluate(el => el.scrollTop);
  expect(after).toBeGreaterThan(before);
  await more.click();
  await expect(rows).toHaveCount(26);
  await more.click();
  await expect(rows).toHaveCount(30);
  await expect(more).toBeDisabled();
  await expect(more).toContainText('Đã hết lịch sử mẫu');
  const ids = await page.locator('.messages .reaction').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('aria-label')!.replace(/\D/g, '')).filter(Boolean));
  expect(new Set(ids).size).toBe(ids.length);
});
test('a send passes pending -> sent, and a simulated failure offers retry', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' });
  const rows = page.locator('.messages .message-row');

  // Golden path: the row is inserted as pending, then settles to sent on its own.
  await input.fill('tin bình thường');
  await input.press('Enter');
  await expect(rows.last()).toContainText('tin bình thường');
  await expect(rows.last().locator('[data-status="pending"]')).toBeVisible();
  await expect(rows.last().locator('[data-status="sent"]')).toBeVisible({ timeout: 3000 });

  // Failure path: arm the one-shot switch, then send.
  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  const arm = page.getByRole('switch', { name: 'Giả lập gửi thất bại' });
  await expect(arm).toHaveAttribute('aria-checked', 'false');
  await arm.click();
  await expect(page.getByRole('button', { name: 'Phòng thử demo', exact: true })).toBeFocused();

  await input.fill('tin sẽ hỏng');
  await input.press('Enter');
  await expect(rows.last()).toContainText('tin sẽ hỏng');
  await expect(rows.last().locator('[data-status="failed"]')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#toast')).toContainText('Gửi thất bại');

  // The switch is one-shot, so the very next send is clean.
  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Giả lập gửi thất bại' })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  // Retry the failed message: it returns to pending, then reaches sent.
  const retry = rows.last().getByRole('button', { name: /^Gửi lại tin/ });
  await retry.click();
  await expect(rows.last().locator('[data-status="pending"]')).toBeVisible();
  await expect(rows.last().locator('[data-status="sent"]')).toBeVisible({ timeout: 3000 });
  await expect(rows.last().getByRole('button', { name: /^Gửi lại tin/ })).toHaveCount(0);
});
test('simulated incoming lands elsewhere, raises its badge, and announces itself', async ({ page }) => {
  const list = page.getByRole('region', { name: 'Danh sách hội thoại' });
  const badge = (name: string) => list.locator('.conversation').filter({ hasText: name }).locator('.unread-count');
  await expect(badge('Nhóm Dự án')).toHaveCount(0);

  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  await page.getByRole('button', { name: 'Mô phỏng tin nhắn đến' }).click();
  await expect(page.getByRole('button', { name: 'Phòng thử demo', exact: true })).toBeFocused();

  // The open chat must not be the target, or the badge would clear instantly.
  await expect(badge('Nhóm Dự án')).toHaveCount(1);
  await expect(badge('Nhóm Dự án')).toHaveAttribute('aria-label', '1 chưa đọc');
  await expect(page.locator('#toast')).toContainText('Nhóm Dự án');
  await expect(page.locator('.messages')).not.toContainText('Tin nhắn mẫu vừa đến');

  // Opening the target clears its badge; the message is really there.
  await list.locator('.conversation').filter({ hasText: 'Nhóm Dự án' }).click();
  await expect(page.locator('.messages')).toContainText('Tin nhắn mẫu vừa đến');
  await expect(badge('Nhóm Dự án')).toHaveCount(0);

  // A second simulation rotates to a different sender rather than repeating.
  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  await page.getByRole('button', { name: 'Mô phỏng tin nhắn đến' }).click();
  await expect(list.locator('.unread-count')).toHaveCount(1);
  await expect(list.locator('.conversation').filter({ hasText: 'Nhóm Dự án' }).locator('.unread-count')).toHaveCount(0);
});
test('drafts survive selection; Enter sends text safely and Shift+Enter adds newline', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' });
  await input.fill('draft A');
  await page.locator('.conversation').filter({ hasText: 'Hoàng Long' }).click();
  await expect(input).toHaveValue('');
  await page.locator('.conversation').filter({ hasText: 'Minh Anh' }).click();
  await expect(input).toHaveValue('draft A');
  await input.fill('<img src=x onerror="window.pwned=1">');
  await input.press('Shift+Enter');
  await input.press('A');
  await expect(input).toHaveValue(/\nA$/);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.messages')).toContainText('<img src=x onerror="window.pwned=1">');
  await expect(page.locator('.messages img[src="x"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.messages')).not.toContainText('window.pwned');
});
test('file metadata, emoji and reactions stay in demo memory', async ({ page }) => {
  await page.getByLabel('Tệp demo', { exact: true }).setInputFiles({ name: 'example.txt', mimeType: 'text/plain', buffer: Buffer.from('secret content should never render') });
  await expect(page.locator('.messages')).toContainText('example.txt');
  await expect(page.locator('.messages')).toContainText('Chỉ metadata');
  await expect(page.locator('.messages')).not.toContainText('secret content');
  await page.getByRole('button', { name: 'Thêm emoji' }).click();
  await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' })).toHaveValue(' 😊');
  const reaction = page.getByRole('button', { name: 'Thả cảm xúc demo tin 1', exact: true });
  await reaction.focus(); await reaction.press('Enter');
  await expect(reaction).toHaveAttribute('aria-pressed', 'true');
});
test('settings persist only preferences; modal traps focus and restores it on Escape', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Cài đặt', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Apple Glass Settings' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Giao diện sáng' }).click();
  await page.getByRole('switch', { name: 'Giảm độ mờ' }).click();
  await page.getByRole('switch', { name: 'Hiệu ứng chuyển động' }).click();
  await page.getByRole('button', { name: 'Hoàn tất' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Đóng cài đặt' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Hoàn tất' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveClass(/low-blur/);
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('zalo-glass-prototype-prefs')!)).sort()))
    .toEqual(['glass', 'lowBlur', 'motion', 'theme']);
});
test('OS reduced motion and demo call screen; no external traffic', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/')) external.push(request.url()); });
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
  const opener = page.getByRole('button', { name: 'Gọi thoại demo' });
  await opener.click();
  const call = page.getByRole('dialog', { name: 'Gọi thoại', exact: true });
  await expect(call).toBeVisible();
  await expect(call).toContainText('Không truy cập micro');
  await page.getByRole('button', { name: 'Kết thúc cuộc gọi mẫu' }).click();
  await expect(call).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(external).toEqual([]);
});

test('a mocked call rings, connects, counts time and holds its toggles', async ({ page }) => {
  await page.getByRole('button', { name: 'Gọi thoại demo' }).click();
  const call = page.getByRole('dialog', { name: 'Gọi thoại', exact: true });
  const status = call.locator('.call-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-phase', 'ringing');
  await expect(status).toHaveText('Đang đổ chuông');
  await expect(call.getByRole('button', { name: 'Tắt camera' })).toHaveCount(0);

  // The fake connection completes on its own, then the clock starts.
  await expect(status).toHaveAttribute('data-phase', 'connected', { timeout: 4000 });
  await expect(status).toHaveText('00:00');
  await expect(status).toHaveText('00:01', { timeout: 3000 });

  const mute = call.getByRole('button', { name: 'Tắt tiếng' });
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  const speaker = call.getByRole('button', { name: 'Loa ngoài' });
  await expect(speaker).toHaveAttribute('aria-pressed', 'true');
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-pressed', 'false');
  // Toggles are independent: muting never flips the speaker.
  await expect(mute).toHaveAttribute('aria-pressed', 'true');

  await call.getByRole('button', { name: 'Kết thúc cuộc gọi mẫu' }).click();
  await expect(call).not.toBeVisible();
});

test('a mocked video call exposes a camera toggle that is absent on voice', async ({ page }) => {
  await page.getByRole('button', { name: 'Gọi video demo' }).click();
  const call = page.getByRole('dialog', { name: 'Gọi video', exact: true });
  const camera = call.getByRole('button', { name: 'Tắt camera' });
  await expect(camera).toHaveAttribute('aria-pressed', 'false');
  await camera.click();
  await expect(camera).toHaveAttribute('aria-pressed', 'true');
  await call.getByRole('button', { name: 'Kết thúc cuộc gọi mẫu' }).click();
  await expect(call).not.toBeVisible();
  await page.getByRole('button', { name: 'Gọi thoại demo' }).click();
  await expect(page.getByRole('dialog', { name: 'Gọi thoại', exact: true }).getByRole('button', { name: 'Tắt camera' })).toHaveCount(0);
});

test('losing the network blocks sending, and reconnecting flushes the waiting message', async ({ page }) => {
  const banner = page.locator('.connection-banner');
  await expect(banner).toHaveCount(0);

  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Giả lập mất mạng' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-connection', 'offline');
  await expect(banner).toContainText('Ngoại tuyến');
  const input = page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' });
  await expect(input).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Gửi tin nhắn demo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Chọn tệp demo' })).toBeDisabled();
  await expect(page.locator('.composer-hint')).toContainText('Ngoại tuyến');

  // Recovery is a real transition: syncing first, then the queued mail settles.
  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  await page.getByRole('switch', { name: 'Giả lập mất mạng' }).click();
  await expect(banner).toHaveAttribute('data-connection', 'syncing', { timeout: 1500 });
  await expect(banner).toContainText('Đang đồng bộ');
  await expect(banner).toHaveCount(0, { timeout: 4000 });
  await expect(input).toBeEnabled();
  await expect(page.locator('#toast')).toContainText('Đã kết nối lại');
});

test('an in-flight send stays pending through an outage and settles on recovery', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' });
  await input.fill('tin đang chờ mạng');
  await input.press('Enter');
  const bubble = page.locator('.message-row').last();
  await expect(bubble.locator('[data-status="pending"]')).toBeVisible();

  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  await page.getByRole('switch', { name: 'Giả lập mất mạng' }).click();
  await page.keyboard.press('Escape');
  // The settle timer fires during the outage and must not mark it sent.
  await page.waitForTimeout(900);
  await expect(bubble.locator('[data-status="pending"]')).toBeVisible();

  await page.getByRole('button', { name: 'Phòng thử demo', exact: true }).click();
  await page.getByRole('switch', { name: 'Giả lập mất mạng' }).click();
  await expect(bubble.locator('[data-status="sent"]')).toBeVisible({ timeout: 5000 });
});

test('secondary glass screens open, label themselves as demo and restore focus', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const info = page.getByRole('button', { name: 'Mở thông tin hội thoại' });
  await info.click();
  const infoDialog = page.getByRole('dialog', { name: 'Minh Anh', exact: true });
  await expect(infoDialog).toBeVisible();
  await expect(infoDialog).toContainText('Bố cục demo · Không kết nối Zalo');
  await page.keyboard.press('Escape');
  await expect(infoDialog).not.toBeVisible();
  await expect(info).toBeFocused();

  await page.getByRole('button', { name: 'Mở tệp mẫu Kế hoạch dự án v2.pdf' }).click();
  const media = page.getByRole('dialog', { name: 'Tệp đính kèm mẫu' });
  await expect(media).toBeVisible();
  await expect(media.locator('.media-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Đóng trình xem' }).click();
  await expect(media).not.toBeVisible();

  await page.getByRole('button', { name: 'Thông báo demo' }).click();
  const notices = page.getByRole('dialog', { name: 'Thông báo mẫu' });
  await expect(notices).toBeVisible();
  await page.getByRole('button', { name: 'Đóng thông báo' }).click();
  await expect(notices).not.toBeVisible();

  await page.getByRole('button', { name: 'Mở hồ sơ demo' }).click();
  const profile = page.getByRole('dialog', { name: 'Người dùng demo' });
  await expect(profile).toBeVisible();
  await expect(profile).toContainText('Không gọi Zalo');
  await page.getByRole('button', { name: 'Đóng hồ sơ' }).click();
  await expect(profile).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('contacts and groups open real member rows from the seeded data', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Mục chính' });
  await nav.getByRole('button', { name: 'Nhóm', exact: true }).click();
  await expect(page.locator('.feature-card')).toHaveCount(4);
  await expect(page.locator('.feature-card').filter({ hasText: 'Nhóm Dự án' })).toContainText('3 thành viên');

  const infoButton = page.getByRole('button', { name: 'Thông tin Nhóm Dự án' });
  await infoButton.click();
  const info = page.getByRole('dialog', { name: 'Nhóm Dự án', exact: true });
  await expect(info).toBeVisible();
  const members = info.getByRole('list', { name: 'Thành viên mẫu' });
  await expect(members.locator('li')).toHaveCount(3);
  await expect(members).toContainText('Nam');
  await expect(members).toContainText('Quản trị nhóm');
  await expect(members).toContainText('Trưởng nhóm');
  await expect(info).not.toContainText('không có trong dữ liệu mẫu');
  await expect(info).toContainText('THÀNH VIÊN MẪU · 3');
  await page.keyboard.press('Escape');
  await expect(info).not.toBeVisible();

  // A direct contact has no member list, so the section must not render for it.
  await nav.getByRole('button', { name: 'Danh bạ', exact: true }).click();
  await expect(page.locator('.feature-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Thông tin Hoàng Long' }).click();
  const direct = page.getByRole('dialog', { name: 'Hoàng Long', exact: true });
  await expect(direct).toContainText('Liên hệ hư cấu');
  await expect(direct.locator('.info-members')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(direct).not.toBeVisible();
});
test('navigation, pinned ordering and in-chat search', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Mục chính' });
  await nav.getByRole('button', { name: 'Danh bạ', exact: true }).click();
  await expect(page.locator('.feature-card')).toHaveCount(2);
  await page.locator('.feature-card').filter({ hasText: 'Hoàng Long' }).click();
  await expect(page.locator('.chat-identity')).toContainText('Hoàng Long');
  await page.getByRole('button', { name: 'Tùy chọn hội thoại', exact: true }).click();
  await page.getByRole('button', { name: 'Ghim hội thoại', exact: true }).click();
  await expect(page.locator('.conversation').nth(1)).toContainText('Hoàng Long');
  await page.locator('.conversation').filter({ hasText: 'Minh Anh' }).click();
  const search = page.getByRole('button', { name: 'Tìm trong hội thoại', exact: true });
  await search.click();
  await page.getByRole('searchbox', { name: 'Tìm nội dung hội thoại' }).fill('hop nhe');
  await expect(page.locator('.search-match')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await nav.getByRole('button', { name: 'Nhóm', exact: true }).click();
  await expect(page.locator('.feature-card')).toHaveCount(4);
  for (const name of ['Nhật ký', 'Cloud', 'Công cụ']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.feature-placeholder')).toContainText('chưa kết nối');
  }
  await page.getByRole('button', { name: 'Về màn hình chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' })).toBeVisible();
});
test('an attachment uploads, completes, and can be cancelled mid-flight', async ({ page }) => {
  const picker = page.locator('input[aria-label="Tệp demo"]');
  await picker.setInputFiles({ name: 'hop-dong.pdf', mimeType: 'application/pdf', buffer: Buffer.from('demo') });
  const block = page.locator('.file-block').filter({ hasText: 'hop-dong.pdf' });
  await expect(block).toHaveCount(1);
  const bar = block.getByRole('progressbar');
  await expect(bar).toBeVisible();
  await expect(block).toContainText('Đang tải lên');
  await expect(block.getByRole('button', { name: 'Hủy tải hop-dong.pdf' })).toBeVisible();
  // The timer is real, so the bar must travel before it settles.
  await expect(block).toContainText('Đã tải lên', { timeout: 5000 });
  await expect(bar).toHaveAttribute('aria-valuenow', '100');
  await expect(block.getByRole('button', { name: 'Hủy tải hop-dong.pdf' })).toHaveCount(0);

  await picker.setInputFiles({ name: 'bao-cao.docx', mimeType: 'application/msword', buffer: Buffer.from('demo') });
  const second = page.locator('.file-block').filter({ hasText: 'bao-cao.docx' });
  await expect(second.getByRole('progressbar')).toBeVisible();
  await second.getByRole('button', { name: 'Hủy tải bao-cao.docx' }).click();
  await expect(second.getByRole('progressbar')).toHaveCount(0);
  await expect(second).toContainText('bao-cao.docx');
});
test('an incoming attachment downloads on demand and settles at done', async ({ page }) => {
  const block = page.locator('.file-block').filter({ hasText: 'Kế hoạch dự án v2.pdf' });
  const start = block.getByRole('button', { name: 'Tải xuống mẫu Kế hoạch dự án v2.pdf' });
  await expect(start).toBeVisible();
  await start.click();
  await expect(block.getByRole('progressbar')).toBeVisible();
  await expect(block).toContainText('Đang tải xuống', { timeout: 2000 });
  await expect(block).toContainText('Đã tải xuống', { timeout: 5000 });
  await expect(start).toHaveCount(0);
});
for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768]]) {
  test(`layout and visual evidence ${width}x${height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(page.locator('.conversation')).toHaveCount(7);
    await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('reports/screenshots', { recursive: true });
    await page.screenshot({ path: `reports/screenshots/react-dark-${width}x${height}.png` });
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await page.getByRole('button', { name: 'Giao diện sáng' }).click();
    await page.getByRole('button', { name: 'Hoàn tất' }).click();
    await page.screenshot({ path: `reports/screenshots/react-light-${width}x${height}.png` });
    expect(errors).toEqual([]);
  });
}
