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
  setActiveThread: 'chat:setActiveThread',
  sendMessage: 'chat:sendMessage',
  retryMessage: 'chat:retryMessage',
  markRead: 'chat:markRead',
  setPinned: 'chat:setPinned',
  setUnread: 'chat:setUnread',
  react: 'chat:react',
  recall: 'chat:recall',
  forwardMessage: 'chat:forwardMessage',
  reconnect: 'chat:reconnect',
  reportError: 'chat:reportError',
  syncFromPhone: 'chat:syncFromPhone',
  evLoginState: 'ev:loginState',
  evConnection: 'ev:connection',
  evMessageUpsert: 'ev:messageUpsert',
  evThreadUpsert: 'ev:threadUpsert',
  evCrash: 'ev:crash',
  evSync: 'ev:sync',
  evCatchUp: 'ev:catchUp',
  evMedia: 'ev:media',
} as const;

const on = <T>(channel: string, callback: (payload: T) => void) => {
  const handler = (_: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  mediaAction: (src: string, name: string, action: 'open' | 'save') => ipcRenderer.invoke('media:action', { src, name, action }),
  minimize: () => ipcRenderer.send('window:action', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('window:action', 'maximize'),
  close: () => ipcRenderer.send('window:action', 'close'),
  notify: (title: string, body: string, threadId: string) => ipcRenderer.send('notice:show', { title: String(title), body: String(body), threadId }),
  onOpenThread: (callback: (threadId: string) => void) => on('notice:openThread', callback),
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
  setActiveThread: (threadId: string | null) => ipcRenderer.send(CH.setActiveThread, threadId),
  /** `clientId` do renderer sinh: plan §5.4 cần nó để nối tin tạm với tin thật. */
  sendMessage: (threadId: string, kind: string, text: string, clientId: string) =>
    ipcRenderer.invoke(CH.sendMessage, { threadId, kind, text, clientId }),
  retryMessage: (threadId: string, kind: string, text: string, clientId: string) =>
    ipcRenderer.invoke(CH.retryMessage, { threadId, kind, text, clientId }),
  markRead: (threadId: string, kind: string) => ipcRenderer.invoke(CH.markRead, { threadId, kind }),
  /** Ghim/bỏ ghim trên máy chủ Zalo; `false` nghĩa là Zalo từ chối. */
  setPinned: (threadId: string, kind: string, value: boolean) =>
    ipcRenderer.invoke(CH.setPinned, { threadId, kind, value }),
  /** Đánh dấu chưa đọc / bỏ dấu trên máy chủ Zalo; `false` nghĩa là bị từ chối. */
  setUnread: (threadId: string, kind: string, value: boolean) =>
    ipcRenderer.invoke(CH.setUnread, { threadId, kind, value }),
  /** Thả/gỡ cảm xúc trên máy chủ Zalo; `icon: ''` là gỡ, `false` là bị từ chối. */
  react: (threadId: string, kind: string, msgId: string, icon: string) =>
    ipcRenderer.invoke(CH.react, { threadId, kind, msgId, icon }),
  recall: (threadId: string, kind: string, msgId: string) =>
    ipcRenderer.invoke(CH.recall, { threadId, kind, msgId }),
  forwardMessage: (threadId: string, kind: string, text: string, msgId?: string, ts?: number) =>
    ipcRenderer.invoke(CH.forwardMessage, { threadId, kind, text, msgId, ts }),
  reconnect: () => ipcRenderer.invoke(CH.reconnect),
  /** Xin điện thoại đẩy lịch sử cũ (Sync V2); tin về qua `onMessageUpsert`. */
  syncFromPhone: () => ipcRenderer.invoke(CH.syncFromPhone),
  /** `send` chứ không `invoke`: renderer vừa hỏng không nên chờ main trả lời. */
  reportRenderError: (payload: unknown) => ipcRenderer.send(CH.reportError, payload),
  onLoginState: (callback: (state: unknown) => void) => on(CH.evLoginState, callback),
  onConnection: (callback: (state: unknown) => void) => on(CH.evConnection, callback),
  onMessageUpsert: (callback: (message: unknown) => void) => on(CH.evMessageUpsert, callback),
  onThreadUpsert: (callback: (thread: unknown) => void) => on(CH.evThreadUpsert, callback),
  onCrash: (callback: (notice: unknown) => void) => on(CH.evCrash, callback),
  onSync: (callback: (payload: unknown) => void) => on(CH.evSync, callback),
  onCatchUp: (callback: (payload: unknown) => void) => on(CH.evCatchUp, callback),
  onMedia: (callback: (message: unknown) => void) => on(CH.evMedia, callback),
}));


contextBridge.exposeInMainWorld('calls', Object.freeze({
  status: () => ipcRenderer.invoke('calls:status'),
  start: (id: string, video: boolean) => ipcRenderer.invoke('calls:start', { id, video }),
  action: (action: string, value?: unknown) => ipcRenderer.send('calls:action', action, value),
  onEvent: (callback: (event: unknown) => void) => on('calls:event', callback),
}));
