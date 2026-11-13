import type { Chat } from '../types.ts';
import type { LiveMessage, LiveThread } from '../../shared/ipc-contract.ts';
import { adoptEcho } from './echo.ts';
import { appendIncoming, applyMedia, applyReactions, applyRecall, insertBackfill, upsertThread } from './map.ts';

/**
 * Phép gộp của một lô sự kiện live (plan §8.1).
 *
 * Tách khỏi store vì hai lý do. Thứ nhất, đây là chỗ **thứ tự** quyết định kết
 * quả: main phát `thread` trước `message`, và một lô có thể chứa cả hai, nên gộp
 * kiểu gì cũng phải cho ra đúng trạng thái như khi từng sự kiện được áp riêng.
 * Thứ hai, `tests/live.test.ts` kiểm được nó bằng node — không `window`, không
 * React, không `setState`.
 *
 * Không đổi hành vi so với đường đi cũ: mỗi sự kiện vẫn được áp lên kết quả của
 * sự kiện trước đó, chỉ khác là **cả lô** thành một giá trị state mới, nên
 * renderer render một lần thay vì N lần.
 */

export type LiveEvent =
  | { type: 'message'; message: LiveMessage }
  | { type: 'media'; message: LiveMessage }
  | { type: 'thread'; thread: LiveThread };

export interface LiveView {
  chats: Chat[];
  activeId: string;
  toast: string;
}

export interface LiveOutcome {
  chats: Chat[];
  toast: string;
  /** Thông báo hệ điều hành cần bắn, theo thứ tự sự kiện. Store tự gọi. */
  notified: { threadId: string; name: string; text: string }[];
}

export function reduceLive(view: LiveView, events: LiveEvent[]): LiveOutcome {
  let chats = view.chats;
  let toast = view.toast;
  const notified: { threadId: string; name: string; text: string }[] = [];

  for (const event of events) {
    if (event.type === 'thread') {
      chats = upsertThread(chats, event.thread, view.activeId);
      continue;
    }
    // Tệp đính kèm vừa tải xong: sửa một bong bóng đã có, **không** phải tin mới.
    // Đi trước mọi nhánh khác vì `media` không mang `text` hay `ts`: rơi vào
    // `appendIncoming` nó sẽ thành một bong bóng rỗng ở cuối hội thoại.
    if (event.type === 'media') {
      chats = applyMedia(chats, event.message);
      continue;
    }
    const message = event.message;
    // Tin đã thu hồi đi chung kênh `evMessageUpsert` nhưng không phải tin mới:
    // nó sửa một bong bóng đã có, không được thêm bong bóng và không được báo
    // toast. `applyRecall` tự trả nguyên `chats` khi không tìm thấy dòng.
    if (message.recalled) {
      chats = applyRecall(chats, message);
      continue;
    }
    // Cảm xúc vừa đổi trên một bong bóng **đã có**. Đi trước `appendIncoming`:
    // cùng một kênh `evMessageUpsert`, nhưng đây không phải tin mới, và nối nó
    // xuống cuối hội thoại là đặt lại một tin cũ ở sai chỗ.
    const reacted = applyReactions(chats, message);
    if (reacted) {
      chats = reacted;
      continue;
    }
    // Tin của lần đồng bộ lịch sử: chèn theo thời điểm, **không** nối vào cuối.
    // Nối vào cuối sẽ đặt một tin của ba năm trước dưới tin vừa nhận, và mỗi tin
    // cũ lại thành một thông báo hệ điều hành.
    if (message.backfill) {
      chats = insertBackfill(chats, message, view.activeId);
      continue;
    }
    // Hồ sơ người gửi có thể được làm mới sau khi tin đã hiện. Gộp metadata
    // vào đúng bong bóng, không tạo thông báo hay bong bóng trùng.
    if (message.msgId && chats.some(chat =>
      chat.id === message.threadId && chat.messages.some(row => row.msgId === message.msgId))) {
      chats = appendIncoming(chats, message, view.activeId);
      continue;
    }
    // Server dội lại tin mình vừa gửi trước khi `sendMessage` trả `msgId`: gắn id
    // chính thức vào bong bóng đang chờ thay vì thêm bong bóng thứ hai.
    const echo = adoptEcho(chats, message);
    if (echo) {
      chats = echo.chats;
      continue;
    }
    const next = appendIncoming(chats, message, view.activeId);
    if (next === chats) continue;
    chats = next;
    if (message.from !== 'them') continue;
    // Tên lấy **sau** khi gắn tin: main phát `thread` trước, nên trong cùng một lô
    // đây là tên thật, không phải nhãn tạm mà `appendIncoming` dựng cho hội thoại lạ.
    const target = chats.find(item => item.id === message.threadId);
    const name = target?.name || 'Hội thoại Zalo';
    toast = `${name}: ${message.text}`;
    if (target) notified.push({ threadId: message.threadId, name, text: message.text });
  }

  return { chats, toast, notified };
}
