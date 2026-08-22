interface AbsoluteHttpUrlOptions {
  allowQueryOrFragment?: boolean;
}

export function assertAbsoluteHttpUrl(
  value: unknown,
  name: string,
  options: AbsoluteHttpUrlOptions = {}
): void {
  parseAbsoluteHttpUrl(value, name, options);
}

export function parseAbsoluteHttpUrl(
  value: unknown,
  name: string,
  options: AbsoluteHttpUrlOptions = {}
): URL {
  const url = parseUrl(absoluteHttpUrlString(value, name), name);

  assertHttpUrlProtocol(url, name);
  assertUrlQueryAndFragmentPolicy(url, name, options);

  return url;
}

function absoluteHttpUrlString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  return value;
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}

function assertHttpUrlProtocol(url: URL, name: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}

function assertUrlQueryAndFragmentPolicy(
  url: URL,
  name: string,
  options: AbsoluteHttpUrlOptions
): void {
  if (!options.allowQueryOrFragment && hasUrlQueryOrFragment(url)) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

function hasUrlQueryOrFragment(url: URL): boolean {
  return url.search.length > 0 || url.hash.length > 0;
}
