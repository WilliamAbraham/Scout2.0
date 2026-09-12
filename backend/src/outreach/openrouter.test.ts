import assert from 'node:assert/strict';
import test from 'node:test';

import {createOpenRouterClient} from './openrouter.ts';

test('openrouter client parses assistant text for opening emails', async () => {
  const calls: Array<{url: string; body: unknown}> = [];
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    model: 'openai/gpt-4o-mini',
    fetchImpl: async (url, init) => {
      calls.push({url: String(url), body: JSON.parse(String(init?.body))});
      return Response.json({
        choices: [{message: {content: 'Hello, can we tour this week?'}}],
      });
    },
  });

  const result = await client.complete({
    system: 'Write a tour request.',
    user: '118 Mulberry Street',
    tools: [],
  });

  assert.equal(result.text, 'Hello, can we tour this week?');
  assert.deepEqual(result.toolCalls, []);
  assert.equal(calls.length, 1);
  assert.equal((calls[0]?.body as {model: string}).model, 'openai/gpt-4o-mini');
});

test('openrouter client parses tool calls for reply handling', async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({
      choices: [{
        message: {
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: {name: 'send_reply', arguments: '{"body":"Tuesday works."}'},
          }],
        },
      }],
    }),
  });

  const result = await client.complete({
    system: 'Handle broker reply.',
    user: 'Thread',
    tools: ['send_reply'],
  });

  assert.deepEqual(result.toolCalls, [{name: 'send_reply', arguments: {body: 'Tuesday works.'}}]);
});

test('openrouter client surfaces API errors', async () => {
  const client = createOpenRouterClient({
    apiKey: 'bad-key',
    fetchImpl: async () => Response.json({error: {message: 'Invalid API key'}}, {status: 401}),
  });

  await assert.rejects(
    () => client.complete({system: 'x', user: 'y', tools: []}),
    /Invalid API key/,
  );
});
