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

// ---------------------------------------------------------------------------
// Google Gemini (generativelanguage.googleapis.com) translation
// ---------------------------------------------------------------------------

function contentToText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('');
  }
  return '';
}

/**
 * Translates an OpenAI Chat Completions payload into a Gemini generateContent body.
 */
export function translateOpenAIToGemini(openAiPayload: any): any {
  const messages: any[] = Array.isArray(openAiPayload.messages) ? openAiPayload.messages : [];
  const systemParts: string[] = [];
  const contents: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(contentToText(msg.content));
      continue;
    }

    if (msg.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.name || msg.tool_call_id || 'tool',
            response: { result: contentToText(msg.content) },
          },
        }],
      });
      continue;
    }

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const parts: any[] = [];
      const text = contentToText(msg.content);
      if (text) parts.push({ text });
      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
        parts.push({ functionCall: { name: tc.function?.name, args } });
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: contentToText(msg.content) }],
    });
  }

  const body: any = { contents };

  if (systemParts.filter(Boolean).length > 0) {
    body.systemInstruction = { parts: [{ text: systemParts.filter(Boolean).join('\n\n') }] };
  }

  const generationConfig: any = {};
  if (typeof openAiPayload.temperature === 'number') generationConfig.temperature = openAiPayload.temperature;
  if (typeof openAiPayload.top_p === 'number') generationConfig.topP = openAiPayload.top_p;
  if (typeof openAiPayload.max_tokens === 'number') generationConfig.maxOutputTokens = openAiPayload.max_tokens;
  if (Array.isArray(openAiPayload.stop) && openAiPayload.stop.length) generationConfig.stopSequences = openAiPayload.stop;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  if (Array.isArray(openAiPayload.tools) && openAiPayload.tools.length > 0) {
    body.tools = [{
      functionDeclarations: openAiPayload.tools
        .filter((t: any) => t?.function)
        .map((t: any) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters || { type: 'object', properties: {} },
        })),
    }];
  }

  return body;
}

/**
 * Translates a Gemini generateContent response into an OpenAI Chat Completion response.
 */
export function translateGeminiToOpenAI(geminiResp: any, modelId: string): any {
  const candidate = geminiResp?.candidates?.[0] || {};
  const parts: any[] = candidate?.content?.parts || [];

  let text = '';
  const toolCalls: any[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string') text += part.text;
    if (part?.functionCall) {
      toolCalls.push({
        id: `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  }

  let finishReason: string = 'stop';
  const raw = String(candidate?.finishReason || '').toUpperCase();
  if (raw === 'MAX_TOKENS') finishReason = 'length';
  else if (raw === 'SAFETY' || raw === 'RECITATION') finishReason = 'content_filter';
  else if (toolCalls.length > 0) finishReason = 'tool_calls';

  const usageMeta = geminiResp?.usageMetadata || {};
  const promptTokens = usageMeta.promptTokenCount || 0;
  const completionTokens = usageMeta.candidatesTokenCount || 0;

  return {
    id: `chatcmpl_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: usageMeta.totalTokenCount || (promptTokens + completionTokens),
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI -> Anthropic request translation (for Anthropic-native upstreams)
// ---------------------------------------------------------------------------

/**
 * Translates an OpenAI Chat Completions payload into an Anthropic Messages payload.
 */
export function translateOpenAIToAnthropicRequest(openAiPayload: any): any {
  const messages: any[] = Array.isArray(openAiPayload.messages) ? openAiPayload.messages : [];
  const systemParts: string[] = [];
  const outMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string' ? msg.content : contentToText(msg.content));
      continue;
    }

    if (msg.role === 'tool') {
      outMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
        }],
      });
      continue;
    }

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const blocks: any[] = [];
      const text = typeof msg.content === 'string' ? msg.content : contentToText(msg.content);
      if (text) blocks.push({ type: 'text', text });
      for (const tc of msg.tool_calls) {
        let input: any = {};
        try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = {}; }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
      }
      outMessages.push({ role: 'assistant', content: blocks });
      continue;
    }

    outMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: typeof msg.content === 'string' ? msg.content : contentToText(msg.content),
    });
  }

  const body: any = {
    messages: outMessages,
    max_tokens: openAiPayload.max_tokens ?? 4096,
  };
  if (systemParts.filter(Boolean).length > 0) body.system = systemParts.filter(Boolean).join('\n\n');
  if (typeof openAiPayload.temperature === 'number') body.temperature = openAiPayload.temperature;
  if (typeof openAiPayload.top_p === 'number') body.top_p = openAiPayload.top_p;
  if (Array.isArray(openAiPayload.stop) && openAiPayload.stop.length) body.stop_sequences = openAiPayload.stop;
  if (Array.isArray(openAiPayload.tools) && openAiPayload.tools.length > 0) {
    body.tools = openAiPayload.tools
      .filter((t: any) => t?.function)
      .map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }));
  }
  return body;
}

/**
 * Translates an Anthropic Messages response into an OpenAI Chat Completion response.
 */
export function translateAnthropicResponseToOpenAI(anthropicResp: any, modelId: string): any {
  const blocks: any[] = Array.isArray(anthropicResp?.content) ? anthropicResp.content : [];
  let text = '';
  const toolCalls: any[] = [];

  for (const block of blocks) {
    if (block?.type === 'text') text += block.text || '';
    if (block?.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
      });
    }
  }

  let finishReason = 'stop';
  if (anthropicResp?.stop_reason === 'tool_use') finishReason = 'tool_calls';
  else if (anthropicResp?.stop_reason === 'max_tokens') finishReason = 'length';

  return {
    id: anthropicResp?.id || `chatcmpl_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: anthropicResp?.usage?.input_tokens || 0,
      completion_tokens: anthropicResp?.usage?.output_tokens || 0,
      total_tokens: (anthropicResp?.usage?.input_tokens || 0) + (anthropicResp?.usage?.output_tokens || 0),
    },
  };
}

/**
 * Wraps an OpenAI Chat Completion as a valid one-shot OpenAI SSE stream so a
 * non-streaming backend (Gemini, Anthropic) can satisfy a streaming client.
 */
export function chatCompletionToSSE(completion: any): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const choice = completion.choices?.[0] || {};
  const message = choice.message || {};
  const chunks: string[] = [];

  chunks.push(`data: ${JSON.stringify({
    id: completion.id,
    object: 'chat.completion.chunk',
    created: completion.created,
    model: completion.model,
    choices: [{ index: 0, delta: { role: 'assistant', content: message.content || '' }, finish_reason: null }],
  })}\n\n`);

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    chunks.push(`data: ${JSON.stringify({
      id: completion.id,
      object: 'chat.completion.chunk',
      created: completion.created,
      model: completion.model,
      choices: [{ index: 0, delta: { tool_calls: message.tool_calls }, finish_reason: null }],
    })}\n\n`);
  }

  chunks.push(`data: ${JSON.stringify({
    id: completion.id,
    object: 'chat.completion.chunk',
    created: completion.created,
    model: completion.model,
    choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || 'stop' }],
    usage: completion.usage,
  })}\n\n`);
  chunks.push('data: [DONE]\n\n');

  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}
