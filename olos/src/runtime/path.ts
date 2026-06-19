import { hasControlCharacter as hasValidationControlCharacter } from "../validation/fields";

export function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

export function hasControlCharacter(value: string): boolean {
  return hasValidationControlCharacter(value);
}
