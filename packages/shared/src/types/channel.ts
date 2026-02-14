import type { Timestamp } from './base.ts';

export const ChannelType = {
  TELEGRAM: 'telegram',
  DISCORD: 'discord',
  SLACK: 'slack',
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  token: string;
  webhookPath: string;
}

export interface ChannelMessage {
  channelType: ChannelType;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Timestamp;
  metadata?: Record<string, unknown>;
}
