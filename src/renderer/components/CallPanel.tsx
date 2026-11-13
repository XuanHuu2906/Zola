import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, X } from 'lucide-react';
import { useCalls, type CallState } from '../store/useCalls.ts';
import { GlassDialog } from '../../components/glass/index.ts';

/** Camera stays local until connected. Audio is handled by the native Opus backend. */
export function CallPanel() {
  const state = useCalls(s => s.state);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const local = useRef<HTMLVideoElement>(null);
  const remote = useRef<HTMLCanvasElement>(null);
  const decoder = useRef<VideoDecoder | null>(null);
  const decoderCodec = useRef('');
  const keyFrame = useRef(true);
  const phase = state?.phase;
  const video = state?.video;

  useEffect(() => {
    let live = true;
    const bridge = window.calls;
    if (!bridge) return;
    const apply = (event: Record<string, unknown>) => {
      if (event.type === 'reset') { useCalls.setState({ state: null }); return; }
      if (event.type === 'state') {
        if (['outgoing', 'incoming', 'connected', 'ended'].includes(String(event.phase))) {
          useCalls.setState({ state: event as unknown as CallState });
        }
      } else if (event.type === 'keyframe') keyFrame.current = true;
      else if (event.type === 'video' && event.data instanceof Uint8Array && typeof event.codec === 'string') {
        try {
          const d = decoder.current;
          if (!d || d.state === 'closed') return;
          if (event.codec !== decoderCodec.current) {
            if (!event.key) return;
            d.configure({ codec: event.codec, optimizeForLatency: true }); decoderCodec.current = event.codec;
          }
          if (d.decodeQueueSize > 4) { bridge.action('needkey'); return; }
          d.decode(new EncodedVideoChunk({ type: event.key ? 'key' : 'delta', timestamp: Math.round(performance.now() * 1000), data: event.data }));
        } catch { bridge.action('needkey'); }
      }
    };
    const off = bridge.onEvent(apply);
    let received = false;
    const offSnapshot = bridge.onEvent(e => { if (e.type === 'state') received = true; });
    void bridge.status().then(result => {
      if (!live) return;
      useCalls.setState({ available: result.available });
      if (!received && result.state) apply({ ...result.state, type: 'state' });
    }).catch(() => undefined);
    return () => { live = false; off(); offSnapshot(); useCalls.setState({ state: null, available: false }); };
  }, []);

  useEffect(() => {
    if (phase !== 'connected' || !video || typeof VideoDecoder === 'undefined') return;
    let disposed = false;
    const create = (): VideoDecoder => new VideoDecoder({
      output: frame => {
        const canvas = remote.current;
        if (canvas) { canvas.width = frame.displayWidth; canvas.height = frame.displayHeight; canvas.getContext('2d')?.drawImage(frame, 0, 0); }
        frame.close();
      },
      error: () => {
        decoderCodec.current = '';
        if (!disposed) { decoder.current = create(); window.calls?.action('needkey'); }
      },
    });
    decoder.current = create(); decoderCodec.current = '';
    return () => { disposed = true; const current = decoder.current; decoder.current = null; if (current && current.state !== 'closed') current.close(); };
  }, [phase, video]);

  useEffect(() => {
    if (phase !== 'connected' || !video || cameraOff) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let encoder: VideoEncoder | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = async () => {
      try {
        if (typeof VideoEncoder === 'undefined') throw new Error('Thiết bị chưa hỗ trợ mã hóa video.');
        const config: VideoEncoderConfig = { codec: 'avc1.42001e', width: 640, height: 360, bitrate: 500000, framerate: 15, latencyMode: 'realtime', avc: { format: 'annexb' } };
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) throw new Error('Chưa có bộ mã hóa H.264.');
        const captured = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 15 }, audio: false });
        if (stopped) { captured.getTracks().forEach(t => t.stop()); return; }
        stream = captured;
        const el = local.current;
        if (!el) { captured.getTracks().forEach(t => t.stop()); return; }
        el.srcObject = captured; await el.play();
        if (stopped) return;
        setCameraError('');
        encoder = new VideoEncoder({
          output: chunk => {
            if (stopped) return;
            const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
            window.calls?.action('videoFrame', { data: bytes, key: chunk.type === 'key' });
          },
          error: () => { stopped = true; if (timer) clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); setCameraError('Không mã hóa được video.'); window.calls?.action('camera', false); },
        });
        encoder.configure(config); keyFrame.current = true;
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext('2d');
        let count = 0;
        timer = setInterval(() => {
          if (stopped || !encoder || encoder.state !== 'configured' || encoder.encodeQueueSize > 2 || !context || el.readyState < 2) return;
          context.drawImage(el, 0, 0, 640, 360);
          const frame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
          try { encoder.encode(frame, { keyFrame: keyFrame.current || count++ % 30 === 0 }); keyFrame.current = false; }
          finally { frame.close(); }
        }, 1000 / 15);
        window.calls?.action('camera', true);
      } catch (error) {
        if (!stopped) { setCameraError(error instanceof Error ? error.message : 'Không mở được camera.'); window.calls?.action('camera', false); }
        stream?.getTracks().forEach(t => t.stop());
      }
    };
    void start();
    return () => {
      stopped = true; if (timer) clearInterval(timer);
      stream?.getTracks().forEach(t => t.stop());
      if (encoder && encoder.state !== 'closed') encoder.close();
    };
  }, [phase, video, cameraOff]);

  useEffect(() => {
    if (phase === 'outgoing' || phase === 'incoming') { setMuted(false); setCameraOff(false); setCameraError(''); }
  }, [phase]);

  if (!state) return null;
  const ended = phase === 'ended';
  const incoming = phase === 'incoming';
  return <GlassDialog labelledBy="zola-call-title" onClose={() => {
    if (ended) useCalls.getState().setState(null);
  }}>
    <div className="zola-call-panel">
      <h2 id="zola-call-title">{state.name || 'Cuộc gọi Zalo'}</h2>
      <p role="status">{state.text}</p>
      {state.notice && <p role="alert">{state.notice}</p>}
      {video && !ended && <div className="zola-call-video">
        <canvas ref={remote} aria-label="Video của người bên kia" />
        <video ref={local} muted playsInline aria-label="Camera của bạn" />
      </div>}
      {cameraError && !ended && <p role="alert">{cameraError}</p>}
      <div className="call-controls">
        {ended ? <button onClick={() => useCalls.getState().setState(null)}><X size={20} />Đóng</button> : <>
          {incoming && <button aria-label="Nhận cuộc gọi" onClick={() => window.calls?.action('accept')}><Phone size={22} />Nhận</button>}
          {!incoming && <button aria-label={muted ? 'Bật micro' : 'Tắt micro'} aria-pressed={muted} onClick={() => { setMuted(!muted); window.calls?.action('mute', !muted); }}>
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>}
          {video && !incoming && <button aria-label={cameraOff ? 'Bật camera' : 'Tắt camera'} aria-pressed={cameraOff} onClick={() => { setCameraOff(!cameraOff); window.calls?.action('camera', cameraOff); }}>
            {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>}
          <button className="call-end" onClick={() => window.calls?.action(incoming ? 'reject' : 'hangup')}><PhoneOff size={22} />{incoming ? 'Từ chối' : 'Kết thúc'}</button>
        </>}
      </div>
    </div>
  </GlassDialog>;
}
