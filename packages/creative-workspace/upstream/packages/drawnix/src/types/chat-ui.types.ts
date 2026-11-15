import type { Dispatch, SetStateAction } from 'react';

export type MessageRole = 'user' | 'assistant' | 'system' | 'data';

export interface TextMessagePart {
  type: 'text';
  text: string;
}

export interface DataFileMessagePart {
  type: 'data-file';
  data: {
    filename?: string;
    mediaType?: string;
    url?: string;
  };
}

export interface ImageUrlMessagePart {
  type: 'image_url';
  image_url?: {
    url?: string;
  };
}

export type MessagePart =
  | TextMessagePart
  | DataFileMessagePart
  | ImageUrlMessagePart;

export interface Message {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  [key: string]: unknown;
}

export type ChatHandlerStatus =
  | 'ready'
  | 'submitted'
  | 'streaming'
  | 'error';

export interface ChatHandler {
  messages: Message[];
  status: ChatHandlerStatus;
  sendMessage: (message: Message) => Promise<void>;
  stop: () => Promise<void>;
  regenerate: (opts?: { messageId?: string }) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}
