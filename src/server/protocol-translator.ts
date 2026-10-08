import crypto from 'crypto';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: any;
  };
}

export interface AnthropicMessageRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<any>;
  }>;
  system?: string | Array<{ type: string; text: string }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema?: any;
  }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  stop_sequences?: string[];
}

export interface ResponsesApiRequest {
  model: string;
  input: string | Array<{ role: string; content: any }>;
  instructions?: string;
  tools?: any[];
  temperature?: number;
  max_output_tokens?: number;
  stream?: boolean;
}

/**
 * Translates an Anthropic /v1/messages request body into an OpenAI-compatible /v1/chat/completions payload.
 */
export function translateAnthropicToOpenAI(body: AnthropicMessageRequest): {
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string[];
} {
  const messages: OpenAIMessage[] = [];

  // Extract system prompt
  if (body.system) {
    let systemText = '';
    if (typeof body.system === 'string') {
      systemText = body.system;
    } else if (Array.isArray(body.system)) {
      systemText = body.system.map(s => s.text || '').join('\n\n');
    }
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  // Convert Anthropic messages
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (Array.isArray(msg.content)) {
        let textParts: string[] = [];
        let toolCalls: OpenAIMessage['tool_calls'] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text || '');
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
              },
            });
          } else if (block.type === 'tool_result') {
            let resContent = '';
            if (typeof block.content === 'string') {
              resContent = block.content;
            } else if (Array.isArray(block.content)) {
              resContent = block.content.map((b: any) => b.text || JSON.stringify(b)).join('\n');
            } else if (block.content) {
              resContent = JSON.stringify(block.content);
            }
            messages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: resContent,
            });
          }
        }

        if (msg.role === 'assistant') {
          messages.push({
            role: 'assistant',
            content: textParts.length > 0 ? textParts.join('\n') : null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        } else if (msg.role === 'user' && textParts.length > 0) {
          messages.push({
            role: 'user',
            content: textParts.join('\n'),
          });
        }
      }
    }
  }

  // Translate tools
  let tools: OpenAITool[] | undefined;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    tools = body.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
  }

  return {
    messages,
    tools,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    stream: body.stream,
    stop: body.stop_sequences,
  };
}

/**
 * Translates an OpenAI Chat Completion response to Anthropic /v1/messages response.
 */
export function translateOpenAIToAnthropicResponse(openAiResp: any, requestedModel: string): any {
  const choice = openAiResp.choices?.[0] || {};
  const msg = choice.message || {};
  const content: any[] = [];

  if (msg.content) {
    content.push({
      type: 'text',
      text: msg.content,
    });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let parsedInput: any = {};
      try {
        parsedInput = JSON.parse(tc.function.arguments || '{}');
      } catch {
        parsedInput = { raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `tool_${crypto.randomUUID()}`,
        name: tc.function.name,
        input: parsedInput,
      });
    }
  }

  let stopReason = 'end_turn';
  if (choice.finish_reason === 'tool_calls') {
    stopReason = 'tool_use';
  } else if (choice.finish_reason === 'length') {
    stopReason = 'max_tokens';
  } else if (choice.finish_reason === 'stop') {
    stopReason = 'end_turn';
  }

  return {
    id: openAiResp.id ? `msg_${openAiResp.id}` : `msg_${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openAiResp.usage?.prompt_tokens || 0,
      output_tokens: openAiResp.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Translates an OpenAI Responses API request (/v1/responses) to OpenAI Chat Completion payload.
 */
export function translateResponsesApiToChatCompletion(body: ResponsesApiRequest): {
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
} {
  const messages: OpenAIMessage[] = [];

  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }

  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (typeof item === 'string') {
        messages.push({ role: 'user', content: item });
      } else if (item && typeof item === 'object') {
        messages.push({
          role: (item.role as any) || 'user',
          content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
        });
      }
    }
  }

  return {
    messages,
    tools: body.tools as any,
    temperature: body.temperature,
    max_tokens: body.max_output_tokens,
    stream: body.stream,
  };
}

/**
 * Translates an OpenAI Chat Completion response to OpenAI Responses API response.
 */
export function translateChatCompletionToResponsesApi(openAiResp: any): any {
  const choice = openAiResp.choices?.[0] || {};
  const msg = choice.message || {};
  const contentText = msg.content || '';

  return {
    id: openAiResp.id ? `resp_${openAiResp.id}` : `resp_${crypto.randomUUID()}`,
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: contentText,
          },
        ],
      },
    ],
    usage: openAiResp.usage || {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  };
}
