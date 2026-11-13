import { Moon, Sun, X, Info } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import { defaults } from '../../../shared/preferences.ts';
import { pressedVariant, toggleVariant } from '../../../design-system/variants.ts';
import { GlassDialog } from '../../../components/glass/index.ts';

export function SettingsDialog({ close }: { close(): void }) {
  const { prefs, setPrefs } = useZaloStore();
  return <GlassDialog labelledBy="settings-title" className="settings-modal" onClose={close}>
    <div className="settings-head"><div><span className="eyebrow">ZOLA</span><h2 id="settings-title">Cài đặt</h2><p>Tùy chỉnh giao diện chỉ lưu trên máy này.</p></div>
      <button className="icon-button" data-autofocus aria-label="Đóng cài đặt" onClick={close}><X size={22} /></button></div>
    <div className="setting-row"><div><strong>Giao diện</strong><small>Chọn kính tối hoặc sáng</small></div><div className="theme-switch">
      <button className={pressedVariant[prefs.theme === 'dark' ? 'pressed' : 'idle']} aria-label="Giao diện tối" aria-pressed={prefs.theme === 'dark'} onClick={() => setPrefs({ theme: 'dark' })}><Moon size={18} /></button>
      <button className={pressedVariant[prefs.theme === 'light' ? 'pressed' : 'idle']} aria-label="Giao diện sáng" aria-pressed={prefs.theme === 'light'} onClick={() => setPrefs({ theme: 'light' })}><Sun size={18} /></button>
    </div></div>
    <div className="setting-stack"><div className="setting-title"><span><strong>Sắc độ kính</strong><small>Điều chỉnh lớp phủ trong suốt</small></span><b>{prefs.glass}%</b></div>
      <input type="range" min={15} max={95} value={prefs.glass} aria-label="Sắc độ kính" onChange={e => setPrefs({ glass: Number(e.target.value) })} /></div>
    <div className="setting-row"><div><strong>Hiệu ứng chuyển động</strong><small>Luôn tôn trọng chế độ giảm chuyển động của hệ thống</small></div>
      <button className={toggleVariant[prefs.motion ? 'on' : 'off']} role="switch" aria-label="Hiệu ứng chuyển động" aria-checked={prefs.motion} onClick={() => setPrefs({ motion: !prefs.motion })}><span /></button></div>
    <div className="setting-row"><div><strong>Giảm độ mờ</strong><small>Lớp nền rõ hơn, giảm hiệu ứng blur</small></div>
      <button className={toggleVariant[prefs.lowBlur ? 'on' : 'off']} role="switch" aria-label="Giảm độ mờ" aria-checked={prefs.lowBlur} onClick={() => setPrefs({ lowBlur: !prefs.lowBlur })}><span /></button></div>
    <div className="settings-warning"><Info size={18} className="shrink-0" /><span>Chỉ tùy chọn giao diện được lưu trên thiết bị này.</span></div>
    <div className="settings-footer"><button className="subtle-btn" onClick={() => setPrefs(defaults)}>Khôi phục tùy chỉnh</button><button className="primary-btn" onClick={close}>Hoàn tất</button></div>
  </GlassDialog>;
}
