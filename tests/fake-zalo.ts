import type { Connector } from '../electron/protocol/zalo-client.ts';

/**
 * `FakeZaloClient` (plan §12).
 *
 * Thay cho `new Zalo(...)` để tạo lại được những tình huống ở bảng §6.10 mà
 * không cần tài khoản thật và không gọi mạng: tin đến trùng, sai thứ tự, gửi
 * hỏng, máy chủ im lặng. Mọi lời gọi đều ghi lại, nên test kiểm được **cái gì
 * đã được hỏi** chứ không chỉ kết quả.
 *
 * Không import `zca-js` ở đây: ADR-004 §4 nói chỉ `electron/protocol/` được chạm
 * gói đó, và `tests/protocol-boundary.test.ts` áp quy tắc ấy cho cả `tests/`.
 * Kiểu `API` suy ra từ chính `Connector` của lớp protocol, nên file này vẫn
 * không biết gì về gói thật.
 */
type FakeApi = Awaited<ReturnType<Connector['login']>>;

export interface FakeMessage {
  threadId: string;
  msgId: string;
  /** Payload thô theo hình dạng zca-js: `zalo-client.ts` map từ đây. */
  data: Record<string, unknown>;
  isSelf?: boolean;
  type?: 'user' | 'group';
}

type Handler = (...args: unknown[]) => void;

export interface FakeListener {
  on(event: string, handler: Handler): void;
  start(options?: { retryOnClose?: boolean }): void;
  stop(): void;
  requestOldMessages(type: unknown, lastId: string | null): void;
  requestOldReactions(type: unknown, lastId: string | null): void;
  /** Phát một sự kiện như server thật. */
  emit(event: string, ...args: unknown[]): void;
}

export interface FakeServer {
  /** Sự kiện mà listener đã đăng ký, theo thứ tự `on()`. */
  readonly subscriptions: string[];
  readonly requests: { method: string; args: unknown[] }[];
  /** Ánh xạ test-only của endpoint `/api/gid/decrypt`. */
  globalIdMap: Record<string, string>;
  /** Group details returned by the avatar-enabled `/api/group/getgi` endpoint. */
  groupMemberInfo: Record<string, Record<string, unknown>>;
  /** Tin gửi đi thành công sẽ nhận `msgId` từ đây, tăng dần. */
  nextMsgId: number;
  /** Đặt `true` để `sendMessage` ném lỗi mạng. */
  failSend: boolean;
  /** Nhóm trả về từ `getGroupChatHistory`. */
  groupMessages: { data: Record<string, unknown>; isSelf: boolean }[];
  groupMore: number;
  listener: FakeListener;
}

/**
 * Dựng một `API` giả. `overrides` cho phép từng test thay đúng hàm nó quan tâm,
 * phần còn lại trả giá trị trung tính để `activate()` chạy hết.
 *
 * `overrides` cố ý là `Record<string, unknown>` chứ không `Partial<API>`: kiểu
 * trả về của zca-js đòi hàng chục trường mà `protocol/` không đọc tới, nên test
 * chỉ khai đúng phần mapper dùng. Phép ép kiểu nằm ở một chỗ duy nhất dưới đây.
 */
export function fakeApi(server: FakeServer, overrides: Record<string, unknown> = {}): FakeApi {
  const base = {
    getOwnId: () => 'own-1',
    getAllFriends: async () => [],
    getAllGroups: async () => ({ version: '', gridVerMap: {} }),
    getPinConversations: async () => ({ conversations: [], version: 0 }),
    getUnreadMark: async () => ({ data: { convsGroup: [], convsUser: [] }, status: 0 }),
    getGroupInfo: async () => null,
    fetchAccountInfo: async () => ({ profile: { displayName: 'Người kiểm thử' } }),
    zpwServiceMap: { profile: ['https://profile.test'], group: ['https://group.test'] },
    getGroupChatHistory: async () => ({ groupMsgs: server.groupMessages, more: server.groupMore }),
    sendMessage: async (...args: unknown[]) => {
      server.requests.push({ method: 'sendMessage', args });
      if (server.failSend) throw new Error('mất mạng');
      const msgId = String(server.nextMsgId++);
      return { message: { msgId } };
    },
    forwardMessage: async (...args: unknown[]) => {
      server.requests.push({ method: 'forwardMessage', args });
      if (server.failSend) throw new Error('mất mạng');
      const msgId = String(server.nextMsgId++);
      return { success: [{ clientId: 'test-cli', msgId }], fail: [] };
    },
    sendSeenEvent: async (...args: unknown[]) => { server.requests.push({ method: 'sendSeenEvent', args }); },
    listener: server.listener,
  };
  const api: Record<string, unknown> = { ...base, ...overrides };
  const utils = {
    encodeAES: (data: string) => Buffer.from(data).toString('base64'),
    makeURL: (baseURL: string, params?: Record<string, string | number>) => {
      const url = new URL(baseURL);
      for (const [key, value] of Object.entries(params ?? {})) {
        url.searchParams.set(key, String(value));
      }
      return url.toString();
    },
    request: async (url: string) => {
      const requestUrl = new URL(url);
      const encrypted = requestUrl.searchParams.get('params');
      if (!encrypted) throw new Error('missing fake API params');
      const payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8')) as {
        globalUids?: unknown; grid?: unknown; avatar_size?: unknown; member_avatar_size?: unknown;
      };
      if (requestUrl.pathname.endsWith('/api/group/getgi')) {
        if (typeof payload.grid !== 'string') throw new Error('missing fake group id');
        server.requests.push({ method: 'getGroupInfoForAvatars', args: [payload] });
        return new Response(JSON.stringify({
          error_code: 0, data: server.groupMemberInfo[payload.grid] ?? null,
        }), { status: 200 });
      }
      if (!requestUrl.pathname.endsWith('/api/gid/decrypt')) {
        throw new Error('unexpected fake API request');
      }
      const requested = typeof payload.globalUids === 'string'
        ? JSON.parse(payload.globalUids) as unknown
        : payload.globalUids;
      if (!Array.isArray(requested) || !requested.every(id => typeof id === 'string')) {
        throw new Error('invalid fake global ID lookup');
      }
      const ids = requested as string[];
      server.requests.push({ method: 'getUserIdsFromGlobalNoiseId', args: [ids] });
      const data: Record<string, string> = {};
      for (const id of ids) {
        const userId = server.globalIdMap[id];
        if (userId) data[id] = userId;
      }
      return new Response(JSON.stringify({ error_code: 0, data }), { status: 200 });
    },
    resolve: async <T>(
      response: Response,
      callback?: (result: { data: unknown }) => T,
    ): Promise<T | unknown> => {
      const payload = await response.json() as { error_code?: number; error_message?: string; data?: unknown };
      if (payload.error_code && payload.error_code !== 0) {
        throw new Error(payload.error_message || 'fake API error');
      }
      const result = { data: payload.data ?? null };
      return callback ? callback(result) : result.data;
    },
  };
  api.custom = (name: string, callback: (input: {
    ctx: Record<string, unknown>;
    utils: typeof utils;
    props: unknown;
  }) => unknown) => {
    Object.defineProperty(api, name, {
      value: (props: unknown) => callback({ ctx: {}, utils, props }),
      enumerable: false,
      configurable: false,
    });
  };
  return api as unknown as FakeApi;
}

export function fakeListener(): FakeListener {
  const handlers = new Map<string, Handler[]>();
  return {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    start() { /* không có socket nào để mở */ },
    stop() { /* idempotent như bản thật */ },
    // Server thật trả trang qua sự kiện `old_messages`; test phát tay sự kiện đó.
    requestOldMessages() { /* không có gì để chờ */ },
    requestOldReactions() { /* không có gì để chờ */ },
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
}

export function createFakeServer(overrides: Partial<FakeServer> = {}): FakeServer {
  return {
    subscriptions: [],
    requests: [],
    globalIdMap: {},
    groupMemberInfo: {},
    nextMsgId: 1000,
    failSend: false,
    groupMessages: [],
    groupMore: 0,
    listener: fakeListener(),
    ...overrides,
  };
}

/**
 * `Connector` trả về đúng `API` đã có — bỏ qua toàn bộ bước đăng nhập, đúng thứ
 * `restore()` cần: `store.load()` có phiên, `login()` trả client sẵn dàng.
 */
export function connectorFor(api: FakeApi): Connector {
  const connector = {
    login: async () => api,
    loginQR: async () => api,
  };
  return connector as unknown as Connector;
}

/** Payload thô một tin 1-1, đủ cho `toLiveMessage` map được. */
export function rawUserMessage(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    msgId: '1', cliMsgId: 'cli-1', uidFrom: 'u-1', idTo: 'own-1',
    msgType: 'webchat', content: 'Chào', ts: '1700000000000', st: 0, cmd: 510,
    ...over,
  };
}

/** Tin nhóm: `threadId` là id nhóm, `uidFrom` là người gửi. */
export function groupMessage(threadId: string, over: Partial<Record<string, unknown>> = {}): FakeMessage {
  return {
    threadId, msgId: String(over.msgId ?? '1'), type: 'group', isSelf: false,
    data: { ...rawUserMessage(over), idTo: threadId, uidFrom: 'member-1' },
  };
}
