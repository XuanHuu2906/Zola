/* Owned wallpaper model. Zalo resolves its chat background from a convId-keyed
   JS map and writes it as an inline style (R3 §6.1). Same shape here, but the
   source is an explicit typed value instead of an implicit side channel.
   Takes a structural shape, not the renderer's Chat type: the design system
   must not depend on a consumer's model. */

export type WallpaperTone = 'dusk' | 'mint' | 'ember' | 'ice';

export interface WallpaperKey {
  isWork: boolean;
  isGroup: boolean;
  verified?: boolean | undefined;
}

export interface WallpaperSource {
  tone: WallpaperTone;
  gradient: string;
}

const gradients: Record<WallpaperTone, string> = {
  dusk: 'linear-gradient(158deg, rgba(28,74,158,.30), rgba(92,64,168,.24))',
  mint: 'linear-gradient(158deg, rgba(22,108,120,.26), rgba(34,86,150,.22))',
  ember: 'linear-gradient(158deg, rgba(150,64,74,.24), rgba(58,62,150,.24))',
  ice: 'linear-gradient(158deg, rgba(54,120,196,.24), rgba(120,168,226,.20))',
};

export function wallpaperFor(chat: WallpaperKey): WallpaperSource {
  const tone: WallpaperTone = chat.isWork ? 'ice' : chat.isGroup ? 'mint' : chat.verified ? 'ice' : 'dusk';
  return { tone, gradient: gradients[tone] };
}
