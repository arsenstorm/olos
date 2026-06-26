import { SESSION_TRANSITIONS } from "../config/session";
import type { SessionState } from "../types/session";

const SESSION_TRANSITION_MAP: Partial<
  Record<SessionState, readonly SessionState[]>
> = SESSION_TRANSITIONS;

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

  throw new Error(invalidSessionTransitionMessage(from, to));
}

function allowedSessionTransitions(
  from: SessionState
): readonly SessionState[] {
  return SESSION_TRANSITION_MAP[from] ?? [];
}

function invalidSessionTransitionMessage(
  from: SessionState,
  to: SessionState
): string {
  return `Invalid session transition: ${from} -> ${to}`;
}
