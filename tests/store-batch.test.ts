import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiveMessage } from '../src/shared/ipc-contract.ts';

/**
 * Tích hợp thật với store (plan §8.1): không chỉ `createBatcher` đúng, mà
 * `connectLive` **có dùng** nó.
 *
 * Test gắn một bridge giả vào `globalThis.window` trước khi import store, vì
 * `liveBridge()` đọc `window.chat`. Cửa sổ gộp là 50 ms thật nên test phải chờ —
 * một test chờ 60 ms là chấp nhận được, và đó chính là điều cần chứng minh: tin
 * tới dồn dập thì **không** được đẩy vào state ngay từng cái.
 */

interface Handlers {
  login?: (state: unknown) => void;
  connection?: (state: unknown) => void;
  message?: (message: LiveMessage) => void;
  thread?: (thread: unknown) => void;
}

const handlers: Handlers = {};
let loginRequests = 0;

let postedPage: { messages: LiveMessage[]; hasMore: boolean } = { messages: [], hasMore: false };
/** Mốc `before` mà store đã gửi cho lần `getMessages` gần nhất. */
let lastBefore: string | undefined;
let activeThreadSignal: string | null | undefined;
let openNoticeThread: ((id: string) => void) | undefined;

const bridge = {
  login: async () => {
    loginRequests += 1;
    assert.ok(handlers.login, 'login listeners must be registered before login starts');
    handlers.login?.({ status: 'logged-out' });
    return true;
  },
  logout: async () => true,
  reconnect: async () => true,
  listConversations: async () => [],
  getMessages: async (_threadId: string, before?: string) => {
    lastBefore = before;
    return postedPage;
  },
  setActiveThread: (threadId: string | null) => { activeThreadSignal = threadId; },
  sendMessage: async () => ({ ok: true }),
  retryMessage: async () => ({ ok: true }),
  markRead: async () => true,
  onLoginState: (callback: Handlers['login']) => { handlers.login = callback; return () => {}; },
  onConnection: (callback: Handlers['connection']) => { handlers.connection = callback; return () => {}; },
  onMessageUpsert: (callback: Handlers['message']) => { handlers.message = callback; return () => {}; },
  onThreadUpsert: (callback: Handlers['thread']) => { handlers.thread = callback; return () => {}; },
  onCrash: () => () => {},
};

(globalThis as { window?: unknown }).window = {
  chat: bridge,
  desktop: {
    notify: () => {},
    onOpenThread: (callback: (id: string) => void) => {
      openNoticeThread = callback;
      return () => { if (openNoticeThread === callback) openNoticeThread = undefined; };
    },
  },
};

const { useZaloStore } = await import('../src/renderer/store/useZaloStore.ts');

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const thread = (id: string, name: string, lastText: string, lastTs: number) => ({
  id, kind: 'user' as const, name, avatar: null, pinned: false, unread: 0, lastText, lastTs,
});

const message = (id: string, text: string, threadId = 'u-1'): LiveMessage => ({
  threadId, kind: 'user', msgId: id, clientId: null,
  from: 'them', text, ts: Date.now(),
});

function connectStore(): void {
  useZaloStore.getState().connectLive();
}

test('connecting the app automatically starts sign-in after subscribing to login events', () => {
  const before = loginRequests;
  connectStore();
  assert.equal(loginRequests, before + 1);
});

test('store gom tin dồn dập thành một lần cập nhật, không phải mỗi tin một lần', async () => {
  connectStore();
  handlers.message?.(message('m-1', 'một'));
  // Tin đầu chưa được áp: cửa sổ gộp đang mở. Đây là điều test này tồn tại để
  // chứng minh — nếu store áp ngay từng tin thì `chats` đã có nội dung ở đây.
  assert.equal(useZaloStore.getState().chats.length, 0, 'tin chưa được áp trước khi hết cửa sổ');
  handlers.message?.(message('m-2', 'hai'));
  handlers.message?.(message('m-3', 'ba'));
  await wait(70);
  const chats = useZaloStore.getState().chats;
  assert.equal(chats.length, 1, 'cả ba tin vào cùng một hội thoại');
  assert.deepEqual(chats[0].messages.map(row => row.text), ['một', 'hai', 'ba']);
});

test('store xả ngay khi người dùng chọn hội thoại, không đợi hết cửa sổ', async () => {
  connectStore();
  handlers.thread?.(thread('u-2', 'Người Khác', 'Xin chào', Date.now()));
  handlers.message?.(message('m-9', 'Xin chào'));
  useZaloStore.getState().selectThread('u-2');
  assert.equal(activeThreadSignal, 'u-2', 'main must know which chat is active after a selection');
  const chats = useZaloStore.getState().chats;
  assert.ok(chats.some(chat => chat.id === 'u-2'), 'hội thoại vừa nhận tin phải có ngay sau khi chọn');
  await wait(70);
});

test('store xả ngay trước khi gửi, nên tin tới đứng trước bong bóng của mình', async () => {
  connectStore();
  handlers.thread?.(thread('u-3', 'Lan', 'Chào', Date.now()));
  useZaloStore.getState().selectThread('u-3');
  useZaloStore.setState({ drafts: { 'u-3': 'trả lời' } });
  handlers.message?.(message('m-10', 'Chào', 'u-3'));
  // `sendLive` gắn bong bóng của mình vào `chats` hiện tại; nếu lô chưa xả thì
  // bong bóng mình sẽ đứng trước tin vừa tới.
  useZaloStore.getState().sendLive();
  const chat = useZaloStore.getState().chats.find(item => item.id === 'u-3');
  assert.ok(chat);
  assert.deepEqual(chat.messages.map(row => row.text), ['Chào', 'trả lời']);
  await wait(70);
});

test('bấm tải gửi mốc cũ nhất đang hiển thị, không phải "trang mới nhất"', async () => {
  // Đây là lỗi đã bắt được qua phản hồi của người dùng: store gọi
  // `getMessages(chatId)` **không có** `before`, nên mọi lần bấm đều xin trang
  // đầu. Máy chủ trả đúng trang đã có ⇒ bấm không thấy gì đổi.
  connectStore();
  const older = message('m-100', 'cũ', 'u-6');
  const newer = message('m-200', 'mới', 'u-6');
  handlers.thread?.(thread('u-6', 'Zun', 'mới', Date.now()));
  handlers.message?.(newer);
  useZaloStore.setState({ activeId: 'u-6' });
  await wait(70);
  // Đưa tin cũ hơn vào trước bằng một lần "tải" trả về nó, rồi bấm lần hai.
  postedPage = { messages: [older], hasMore: true };
  useZaloStore.getState().loadLiveHistory('u-6');
  await wait(20);
  assert.equal(lastBefore, 'm-200', 'lần đầu xin trước tin cũ nhất đang có');
  postedPage = { messages: [], hasMore: true };
  useZaloStore.getState().loadLiveHistory('u-6');
  await wait(20);
  assert.equal(lastBefore, 'm-100', 'lần hai phải lùi mốc xuống tin cũ nhất mới nhận được');
});

test('trang lịch sử chỉ trả tin đã có: nói rõ ra, và không hứa "còn nữa"', async () => {
  // Đo thật 2026-11-08 12:34: gửi `lastId` cũ nhất, máy chủ trả lại trang mới
  // hơn. Bấm nút khi đó không đổi gì trên UI. Im lặng là kiểu hỏng tệ nhất.
  connectStore();
  const known: LiveMessage = message('m-20', 'đã có', 'u-4');
  handlers.thread?.(thread('u-4', 'Vinh Wibu', 'đã có', Date.now()));
  handlers.message?.(known);
  // Đặt `activeId` trực tiếp thay vì `selectThread`: hàm đó tự nạp trang đầu,
  // và test này cần đúng **một** lần bấm nút, không phải hai lần nạp.
  useZaloStore.setState({ activeId: 'u-4' });
  await wait(70);
  // Đã xả lô, và chưa gọi `getMessages` lần nào (không qua `selectThread`).
  postedPage = { messages: [known], hasMore: true };
  const before = useZaloStore.getState().chats.find(chat => chat.id === 'u-4');
  assert.ok(before);
  useZaloStore.setState({ toast: '' });
  useZaloStore.getState().loadLiveHistory('u-4');
  await wait(20);
  const after = useZaloStore.getState();
  const chat = after.chats.find(item => item.id === 'u-4');
  assert.ok(chat);
  assert.equal(chat.messages.length, before.messages.length, 'không tin nào được thêm');
  assert.match(after.toast, /không trả về tin cũ hơn/,
    'phải nói cho người dùng biết vì sao bấm không có gì');
  assert.equal(after.liveHistory['u-4']?.hasMore, false,
    'đã biết là trùng thì đừng để nút hứa tải được thêm');
  postedPage = { messages: [], hasMore: false };
});

test('trang lịch sử có tin mới thật: chèn vào, không báo "không trả về"', async () => {
  connectStore();
  const existing: LiveMessage = message('m-30', 'mới', 'u-5');
  postedPage = {
    messages: [message('m-29', 'cũ hơn', 'u-5')],
    hasMore: true,
  };
  handlers.thread?.(thread('u-5', 'Nhi', 'mới', Date.now()));
  handlers.message?.(existing);
  useZaloStore.setState({ activeId: 'u-5' });
  await wait(70);
  useZaloStore.setState({ toast: '' });
  useZaloStore.getState().loadLiveHistory('u-5');
  await wait(20);
  const after = useZaloStore.getState();
  assert.deepEqual(after.chats.find(chat => chat.id === 'u-5')?.messages.map(row => row.text), ['cũ hơn', 'mới']);
  assert.equal(after.toast, '', 'có tin mới thì không có gì để phàn nàn');
  assert.equal(after.liveHistory['u-5']?.hasMore, true);
  postedPage = { messages: [], hasMore: false };
});

test('đăng xuất bỏ lô tin đang chờ thay vì đưa tin vào phiên kế tiếp', async () => {
  connectStore();
  useZaloStore.setState({ activeId: 'u-1' });
  handlers.message?.(message('m-11', 'sót lại'));
  useZaloStore.getState().requestLogout();
  await wait(70);
  const leaked = useZaloStore.getState().chats.some(chat => chat.messages.some(row => row.text === 'sót lại'));
  assert.equal(leaked, false, 'tin còn trong batch không được đưa vào sau khi đăng xuất');
});

/**
 * Truy vết ngày 2026-11-09: nút "Đang mở phiên…" không gỡ được.
 *
 * `loginQRFlow` của main phát `{status:'error', retryable:true}` khi mã QR hết
 * hạn hoặc bị từ chối, rồi **trả về bình thường** — không có `logged-in` nào
 * tiếp theo. Store cũ chỉ xoá `loginPending` khi `logged-in`, nên nút "Thử lại"
 * (`disabled={pending}`) kẹt vĩnh viễn, không thể gửi yêu cầu đăng nhập lần nữa.
 */
test('mã QR hết hạn gỡ được trạng thái "đang mở phiên", để bấm lại được', () => {
  connectStore();
  // Đúng thứ tự thật: người dùng bấm, main bắt đầu, rồi một trạng thái về.
  useZaloStore.setState({ login: { status: 'logged-out' }, loginPending: true });
  handlers.login?.({ status: 'error', message: 'Mã QR đã hết hạn.', retryable: true });
  const state = useZaloStore.getState();
  assert.equal(state.loginPending, false, 'nút phải bấm lại được, không kẹt "Đang mở phiên…"');
  assert.equal(state.login.status, 'error');
  assert.equal(state.login.retryable, true, 'lỗi tạm thời thì phải có nút "Thử lại"');
});

test('bị từ chối trên điện thoại cũng gỡ được trạng thái đang chờ', () => {
  connectStore();
  useZaloStore.setState({ loginPending: true });
  handlers.login?.({ status: 'error', message: 'Bạn đã từ chối đăng nhập.', retryable: true });
  assert.equal(useZaloStore.getState().loginPending, false);
});

test('vào được phiên vẫn gỡ trạng thái đang chờ — nhánh cũ không bị mất', () => {
  connectStore();
  useZaloStore.setState({ loginPending: true });
  handlers.login?.({ status: 'logged-in', label: 'Tài khoản Zalo' });
  const state = useZaloStore.getState();
  assert.equal(state.loginPending, false);
  assert.equal(state.login.status, 'logged-in');
});

test('notification click flushes the message batch and opens the destination conversation', async () => {
  const off = useZaloStore.getState().connectLive();
  useZaloStore.setState({ login: { status: 'logged-in', label: 'Test' }, liveOverlay: { kind: 'profile' } });
  handlers.thread?.(thread('u-notice', 'Liên hệ', 'Tin mới', Date.now()));
  handlers.message?.(message('m-notice', 'Tin mới', 'u-notice'));
  assert.ok(openNoticeThread);
  openNoticeThread('u-notice');
  assert.equal(useZaloStore.getState().activeId, 'u-notice');
  assert.equal(activeThreadSignal, 'u-notice');
  assert.equal(useZaloStore.getState().liveOverlay, null);
  openNoticeThread('unknown');
  assert.equal(useZaloStore.getState().activeId, 'u-notice');
  useZaloStore.setState({ login: { status: 'logged-out' } });
  openNoticeThread('u-1');
  assert.equal(useZaloStore.getState().activeId, 'u-notice');
  off();
  assert.equal(openNoticeThread, undefined);
  await wait(20);
});
