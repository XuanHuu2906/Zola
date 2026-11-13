import { decodeWsFrameHeader } from '../protocol/ws-frame.js';
import { unwrapPayload } from '../protocol/ws-payload.js';

/** Receive voip events on the existing authenticated socket; never open a second login. */
export function watchCallControls(listener: { ws?: WebSocket; cipherKey?: string }, onControl: (value: Record<string, unknown>) => void): () => void {
  const socket = listener.ws;
  if (!socket?.addEventListener) return () => undefined;
  let disposed = false;
  const read = (bytes: Uint8Array) => {
    if (disposed) return;
    const h = decodeWsFrameHeader(bytes);
    if (!h || h.version !== 1 || (h.cmd !== 601 && h.cmd !== 603)) return;
    try {
      let root = JSON.parse(new TextDecoder().decode(bytes.subarray(4)));
      if (root.encrypt && typeof root.data === 'string') root = unwrapPayload(root.encrypt, root.data, listener.cipherKey);
      const list = root?.data?.controls ?? root?.controls;
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const c = item?.content;
        if (c?.act_type !== 'voip' || typeof c.act !== 'string' || c.act.startsWith('group_')) continue;
        let data = c.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch { continue; } }
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        const ts = Number(data.ts ?? c.ts);
        if (!Number.isFinite(ts) || ts < Date.now() - 60000 || ts > Date.now() + 60000) continue;
        onControl({ ...c, data });
      }
    } catch { /* Invalid or unrelated frames must not break chat. */ }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) read(new Uint8Array(event.data));
    else if (event.data instanceof Uint8Array) read(event.data);
    else if (typeof Blob !== 'undefined' && event.data instanceof Blob) void event.data.arrayBuffer().then(b => read(new Uint8Array(b))).catch(() => undefined);
  };
  socket.addEventListener('message', onMessage);
  return () => { disposed = true; socket.removeEventListener('message', onMessage); };
}
