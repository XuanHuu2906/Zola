import { app, BrowserWindow, ipcMain, Notification, protocol, session } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import { APP_ORIGIN, DEV_ORIGIN, CSP, isAllowedRequest, isTrustedDocument, resourcePath } from './security.js';
import { IPC, readMessagesRequest, readReadRequest, readSendRequest } from './ipc-contract.js';
import { createSessionStore } from './protocol/session.js';
import { createZaloClient } from './protocol/zalo-client.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'glass', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const development = !app.isPackaged && process.env.GLASS_DEV === '1';
const rendererRoot = path.join(__dirname, '../dist');
// Electron requires sessionData to be configured synchronously before ready.
const dataRoot = path.join(app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : app.getAppPath(), '.glass-demo-data');
mkdirSync(dataRoot, { recursive: true });
app.setPath('userData', dataRoot);
app.setPath('sessionData', dataRoot);
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

let chat: ReturnType<typeof createZaloClient> | null = null;

/**
 * Lớp zca-js được tạo lười: app vẫn mở được như bản demo kể cả khi gói không nạp
 * được (thiếu bản cài, asar hỏng). Lỗi được báo bằng `error` state, không ném ra
 * vòng lặp sự kiện của Electron.
 */
/**
 * Nhật ký chẩn đoán listener. Bản đóng gói không có DevTools (`devTools` chỉ bật
 * khi `GLASS_DEV=1`), nên không có cách nào khác để xem listener có nhận được
 * khung tin nào. Chỉ ghi metadata: không nội dung tin, không cookie/IMEI/token.
 */
const logDebug = (event: string, data: Record<string, unknown>): void => {
  try {
    appendFileSync(path.join(dataRoot, 'live-listener.log'),
      `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
  } catch { /* chẩn đoán không được làm hỏng luồng tin */ }
};

function chatClient(): ReturnType<typeof createZaloClient> | null {
  if (chat) return chat;
  try {
    chat = createZaloClient(createSessionStore(dataRoot), {
      login: state => push(IPC.evLoginState, state),
      connection: state => push(IPC.evConnection, state),
      message: message => push(IPC.evMessageUpsert, message),
      thread: thread => push(IPC.evThreadUpsert, thread),
      debug: logDebug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    push(IPC.evLoginState, { status: 'error',
      message: `Không nạp được lớp Zalo: ${message.slice(0, 120)}`, retryable: false });
  }
  return chat;
}

function registerChatHandlers() {
  ipcMain.handle(IPC.login, event => { if (isTrusted(event)) void chatClient()?.login(); });
  ipcMain.handle(IPC.logout, event => { if (isTrusted(event)) void chatClient()?.logout(); });
  ipcMain.handle(IPC.reconnect, event => { if (isTrusted(event)) chatClient()?.reconnect(); });
  ipcMain.handle(IPC.listConversations, event => {
    if (!isTrusted(event)) return [];
    return chatClient()?.listConversations() ?? [];
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
    return client.getMessages(request.threadId, kind, request.before);
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
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 700, show: false,
    title: 'Glass Messenger · Offline Demo', frame: false, backgroundColor: '#264eab',
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
  void window.loadURL(development ? DEV_ORIGIN : `${APP_ORIGIN}/index.html`).catch(error => {
    console.error('Renderer load failed:', error.message);
    app.exit(1);
  });
}

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url, development) }));
  protocol.handle('glass', async request => {
    const file = resourcePath(rendererRoot, request.url);
    if (!file || request.method !== 'GET') return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(file);
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
      } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  registerChatHandlers();
  ipcMain.on('window:action', (event, action: unknown) => {
    if (!isTrusted(event)) return;
    if (action === 'minimize') window?.minimize();
    else if (action === 'maximize') { if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); }
    else if (action === 'close') window?.close();
  });
  // Desktop notifications stay local: the renderer only names a demo chat and a
  // short body, and nothing leaves the machine. The payload is string-only and
  // length-capped so a compromised renderer cannot reshape the native object.
  ipcMain.on('notice:demo', (event, payload: unknown) => {
    if (!isTrusted(event)) return;
    if (typeof payload !== 'object' || payload === null) return;
    const { title, body } = payload as { title?: unknown; body?: unknown };
    if (typeof title !== 'string' || typeof body !== 'string') return;
    if (!Notification.isSupported()) return;
    new Notification({ title: title.slice(0, 80), body: body.slice(0, 180), silent: false }).show();
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { console.error(error); app.exit(1); });
// Thoát app chỉ dừng listener: phiên lưu lại để lần mở sau khôi phục (plan §5.3).
app.on('before-quit', () => chat?.dispose());
app.on('window-all-closed', () => app.quit());
