import { useDemoStore } from '../store/useDemoStore.ts';
import type { View } from '../adapters/types.ts';
import { ConversationList } from './ConversationList/index.tsx';
import { ChatPane } from './ChatPane/index.tsx';
import { LiveOverlays } from './LiveOverlays/index.tsx';

/**
 * Cây con của chế độ thật. Dùng lại `ConversationList`/`ChatPane`/`MessageComposer`
 * để UI không rẽ nhánh; mọi chỗ đọc store đều tự chọn nhánh live bằng `liveMode`.
 * Chưa đăng nhập (chưa có hội thoại) thì bảng hội thoại là cửa vào: đăng nhập QR.
 */
export function LiveSession({ view, activeId }: { view: View; activeId: string }) {
  const hasChat = useDemoStore(s => s.chats.length > 0);
  const loggedIn = useDemoStore(s => s.login.status === 'logged-in');
  // Cửa đăng nhập chiếm trọn cửa sổ như bản demo; chỉ dựng bố cục hai cột sau khi
  // đã có phiên, nếu không cột trống nằm cạnh form QR.
  if (!loggedIn) return <LiveOverlays />;
  return <>
    {hasChat ? <div className="app-layout live-layout"><ConversationList />
      {view === 'chats' && activeId ? <ChatPane key={activeId} /> : <LiveStage />}
    </div> : <LiveStage />}
    <LiveOverlays />
  </>;
}

/** Chỗ đứng khi đã đăng nhập nhưng tài khoản phụ chưa có hội thoại nào. */
function LiveStage() {
  return <main className="chat-panel feature-panel live-stage" aria-label="Chế độ Zalo thật">
    <div className="feature-placeholder"><h3>Chưa có hội thoại</h3>
      <p>Tài khoản phụ này chưa có hội thoại nào để hiển thị.</p>
    </div>
  </main>;
}
