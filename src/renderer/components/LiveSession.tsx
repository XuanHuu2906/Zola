import { useZaloStore } from '../store/useZaloStore.ts';
import { ConversationList } from './ConversationList/index.tsx';
import { ChatPane } from './ChatPane/index.tsx';
import { CallPanel } from './CallPanel.tsx';
import { LiveOverlays } from './LiveOverlays/index.tsx';

/**
 * The authenticated session displays conversations from the connected Zalo account.
 */
export function LiveSession({ activeId }: { activeId: string }) {
  const hasChat = useZaloStore(s => s.chats.length > 0);
  const loggedIn = useZaloStore(s => s.login.status === 'logged-in');
  // Keep the sign-in flow full-window until the account session is active.
  if (!loggedIn) return <LiveOverlays />;
  return <>
    {hasChat ? <div className="app-layout live-layout"><ConversationList />
      {activeId ? <ChatPane key={activeId} /> : <LiveStage />}
    </div> : <LiveStage />}
    <LiveOverlays />
    <CallPanel />
  </>;
}

/** Chỗ đứng khi đã đăng nhập nhưng tài khoản phụ chưa có hội thoại nào. */
function LiveStage() {
  return <main className="chat-panel feature-panel live-stage" aria-label="Phiên Zalo">
    <div className="feature-placeholder"><h3>Chưa có hội thoại</h3>
      <p>Tài khoản phụ này chưa có hội thoại nào để hiển thị.</p>
    </div>
  </main>;
}
