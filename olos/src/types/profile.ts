/**
 * Profile-defined data carried opaquely by Core wire objects. Core only
 * requires it to be a JSON object; the owning profile module (for example
 * `@arsenstorm/olos/media` for the CMAF/LL-HLS profile) defines and
 * validates its contents.
 */
export type ProfileData = Record<string, unknown>;

/**
 * The profile a session runs under. `id` names the profile (for example
 * `cmaf-llhls`); every other field belongs to that profile. Core copies the
 * object unchanged onto the session's cursors.
 */
export interface StreamProfile extends ProfileData {
  id: string;
}
