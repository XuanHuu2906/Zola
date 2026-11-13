import { app, BrowserWindow, ipcMain, Notification, protocol, session, dialog, shell } from 'electron';
import path from 'node:path';
import { readFile, copyFile, realpath, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { APP_ORIGIN, DEV_ORIGIN, CSP, isAllowedRequest, isAvatarPath, isMediaPath, isTrustedDocument, resourcePath } from './security.js';
import { IPC, THREAD_ID_MAX, readForwardRequest, readMessagesRequest, readReactionRequest, readReadRequest, readRecallRequest, readRenderError, readSendRequest, readToggleRequest, type ThreadKind } from './ipc-contract.js';
import { installCrashGuard, type CrashReport } from './crash.js';
import { createLogFile } from './log-file.js';
import { createSessionStore } from './protocol/session.js';
import { createZaloClient } from './protocol/zalo-client.js';
import { CallService } from './calls/service.js';
import { createNotifications } from './notifications.js';
import { openDb } from './db/schema.js';
import { readAvatar, syncAvatars, pruneTemp } from './avatars.js';
import { mediaFilePath, mediaContentType, pruneMediaTemp, readMedia, syncMedia, type MediaJob } from './media.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'glass', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const development = !app.isPackaged && process.env.GLASS_DEV === '1';
const rendererRoot = path.join(__dirname, '../dist');
// Electron requires sessionData to be configured synchronously before ready.
// Windows' portable target runs from a real directory, so the profile can sit next
// to the executable. An AppImage is mounted read-only at a path that changes every
// launch, so on Linux and macOS the profile goes to the platform's user-data
// directory instead — otherwise the Zalo session would be lost on every quit.
const profileRoot = process.env.PORTABLE_EXECUTABLE_DIR
  ? process.env.PORTABLE_EXECUTABLE_DIR
  : !app.isPackaged ? app.getAppPath()
    : process.platform === 'win32' ? path.dirname(process.execPath)
      : path.join(app.getPath('appData'), 'zalo-apple-glass-ui');
// Keep the established profile directory name so upgrades retain encrypted Zalo sessions.
const dataRoot = path.join(profileRoot, '.glass-demo-data');
mkdirSync(dataRoot, { recursive: true });
app.setPath('userData', dataRoot);
app.setPath('sessionData', dataRoot);

/**
 * Một tiến trình cho mỗi profile.
 *
 * Hai bản chạy cùng lúc trên một profile sẽ mở hai listener cho **cùng một phiên**
 * Zalo; máy chủ đá một bên (mã 3000/3003) và bên kia thấy `replaced`. Tệ hơn, từ
 * khi lịch sử được tải theo trang, mỗi tiến trình giữ con trỏ `msgId` riêng nên
 * chúng xin trùng dữ liệu. Khoá được lấy sau `setPath('userData')` nên nó gắn với
 * profile: hai bản portable ở hai thư mục khác nhau vẫn chạy song song được, vì
 * đó là hai tài khoản/phiên khác nhau chứ không phải hai cửa sổ của một app.
 */
const primaryInstance = app.requestSingleInstanceLock();

if (primaryInstance) {
  // Bản thứ hai chỉ đánh thức bản chính; cửa sổ của nó không bao giờ được tạo.
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
} else {
  // Thoát trước khi ghép IPC hay tạo cửa sổ: không profile thứ hai nào bị chạm vào.
  app.quit();
}

let window: BrowserWindow | null = null;
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

/**
 * Ranh giới tin cậy dùng chung cho cả `ipcMain.handle` và `ipcMain.on`: chỉ frame
 * chính của cửa sổ chính, và chỉ khi URL là tài liệu app thật (không phải iframe
 * hay trang bị chuyển hướng tới).
 */
const isTrusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean =>
  !!window && event.sender === window.webContents
  && event.senderFrame === window.webContents.mainFrame
  && isTrustedDocument(event.senderFrame.url, development);

const push = (channel: string, payload: unknown): void => {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
};
const notices = createNotifications({
  create: (title, body) => new Notification({ title, body, silent: false }),
  window: () => {
    const win = window;
    if (!win) return null;
    return {
      isDestroyed: () => win.isDestroyed(), isMinimized: () => win.isMinimized(),
      restore: () => win.restore(), show: () => win.show(), focus: () => win.focus(),
      openThread: id => win.webContents.send('notice:openThread', id),
    };
  },
});

/**
 * Nhật ký chẩn đoán listener, xoay vòng để một phiên dài không ghi vô hạn. Việc
 * xoay nằm ở `log-file.ts` để test được bằng node mà không cần Electron.
 *
 * Tạo ở đây không chạm đĩa: `createLogFile` chỉ đọc kích thước ở lần ghi đầu, nên
 * bản thứ hai của app (đã bị khoá ở trên) cũng không tạo ra file rỗng.
 */
const listenerLog = createLogFile(path.join(dataRoot, 'live-listener.log'));
const logDebug = (event: string, data: Record<string, unknown>): void => listenerLog.write(event, data);
/**
 * Thư mục avatar: ngoài `dist/` vì nội dung của nó do máy chủ Zalo quyết định,
 * không phải bản build. `pruneTemp` dọn `.part` còn lại của lần tải bị cắt.
 */
const avatarDir = path.join(dataRoot, 'avatars');
void pruneTemp(avatarDir);
/**
 * Thư mục tệp đính kèm, cùng lý do và cùng chỗ đứng với `avatarDir`.
 *
 * Nội dung ở đây là ảnh/tệp người dùng gửi, nên nó lớn hơn avatar nhiều và
 * không bao giờ được đóng gói vào `dist/`.
 */
const mediaDir = path.join(dataRoot, 'media');
void pruneMediaTemp(mediaDir);

/**
 * Hàng đợi avatar. Sự kiện `avatar` của lớp Zalo đến **theo từng hội thoại**
 * ngay sau khi danh sách bạn bè về; gom chúng lại rồi tải một mẻ tuần tự, thay
 * vì mở 238 lần tải song song tới cùng một CDN.
 *
 * Đây là biến module chứ không phải tham số vì một lần tải có thể đang chạy khi
 * sự kiện tiếp theo tới: khi đó chỉ ghi vào bản đồ, vòng `while` đọc lại và gộp
 * thành mẻ kế tiếp.
 */
const avatarQueue = new Map<string, { remote: string; current: string | null }>();
let avatarRunning = false;

function queueAvatars(
  client: ReturnType<typeof createZaloClient>,
  entries: { threadId: string; remote: string; current: string | null }[],
): void {
  for (const entry of entries) avatarQueue.set(entry.threadId, { remote: entry.remote, current: entry.current });
  if (avatarRunning) return;
  avatarRunning = true;
  void (async () => {
    try {
      // Lặp tới khi hàng đợi rỗng: trong lúc đang tải, sự kiện mới có thể thêm
      // vào. `syncAvatars` đã tự bỏ qua ảnh có sẵn trên đĩa.
      while (avatarQueue.size) {
        const jobs = [...avatarQueue].map(([threadId, job]) => ({ threadId, ...job }));
        avatarQueue.clear();
        const stats = await syncAvatars({
          dir: avatarDir, jobs, fetch: globalThis.fetch,
          onStored: (threadId, fileName) => client.setAvatar(threadId, fileName),
          log: (event, data) => logDebug(event, data),
        });
        logDebug('avatars', { ...stats });
      }
    } catch (error) {
      logDebug('avatars', { ok: false, message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    } finally { avatarRunning = false; }
  })();
}

/**
 * Hàng đợi tệp đính kèm. Khoá theo `<threadId>|<msgId>|<index>` chứ không chỉ
 * theo tin: một tin có thể mang cả album, và mỗi tệp là một lần tải riêng.
 *
 * Giống `avatarQueue`, đây là biến module vì một mẻ tải có thể đang chạy khi tin
 * tiếp theo tới; khi đó chỉ ghi vào bản đồ và vòng `while` gộp mẻ kế tiếp.
 */
const mediaQueue = new Map<string, MediaJob & { kindOfThread: ThreadKind }>();
let mediaRunning = false;

function queueMedia(client: ReturnType<typeof createZaloClient>,
  jobs: (MediaJob & { kindOfThread: ThreadKind })[]): void {
  for (const job of jobs) mediaQueue.set(`${job.threadId}|${job.msgId}|${job.index}`, job);
  if (mediaRunning) return;
  mediaRunning = true;
  void (async () => {
    try {
      while (mediaQueue.size) {
        const batch = [...mediaQueue.values()];
        mediaQueue.clear();
        // Gom theo tin: `setMedia` sửa **một** hàng, nên mười tệp của cùng một
        // album phải đi vào một lần gọi thay vì mười lần ghi đè lên nhau — và
        // một lần gọi là một lần phát tin, không phải mười.
        const kinds = new Map<string, ThreadKind>();
        for (const job of batch) kinds.set(`${job.threadId}|${job.msgId}`, job.kindOfThread);
        const stats = await syncMedia({
          dir: mediaDir, jobs: batch, fetch: globalThis.fetch,
          onFailed: job => client.setMedia(job.threadId, job.msgId,
            kinds.get(`${job.threadId}|${job.msgId}`) ?? 'user',
            new Map([[job.index, { src: null, thumb: null, failed: true }]])),
          onStored: result => client.setMedia(result.threadId, result.msgId,
            kinds.get(`${result.threadId}|${result.msgId}`) ?? 'user',
            new Map([[result.index, { src: result.src, thumb: result.thumb }]])),
          log: (event, data) => logDebug(event, data),
        });
        logDebug('media', { ...stats });
      }
    } catch (error) {
      logDebug('media', { ok: false, message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    } finally { mediaRunning = false; }
  })();
}

/**
 * Bắt lỗi toàn cục **trước** mọi thứ khác: mọi `throw` không có `catch` trong
 * main đều dừng ở đây. Không có nó, Node in stack ra stderr rồi thoát — bản đóng
 * gói không có DevTools, nên người dùng chỉ thấy cửa sổ biến mất.
 *
 * `fatal` (lỗi thứ ba trong một phút) mới thực sự thoát: chạy tiếp một tiến trình
 * đang hỏng vòng lặp thì tệ hơn là dừng. Logic đếm nằm ở `crash.ts` để test được.
 */
function reportCrash(report: CrashReport): void {
  logDebug(`crash-${report.kind}`, { message: report.message, fatal: report.fatal });
  // Báo cho renderer để người dùng thấy app vừa gặp lỗi — im lặng ghi log nghĩa
  // là họ chỉ thấy một cửa sổ hành xử lạ mà không biết tại sao.
  push(IPC.evCrash, { message: report.message });
  if (report.fatal) app.exit(1);
}

let chat: ReturnType<typeof createZaloClient> | null = null;
const calls = new CallService({
  runtime: process.env.ZOLA_CALL_RUNTIME || (app.isPackaged
    ? path.join(process.resourcesPath, 'zola-call-runtime')
    : path.join(app.getAppPath(), '.zola-call-runtime')),
  signal: request => {
    if (!chat) return Promise.reject(new Error('Not signed in'));
    return chat.callSignal(request);
  },
  peer: id => chat?.callPeer(id) ?? null,
  push: event => push('calls:event', event),
});

/**
 * Lớp zca-js được tạo lười: app vẫn mở được kể cả khi gói không nạp
 * được (thiếu bản cài, asar hỏng). Lỗi được báo bằng `error` state, không ném ra
 * vòng lặp sự kiện của Electron.
 */
function chatClient(): ReturnType<typeof createZaloClient> | null {
  if (chat) return chat;
  try {
    chat = createZaloClient(createSessionStore(dataRoot), {
      login: state => {
        if (state.status !== 'logged-in') notices.clear();
        push(IPC.evLoginState, state);
      },
      connection: state => {
        if (state !== 'connected') calls.dispose();
        push(IPC.evConnection, state);
      },
      callControl: data => calls.control(data),
      message: message => {
        push(IPC.evMessageUpsert, message);
        // Ảnh/tệp đi vào hàng đợi tải **sau** khi tin đã lên UI: bong bóng hiện
        // ngay với ô chờ, thay vì cả hội thoại đứng im chờ một tấm ảnh.
        //
        // `message` đi qua IPC đã bị bóc URL (`toIpcMessage`), nên việc tải phải
        // lấy danh sách từ DB — đó là nơi còn `remote`. `client.mediaJobs` đọc
        // đúng hàng vừa ghi và trả việc cần làm.
        const client = chat;
        if (client) void client.mediaJobs(message.threadId, message.msgId ?? '', message.kind)
          .then(jobs => queueMedia(client, jobs)).catch(error => logDebug('media-prepare', {
            ok: false, error: error instanceof Error ? error.name : 'unknown',
          }));
      },
      thread: thread => push(IPC.evThreadUpsert, thread),
      // Ảnh đại diện: URL từ xa **chỉ** đi tới đây. Main tải về đĩa rồi phát
      // `thread` với `glass://app/avatars/…`; renderer không bao giờ thấy CDN.
      avatar: (threadId, remote, current) => {
        if (chat) queueAvatars(chat, [{ threadId, remote, current }]);
      },
      // Tệp đính kèm tải xong: cùng `msgId` với tin đã phát, nên renderer sửa
      // tại chỗ. Đi kênh riêng để tầng trên không phải phân biệt "tin mới" với
      // "tin cũ vừa có thêm ảnh" bằng cách so nội dung.
      media: message => push(IPC.evMedia, message),
      // Tiến trình đồng bộ: chỉ số đếm và giai đoạn, không nội dung tin.
      sync: (phase, stats) => push(IPC.evSync, { phase, ...stats }),
      catchUp: progress => push(IPC.evCatchUp, progress),
      debug: logDebug,
    }, {
      cache: {
        // Mỗi tài khoản một file `cache-<ownId>.db` trong thư mục dữ liệu. Mở hỏng
        // (quyền, đĩa đầy, DB cũ không đọc được) thì trả `null`: app chạy tiếp
        // không có cache, đúng như trước khi có giai đoạn 6.
        open: ownId => {
          try {
            return openDb(dataRoot, ownId);
          } catch (error) {
            logDebug('cache', { op: 'open', ok: false,
              message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
            return null;
          }
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    push(IPC.evLoginState, { status: 'error',
      message: `Không nạp được lớp Zalo: ${message.slice(0, 120)}`, retryable: false });
  }
  return chat;
}

function registerChatHandlers() {
  ipcMain.handle('media:action', async (event, payload: unknown) => {
    if (!isTrusted(event) || !payload || typeof payload !== 'object') return { ok: false, message: 'Yêu cầu không hợp lệ.' };
    const { src, name, action } = payload as Record<string, unknown>;
    if (typeof src !== 'string' || typeof name !== 'string' || !['open', 'save'].includes(String(action))) return { ok: false, message: 'Yêu cầu không hợp lệ.' };
    try {
      const url = new URL(src);
      if (url.protocol !== 'glass:' || url.hostname !== 'app' || url.port || url.username || url.password || url.search || url.hash || !isMediaPath(url.pathname)) throw new Error('Invalid media');
      const file = mediaFilePath(mediaDir, url.pathname);
      if (!file || path.dirname(await realpath(file)) !== await realpath(mediaDir) || !(await stat(file)).isFile()) throw new Error('Missing media');
      const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || path.basename(file);
      if (action === 'save') {
        const result = await dialog.showSaveDialog({ title: 'Lưu tệp', defaultPath: path.join(app.getPath('downloads'), safeName) });
        if (result.canceled || !result.filePath) return { ok: true, canceled: true };
        await copyFile(file, result.filePath);
      } else {
        // Use the original name so the OS can select the correct application.
        const folder = path.join(dataRoot, 'opened-media', path.basename(file));
        await import('node:fs/promises').then(fs => fs.mkdir(folder, { recursive: true }));
        const target = path.join(folder, safeName);
        await copyFile(file, target);
        const error = await shell.openPath(target);
        if (error) return { ok: false, message: 'Không mở được tệp. Hãy tải về và chọn ứng dụng phù hợp.' };
      }
      return { ok: true };
    } catch { return { ok: false, message: 'Không truy cập được tệp. Hãy mở lại hội thoại để tải lại.' }; }
  });
  ipcMain.handle('calls:status', event => isTrusted(event) ? calls.snapshot() : { available: false });
  ipcMain.handle('calls:start', (event, payload: unknown) => {
    if (!isTrusted(event) || !payload || typeof payload !== 'object') return { ok: false, message: 'Yêu cầu không hợp lệ.' };
    const p = payload as { id?: unknown; video?: unknown };
    if (typeof p.id !== 'string' || !/^[0-9A-Za-z_-]{1,128}$/.test(p.id) || typeof p.video !== 'boolean') return { ok: false, message: 'Liên hệ không hợp lệ.' };
    try { calls.start(p.id, p.video); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Không mở được cuộc gọi.' }; }
  });
  ipcMain.on('calls:action', (event, action: unknown, value: unknown) => {
    if (isTrusted(event) && typeof action === 'string') calls.action(action, value);
  });
  ipcMain.handle(IPC.login, event => { if (isTrusted(event)) void chatClient()?.login(); });
  ipcMain.handle(IPC.logout, event => { if (isTrusted(event)) void chatClient()?.logout(); });
  ipcMain.handle(IPC.reconnect, event => { if (isTrusted(event)) chatClient()?.reconnect(); });
  // Xin điện thoại đẩy lịch sử cũ (Sync V2). Tin về sau qua `evMessageUpsert`
  // như mọi tin khác — nên UI không cần nhánh riêng cho tin đồng bộ.
  ipcMain.handle(IPC.syncFromPhone, async event => {
    if (!isTrusted(event)) return { ok: false, code: 'denied' };
    const client = chatClient();
    if (!client) return { ok: false, code: 'not-ready', message: 'chưa đăng nhập' };
    return client.syncFromPhone();
  });
  ipcMain.handle(IPC.listConversations, event => {
    if (!isTrusted(event)) return [];
    return chatClient()?.listConversations() ?? [];
  });
  ipcMain.on(IPC.setActiveThread, (event, payload: unknown) => {
    if (!isTrusted(event)) return;
    if (payload !== null && (typeof payload !== 'string' || payload.length === 0
      || payload.length > THREAD_ID_MAX)) return;
    chatClient()?.setActiveThread(payload);
  });
  ipcMain.handle(IPC.getMessages, async (event, payload: unknown) => {
    const request = readMessagesRequest(payload);
    if (!isTrusted(event) || !request) return { messages: [], hasMore: false };
    const client = chatClient();
    if (!client) return { messages: [], hasMore: false };
    // `kind` không nằm trong payload của plan §5.1, nên loại thread được tra từ
    // danh sách đã có thay vì tin một trường do renderer tự khai.
    const threads = await client.listConversations();
    const kind = threads.find(item => item.id === request.threadId)?.kind ?? 'user';
    const page = await client.getMessages(request.threadId, kind, request.before);
    // Tệp trong một trang lịch sử cũng phải được tải, không chỉ tệp của tin
    // vừa tới. Trang đi qua IPC đã bị bóc URL (`toIpcMessage`), nên danh sách
    // việc phải đọc lại từ DB — nơi `src` còn `null` và `remote` còn đó. Không
    // có vòng này thì cuộn lịch sử chỉ hiện ô trống vĩnh viễn: sự kiện
    // `evMessageUpsert` chỉ phát cho tin **mới**, không phát cho trang cũ.
    if (chat) {
      for (const message of page.messages) {
        // Chỉ tin còn tệp chưa có đường dẫn cục bộ mới cần một lần tải.
        if (!message.msgId || !message.attachments?.some(item => !item.src)) continue;
        queueMedia(chat, await chat.mediaJobs(request.threadId, message.msgId, kind));
      }
    }
    return page;
  });
  const send = (channel: string) => ipcMain.handle(channel, (event, payload: unknown) => {
    const request = readSendRequest(payload);
    if (!isTrusted(event) || !request) {
      const clientId = typeof (payload as { clientId?: unknown })?.clientId === 'string'
        ? String((payload as { clientId: string }).clientId) : '';
      return { ok: false, clientId, error: 'Yêu cầu không hợp lệ.' };
    }
    const client = chatClient();
    if (!client) return { ok: false, clientId: request.clientId, error: 'Chưa đăng nhập.' };
    return client.send(request);
  });
  // Gửi lại dùng cùng đường với gửi mới: `clientId` giữ nguyên nên UI nối được
  // bong bóng tạm với tin thật (plan §5.4).
  send(IPC.sendMessage);
  send(IPC.retryMessage);
  ipcMain.handle(IPC.markRead, (event, payload: unknown) => {
    const request = readReadRequest(payload);
    if (!isTrusted(event) || !request) return;
    return chatClient()?.markRead(request.threadId, request.kind);
  });
  // Ghim và đánh dấu chưa đọc đều là **trạng thái máy chủ**; hàm trả `false`
  // khi Zalo từ chối, và renderer phải trả lại cờ cũ thay vì giữ một ghim chỉ
  // tồn tại trên màn hình này.
  ipcMain.handle(IPC.setPinned, (event, payload: unknown) => {
    const request = readToggleRequest(payload);
    if (!isTrusted(event) || !request) return false;
    return chatClient()?.setPinned(request.threadId, request.kind, request.value) ?? false;
  });
  ipcMain.handle(IPC.setUnread, (event, payload: unknown) => {
    const request = readToggleRequest(payload);
    if (!isTrusted(event) || !request) return false;
    return chatClient()?.setUnread(request.threadId, request.kind, request.value) ?? false;
  });
  // Cảm xúc cũng là trạng thái máy chủ. `icon: ''` là gỡ, nên validator phải
  // chấp nhận chuỗi rỗng — đó là lý do nó là một validator riêng chứ không dùng
  // lại `readSendRequest` (hàm đó đòi text không rỗng).
  ipcMain.handle(IPC.react, (event, payload: unknown) => {
    const request = readReactionRequest(payload);
    if (!isTrusted(event) || !request) return false;
    return chatClient()?.react(request.threadId, request.kind, request.msgId, request.icon) ?? false;
  });
  // Thu hồi cũng là trạng thái máy chủ, cùng nguyên tắc với ghim và cảm xúc:
  // Zalo từ chối thì trả `false` để renderer trả lại bong bóng.
  ipcMain.handle(IPC.recall, (event, payload: unknown) => {
    const request = readRecallRequest(payload);
    if (!isTrusted(event) || !request) return false;
    return chatClient()?.recall(request.threadId, request.kind, request.msgId) ?? false;
  });
  // Chuyển tiếp tin nhắn đến một hội thoại.
  ipcMain.handle(IPC.forwardMessage, (event, payload: unknown) => {
    const request = readForwardRequest(payload);
    if (!isTrusted(event) || !request) return false;
    return chatClient()?.forward(request.threadId, request.kind, request.text, request.msgId, request.ts) ?? false;
  });
}

function createWindow() {
  window = new BrowserWindow({
    icon: path.join(app.getAppPath(), 'build/icon.png'),
    width: 1440, height: 900, minWidth: 1000, minHeight: 700, show: false,
    title: 'Zola · Zalo', frame: false, backgroundColor: '#264eab',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, devTools: development },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  // Lỗi render đã có `ErrorBoundary` lo phần UI; đây chỉ ghi lại để lần sau đọc
  // log biết app đã hỏng ở đâu. `webContents` vẫn sống nên log ghi được.
  window.webContents.on('render-process-gone', (_event, details) => {
    logDebug('renderer-gone', { reason: details.reason, exitCode: details.exitCode });
  });
  window.webContents.on('unresponsive', () => logDebug('renderer-unresponsive', {}));
  void window.loadURL(development ? DEV_ORIGIN : `${APP_ORIGIN}/index.html`).catch(error => {
    console.error('Renderer load failed:', error.message);
    app.exit(1);
  });
}

void app.whenReady().then(async () => {
  // `app.quit()` ở trên chỉ *lên lịch* thoát. Chặn ở đây để bản thứ hai không mở
  // protocol, IPC hay cửa sổ trong lúc Electron xử lý lệnh thoát — mọi handler đã
  // đăng ký sẽ sống sót tới khi tiến trình chết thật.
  if (!primaryInstance) return;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    permission === 'media' && contents === window?.webContents && calls.active()
    && details.isMainFrame && isTrustedDocument(details.requestingUrl, development)
    && 'mediaTypes' in details && !!details.mediaTypes && details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'video'),
  ));
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    permission === 'media' && contents === window?.webContents && calls.active()
    && details.isMainFrame && details.mediaType === 'video'
    && isTrustedDocument(contents?.getURL() || origin, development),
  );
  session.defaultSession.on('will-download', event => event.preventDefault());
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url, development) }));
  protocol.handle('glass', async request => {
    if (request.method !== 'GET') return new Response('Not found', { status: 404 });
    // Avatar nằm ngoài `dist/`: main tải về `<dataRoot>/avatars/` lúc chạy, nên nó
    // được phục vụ từ thư mục dữ liệu chứ không qua allow-list asset đóng gói.
    // Vẫn là `glass://app` nên CSP không phải nới — xem `electron/avatars.ts`.
    if (isAvatarPath(new URL(request.url).pathname)) {
      const bytes = await readAvatar(avatarDir, new URL(request.url).pathname);
      if (!bytes) return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(bytes), { headers: {
        // Đuôi đã được `isAvatarPath` chốt là png hoặc jpg, nên loại nội dung
        // suy từ chính đường dẫn chứ không từ file trên đĩa.
        'Content-Type': new URL(request.url).pathname.endsWith('.png') ? 'image/png' : 'image/jpeg',
        'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
        // Ảnh đổi khi người dùng đổi avatar; một ngày là đủ để đỡ tải lại mỗi lần
        // mở, mà vẫn tự làm mới mà không cần xoá cache.
        'Cache-Control': 'private, max-age=86400',
      } });
    }
    // Tệp đính kèm cũng vậy: `<dataRoot>/media/`, cùng origin nên CSP không đổi.
    // Đuôi tệp quyết định `Content-Type`, và `nosniff` giữ trình duyệt không tự
    // đoán lại — một `.bin` không bao giờ được hiểu thành HTML.
    if (isMediaPath(new URL(request.url).pathname)) {
      const bytes = await readMedia(mediaDir, new URL(request.url).pathname);
      if (!bytes) return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': mediaContentType(new URL(request.url).pathname),
        'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
        // Tên file chứa khoá nội dung, nên cùng một đường dẫn luôn là cùng một
        // tệp: cache dài là an toàn, và nó tránh đọc lại 12 MB ảnh mỗi lần mở
        // hội thoại.
        'Cache-Control': 'private, max-age=604800',
        'Content-Disposition': 'inline',
      } });
    }
    const file = resourcePath(rendererRoot, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(file);
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
      } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  registerChatHandlers();
  ipcMain.on(IPC.reportError, (event, payload: unknown) => {
    if (!isTrusted(event)) return;
    const report = readRenderError(payload);
    if (!report) return;
    // `messageLength` chứ không phải `message`: nhật ký này không giữ nội dung
    // tin, và một lỗi render có thể mang nguyên văn một tin nhắn trong message.
    logDebug('render-error', { name: report.name, messageLength: report.messageLength,
      stack: report.componentStack });
  });
  ipcMain.on('window:action', (event, action: unknown) => {
    if (!isTrusted(event)) return;
    if (action === 'minimize') window?.minimize();
    else if (action === 'maximize') { if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); }
    else if (action === 'close') window?.close();
  });
  // Carry only validated display strings and the destination conversation id.
  ipcMain.on('notice:show', (event, payload: unknown) => {
    if (!isTrusted(event)) return;
    if (!Notification.isSupported()) return;
    try { notices.show(payload); }
    catch (error) { logDebug('notification', { errorType: error instanceof Error ? error.name : 'unknown' }); }
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { console.error(error); app.exit(1); });
// Thoát app chỉ dừng listener: phiên lưu lại để lần mở sau khôi phục (plan §5.3).
// Đăng ký **ngay** ở cấp module, không đợi `whenReady`: lỗi xảy ra trước khi cửa
// sổ được tạo cũng phải được ghi lại thay vì làm app biến mất không dấu vết.
installCrashGuard(process, reportCrash);
app.on('before-quit', () => { notices.clear(); calls.dispose(); chat?.dispose(); });
app.on('window-all-closed', () => app.quit());
