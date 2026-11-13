/* Owned wallpaper model. Zalo resolves its chat background from a convId-keyed
   JS map and writes it as an inline style (R3 §6.1). Same shape here, but the
   source is an explicit typed value instead of an implicit side channel.
   Takes a structural shape, not the renderer's Chat type: the design system
   must not depend on a consumer's model. */

export type WallpaperTone = 'dusk' | 'mint';

export interface WallpaperKey {
  isGroup: boolean;
}

export interface WallpaperSource {
  tone: WallpaperTone;
  gradient: string;
}

const gradients: Record<WallpaperTone, string> = {
  dusk: 'linear-gradient(158deg, rgba(28,74,158,.30), rgba(92,64,168,.24))',
  mint: 'linear-gradient(158deg, rgba(22,108,120,.26), rgba(34,86,150,.22))',
};

export function wallpaperFor(chat: WallpaperKey): WallpaperSource {
  const tone: WallpaperTone = chat.isGroup ? 'mint' : 'dusk';
  return { tone, gradient: gradients[tone] };
}
