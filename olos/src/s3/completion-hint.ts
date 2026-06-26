import type { OlosId } from "../types/ids";

interface CompletionHintOptions {
  completionHintClock?: () => Date | string;
  completionHintCommitId?: (slotId: string) => string;
  completionHintNow?: () => Date | string;
}

export interface CompletionHintDefaults {
  commitId: (slotId: OlosId) => string;
  committedAt: () => string;
}

const DEFAULT_COMPLETION_HINT_COMMIT_ID_PREFIX = "complete_";
const DEFAULT_COMPLETION_HINT_NOW = (): Date | string => new Date();

export function createCompletionHintDefaults(
  options: CompletionHintOptions
): CompletionHintDefaults {
  return {
    committedAt: () =>
      completionHintTimestamp(resolveCompletionHintNow(options)),
    commitId: resolveCompletionHintCommitId(options),
  };
}

function resolveCompletionHintCommitId(
  options: CompletionHintOptions
): (slotId: string) => string {
  if (options.completionHintCommitId !== undefined) {
    return options.completionHintCommitId;
  }

  return completionHintCommitId;
}

function resolveCompletionHintNow(
  options: CompletionHintOptions
): () => Date | string {
  if (options.completionHintClock !== undefined) {
    return options.completionHintClock;
  }

  if (options.completionHintNow !== undefined) {
    return options.completionHintNow;
  }

  return DEFAULT_COMPLETION_HINT_NOW;
}

function completionHintCommitId(slotId: string): string {
  return `${DEFAULT_COMPLETION_HINT_COMMIT_ID_PREFIX}${slotId}`;
}

function completionHintTimestamp(now: () => Date | string): string {
  const next = now();

  return next instanceof Date ? next.toISOString() : next;
}
