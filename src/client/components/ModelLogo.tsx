import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color';
import ClaudeColor from '@lobehub/icons/es/Claude/components/Color';
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono';
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color';
import QwenColor from '@lobehub/icons/es/Qwen/components/Color';
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color';
import MoonshotMono from '@lobehub/icons/es/Moonshot/components/Mono';
import MinimaxColor from '@lobehub/icons/es/Minimax/components/Color';
import MistralColor from '@lobehub/icons/es/Mistral/components/Color';
import GroqMono from '@lobehub/icons/es/Groq/components/Mono';
import MetaColor from '@lobehub/icons/es/Meta/components/Color';
import OllamaMono from '@lobehub/icons/es/Ollama/components/Mono';
import { isFreeModelId } from '../../shared/types.js';

interface ModelLogoProps {
  modelId?: string;
  providerName?: string;
  size?: number;
  className?: string;
}

export function detectModelFamily(modelId: string = '', providerName: string = ''): {
  family: string;
  color: string;
  isFree: boolean;
} {
  const norm = (modelId + ' ' + providerName).toLowerCase();
  const isFree = isFreeModelId(modelId);

  if (norm.includes('deepseek')) return { family: 'DeepSeek', color: '#3B82F6', isFree };
  if (norm.includes('claude') || norm.includes('anthropic')) return { family: 'Claude', color: '#D97706', isFree };
  if (norm.includes('gpt') || norm.includes('openai') || norm.includes('codex') || norm.includes('o3') || norm.includes('o1')) return { family: 'OpenAI', color: '#10A37F', isFree };
  if (norm.includes('gemini') || norm.includes('google')) return { family: 'Gemini', color: '#4285F4', isFree };
  if (norm.includes('qwen')) return { family: 'Qwen', color: '#8B5CF6', isFree };
  if (norm.includes('glm') || norm.includes('z-ai') || norm.includes('zhipu')) return { family: 'GLM', color: '#06B6D4', isFree };
  if (norm.includes('kimi') || norm.includes('moonshot')) return { family: 'Kimi', color: '#F43F5E', isFree };
  if (norm.includes('mimo') || norm.includes('minimax')) return { family: 'MiniMax', color: '#EC4899', isFree };
  if (norm.includes('mistral') || norm.includes('codestral')) return { family: 'Mistral', color: '#F97316', isFree };
  if (norm.includes('groq')) return { family: 'Groq', color: '#F59E0B', isFree };
  if (norm.includes('llama') || norm.includes('meta')) return { family: 'Llama', color: '#3B82F6', isFree };
  if (norm.includes('ollama')) return { family: 'Ollama', color: '#E5E7EB', isFree };
  if (norm.includes('tokenharbor') || norm.includes('token harbor')) return { family: 'Token Harbor', color: '#E8590C', isFree };

  return { family: providerName || 'LLM', color: '#868E96', isFree };
}

export const ModelLogo: React.FC<ModelLogoProps> = ({
  modelId = '',
  providerName = '',
  size = 20,
  className = '',
}) => {
  const { family } = detectModelFamily(modelId, providerName);

  // 1. DeepSeek (@lobehub/icons Color)
  if (family === 'DeepSeek') {
    return <DeepSeekColor size={size} className={className} />;
  }

  // 2. Claude / Anthropic (@lobehub/icons Color)
  if (family === 'Claude') {
    return <ClaudeColor size={size} className={className} />;
  }

  // 3. OpenAI / GPT / Codex (@lobehub/icons Mono with emerald brand tint)
  if (family === 'OpenAI') {
    return (
      <div style={{ width: size, height: size }} className={`flex items-center justify-center text-[#10A37F] ${className}`}>
        <OpenAIMono size={size} />
      </div>
    );
  }

  // 4. Google Gemini (@lobehub/icons Color)
  if (family === 'Gemini') {
    return <GeminiColor size={size} className={className} />;
  }

  // 5. Qwen (@lobehub/icons Color)
  if (family === 'Qwen') {
    return <QwenColor size={size} className={className} />;
  }

  // 6. GLM / Zhipu (@lobehub/icons Color)
  if (family === 'GLM') {
    return <ZhipuColor size={size} className={className} />;
  }

  // 7. Kimi / Moonshot (@lobehub/icons Mono with rose brand tint)
  if (family === 'Kimi') {
    return (
      <div style={{ width: size, height: size }} className={`flex items-center justify-center text-[#FB7185] ${className}`}>
        <MoonshotMono size={size} />
      </div>
    );
  }

  // 8. MiniMax / Mimo (@lobehub/icons Color)
  if (family === 'MiniMax') {
    return <MinimaxColor size={size} className={className} />;
  }

  // 9. Mistral (@lobehub/icons Color)
  if (family === 'Mistral') {
    return <MistralColor size={size} className={className} />;
  }

  // 10. Groq (@lobehub/icons Mono with amber brand tint)
  if (family === 'Groq') {
    return (
      <div style={{ width: size, height: size }} className={`flex items-center justify-center text-[#F59E0B] ${className}`}>
        <GroqMono size={size} />
      </div>
    );
  }

  // 11. Meta / Llama (@lobehub/icons Color)
  if (family === 'Llama') {
    return <MetaColor size={size} className={className} />;
  }

  // 12. Ollama (@lobehub/icons Mono)
  if (family === 'Ollama') {
    return (
      <div style={{ width: size, height: size }} className={`flex items-center justify-center text-text-primary ${className}`}>
        <OllamaMono size={size} />
      </div>
    );
  }



  // 13. Token Harbor (Custom styled SVG)
  if (family === 'Token Harbor') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <path d="M6 8h12M12 8v10M8 18h8" stroke="#E8590C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }


  // Default clean monogram
  const monogram = (modelId.slice(0, 2) || providerName.slice(0, 2) || 'AI').toUpperCase();
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded bg-bg-raised border border-border-default flex items-center justify-center font-mono text-[9px] font-semibold text-text-secondary select-none ${className}`}
    >
      {monogram}
    </div>
  );
};
