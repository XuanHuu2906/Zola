import { useState } from 'react';
import { AlertTriangle, LockKeyhole, QrCode, ShieldCheck, Sparkles } from 'lucide-react';
import { useDemoStore } from '../../store/useDemoStore.ts';
import { LIVE_NOTICE } from '../../../shared/live.ts';

/** Fake sign-in. No credentials leave the renderer: the label is a display name only. */
export function LoginScreen() {
  const signIn = useDemoStore(s => s.signIn);
  const enterLive = useDemoStore(s => s.enterLive);
  const [label, setLabel] = useState('');
  // The real mode exists only inside the Electron shell; in a plain browser the
  // bridge is absent and the demo stays the only entrance.
  const canGoLive = typeof window !== 'undefined' && Boolean(window.chat);
  return <div className="login-shell">
    <form className="login-card glass-card" aria-labelledby="login-title"
      onSubmit={event => { event.preventDefault(); signIn(label); }}>
      <span className="login-emblem" aria-hidden="true"><Sparkles size={26} /></span>
      <span className="eyebrow">PHIÊN CỤC BỘ</span>
      <h1 id="login-title">Đăng nhập bản demo</h1>
      <p className="login-copy">Đây là cửa vào giả lập của bản demo Apple Glass. Không có tài khoản Zalo,
        không mật khẩu, không kết nối máy chủ nào.</p>
      <label className="login-field"><span>Tên hiển thị</span>
        <input aria-label="Tên hiển thị demo" type="text" maxLength={40} autoFocus
          placeholder="Người dùng Demo" value={label} onChange={event => setLabel(event.target.value)} />
      </label>
      <button className="primary-btn login-submit" type="submit"><LockKeyhole size={17} />Vào bản demo</button>
      <p className="login-note"><ShieldCheck size={15} />Không kết nối Zalo · Dữ liệu hư cấu trong bộ nhớ</p>
      {canGoLive && <div className="live-entry">
        <button className="subtle-btn" type="button" onClick={enterLive}><QrCode size={16} />Đăng nhập Zalo thật</button>
        <p className="live-notice" role="note"><AlertTriangle size={15} />{LIVE_NOTICE}</p>
      </div>}
    </form>
  </div>;
}
