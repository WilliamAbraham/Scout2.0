import {createOpenRouterClient} from './openrouter.ts';
import type {OutreachPorts} from './types.ts';

export function createOutreachPorts(options: {
  openRouterApiKey: string;
  model?: string;
  appUrl?: string;
  sendMail?: OutreachPorts['sendMail'];
}): OutreachPorts {
  return {
    llm: createOpenRouterClient({
      apiKey: options.openRouterApiKey,
      ...(options.model ? {model: options.model} : {}),
      ...(options.appUrl ? {appUrl: options.appUrl} : {}),
    }),
    checkAvailability: async () => ({free: true}),
    bookTour: async () => ({eventId: 'stub'}),
    sendMail: options.sendMail ?? (async message => ({
      threadId: message.threadId ?? `thread-${Date.now()}`,
      messageId: `msg-${Date.now()}`,
    })),
    sendPacket: async () => {},
  };
}
