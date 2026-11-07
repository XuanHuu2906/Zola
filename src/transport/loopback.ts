/**
 * LoopbackTransport — M2 test double.
 *
 * Nói chuyện HTTP + SSE với một server trên 127.0.0.1 do chính dự án này chạy.
 * Giao thức ở đây là của chúng ta (`x-demo-*`), KHÔNG phải Zalo. Không có host,
 * endpoint, header hay credential nào của Zalo trong file này.
 *
 * Chỉ dùng được từ Node (main process / test). Renderer bị CSP `connect-src 'none'`
 * chặn, và ADR-002 cấm mở CSP. Xem docs/ADR-003-loopback-transport.md.
 */

import type {
  ClientError,
  ClientResult,
  RequestOptions,
  SessionHandle,
  TransportEvent,
  TransportPort,
  TransportStatus,
  Unsubscribe,
} from '../adapters/types.ts';

export interface LoopbackConfig {
  /** Chỉ chấp nhận loopback: 127.0.0.1 / ::1 / localhost. */
  readonly baseUrl: string;
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly backoff: { readonly baseMs: number; readonly maxMs: number; readonly maxRetries: number };
}

export const DEFAULT_LOOPBACK: Omit<LoopbackConfig, 'baseUrl'> = {
  connectTimeoutMs: 1_500,
  idleTimeoutMs: 15_000,
  backoff: { baseMs: 200, maxMs: 5_000, maxRetries: 4 },
};

/** Chỉ đường dẫn tương đối trên loopback mới hợp lệ; tuyệt đối bị từ chối. */
export function assertLoopback(baseUrl: string): URL {
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('baseUrl không phải URL hợp lệ.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Loopback transport chỉ dùng http(s).');
  }
  const host = parsed.hostname;
  const isLoopback = host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost';
  if (!isLoopback) throw new Error(`Từ chối host không phải loopback: ${host}`);
  return parsed;
}

const fail = <T>(kind: ClientError['kind'], message: string, retryable: boolean, code?: string): ClientResult<T> =>
  ({ ok: false, error: { kind, message, retryable, ...(code === undefined ? {} : { code }) } });

const ok = <T>(value: T): ClientResult<T> => ({ ok: true, value });

type Listener<T> = (value: T) => void;

export interface LoopbackDeps {
  /** Tiêm để test không phải mở socket thật khi kiểm tra logic thuần. */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class LoopbackTransport implements TransportPort {
  readonly capability = 'mock' as const;

  private readonly config: LoopbackConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly events = new Set<Listener<TransportEvent>>();

  private handle: SessionHandle | null = null;
  private current: TransportStatus = 'idle';
  private controller: AbortController | null = null;
  private reconnectAttempt = 0;

  constructor(config: LoopbackConfig, deps: LoopbackDeps = {}) {
    assertLoopback(config.baseUrl);
    this.config = config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async connect(handle: SessionHandle, options?: RequestOptions): Promise<ClientResult<void>> {
    if (!handle.id) return fail('unauthorized', 'Session handle không hợp lệ.', false);
    if (options?.signal?.aborted) return fail('cancelled', 'Thao tác đã bị huỷ.', true);

    if (this.current === 'online') return ok(undefined);

    this.handle = handle;
    this.current = 'connecting';
    this.controller = new AbortController();

    const signal = this.controller.signal;
    const abort = () => this.controller?.abort();
    options?.signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.trim(this.config.baseUrl)}/session`, {
          method: 'GET',
          headers: { 'x-demo-session': handle.id },
          signal,
        }),
        this.config.connectTimeoutMs,
      );

      if (!response.ok) {
        this.current = 'offline';
        return fail(
          response.status === 401 ? 'unauthorized' : 'network',
          `Loopback handshake thất bại (HTTP ${response.status}).`,
          response.status >= 500,
          String(response.status),
        );
      }

      this.current = 'online';
      this.reconnectAttempt = 0;
      this.emit({ type: 'connected' });
      return ok(undefined);
    } catch (error) {
      this.current = 'offline';
      return fail('network', describe(error), true);
    } finally {
      options?.signal?.removeEventListener('abort', abort);
    }
  }

  async disconnect(): Promise<ClientResult<void>> {
    this.controller?.abort();
    this.controller = null;
    const wasOnline = this.current === 'online' || this.current === 'connecting';
    this.current = 'idle';
    if (wasOnline) this.emit({ type: 'disconnected', reason: 'client-requested', retryable: true });
    return ok(undefined);
  }

  async status(): Promise<ClientResult<TransportStatus>> {
    return ok(this.current);
  }

  onEvent(listener: Listener<TransportEvent>): Unsubscribe {
    this.events.add(listener);
    return () => { this.events.delete(listener); };
  }

  /**
   * Đọc một dòng SSE tại một thời điểm từ kênh push. Trả về số sự kiện đã đọc.
   * Tách khỏi `connect` để test điều khiển được nhịp đọc thay vì phải chờ nền.
   */
  async pumpPush(options?: RequestOptions): Promise<ClientResult<number>> {
    const handle = this.handle;
    if (!handle) return fail('unauthorized', 'Chưa có phiên để mở kênh push.', false);
    if (options?.signal?.aborted) return fail('cancelled', 'Thao tác đã bị huỷ.', true);

    const controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort();
    options?.signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.trim(this.config.baseUrl)}/events`, {
          headers: { 'x-demo-session': handle.id, accept: 'text/event-stream' },
          signal,
        }),
        this.config.idleTimeoutMs,
      );
      if (!response.ok) {
        return fail('network', `Push stream mở thất bại (HTTP ${response.status}).`, response.status >= 500);
      }
      const text = await response.text();
      return ok(countEvents(text));
    } catch (error) {
      return fail('network', describe(error), true);
    } finally {
      options?.signal?.removeEventListener('abort', abort);
    }
  }

  /**
   * Một vòng thử kết nối lại. Không tự lặp vô hạn: số lần do `backoff.maxRetries` quy định,
   * và caller quyết định có gọi tiếp hay không.
   */
  async reconnectOnce(): Promise<ClientResult<void>> {
    const handle = this.handle;
    if (!handle) return fail('unauthorized', 'Chưa có phiên để kết nối lại.', false);
    if (this.reconnectAttempt >= this.config.backoff.maxRetries) {
      this.current = 'offline';
      this.emit({ type: 'disconnected', reason: 'retries-exhausted', retryable: false });
      return fail('network', 'Đã hết số lần thử kết nối lại.', false);
    }
    const delay = Math.min(
      this.config.backoff.maxMs,
      this.config.backoff.baseMs * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    await this.sleep(delay);

    this.current = 'connecting';
    const result = await this.connect(handle);
    if (!result.ok) {
      this.emit({ type: 'disconnected', reason: result.error.message, retryable: result.error.retryable });
    }
    return result;
  }

  private trim(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  private emit(event: TransportEvent): void {
    for (const listener of [...this.events]) listener(event);
  }
}

function countEvents(body: string): number {
  return body.split(/\r?\n/).filter(line => line.startsWith('event:')).length;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name === 'AbortError' ? 'Kết nối bị huỷ.' : error.message;
  return 'Lỗi mạng không xác định.';
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Hết thời gian chờ.');
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
