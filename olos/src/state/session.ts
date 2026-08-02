import { SESSION_TRANSITIONS } from "../config/session";
import type { SessionState } from "../types/session";

const SESSION_TRANSITION_MAP: Partial<
  Record<SessionState, readonly SessionState[]>
> = SESSION_TRANSITIONS;

/**
 * Whether a session may move from one state to another. Allowed
 * transitions: `live -> ending | aborted` and `ending -> ended`; `ended`
 * and `aborted` are terminal. Pure.
 */
export function canTransitionSession(
  from: SessionState,
  to: SessionState
): boolean {
  return allowedSessionTransitions(from).includes(to);
}

/**
 * Throwing variant of {@link canTransitionSession}: throws
 * `Invalid session transition: <from> -> <to>` when the transition is not
 * allowed, returns nothing otherwise.
 */
export function assertSessionTransition(
  from: SessionState,
  to: SessionState
): void {
  if (canTransitionSession(from, to)) {
    return;
  }

  throw new Error(invalidSessionTransitionMessage(from, to));
}

/**
 * Whether a session state is terminal (`ended` or `aborted`): no further
 * transitions or commits can occur, and media playlists emit
 * `#EXT-X-ENDLIST`. Pure.
 */
export function isEndOfStreamSessionState(state: SessionState): boolean {
  return state === "ended" || state === "aborted";
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
