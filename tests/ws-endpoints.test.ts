import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      } catch {
        // Không có bản `.ts`: giữ nguyên đường dẫn gốc.
      }
    }
    return nextResolve(specifier, context);
  },
});

const { describeEndpoint, describeWsEndpoints } = await import('../electron/protocol/ws-endpoints.ts');

/**
 * Phép đo danh sách endpoint WebSocket.
 *
 * Vì sao phải có test: hàm này ghi vào `live-listener.log`, file nằm trên đĩa
 * của người dùng. Nó đọc `ctx` — nơi giữ cookie, imei, userAgent. Một thay đổi
 * vô ý ở đây làm rò đúng thứ mà ADR-004 cấm rời khỏi lớp protocol. Test khoá
 * **phần không được xuất hiện**, không chỉ phần tính đúng.
 */

test('URL thường: giữ origin và path, bỏ query', () => {
  const view = describeEndpoint('wss://chat.zalo.me/ws?zpw_ver=685&zpw_type=30');
  assert.deepEqual(view, {
    origin: 'wss://chat.zalo.me',
    path: '/ws',
    queryChars: 24,
    queryKeys: ['zpw_ver', 'zpw_type'],
  });
  assert.equal(JSON.stringify(view).includes('685'), false,
    'giá trị query không được lọt vào kết quả — chỉ tên tham số');
});

test('host riêng cho từng socket là thứ phân biệt được', () => {
  // Câu hỏi thật của phép đo: socket ctrl có host riêng không?
  const chat = describeEndpoint('wss://chat.zalo.me/ws?t=123');
  const ctrl = describeEndpoint('wss://ctrl.zalo.me/ws?t=123');
  assert.notEqual(chat?.origin, ctrl?.origin, 'hai host khác nhau phải đọc ra khác nhau');
});

test('cùng host khác path cũng phân biệt được', () => {
  const chat = describeEndpoint('wss://chat.zalo.me/ws?t=1');
  const ctrl = describeEndpoint('wss://chat.zalo.me/ctrl?t=1');
  assert.equal(chat?.origin, ctrl?.origin);
  assert.notEqual(chat?.path, ctrl?.path, 'path là tín hiệu thứ hai khi host giống');
});

test('chuỗi không phải URL: chỉ ghi độ dài, không ghi nội dung', () => {
  const view = describeEndpoint('khong-phai-url-nhung-dai-32-ky-tu!!');
  assert.equal(view?.origin, null);
  assert.equal(view?.path, '(không phải URL, 35 ký tự)');
  assert.equal(JSON.stringify(view).includes('khong-phai'), false,
    'nội dung chuỗi lạ không được lọt ra — nó có thể là khoá');
});

test('giá trị không phải chuỗi bị bỏ, không thành mục rỗng', () => {
  assert.equal(describeEndpoint(null), null);
  assert.equal(describeEndpoint(42), null);
  assert.equal(describeEndpoint(''), null);
});

test('ctx đầy đủ: đọc được danh sách, cờ socket, và tên service liên quan', () => {
  const view = describeWsEndpoints({
    loginInfo: {
      zpw_ws: ['wss://chat.zalo.me/ws?zpw_ver=685&zpw_type=30', 'wss://chat.zalo.me/ws2?t=9'],
      // Những trường này **có** trong ctx thật và tuyệt đối không được lọt ra.
      imei: 'imei-that-cua-nguoi-dung',
      userAgent: 'Mozilla/5.0 that-user-agent',
    },
    settings: { features: { socket: { enable_chat_socket: true, enable_ctrl_socket: false } } },
    zpwServiceMap: {
      chat: ['https://chat.zalo.me/api/chat?zpw_ver=685&sign=secret-token'],
      sync_action: ['https://tt-sync.chat.zalo.me/api/sync'],
      file: ['https://file.zalo.me/api/file'],
    },
  });

  assert.equal(view.count, 2);
  assert.equal(view.endpoints.length, 2);
  assert.equal(view.enableChatSocket, true);
  assert.equal(view.enableCtrlSocket, false);
  assert.deepEqual(view.controlish, ['sync_action'], 'chỉ tên khoá liên quan điều khiển');
  assert.equal(view.serviceMapKeys, 3);
  assert.deepEqual(view.loginInfoConnectionFields, ['zpw_ws'],
    'tên trường nói về kết nối — ở đây chỉ có mẫu thử, thực tế giàu hơn');
  assert.deepEqual(view.serviceMapNames, ['chat', 'file', 'sync_action'], 'danh sách đủ, đã sắp xếp');
  assert.deepEqual(view.serviceMapOrigins, {
    chat: 'https://chat.zalo.me',
    file: 'https://file.zalo.me',
    sync_action: 'https://tt-sync.chat.zalo.me',
  }, 'chỉ origin — path và query bị bỏ');

  const dumped = JSON.stringify(view);
  assert.equal(dumped.includes('secret-token'), false,
    'tham số đã ký trong query không được lọt vào log');
  assert.equal(dumped.includes('/api/sync'), false, 'path cũng bị bỏ, chỉ giữ host');
  assert.equal(dumped.includes('imei-that'), false, 'imei không được rời khỏi ctx');
  assert.equal(dumped.includes('Mozilla'), false, 'userAgent không được rời khỏi ctx');
  assert.equal(dumped.includes('zpw_ver'), true, 'tên tham số thì được — nó không phải bí mật');
});

test('ctx rỗng hoặc sai kiểu vẫn trả mô tả, không ném', () => {
  for (const input of [undefined, null, 42, 'x', {}, { loginInfo: 'không phải object' }]) {
    const view = describeWsEndpoints(input);
    assert.equal(view.count, 0);
    assert.deepEqual(view.endpoints, []);
    assert.equal(view.enableChatSocket, null);
    assert.equal(view.enableCtrlSocket, null);
  }
});

test('khoá service map có giá trị lạ: ghi null, không ném', () => {
  // `zpw_service_map_v3` là dữ liệu máy chủ. Một khoá có thể là chuỗi trần thay
  // vì mảng, hoặc một object — không có gì bảo đảm hình dạng.
  const view = describeWsEndpoints({
    zpwServiceMap: {
      mang: ['https://a.zalo.me/x'],
      chuoi: 'https://b.zalo.me/y',
      object: { url: 'https://c.zalo.me/z' },
      so: 42,
      khongPhaiUrl: ['not a url'],
    },
  });
  assert.equal(view.serviceMapOrigins.mang, 'https://a.zalo.me');
  assert.equal(view.serviceMapOrigins.chuoi, 'https://b.zalo.me', 'nhận cả chuỗi trần');
  assert.equal(view.serviceMapOrigins.object, null, 'object: không đoán, ghi null');
  assert.equal(view.serviceMapOrigins.so, null);
  assert.equal(view.serviceMapOrigins.khongPhaiUrl, null);
});

test('máy chủ đổi kiểu zpw_ws thành chuỗi: ghi 0 mục, không ném', () => {
  // Không phải giả định viển vông: đây là dữ liệu máy chủ, và `Array.isArray`
  // là thứ duy nhất đứng giữa nó và một lần `.map` ném giữa đường khởi động.
  const view = describeWsEndpoints({ loginInfo: { zpw_ws: 'wss://chat.zalo.me/ws' } });
  assert.equal(view.count, 0);
});
