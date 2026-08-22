import type { SessionState } from "../types/session";
import { SESSION_TRANSITIONS } from "../types/session";

const SESSION_TRANSITION_MAP: Partial<
  Record<SessionState, readonly SessionState[]>
> = SESSION_TRANSITIONS;

const sessionTransitionRules = createTransitionRules(
  SESSION_TRANSITION_MAP,
  "session"
);

/**
 * Whether a session may move from one state to another. Allowed
 * transitions: `live -> ending | aborted` and `ending -> ended`; `ended`
 * and `aborted` are terminal. Pure.
 */
export function canTransitionSession(
  from: SessionState,
  to: SessionState
): boolean {
  return sessionTransitionRules.can(from, to);
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
  sessionTransitionRules.assert(from, to);
}

/**
 * Whether a session state is terminal (`ended` or `aborted`): no further
 * transitions or commits can occur, and media playlists emit
 * `#EXT-X-ENDLIST`. Pure.
 */
export function isEndOfStreamSessionState(state: SessionState): boolean {
  return state === "ended" || state === "aborted";
}

/**
 * Build the `allowed`/`can`/`assert` trio for a state machine's transition
 * map. `noun` names the entity in the thrown message: `Invalid <noun>
 * transition: <from> -> <to>`.
 */
export function createTransitionRules<State extends string>(
  map: Partial<Record<State, readonly State[]>>,
  noun: string
): {
  allowed(from: State): readonly State[];
  can(from: State, to: State): boolean;
  assert(from: State, to: State): void;
} {
  const allowed = (from: State): readonly State[] => map[from] ?? [];
  const can = (from: State, to: State): boolean => allowed(from).includes(to);
  const assert = (from: State, to: State): void => {
    if (can(from, to)) {
      return;
    }

    throw new Error(`Invalid ${noun} transition: ${from} -> ${to}`);
  };

  return { allowed, can, assert };
}
