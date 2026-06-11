import { SESSION_TRANSITIONS } from "../config/session";
import type { SessionState } from "../types/session";

export function canTransitionSession(
  from: SessionState,
  to: SessionState
): boolean {
  return allowedSessionTransitions(from).includes(to);
}

export function assertSessionTransition(
  from: SessionState,
  to: SessionState
): void {
  if (canTransitionSession(from, to)) {
    return;
  }

  throw new Error(`Invalid session transition: ${from} -> ${to}`);
}

function allowedSessionTransitions(
  from: SessionState
): readonly SessionState[] {
  const transitions: Partial<Record<SessionState, readonly SessionState[]>> =
    SESSION_TRANSITIONS;

  return transitions[from] ?? [];
}
