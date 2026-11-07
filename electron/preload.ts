import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload chạy trong sandbox: `require()` ở đây chỉ phục vụ 'electron' và vài
 * module polyfill, **không** nạp được file cục bộ. Vì vậy tên kênh phải là chuỗi
 * literal và `tests/ipc-contract.test.ts` đối chiếu chúng với `IPC` dùng chung.
 */
const CH = {
  login: 'chat:login',
  logout: 'chat:logout',
  listConversations: 'chat:listConversations',
  getMessages: 'chat:getMessages',
  sendMessage: 'chat:sendMessage',
  retryMessage: 'chat:retryMessage',
  markRead: 'chat:markRead',
  reconnect: 'chat:reconnect',
  evLoginState: 'ev:loginState',
  evConnection: 'ev:connection',
  evMessageUpsert: 'ev:messageUpsert',
  evThreadUpsert: 'ev:threadUpsert',
} as const;

const on = <T>(channel: string, callback: (payload: T) => void) => {
  const handler = (_: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  minimize: () => ipcRenderer.send('window:action', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('window:action', 'maximize'),
  close: () => ipcRenderer.send('window:action', 'close'),
  notify: (title: string, body: string) => ipcRenderer.send('notice:demo', { title: String(title), body: String(body) }),
}));

/**
 * Mỗi hàm một mục đích; không expose `ipcRenderer` thô. Mọi `on*` trả về hàm huỷ
 * đăng ký để React `useEffect` dọn được, và payload đi lên chỉ là `Live*` đã map.
 */
contextBridge.exposeInMainWorld('chat', Object.freeze({
  login: () => ipcRenderer.invoke(CH.login),
  logout: () => ipcRenderer.invoke(CH.logout),
  listConversations: () => ipcRenderer.invoke(CH.listConversations),
  getMessages: (threadId: string, before?: string) => ipcRenderer.invoke(CH.getMessages, { threadId, before }),
  /** `clientId` do renderer sinh: plan §5.4 cần nó để nối tin tạm với tin thật. */
  sendMessage: (threadId: string, kind: string, text: string, clientId: string) =>
    ipcRenderer.invoke(CH.sendMessage, { threadId, kind, text, clientId }),
  retryMessage: (threadId: string, kind: string, text: string, clientId: string) =>
    ipcRenderer.invoke(CH.retryMessage, { threadId, kind, text, clientId }),
  markRead: (threadId: string, kind: string) => ipcRenderer.invoke(CH.markRead, { threadId, kind }),
  reconnect: () => ipcRenderer.invoke(CH.reconnect),
  onLoginState: (callback: (state: unknown) => void) => on(CH.evLoginState, callback),
  onConnection: (callback: (state: unknown) => void) => on(CH.evConnection, callback),
  onMessageUpsert: (callback: (message: unknown) => void) => on(CH.evMessageUpsert, callback),
  onThreadUpsert: (callback: (thread: unknown) => void) => on(CH.evThreadUpsert, callback),
}));
