import fs from 'fs';
import path from 'path';
import os from 'os';

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
              apiKey: gatewayKey,
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
      snippet: `export ANTHROPIC_BASE_URL="${rootUrl}"\nexport ANTHROPIC_AUTH_TOKEN="${gatewayKey}"\nexport ANTHROPIC_MODEL="${chainName}"`,
      instructions: 'Run these export commands in your shell before launching claude, or put them in ~/.bashrc / PowerShell $PROFILE.',
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      category: 'cli',
      description: 'OpenAI command line coding tool using Responses API and chat completions',
      docUrl: 'https://github.com/openai/codex',
      configType: 'env',
      snippet: `export OPENAI_BASE_URL="${v1Url}"\nexport OPENAI_API_KEY="${gatewayKey}"\nexport CODEX_MODEL="${chainName}"`,
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
        apiKey: gatewayKey,
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
        apiKey: gatewayKey,
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
            apiKey: gatewayKey,
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
      snippet: `export OPENAI_API_BASE="${v1Url}"\nexport OPENAI_API_KEY="${gatewayKey}"\naider --model openai/${chainName}`,
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
      snippet: `curl ${v1Url}/chat/completions \\\n  -H "Authorization: Bearer ${gatewayKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${chainName}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
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
      [chainName]: {
        name: `${chainName} (NonStop)`,
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
    },
  };

  parsed.model = `nonstop/${chainName}`;
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
