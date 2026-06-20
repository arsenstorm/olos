export function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
