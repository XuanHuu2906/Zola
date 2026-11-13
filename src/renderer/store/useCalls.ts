import { create } from 'zustand';

export interface CallState {
  phase: 'outgoing' | 'incoming' | 'connected' | 'ended';
  name: string;
  text: string;
  video: boolean;
  since?: number;
  notice?: string;
}
export const useCalls = create<{
  available: boolean;
  state: CallState | null;
  setState(state: CallState | null): void;
  start(id: string, video: boolean): Promise<void>;
}>(set => ({
  available: false, state: null,
  setState: state => set({ state }),
  start: async (id, video) => {
    try {
      const result = await window.calls?.start(id, video);
      if (result && !result.ok) set({ state: { phase: 'ended', name: 'Cuộc gọi', text: result.message || 'Không gọi được.', video: false } });
    } catch { set({ state: { phase: 'ended', name: 'Cuộc gọi', text: 'Không mở được cuộc gọi.', video: false } }); }
  },
}));
