/* Typed variant maps. Each state resolves to a complete class string, so a
   component never concatenates booleans into a class list the way the shipped
   Zalo bundle does (R3 §12.4). */

export type MessageDirection = 'incoming' | 'outgoing';
export type ToggleState = 'on' | 'off';
export type PressedState = 'pressed' | 'idle';
export type ReactionState = 'reacted' | 'empty';
export type MatchState = 'match' | 'plain';
export type BubbleKind = 'text' | 'file';

export const messageRowVariant: Record<MessageDirection, string> = {
  incoming: 'message-row incoming',
  outgoing: 'message-row outgoing',
};

export const toggleVariant: Record<ToggleState, string> = {
  on: 'toggle on',
  off: 'toggle',
};

export const pressedVariant: Record<PressedState, string> = {
  pressed: 'on',
  idle: '',
};

export const reactionVariant: Record<ReactionState, string> = {
  reacted: 'reaction',
  empty: 'reaction reaction-add',
};

export const matchVariant: Record<MatchState, string> = {
  match: 'bubble-copy search-match',
  plain: 'bubble-copy',
};

export const bubbleVariant: Record<BubbleKind, string> = {
  text: 'bubble',
  file: 'bubble bubble-file',
};

export const directionToClass = (from: 'me' | 'them'): MessageDirection => (from === 'me' ? 'outgoing' : 'incoming');

export type SelectedState = 'selected' | 'idle';

export const railButtonVariant: Record<SelectedState, string> = {
  selected: 'rail-button is-active',
  idle: 'rail-button',
};

export const filterChipVariant: Record<SelectedState, string> = {
  selected: 'filter-chip selected',
  idle: 'filter-chip',
};

export const conversationVariant: Record<SelectedState, string> = {
  selected: 'conversation selected',
  idle: 'conversation',
};

export type DeliveryState = 'pending' | 'sent' | 'failed';

/** Delivery is three states, so it gets its own map rather than the two-state one. */
export const deliveryVariant: Record<DeliveryState, string> = {
  pending: 'delivery delivery-pending',
  sent: 'delivery delivery-sent',
  failed: 'delivery delivery-failed',
};

export const deliveryLabel: Record<DeliveryState, string> = {
  pending: 'Đang gửi',
  sent: 'Đã gửi',
  failed: 'Gửi thất bại',
};

export type AvatarSize = 'regular' | 'large' | 'tiny';

export const avatarVariant = (chatId: string, size: AvatarSize, hasImage: boolean): string =>
  `avatar avatar-${chatId} ${size}${hasImage ? '' : ' avatar-art'}`;
