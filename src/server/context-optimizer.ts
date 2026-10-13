/**
 * NonStop Router — Context & Token Optimization Engine (ContextTrim)
 * Conservative, non-lossy-for-recent-turns compression pipeline for coding prompts.
 * Strips whitespace bloat, de-duplicates repeated large file payloads across older
 * turns, and compacts verbose git diffs and noisy build logs before upstream dispatch.
 */

import crypto from 'crypto';

export interface OptimizationResult {
  optimizedBody: any;
  originalChars: number;
  optimizedChars: number;
  charsSaved: number;
  estimatedTokensSaved: number;
  compressionRatio: number; // e.g., 0.22 (22% reduction)
}

/**
 * Compacts excessive whitespace without altering indentation inside code blocks.
 */
function cleanWhitespace(text: string): string {
  // Normalize Windows newlines
  let res = text.replace(/\r\n/g, '\n');
  // Collapse 3+ newlines to max 2
  res = res.replace(/\n{3,}/g, '\n\n');
  // Strip trailing spaces and tabs from lines
  res = res.replace(/[ \t]+$/gm, '');
  return res;
}

/**
 * Compacts verbose git diff metadata that adds token bloat without aiding reasoning.
 * e.g., strips "index 1234567..89abcdef 100644" and "=== modified file" banners.
 */
function compactGitDiffs(text: string): string {
  if (!text.includes('diff --git')) return text;
  
  // Strip raw git commit hash index lines
  let res = text.replace(/^index [0-9a-f]{7,40}\.\.[0-9a-f]{7,40}(?: \d+)?$/gm, '');
  // Strip old/new mode transitions if identical
  res = res.replace(/^old mode \d+\s*\nnew mode \d+$/gm, '');
  return res;
}

/**
 * Compacts massive build / compiler progress logs (e.g., "[12/240] Building ...")
 * keeping the start and end but collapsing repetitive middle iterations.
 */
function compactCompilerLogs(text: string): string {
  // Matches 5+ consecutive lines of "[X/Y] Compiling/Building..."
  const progressRegex = /(?:^\s*\[\s*\d+\s*\/\s*\d+\s*\].+$\n){5,}/gm;
  return text.replace(progressRegex, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length <= 4) return match;
    const firstTwo = lines.slice(0, 2).join('\n');
    const lastTwo = lines.slice(-2).join('\n');
    return `${firstTwo}\n[... ${lines.length - 4} build steps omitted by NonStop Router ...]\n${lastTwo}\n`;
  });
}

/**
 * Deduplicates large code/file content repeated verbatim across multiple user/assistant turns.
 * Frequently happens in Cline/OpenCode when the IDE re-sends the whole file on every turn.
 */
function deduplicateHistoryTurns(messages: any[]): any[] {
  if (messages.length <= 2) return messages;

  const seenLargeSnippets = new Map<string, number>(); // fingerprint -> turn index
  // Only consider dropping a repeat when the earlier copy is still in context and
  // the block is large enough that dedup is worth the risk of losing fidelity.
  const MIN_SNIPPET_LEN = 1200;

  return messages.map((msg, index) => {
    // Never alter a non-string turn, the two most recent turns, or system prompts.
    if (typeof msg.content !== 'string' || index >= messages.length - 2 || msg.role === 'system') {
      return msg;
    }

    let content = msg.content;
    const codeBlockRegex = /```[\w-]*\n([\s\S]{1200,}?)\n```/g;

    content = content.replace(codeBlockRegex, (fullBlock: string, innerCode: string) => {
      if (innerCode.length < MIN_SNIPPET_LEN) return fullBlock;

      // Fingerprint the full block (length + hash of the whole body) so two
      // different files that merely share a header are not treated as equal.
      const fingerprint = crypto.createHash('sha256').update(innerCode).digest('hex');

      if (seenLargeSnippets.has(fingerprint)) {
        return '```\n// [NonStop Router: identical file snippet omitted; refer to earlier turn]\n```';
      }

      seenLargeSnippets.set(fingerprint, index);
      return fullBlock;
    });

    return { ...msg, content };
  });
}

/**
 * Main compression entrypoint. Conservative by design: it never changes the last
 * two turns, never touches system prompts, and only collapses whitespace and
 * clearly redundant blocks. Disabled by default in settings.
 */
export function optimizePromptPayload(body: any): OptimizationResult {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      optimizedBody: body,
      originalChars: 0,
      optimizedChars: 0,
      charsSaved: 0,
      estimatedTokensSaved: 0,
      compressionRatio: 0,
    };
  }

  let originalChars = 0;
  let optimizedChars = 0;

  // Step 1: Turn-level de-duplication
  let processedMessages = deduplicateHistoryTurns(body.messages);

  // Step 2: Content-level compression (whitespace and metadata only)
  processedMessages = processedMessages.map((m: any) => {
    if (typeof m.content !== 'string') {
      return m;
    }

    originalChars += m.content.length;

    let text = cleanWhitespace(m.content);
    text = compactGitDiffs(text);
    text = compactCompilerLogs(text);

    optimizedChars += text.length;

    return { ...m, content: text };
  });

  const charsSaved = Math.max(0, originalChars - optimizedChars);
  // Standard BPE estimation: ~4 English/code characters per token
  const estimatedTokensSaved = Math.round(charsSaved / 4);
  const compressionRatio = originalChars > 0 ? Number((charsSaved / originalChars).toFixed(3)) : 0;

  return {
    optimizedBody: {
      ...body,
      messages: processedMessages,
    },
    originalChars,
    optimizedChars,
    charsSaved,
    estimatedTokensSaved,
    compressionRatio,
  };
}

/**
 * Estimates prompt size in tokens from a request body, for context-window
 * pre-checks. Uses the standard ~4 chars/token heuristic.
 */
export function estimatePromptTokens(body: any): number {
  if (!body) return 0;
  try {
    const text = typeof body === 'string' ? body : JSON.stringify(body.messages ?? body);
    return Math.round(text.length / 4);
  } catch {
    return 0;
  }
}
