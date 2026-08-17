import type { Tool } from '@mistralai/mistralai/models/components/tool.js';

export type AuthoringToolName =
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'wait'
  | 'extract_candidates'
  | 'ask_secret'
  | 'propose_job';

export const MAX_TURNS_PER_MESSAGE = 20;
export const MAX_TURNS_PER_CONVERSATION = 40;

function tool(
  name: AuthoringToolName,
  description: string,
  parameters: Record<string, unknown>,
): Tool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters,
    },
  };
}

export const authoringTools: Tool[] = [
  tool(
    'snapshot',
    'Capture an accessibility tree snapshot and optional screenshot of the current page.',
    { type: 'object', properties: {}, additionalProperties: false },
  ),
  tool(
    'click',
    'Click an element matching a CSS selector.',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to click' },
      },
      required: ['selector'],
      additionalProperties: false,
    },
  ),
  tool(
    'fill',
    'Fill an input with a literal value or a secret key previously collected from the user.',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input' },
        value: { type: 'string', description: 'Literal text to type' },
        secretKey: {
          type: 'string',
          description: 'Secret key to fill from encrypted store (e.g. username, password)',
        },
      },
      required: ['selector'],
      additionalProperties: false,
    },
  ),
  tool(
    'wait',
    'Wait for a selector to appear or for a timeout.',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector to wait for' },
        timeoutMs: { type: 'number', description: 'Maximum wait in milliseconds' },
      },
      additionalProperties: false,
    },
  ),
  tool(
    'extract_candidates',
    'Try extracting sample values from the page using selectors and strategies.',
    {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              selector: { type: 'string' },
              strategy: { type: 'string', enum: ['text', 'price', 'json_ld', 'shopify_json'] },
            },
            required: ['key', 'selector'],
          },
        },
      },
      required: ['fields'],
      additionalProperties: false,
    },
  ),
  tool(
    'ask_secret',
    'Ask the user for secret credentials via the UI form. Stops the turn until secrets are submitted.',
    {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Secret keys to collect (e.g. username, password)',
        },
        message: { type: 'string', description: 'Assistant message explaining what is needed' },
      },
      required: ['keys'],
      additionalProperties: false,
    },
  ),
  tool(
    'propose_job',
    'Propose a workflow job with a sample extract for user confirmation.',
    {
      type: 'object',
      properties: {
        workflow: { type: 'array', items: { type: 'object' } },
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string', enum: ['string', 'number', 'price', 'date'] },
            },
            required: ['key', 'label', 'type'],
          },
        },
        extract: {
          type: 'object',
          additionalProperties: { type: ['string', 'number'] },
        },
        message: { type: 'string' },
      },
      required: ['workflow', 'schema', 'extract'],
      additionalProperties: false,
    },
  ),
];

export function isAuthoringToolName(name: string): name is AuthoringToolName {
  return (
    name === 'snapshot' ||
    name === 'click' ||
    name === 'fill' ||
    name === 'wait' ||
    name === 'extract_candidates' ||
    name === 'ask_secret' ||
    name === 'propose_job'
  );
}
