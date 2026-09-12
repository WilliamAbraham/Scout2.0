import type {LlmClient, LlmCompletion, LlmToolCall, ToolName} from './types.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const TOOL_SCHEMAS: Record<ToolName, {description: string; parameters: Record<string, unknown>}> = {
  check_availability: {
    description: 'Check whether the renter is free during a proposed tour window.',
    parameters: {
      type: 'object',
      properties: {
        start: {type: 'string', description: 'ISO 8601 start time'},
        end: {type: 'string', description: 'ISO 8601 end time'},
      },
      required: ['start', 'end'],
    },
  },
  book_tour: {
    description: 'Book a confirmed tour on the renter calendar.',
    parameters: {
      type: 'object',
      properties: {
        start: {type: 'string'},
        end: {type: 'string'},
      },
      required: ['start', 'end'],
    },
  },
  send_reply: {
    description: 'Send a reply in the existing broker thread.',
    parameters: {
      type: 'object',
      properties: {body: {type: 'string'}},
      required: ['body'],
    },
  },
  send_packet: {
    description: 'Email the stored application packet in this thread.',
    parameters: {type: 'object', properties: {}},
  },
  escalate: {
    description: 'Hand control to the user when the agent cannot proceed.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['no_contact', 'unanswerable_question', 'no_fitting_slot', 'portal_link', 'missing_document', 'decision'],
        },
        detail: {type: 'string'},
      },
      required: ['reason', 'detail'],
    },
  },
  mark_dead: {
    description: 'Stop pursuing this listing.',
    parameters: {
      type: 'object',
      properties: {reason: {type: 'string'}},
      required: ['reason'],
    },
  },
  schedule_follow_up: {
    description: 'Schedule a future follow-up email if the broker goes quiet.',
    parameters: {
      type: 'object',
      properties: {
        days: {type: 'number', description: 'Days from now to send the follow-up'},
      },
      required: ['days'],
    },
  },
};

type OpenRouterToolCall = {
  id: string;
  type: 'function';
  function: {name: string; arguments: string};
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
  error?: {message?: string};
};

function parseToolCalls(raw: OpenRouterToolCall[] | undefined): LlmToolCall[] {
  if (!raw?.length) {
    return [];
  }
  return raw.flatMap(call => {
    if (call.type !== 'function') {
      return [];
    }
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      return [];
    }
    return [{name: call.function.name as ToolName, arguments: args}];
  });
}

export function createOpenRouterClient(options: {
  apiKey: string;
  model?: string | undefined;
  fetchImpl?: typeof fetch;
  appUrl?: string | undefined;
}): LlmClient {
  const model = options.model ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete(input): Promise<LlmCompletion> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          {role: 'system', content: input.system},
          {role: 'user', content: input.user},
        ],
      };
      if (input.tools.length > 0) {
        body.tools = input.tools.map(name => ({
          type: 'function',
          function: {
            name,
            description: TOOL_SCHEMAS[name].description,
            parameters: TOOL_SCHEMAS[name].parameters,
          },
        }));
        body.tool_choice = 'auto';
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (options.appUrl) {
        headers['HTTP-Referer'] = options.appUrl;
      }

      const response = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const payload = await response.json() as OpenRouterResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `OpenRouter HTTP ${response.status}`);
      }

      const message = payload.choices?.[0]?.message;
      return {
        text: typeof message?.content === 'string' ? message.content : undefined,
        toolCalls: parseToolCalls(message?.tool_calls),
      };
    },
  };
}
