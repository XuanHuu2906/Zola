/**
 * Composition root cho đường gửi tin của bản demo.
 *
 * Nối Glass UI với `MessagingService` trên `MockZaloClient`. UI chỉ thấy các sự kiện
 * theo `clientMessageId`; việc optimistic state, outbox và khử echo nằm ở Services.
 * Không có host, endpoint hay credential nào ở đây — mock không nói chuyện với mạng.
 */

import { MockZaloClient } from '../adapters/mock.ts';
import { MessagingService } from '../services/messaging.ts';
import type { ClientResult, MessageStatus, Unsubscribe } from '../adapters/types.ts';

export type DeliveryPhase = 'pending' | 'sent' | 'failed';

export interface DeliveryUpdate {
  readonly clientMessageId: string;
  readonly phase: DeliveryPhase;
}

export interface InboundDelivery {
  readonly conversationId: string;
  readonly text: string;
}

export interface UiBridgeOptions {
  /** Độ trễ mô phỏng mỗi lần gửi, để pha "đang gửi" của UI quan sát được. */
  readonly sendLatencyMs: number;
}

export interface UiBridge {
  send(conversationId: string, text: string): ClientResult<{ clientMessageId: string }>;
  retry(clientMessageId: string): ClientResult<void>;
  /** Trạng thái outbox thật của Services, để UI không tự đoán một tin đã đi được hay chưa. */
  entryState(clientMessageId: string): DeliveryPhase | null;
  armFailure(armed: boolean): void;
  simulateIncoming(conversationId: string, senderId: string, text: string): void;
  onDelivery(listener: (update: DeliveryUpdate) => void): Unsubscribe;
  onInbound(listener: (message: InboundDelivery) => void): Unsubscribe;
  reset(): void;
}

const phaseOf = (status: MessageStatus): DeliveryPhase =>
  status === 'failed' ? 'failed' : status === 'sending' ? 'pending' : 'sent';

export function createUiBridge({ sendLatencyMs }: UiBridgeOptions): UiBridge {
  const deliveryListeners = new Set<(update: DeliveryUpdate) => void>();
  const inboundListeners = new Set<(message: InboundDelivery) => void>();

  let client: MockZaloClient;
  let service: MessagingService;
  let stopMessages: Unsubscribe;

  const start = (): void => {
    client = new MockZaloClient({ sendLatencyMs });
    // Một lần thử: công tắc demo là một hỏng hóc dứt điểm, người đọc phải bấm "Gửi lại".
    // Chính sách retry có giới hạn vẫn được kiểm bằng tests/services.test.ts.
    service = new MessagingService(client, { policy: { maxAttempts: 1 } });
    stopMessages = service.onMessage(event => {
      if (event.type !== 'upsert') return;
      const message = event.message;
      if (message.senderId === 'me') {
        const update: DeliveryUpdate = {
          clientMessageId: message.clientMessageId,
          phase: phaseOf(message.status),
        };
        for (const listener of [...deliveryListeners]) listener(update);
        return;
      }
      const delivery: InboundDelivery = {
        conversationId: message.conversationId,
        text: message.text ?? '',
      };
      for (const listener of [...inboundListeners]) listener(delivery);
    });
  };

  start();

  return {
    send: (conversationId, text) => {
      const result = service.sendText(conversationId, text);
      return result.ok
        ? { ok: true, value: { clientMessageId: result.value.clientMessageId } }
        : result;
    },
    retry: clientMessageId => service.retry(clientMessageId),
    entryState: clientMessageId => {
      const entry = service.entry(clientMessageId);
      if (!entry) return null;
      return entry.state === 'sent' ? 'sent' : entry.state === 'failed' ? 'failed' : 'pending';
    },
    armFailure: armed => client.armSendFailure(armed),
    simulateIncoming: (conversationId, senderId, text) => {
      client.simulateIncoming(conversationId, senderId, text);
    },
    onDelivery: listener => {
      deliveryListeners.add(listener);
      return () => { deliveryListeners.delete(listener); };
    },
    onInbound: listener => {
      inboundListeners.add(listener);
      return () => { inboundListeners.delete(listener); };
    },
    reset: () => {
      stopMessages();
      service.dispose();
      start();
    },
  };
}
