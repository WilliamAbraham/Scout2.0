import {createOpenRouterClient} from './openrouter.ts';
import type {OutreachPorts} from './types.ts';

export function createOutreachPorts(options: {
  openRouterApiKey: string;
  model?: string;
  appUrl?: string;
  mode?: 'dry-run' | 'live';
  sendMail?: OutreachPorts['sendMail'];
  reserveModelSpend?: OutreachPorts['reserveModelSpend'];
}): OutreachPorts {
  const mode = options.mode ?? 'dry-run';
  return {
    llm: createOpenRouterClient({
      apiKey: options.openRouterApiKey,
      ...(options.model ? {model: options.model} : {}),
      ...(options.appUrl ? {appUrl: options.appUrl} : {}),
    }),
    checkAvailability: async () => ({free: true}),
    bookTour: async () => {
      throw new Error('Calendar booking is not available');
    },
    sendMail: options.sendMail ?? (mode === 'live'
      ? async () => {
        throw new Error('live sendMail is not configured; pass a Gmail outbox sender');
      }
      : async message => {
        if (!message.body.trim()) {
          throw new Error('Cannot send an empty draft');
        }
        return {threadId: message.threadId ?? 'dry-run', messageId: 'dry-run'};
      }),
    sendPacket: async () => {
      throw new Error('Document release is not available');
    },
    ...(options.reserveModelSpend ? {reserveModelSpend: options.reserveModelSpend} : {}),
  };
}
