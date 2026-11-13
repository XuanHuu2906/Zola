/**
 * Mô tả danh sách endpoint WebSocket mà máy chủ cấp cho phiên này.
 *
 * Vì sao cần: Zalo PC mở **hai** socket — `chat` (tin nhắn) và `ctrl` (sự kiện
 * điều khiển, trong đó có `transfer_after_login` mang `temp_key`). zca-js chỉ mở
 * một, lấy từ `loginInfo.zpw_ws`. Không biết `zpw_ws` chứa gì thì không phân biệt
 * được hai khả năng:
 *
 * 1. Máy chủ có cấp endpoint `ctrl` riêng → đường đúng là mở socket thứ hai.
 * 2. `zpw_ws` chỉ có endpoint chat, và socket ctrl là cùng host khác path
 *    (`/ws` so với `/ctrl`) → phải suy ra từ chỗ khác, không phải từ danh sách này.
 *
 * Hai khả năng đó dẫn tới hai thiết kế khác nhau, nên phải đo trước khi viết.
 *
 * **Chỉ ghi hình dạng, không ghi gì dùng được.** Mỗi mục thành `origin + path`;
 * query bị bỏ vì `makeURL` nhét `zpw_ver`/`zpw_type`/`t` vào đó, và một endpoint
 * do máy chủ cấp có thể mang tham số đã ký. Độ dài query thì vẫn ghi — nó nói
 * được "có tham số" mà không nói tham số gì.
 *
 * Hàm thuần: nhận `unknown`, không chạm mạng, không đọc đĩa. `tests/ws-endpoints.test.ts`
 * khoá cả hình dạng lẫn phần che bớt.
 */

/** Một endpoint đã lược về `origin + path`. */
export interface WsEndpointView {
  /** `wss://host` — không có path, không có query. */
  origin: string | null;
  path: string;
  /** Độ dài chuỗi query, hoặc `0` khi không có. Chỉ là con số. */
  queryChars: number;
  /** Tên tham số, **không** giá trị. */
  queryKeys: string[];
}

/** Mô tả an toàn để ghi log. */
export interface WsEndpointsView {
  /** Số mục máy chủ cấp. `0` nghĩa là không đọc được hoặc danh sách rỗng. */
  count: number;
  endpoints: WsEndpointView[];
  /** Cờ trong `settings.features.socket` — quyết định socket ctrl có bật không. */
  enableChatSocket: boolean | null;
  enableCtrlSocket: boolean | null;
  /** Số khoá trong `zpw_service_map_v3`; để biết map có đọc được không. */
  serviceMapKeys: number;
  /** Khoá của service map trông giống điều khiển/sync — chỉ **tên**. */
  controlish: string[];
  /**
   * **Tên đủ cả 45 khoá** của `zpw_service_map_v3`, đã sắp xếp.
   *
   * Bộ lọc `controlish` ở trên chỉ đoán theo mẫu chữ; nếu khoá thật tên là
   * `zpw_ws2` hay `sync2_server` thì nó trượt mẫu và ta không thấy gì. Danh sách
   * đủ là thứ duy nhất trả lời được "có khoá nào cho `CTRL_PULL_CTRL` không".
   * Tên khoá là tên dịch vụ, không dùng lại được để đăng nhập.
   */
  serviceMapNames: string[];
  /**
   * `origin` (protocol + host, **không** path, **không** query) của URL đầu tiên
   * dưới mỗi khoá service map.
   *
   * Cần cả origin chứ không chỉ tên: câu hỏi là "khoá nào trỏ tới một host
   * **khác** họ `chat.zalo.me`" — endpoint điều khiển rất có thể nằm ở host riêng
   * như `tt-...` hay `ws-ctrl`, và chỉ cái origin mới phân biệt được. Path và
   * query bị bỏ: query có thể mang tham số đã ký.
   */
  serviceMapOrigins: Record<string, string | null>;
  /**
   * **Tên** các trường của `loginInfo` liên quan tới socket/kết nối.
   *
   * Đây là chỗ trả lời câu hỏi còn lại: `zpw_ws` chỉ có bảy host `-msg`, toàn
   * socket tin nhắn. Nếu Zalo PC mở socket điều khiển ở một host khác thì máy
   * chủ phải cấp địa chỉ đó ở đâu đó trong `loginInfo` — và một trường tên
   * `*ctrl*`/`*ws*` là dấu vết duy nhất tìm được mà không đoán.
   *
   * Chỉ tên, không giá trị. Tên trường không dùng lại được để đăng nhập.
   */
  loginInfoConnectionFields: string[];
}

/** Lược một URL thành phần không dùng lại được. */
export function describeEndpoint(raw: unknown): WsEndpointView | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Không phải URL tuyệt đối. Giữ đúng độ dài để biết nó có tồn tại, không
    // giữ nội dung: một chuỗi lạ có thể là thứ khác hoàn toàn.
    return { origin: null, path: `(không phải URL, ${raw.length} ký tự)`, queryChars: 0, queryKeys: [] };
  }
  const queryKeys = [...url.searchParams.keys()];
  return {
    origin: `${url.protocol}//${url.host}`,
    path: url.pathname,
    queryChars: url.search.length,
    queryKeys,
  };
}

/**
 * Từ những gì `ctx` giữ sau đăng nhập, dựng mô tả endpoint.
 *
 * Nhận `unknown` vì đây là dữ liệu máy chủ: kiểu của nó thay đổi theo phiên bản
 * Zalo, và một `as` ở đây sẽ biến `undefined` thành một lần đọc ném lỗi giữa
 * đường khởi động. Mọi nhánh đều trả về một mô tả, kể cả khi không đọc được gì —
 * "không đọc được" cũng là một kết quả đo.
 */
export function describeWsEndpoints(ctx: unknown): WsEndpointsView {
  const root = (ctx && typeof ctx === 'object' ? ctx : {}) as Record<string, unknown>;
  const loginInfo = (root.loginInfo && typeof root.loginInfo === 'object' ? root.loginInfo : {}) as
    Record<string, unknown>;

  // `zpw_ws` là danh sách máy chủ cấp. zca-js đưa nguyên nó cho `Listener`, nên
  // đây **chính là** nguồn của `listener.wsURL` — không phải một bản sao.
  const rawList = loginInfo.zpw_ws;
  const list = Array.isArray(rawList) ? rawList : [];
  const endpoints = list.map(describeEndpoint).filter((item): item is WsEndpointView => item !== null);

  const settings = (root.settings && typeof root.settings === 'object' ? root.settings : {}) as
    Record<string, unknown>;
  const features = (settings.features && typeof settings.features === 'object' ? settings.features : {}) as
    Record<string, unknown>;
  const socket = (features.socket && typeof features.socket === 'object' ? features.socket : {}) as
    Record<string, unknown>;
  const flag = (key: string): boolean | null =>
    typeof socket[key] === 'boolean' ? socket[key] as boolean : null;

  // Service map **không** nằm trên `ctx`: zca-js đặt nó thành `api.zpwServiceMap`
  // (`dist/apis.js:159`) và `ctx` rỗng ở trường này — lần đo đầu đọc `ctx` nên
  // ra `0`, một con số sai trông như "máy chủ không cấp gì". Chấp nhận cả hai
  // chỗ để phép đo không phụ thuộc vào việc zca-js đổi nơi đặt.
  const pickMap = (): Record<string, unknown> => {
    for (const candidate of [root.zpwServiceMap, loginInfo.zpw_service_map_v3]) {
      if (candidate && typeof candidate === 'object') return candidate as Record<string, unknown>;
    }
    return {};
  };
  const serviceMap = pickMap();
  const serviceMapKeys = Object.keys(serviceMap);
  // Chỉ tên, và chỉ những tên liên quan tới điều khiển/đồng bộ. Danh sách đầy đủ
  // là cấu hình nội bộ của Zalo, không cần cho câu hỏi này.
  const controlish = serviceMapKeys.filter(key =>
    /ctrl|control|sync|action|transfer/i.test(key));

  // Chỉ tên trường, và chỉ những tên nói về kết nối. `loginInfo` còn giữ nhiều
  // thứ khác (uid, public_ip, send2me_id) — lọc theo tên là cách duy nhất giữ
  // phép đo này ở mức "hình dạng".
  const loginInfoConnectionFields = Object.keys(loginInfo)
    .filter(key => /ws|socket|ctrl|control|endpoint|url|host/i.test(key))
    .sort();

  // Origin của URL đầu tiên dưới mỗi khoá. Chỉ origin: xem doc của
  // `serviceMapOrigins` để biết vì sao path/query không được giữ.
  const serviceMapOrigins: Record<string, string | null> = {};
  for (const key of serviceMapKeys) {
    const value = serviceMap[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== 'string') { serviceMapOrigins[key] = null; continue; }
    try {
      const url = new URL(first);
      serviceMapOrigins[key] = `${url.protocol}//${url.host}`;
    } catch {
      serviceMapOrigins[key] = null;
    }
  }

  return {
    count: list.length,
    endpoints,
    enableChatSocket: flag('enable_chat_socket'),
    enableCtrlSocket: flag('enable_ctrl_socket'),
    serviceMapKeys: serviceMapKeys.length,
    controlish,
    serviceMapNames: [...serviceMapKeys].sort(),
    serviceMapOrigins,
    loginInfoConnectionFields,
  };
}
