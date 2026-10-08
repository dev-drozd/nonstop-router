import React from 'react';

interface ProviderLogoProps {
  providerName: string;
  className?: string;
  size?: number;
}

export const ProviderLogo: React.FC<ProviderLogoProps> = ({ providerName, className = '', size = 20 }) => {
  const norm = providerName.toLowerCase();

  // Token Harbor
  if (norm.includes('token') || norm.includes('harbor')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <path d="M6 8h12M12 8v10M8 18h8" stroke="#E8590C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Anthropic / Claude
  if (norm.includes('anthropic') || norm.includes('claude')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <path d="M14.5 5.5l5 13h-3.2l-1-2.8H8.7l-1 2.8H4.5l5-13h5zm-2.8 7.6h2.6l-1.3-3.6-1.3 3.6z" fill="#D97706" />
      </svg>
    );
  }

  // OpenAI
  if (norm.includes('openai') || norm.includes('gpt')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <path d="M12 6a4 4 0 0 1 3.5 2l1.7-1a6 6 0 0 0-7.8 1.4l1.8 1A4 4 0 0 1 12 6zm4.8 3.5a4 4 0 0 1 .5 4l1.7 1a6 6 0 0 0 .5-7.9l-1.7 1a4 4 0 0 1-.5 1.9zm-1.3 5.3a4 4 0 0 1-3.5 2l-1.7 1a6 6 0 0 0 7.8-1.4l-1.8-1a4 4 0 0 1-.8-.6zm-4.8-1.3a4 4 0 0 1-.5-4l-1.7-1a6 6 0 0 0-.5 7.9l1.7-1a4 4 0 0 1 .5-1.9z" fill="#10A37F" />
      </svg>
    );
  }

  // DeepSeek
  if (norm.includes('deepseek')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <path d="M7 16l5-8 5 8M9.5 12h5" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Google / Gemini
  if (norm.includes('google') || norm.includes('gemini')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <path d="M12 5v14M5 12h14" stroke="#4285F4" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }

  // Groq
  if (norm.includes('groq')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <circle cx="12" cy="12" r="5" stroke="#F97316" strokeWidth="2" />
      </svg>
    );
  }

  // OpenRouter
  if (norm.includes('openrouter')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <path d="M6 12h12M14 8l4 4-4 4" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Ollama
  if (norm.includes('ollama')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
        <rect width="24" height="24" rx="5" fill="#1F1C19" stroke="#3A342E" strokeWidth="1" />
        <circle cx="9" cy="10" r="1.5" fill="#E5E7EB" />
        <circle cx="15" cy="10" r="1.5" fill="#E5E7EB" />
        <path d="M8 15c1 1.5 7 1.5 8 0" stroke="#E5E7EB" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  // Clean Monogram fallback
  const monogram = (providerName.slice(0, 2) || 'PR').toUpperCase();
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-md bg-bg-raised border border-border-default flex items-center justify-center font-mono text-[10px] font-semibold text-text-secondary select-none ${className}`}
    >
      {monogram}
    </div>
  );
};
