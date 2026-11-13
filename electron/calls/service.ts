import path from 'node:path';
import { existsSync } from 'node:fs';
import type { CallSignal } from '../protocol/call-signaling.js';

type Data = Record<string, unknown>;
interface Engine {
  call: { state: string } | null;
  onZaloFrame(frame: Data): void;
  hangup(reason: string): void;
}
interface Backend { stop(): void }
interface Runtime {
  EngineCore: new (options: Data) => Engine;
}
interface MediaRuntime { ZrtcMediaBackend: new (options: Data) => Backend }

/** Loads the user's locally extracted Linux engine; no proprietary files are bundled. */
export class CallService {
  private engine: Engine | null = null;
  private media: Backend | null = null;
  private generation = 0;
  private callbacks = new Map<string, (...args: unknown[]) => void>();
  private state: Data | null = null;
  private closing = false;
  private deps: {
    runtime: string;
    signal(signal: CallSignal): Promise<unknown>;
    push(event: Data): void;
    peer(id: string): { id: string; name: string } | null;
    load?(): { core: Runtime; backend: MediaRuntime };
  };
  constructor(deps: CallService['deps']) { this.deps = deps; }

  available(): boolean {
    return process.platform === 'linux'
      && ['engine-core.js', 'backends/zrtc-media.js', 'zcall-audio'].every(f => existsSync(path.join(this.deps.runtime, 'native-engine', f)));
  }
  snapshot(): Data { return { available: this.available(), state: this.state }; }
  active(): boolean { return !!this.engine?.call && this.engine.call.state !== 'ended'; }
  private publish(patch: Data): void {
    this.state = { ...this.state, ...patch };
    this.deps.push({ type: 'state', ...this.state });
  }
  private ensure(): Engine {
    if (this.engine) return this.engine;
    if (!this.available()) throw new Error('Chưa có bộ gọi Linux trên máy.');
    // These modules are inspected local files, loaded only when a call is requested.
    const loaded = this.deps.load?.();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = loaded?.core ?? require(path.join(this.deps.runtime, 'native-engine/engine-core.js')) as Runtime;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const backend = loaded?.backend ?? require(path.join(this.deps.runtime, 'native-engine/backends/zrtc-media.js')) as MediaRuntime;
    const ui: Data = {};
    for (const [hook, action] of Object.entries({ onHangup: 'hangup', onMute: 'mute', onSpeaker: 'speaker', onCamera: 'camera', onVideoFrame: 'videoFrame', onNeedKey: 'needkey' })) {
      ui[hook] = (cb: (...args: unknown[]) => void) => this.callbacks.set(action, cb);
    }
    ui.open = (o: Data) => this.publish({ phase: 'outgoing', name: o.title, text: o.text, video: !!o.video, since: 0 });
    ui.incoming = (o: Data, accept: (...args: unknown[]) => void, reject: (...args: unknown[]) => void) => {
      this.callbacks.set('accept', accept); this.callbacks.set('reject', reject);
      this.publish({ phase: 'incoming', name: o.title, text: o.text, video: !!o.video, since: 0 });
    };
    ui.status = (text: string, since = 0) => this.publish({ text, ...(since ? { phase: 'connected', since } : {}) });
    ui.close = (text: string) => { this.publish({ phase: 'ended', text: text || 'Đã kết thúc' }); };
    ui.rename = (name: string) => this.publish({ name });
    ui.peer = (peer: Data) => this.publish({ peer });
    ui.notice = (notice: string) => this.publish({ notice });
    ui.requestKeyFrame = () => this.deps.push({ type: 'keyframe' });
    ui.video = (f: Data) => {
      if (!Buffer.isBuffer(f.data) || f.data.length > 2 * 1024 * 1024) return;
      this.deps.push({ type: 'video', key: !!f.key, codec: f.codec, data: f.data });
    };
    ui.setCameraEncode = (profile: Data) => this.deps.push({ type: 'encode', profile });
    const generation = ++this.generation;
    const media = new backend.ZrtcMediaBackend({ log: () => undefined, sendUdp: true });
    this.media = media;
    const engine = new core.EngineCore({
      group: false, media, ui, log: () => undefined,
      emit: (frame: Data) => {
        if (frame.type === 'sendSignal') {
          const signalCall = engine.call;
          void this.deps.signal({ command: Number(frame.command), data: frame.data as Data }).then(data => {
            if (this.generation === generation && engine.call === signalCall) engine.onZaloFrame({ type: 'recvSignal', command: frame.command, data });
          }).catch(() => {
            if (frame.command === 406 || frame.command === 12006) return;
            if (this.generation !== generation || this.closing || !engine.call || engine.call !== signalCall) return;
            this.closing = true;
            try { engine.hangup('signaling-error'); } finally { this.closing = false; }
            this.publish({ phase: 'ended', text: 'Máy chủ không chấp nhận cuộc gọi hoặc kết nối bị gián đoạn.' });
          });
        } else if (frame.type === 'request' && frame.command === 'getAliasName') {
          const d = frame.data as Data;
          const peer = this.deps.peer(String(d.noisedId));
          engine.onZaloFrame({ type: 'response', command: 'getAliasName', data: { ...d, aliasName: peer?.name || '' } });
        }
      },
    });
    this.engine = engine;
    return engine;
  }
  start(id: string, video: boolean): void {
    if (this.active()) throw new Error('Đang có cuộc gọi.');
    const peer = this.deps.peer(id);
    if (!peer) throw new Error('Không tìm thấy liên hệ.');
    this.callbacks.delete('accept'); this.callbacks.delete('reject');
    this.ensure().onZaloFrame({ type: 'request', command: 'makeCall', data: { type: video ? 3 : 1, partner: [peer] } });
  }
  control(data: Data): void {
    if (!this.available()) return;
    // Only instantiate for a real incoming request, never for unrelated events.
    if (!this.engine && data.act !== 'request') return;
    try { this.ensure().onZaloFrame({ type: 'control', data }); } catch { this.publish({ phase: 'ended', text: 'Không mở được bộ gọi.' }); }
  }
  action(action: string, value?: unknown): void {
    if (!this.active()) return;
    if (action === 'videoFrame') {
      const f = value as Data | null;
      if (this.engine?.call?.state !== 'connected' || !f || !(f.data instanceof Uint8Array) || f.data.byteLength > 2 * 1024 * 1024) return;
      this.callbacks.get(action)?.({ data: Buffer.from(f.data), key: !!f.key, w: 640, h: 360 });
    } else if (action === 'needkey') this.callbacks.get(action)?.('decode');
    else if (['mute', 'speaker', 'camera'].includes(action)) this.callbacks.get(action)?.(value === true);
    else if (['hangup', 'accept', 'reject'].includes(action)) this.callbacks.get(action)?.();
  }
  dispose(): void {
    if (!this.engine) return;
    try { this.engine?.hangup('session-ended'); } finally {
      this.media?.stop(); this.media = null; this.engine = null; this.generation++;
      this.callbacks.clear(); this.state = null; this.deps.push({ type: 'reset' });
    }
  }
}
