interface Notice {
  on(event: 'click' | 'close', callback: () => void): unknown;
  show(): void;
  close(): void;
}
interface NoticeWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  openThread(id: string): void;
}

/** Keep notices alive, bind clicks to a conversation, invalidate them on logout. */
export function createNotifications(deps: {
  create(title: string, body: string): Notice;
  window(): NoticeWindow | null;
}) {
  const pending = new Set<Notice>();
  let generation = 0;
  return {
    show(payload: unknown): void {
      if (!payload || typeof payload !== 'object') return;
      const { title, body, threadId } = payload as Record<string, unknown>;
      if (typeof title !== 'string' || typeof body !== 'string'
        || typeof threadId !== 'string' || !/^[\w-]{1,128}$/.test(threadId)) return;
      const epoch = generation;
      const notice = deps.create(title.slice(0, 80), body.slice(0, 180));
      pending.add(notice);
      notice.on('close', () => pending.delete(notice));
      notice.on('click', () => {
        if (epoch !== generation || !pending.has(notice)) return;
        const win = deps.window();
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.openThread(threadId);
        pending.delete(notice);
        notice.close();
      });
      // Avoid retaining an unbounded number of OS notification objects.
      if (pending.size > 100) {
        const oldest = pending.values().next().value;
        if (oldest) { pending.delete(oldest); oldest.close(); }
      }
      notice.show();
    },
    clear(): void {
      generation++;
      for (const notice of pending) notice.close();
      pending.clear();
    },
  };
}
