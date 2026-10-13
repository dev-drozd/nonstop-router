import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from './db.js';

export interface ToolConfigSnippet {
  id: string;
  name: string;
  category: 'cli' | 'editor' | 'generic';
  description: string;
  docUrl: string;
  configType: 'json' | 'env' | 'cli' | 'mixed';
  filename?: string;
  snippet: string;
  instructions: string;
}

export function generateToolConfigs(baseUrl: string, gatewayKey: string, chainName: string): ToolConfigSnippet[] {
  const v1Url = `${baseUrl.replace(/\/+$/, '')}/v1`;
  const rootUrl = baseUrl.replace(/\/+$/, '');
  // Never bake a real secret into a copyable snippet; the one-click writers inject it.
  const keyPlaceholder = 'YOUR_GATEWAY_KEY';

  return [
    {
      id: 'opencode',
      name: 'OpenCode CLI',
      category: 'cli',
      description: 'AI coding agent with automatic tool calling and project memory',
      docUrl: 'https://opencode.ai/docs',
      configType: 'json',
      filename: '~/.config/opencode/opencode.jsonc',
      snippet: JSON.stringify({
        providers: {
          nonstop: {
            name: "NonStop Router",
            package: "@opencode/ai/providers/openai-compatible",
            settings: {
              baseURL: v1Url,
              apiKey: keyPlaceholder,
            },
            models: {
              [chainName]: {
                name: `${chainName} (NonStop)`,
                capabilities: {
                  tools: true,
                  input: ["text", "image"],
                  output: ["text"],
                },
              },
            },
          },
        },
        model: `nonstop/${chainName}`,
      }, null, 2),
      instructions: 'Merge this provider block into your ~/.config/opencode/opencode.jsonc or use the One-Click writer below.',
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      category: 'cli',
      description: "Anthropic's terminal agent for coding tasks",
      docUrl: 'https://docs.anthropic.com/en/docs/claude-code',
      configType: 'env',
      snippet: `export ANTHROPIC_BASE_URL="${rootUrl}"\nexport ANTHROPIC_AUTH_TOKEN="${keyPlaceholder}"\nexport ANTHROPIC_MODEL="${chainName}"`,
      instructions: 'Run these export commands in your shell before launching claude, or put them in ~/.bashrc / PowerShell $PROFILE.',
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      category: 'cli',
      description: 'OpenAI command line coding tool using Responses API and chat completions',
      docUrl: 'https://github.com/openai/codex',
      configType: 'env',
      snippet: `export OPENAI_BASE_URL="${v1Url}"\nexport OPENAI_API_KEY="${keyPlaceholder}"\nexport CODEX_MODEL="${chainName}"`,
      instructions: 'Set the base URL and API key in your terminal session.',
    },
    {
      id: 'cline',
      name: 'Cline (VS Code)',
      category: 'editor',
      description: 'Autonomous coding agent extension for VS Code',
      docUrl: 'https://github.com/cline/cline',
      configType: 'json',
      snippet: JSON.stringify({
        apiProvider: "openai-compatible",
        apiBaseUrl: v1Url,
        apiKey: keyPlaceholder,
        customModelId: chainName,
      }, null, 2),
      instructions: 'In Cline extension settings, choose "OpenAI Compatible", set Base URL to ' + v1Url + ', and enter the key.',
    },
    {
      id: 'roo-code',
      name: 'Roo Code',
      category: 'editor',
      description: 'Community AI assistant extension for VS Code',
      docUrl: 'https://github.com/RooVetGit/Roo-Code',
      configType: 'json',
      snippet: JSON.stringify({
        apiProvider: "openai-compatible",
        baseUrl: v1Url,
        apiKey: keyPlaceholder,
        modelId: chainName,
      }, null, 2),
      instructions: 'In Roo Code settings, select "OpenAI Compatible" provider and paste the endpoint and key.',
    },
    {
      id: 'continue',
      name: 'Continue',
      category: 'editor',
      description: 'Open-source AI code assistant for VS Code and JetBrains',
      docUrl: 'https://docs.continue.dev',
      configType: 'json',
      filename: '~/.continue/config.json',
      snippet: JSON.stringify({
        models: [
          {
            title: `NonStop Router (${chainName})`,
            provider: "openai",
            model: chainName,
            apiKey: keyPlaceholder,
            apiBase: v1Url,
          },
        ],
      }, null, 2),
      instructions: 'Add this model object into the "models" array inside your ~/.continue/config.json file.',
    },
    {
      id: 'aider',
      name: 'Aider',
      category: 'cli',
      description: 'AI pair programming in your terminal',
      docUrl: 'https://aider.chat/docs/install.html',
      configType: 'cli',
      snippet: `export OPENAI_API_BASE="${v1Url}"\nexport OPENAI_API_KEY="${keyPlaceholder}"\naider --model openai/${chainName}`,
      instructions: 'Export the environment variables and run aider with the specified model.',
    },
    {
      id: 'zed',
      name: 'Zed Editor',
      category: 'editor',
      description: 'High-performance code editor with built-in assistant',
      docUrl: 'https://zed.dev/docs/assistant',
      configType: 'json',
      filename: '~/.config/zed/settings.json',
      snippet: JSON.stringify({
        language_models: {
          openai: {
            version: "1",
            api_url: v1Url,
            available_models: [
              {
                name: chainName,
                display_name: `NonStop Router (${chainName})`,
                max_tokens: 128000,
              },
            ],
          },
        },
      }, null, 2),
      instructions: 'Add to your Zed settings.json under language_models.openai.',
    },
    {
      id: 'curl',
      name: 'cURL / OpenAI SDK',
      category: 'generic',
      description: 'Direct HTTP or any standard OpenAI SDK client',
      docUrl: 'https://platform.openai.com/docs/api-reference',
      configType: 'cli',
      snippet: `curl ${v1Url}/chat/completions \\\n  -H "Authorization: Bearer ${keyPlaceholder}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${chainName}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
      instructions: 'Standard OpenAI-compatible completions endpoint with streaming support.',
    },
  ];
}

/**
 * Backs up opencode.jsonc, computes diff, and writes NonStop Router provider.
 */
export function writeToOpenCodeConfig(v1Url: string, gatewayKey: string, chainName: string, execute = false): {
  filePath: string;
  backupPath: string | null;
  hasChanged: boolean;
  originalText: string;
  updatedText: string;
} {
  const possiblePaths = [
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
  ];

  let targetPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
  let originalText = '';
  let parsed: any = {};

  if (fs.existsSync(targetPath)) {
    originalText = fs.readFileSync(targetPath, 'utf8');
    try {
      // Strip comments for parsing
      const stripped = originalText
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^\\:])\/\/.*$/gm, '$1');
      parsed = JSON.parse(stripped);
    } catch {
      parsed = {};
    }
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    parsed = {
      $schema: "https://opencode.ai/config.json",
      providers: {},
    };
  }

  if (!parsed.providers) parsed.providers = {};

  const db = getDb();
  let dbModels: any[] = [];
  try {
    dbModels = db.prepare('SELECT model_id, name, supports_tools, context_window, is_free FROM models WHERE enabled = 1 ORDER BY is_free DESC, model_id ASC').all() as any[];
  } catch {}

  const dynamicModels: Record<string, any> = {
    [chainName]: {
      name: `${chainName} (Failover Pool)`,
      capabilities: {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 200000,
        output: 32000,
      },
    },
  };

  for (const m of dbModels) {
    dynamicModels[m.model_id] = {
      name: m.name || m.model_id,
      capabilities: {
        tools: Boolean(m.supports_tools),
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: m.context_window || 64000,
        output: 16000,
      },
    };
  }

  // Add / merge nonstop provider
  parsed.providers.nonstop = {
    name: "NonStop Router",
    package: "@opencode/ai/providers/openai-compatible",
    settings: {
      baseURL: v1Url,
      apiKey: gatewayKey,
    },
    models: {
      ...(parsed.providers.nonstop?.models || {}),
      ...dynamicModels,
    },
  };

  if (!parsed.model) {
    parsed.model = `nonstop/${chainName}`;
  }
  const updatedText = JSON.stringify(parsed, null, 2);

  let backupPath: string | null = null;
  if (execute) {
    if (fs.existsSync(targetPath)) {
      backupPath = `${targetPath}.bak.${Date.now()}`;
      fs.copyFileSync(targetPath, backupPath);
    }
    fs.writeFileSync(targetPath, updatedText, 'utf8');
  }

  return {
    filePath: targetPath,
    backupPath,
    hasChanged: originalText !== updatedText,
    originalText,
    updatedText,
  };
}

export function writeToContinueConfig(
  baseUrl: string,
  gatewayKey: string,
  chainName: string = 'auto',
  execute = false
): {
  filePath: string;
  backupPath: string | null;
  hasChanged: boolean;
  originalText: string;
  updatedText: string;
} {
  const v1Url = `${baseUrl.replace(/\/+$/, '')}/v1`;
  const targetPath = path.join(os.homedir(), '.continue', 'config.json');

  let originalText = '';
  let parsed: any = {};

  if (fs.existsSync(targetPath)) {
    originalText = fs.readFileSync(targetPath, 'utf8');
    try {
      parsed = JSON.parse(originalText);
    } catch {
      parsed = {};
    }
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    parsed = { models: [] };
  }

  if (!Array.isArray(parsed.models)) parsed.models = [];

  // Remove existing nonstop entry if present
  parsed.models = parsed.models.filter((m: any) => m.title !== 'NonStop Router');

  // Insert NonStop model at the top
  parsed.models.unshift({
    title: 'NonStop Router',
    provider: 'openai',
    model: chainName,
    apiBase: v1Url,
    apiKey: gatewayKey,
  });

  const updatedText = JSON.stringify(parsed, null, 2);
  let backupPath: string | null = null;
  if (execute) {
    if (fs.existsSync(targetPath)) {
      backupPath = `${targetPath}.bak.${Date.now()}`;
      fs.copyFileSync(targetPath, backupPath);
    }
    fs.writeFileSync(targetPath, updatedText, 'utf8');
  }

  return {
    filePath: targetPath,
    backupPath,
    hasChanged: originalText !== updatedText,
    originalText,
    updatedText,
  };
}

export function writeToAiderConfig(
  baseUrl: string,
  gatewayKey: string,
  chainName: string = 'auto',
  execute = false
): {
  filePath: string;
  backupPath: string | null;
  hasChanged: boolean;
  originalText: string;
  updatedText: string;
} {
  const v1Url = `${baseUrl.replace(/\/+$/, '')}/v1`;
  const targetPath = path.join(os.homedir(), '.aider.conf.yml');

  let originalText = '';
  if (fs.existsSync(targetPath)) {
    originalText = fs.readFileSync(targetPath, 'utf8');
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const lines = originalText.split('\n').filter(l => (
    !l.startsWith('openai-api-base:') &&
    !l.startsWith('openai-api-key:') &&
    !l.startsWith('model:')
  ));

  lines.unshift(
    `# NonStop Router Configuration`,
    `openai-api-base: ${v1Url}`,
    `openai-api-key: ${gatewayKey}`,
    `model: openai/${chainName}`
  );

  const updatedText = lines.join('\n').trim() + '\n';
  let backupPath: string | null = null;
  if (execute) {
    if (fs.existsSync(targetPath)) {
      backupPath = `${targetPath}.bak.${Date.now()}`;
      fs.copyFileSync(targetPath, backupPath);
    }
    fs.writeFileSync(targetPath, updatedText, 'utf8');
  }

  return {
    filePath: targetPath,
    backupPath,
    hasChanged: originalText !== updatedText,
    originalText,
    updatedText,
  };
}

