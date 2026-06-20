import {
  assertNonNegativeInteger as assertValidatedNonNegativeInteger,
  assertPositiveInteger as assertValidatedPositiveInteger,
} from "../validation/ids";

export function assertPositiveInteger(value: number, name: string): void {
  assertValidatedPositiveInteger(value, name);
}

export function assertNonNegativeInteger(value: number, name: string): void {
  assertValidatedNonNegativeInteger(value, name);
}
