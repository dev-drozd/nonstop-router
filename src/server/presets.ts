import type { ProviderProtocol } from '../shared/types.js';

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  defaultBaseUrl: string;
  modelsEndpoint: string;
  docsUrl: string;
  requiresKey: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'tokenharbor',
    name: 'Token Harbor',
    protocol: 'openai',
    defaultBaseUrl: 'https://tokenharbor.ai/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://tokenharbor.ai',
    requiresKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://platform.openai.com',
    requiresKey: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://docs.anthropic.com',
    requiresKey: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    modelsEndpoint: '/models',
    docsUrl: 'https://platform.deepseek.com',
    requiresKey: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://openrouter.ai/docs',
    requiresKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://console.groq.com',
    requiresKey: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://together.ai',
    requiresKey: true,
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://mistral.ai',
    requiresKey: true,
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.x.ai/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://docs.x.ai',
    requiresKey: true,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsEndpoint: '/models',
    docsUrl: 'https://ai.google.dev',
    requiresKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    protocol: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://ollama.ai',
    requiresKey: false,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    protocol: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    modelsEndpoint: '/models',
    docsUrl: 'https://lmstudio.ai',
    requiresKey: false,
  },
];
