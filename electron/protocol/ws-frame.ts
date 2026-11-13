/**
 * Header của frame WebSocket Zalo.
 *
 * Định dạng trên dây (`_send` của Zalo PC, `sendWs` của zca-js):
 *
 * ```
 * [version: u8][cmd: u16 little-endian][subCmd: u8][raw UTF-8 JSON]
 * ```
 *
 * Tách ra thành hàm thuần vì **ba lần** bộ quan sát đọc sai chỗ này đều cho ra
 * `frames: []` — một kết quả trông y hệt "máy chủ không trả lời gì", và vì thế
 * không phân biệt được với sự thật. Hàm này không phụ thuộc WebSocket, Electron
 * hay `Buffer`, nên test khoá được nó.
 *
 * Đối chiếu nguồn: `getHeader` của zca-js (`dist/apis/listen.js:420`) trả
 * `[buffer[0], buffer.readUInt16LE(1), buffer[3]]`. Đọc `int32` ở offset 1 là
 * lấn sang byte `subCmd` — chính là lỗi đó.
 */
export interface WsFrameHeader {
  version: number;
  cmd: number;
  subCmd: number;
  /** Số byte thân frame (đã trừ 4 byte header). */
  bodyBytes: number;
}

/**
 * Đọc header từ một frame. Trả `null` khi frame ngắn hơn 4 byte — frame như vậy
 * không thể là frame Zalo, và ném lỗi ở đây sẽ biến một frame rác thành sự cố.
 */
export function decodeWsFrameHeader(bytes: Uint8Array): WsFrameHeader | null {
  if (bytes.byteLength < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    version: view.getUint8(0),
    cmd: view.getUint16(1, true),
    subCmd: view.getUint8(3),
    bodyBytes: bytes.byteLength - 4,
  };
}

/**
 * Hình dạng thân frame — **không** phải nội dung.
 *
 * Đây là câu trả lời cho một câu hỏi hẹp nhưng quyết định: frame `590` nhận về
 * là **phản hồi của máy chủ** hay **frame của chính ta dội lại**? Hai thứ đó khác
 * nhau ở chỗ một phản hồi thật mang `reqId` cùng `error_code` và thường có thân
 * lớn hơn nhiều so với thứ ta gửi.
 *
 * Vì sao không đọc thẳng nội dung: thân frame có thể mang dữ liệu đồng bộ của
 * người dùng. Chỉ những thứ dưới đây được ghi ra — tên các khoá, độ dài hai
 * trường định danh, và số byte. Đủ để phân biệt hai giả thuyết, không đủ để dựng
 * lại gì.
 */
export interface WsFrameBodyShape {
  /** Tên khoá ở cấp ngoài cùng, đã sắp xếp. `null` nếu thân không phải JSON object. */
  keys: string[] | null;
  /** Độ dài `reqId` nếu có — máy chủ trả lại chính `reqId` ta gửi thì cùng độ dài. */
  reqIdChars: number;
  /** `error_code` nếu thân có, để đọc được máy chủ chấp nhận hay từ chối. */
  errorCode: number | null;
  /**
   * Giá trị cờ `encrypt` của phong bì — `null` khi thân không có cờ này.
   *
   * Không phải chi tiết phụ, và không phải boolean. zca-js đòi nó là **số 0–3**
   * (`dist/utils.js:340-346`): `0` nghĩa là **không cần giải mã**, payload nằm
   * thẳng trong `data`; `1`/`2`/`3` mới là các kiểu mã hoá/giải nén. Giữ nguyên số
   * là cách duy nhất đọc được "phản hồi này là văn bản thuần" — chính là điều kiện
   * để những gì ta đọc ở tầng ngoài (kể cả việc **không** có `reqId`) nói về nội
   * dung thật chứ không chỉ về phong bì.
   */
  encrypt: number | null;
}

/** `error_code` (snake) hoặc `errorCode` (camel) ở một tầng, `null` nếu không có. */
function pickErrorCode(record: Record<string, unknown>): number | null {
  const snake = record.error_code;
  if (typeof snake === 'number') return snake;
  const camel = record.errorCode;
  if (typeof camel === 'number') return camel;
  return null;
}

/**
 * Đọc hình dạng thân frame. Không ném: thân không phải JSON (frame mã hoá, frame
 * rỗng, frame rác) trả `keys: null` thay vì làm hỏng bộ quan sát.
 */
export function describeWsFrameBody(body: Uint8Array): WsFrameBodyShape {
  const blank: WsFrameBodyShape = { keys: null, reqIdChars: 0, errorCode: null, encrypt: null };
  if (body.byteLength === 0) return blank;
  const text = new TextDecoder().decode(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return blank;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return blank;
  }
  const record = parsed as Record<string, unknown>;
  const inner = record.data;
  const innerRecord = inner && typeof inner === 'object' && !Array.isArray(inner)
    ? (inner as Record<string, unknown>) : null;
  // `reqId` có thể nằm ở cấp ngoài (`addCommonParams` của Zalo PC đặt nó ở đó)
  // hoặc trong `data` (một số đường cũ hơn gửi như vậy). Tìm cả hai.
  const outerReqId = record.reqId;
  const innerReqId = innerRecord ? innerRecord.reqId : undefined;
  const reqId = typeof outerReqId === 'string' ? outerReqId
    : typeof innerReqId === 'string' ? innerReqId : '';
  // `error_code` cũng vậy, và vì đúng lý do: `handleZaloResponse` của zca-js
  // (`dist/utils.js:588`) kiểm `jsonData.error_code` ở cấp ngoài rồi kiểm lại
  // `decodedData.error_code` bên trong — hai tầng, không phải một.
  const errorCode = pickErrorCode(record) ?? (innerRecord ? pickErrorCode(innerRecord) : null);
  const encrypt = typeof record.encrypt === 'number' ? record.encrypt : null;
  return { keys: Object.keys(record).sort(), reqIdChars: reqId.length, errorCode, encrypt };
}
