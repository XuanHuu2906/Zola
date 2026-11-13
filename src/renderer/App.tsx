import { useEffect } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { Minus, Settings, Square, X } from 'lucide-react';
import { LiveSession } from './components/LiveSession.tsx';
import { useZaloStore } from './store/useZaloStore.ts';
import { LiveBanner } from './components/LiveBanner/index.tsx';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { reportRenderError } from './live/error-report.ts';
export default function App() {
  const { prefs, activeId, toast, notify, connectLive, openLiveOverlay } = useZaloStore();
  const loggedIn = useZaloStore(s => s.login.status === 'logged-in');
  const osReduced = useReducedMotion();
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.style.setProperty('--glass-opacity', String(prefs.glass / 100));
    document.documentElement.classList.toggle('reduced-motion', !prefs.motion || !!osReduced);
    document.documentElement.classList.toggle('low-blur', prefs.lowBlur);
  }, [prefs, osReduced]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => notify(''), 4500); return () => clearTimeout(timer); } }, [toast, notify]);
  // Chế độ thật luôn nghe trước khi phát yêu cầu (main đẩy sự kiện đồng bộ),
  // và dọn dẹp thật khi unmount để StrictMode không để lại listener thứ hai.
  useEffect(() => connectLive(), [connectLive]);
  return <MotionConfig reducedMotion={prefs.motion ? 'user' : 'always'}>
    <div className="ambient ambient-a" aria-hidden="true" /><div className="ambient ambient-b" aria-hidden="true" /><div className="ambient ambient-c" aria-hidden="true" />
    <div className={`window-shell ${window.desktop ? 'desktop-shell' : ''}`}>
      <div className="titlebar"><span className="app-tag">ZOLA · ZALO</span>
        {loggedIn && <button className="icon-button titlebar-action" aria-label="Cài đặt" title="Cài đặt"
          onClick={() => openLiveOverlay({ kind: 'settings' })}><Settings size={17} /></button>}
        {window.desktop && <div className="window-controls">
          <button aria-label="Thu nhỏ cửa sổ" onClick={() => window.desktop?.minimize()}><Minus size={17} /></button>
          <button aria-label="Phóng to hoặc khôi phục cửa sổ" onClick={() => window.desktop?.toggleMaximize()}><Square size={14} /></button>
          <button className="close-window" aria-label="Đóng cửa sổ" onClick={() => window.desktop?.close()}><X size={19} /></button>
        </div>}
      </div>
      {/* Boundary bọc **nội dung**, không bọc cả `App`: khung cửa sổ (thanh tiêu đề,
          nút đóng) phải sống sót để người dùng còn cách thoát. `resetKey` đổi theo
          hội thoại đang mở, nên một hội thoại hỏng không khoá các hội thoại khác. */}
      <ErrorBoundary resetKey={`chats:${activeId}`}
        onError={(error, info) => reportRenderError(error, info.componentStack ?? '')}>
        <LiveSession activeId={activeId} />
      </ErrorBoundary>
      <LiveBanner />
      <div id="toast" className={toast ? 'visible' : ''} role="status" aria-live="polite">{toast}</div>
    </div>
  </MotionConfig>;
}
