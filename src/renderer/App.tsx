import { useEffect, useState } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { Minus, Square, X, Sparkles, WifiOff } from 'lucide-react';
import { NavigationRail } from './components/NavigationRail/index.tsx';
import { ConversationList } from './components/ConversationList/index.tsx';
import { ChatPane } from './components/ChatPane/index.tsx';
import { SettingsDialog } from './components/SettingsDialog/index.tsx';
import { FeaturePage } from './components/FeaturePage.tsx';
import { LoginScreen } from './components/LoginScreen/index.tsx';
import { LiveSession } from './components/LiveSession.tsx';
import { Overlays } from './components/Overlays/index.tsx';
import { useDemoStore } from './store/useDemoStore.ts';
import { LiveBanner } from './components/LiveBanner/index.tsx';
import { TRANSFER_STEP_MS } from '../shared/transfer.ts';
import { connectionLabel } from '../shared/network.ts';
export default function App() {
  const [settings, setSettings] = useState(false);
  const { prefs, view, activeId, toast, notify, session, advanceTransfers, connection, liveMode, connectLive } = useDemoStore();
  // A boolean selector, so the timer re-render cycle stops as soon as the last
  // transfer finishes instead of ticking a store that has nothing to advance.
  const transferring = useDemoStore(s => s.chats.some(c => c.messages.some(m => typeof m.progress === 'number' && m.progress < 100)));
  const osReduced = useReducedMotion();
  useEffect(() => {
    if (!transferring) return;
    const timer = setInterval(advanceTransfers, TRANSFER_STEP_MS);
    return () => clearInterval(timer);
  }, [transferring, advanceTransfers]);
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
      <div className="titlebar"><span className="prototype-tag"><Sparkles size={14} /> APPLE GLASS · LOCAL DEMO</span>
        {window.desktop && <div className="window-controls">
          <button aria-label="Thu nhỏ cửa sổ" onClick={() => window.desktop?.minimize()}><Minus size={17} /></button>
          <button aria-label="Phóng to hoặc khôi phục cửa sổ" onClick={() => window.desktop?.toggleMaximize()}><Square size={14} /></button>
          <button className="close-window" aria-label="Đóng cửa sổ" onClick={() => window.desktop?.close()}><X size={19} /></button>
        </div>}
      </div>
      {liveMode === 'live' ? <LiveSession view={view} activeId={activeId} />
        : session ? <div className="app-layout"><NavigationRail openSettings={() => setSettings(true)} /><ConversationList />
          {view === 'chats' ? <ChatPane key={activeId} /> : <FeaturePage />}
        </div> : <LoginScreen />}
      {liveMode === 'live' ? <LiveBanner />
        : session && connection !== 'online' && <div className="connection-banner" data-connection={connection} role="status" aria-live="polite">
          <WifiOff size={16} />{connectionLabel(connection)}</div>}
      <div id="toast" className={toast ? 'visible' : ''} role="status" aria-live="polite">{toast}</div>
    </div>
    {liveMode === 'demo' && session && settings && <SettingsDialog close={() => setSettings(false)} />}
    {liveMode === 'demo' && session && <Overlays />}
  </MotionConfig>;
}
