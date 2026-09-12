import type { PlatformId } from './destination.js';

export interface ChatAuthor {
  id: string;
  displayName: string;
  avatarUrl?: string;
  badges?: Array<'owner' | 'moderator' | 'member' | 'verified' | 'subscriber'>;
}

export interface ChatMessage {
  id: string;
  platform: PlatformId;
  destinationId: string;
  author: ChatAuthor;
  text: string;
  receivedAt: number;
  /** Platform message id used for moderation actions. */
  platformMessageId?: string;
  /** True when this message was sent by the broadcaster through LIVETAP. */
  own?: boolean;
  mock?: boolean;
}

export type ModerationAction = 'delete' | 'timeout' | 'ban';

export interface ModerationRequest {
  action: ModerationAction;
  message: ChatMessage;
  durationSeconds?: number;
}
