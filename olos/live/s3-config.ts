export type LiveS3Env = Record<string, string | undefined>;

export type LiveS3Config =
  | { status: "disabled" }
  | {
      accessKeyId: string;
      bucket: string;
      endpoint?: string;
      forcePathStyle: boolean;
      prefix: string;
      region: string;
      secretAccessKey: string;
      status: "enabled";
    };

export function readLiveS3ConfigFromEnv(env: LiveS3Env): LiveS3Config {
  if (env.OLOS_LIVE_S3 !== "1") {
    return { status: "disabled" };
  }

  const required = readRequiredLiveS3Env(env, [
    "OLOS_LIVE_S3_ACCESS_KEY_ID",
    "OLOS_LIVE_S3_BUCKET",
    "OLOS_LIVE_S3_REGION",
    "OLOS_LIVE_S3_SECRET_ACCESS_KEY",
  ]);

  assertLiveS3Bucket(required.OLOS_LIVE_S3_BUCKET);

  return {
    accessKeyId: required.OLOS_LIVE_S3_ACCESS_KEY_ID,
    bucket: required.OLOS_LIVE_S3_BUCKET,
    endpoint: readLiveS3Endpoint(env),
    forcePathStyle: readBoolEnv(
      env,
      "OLOS_LIVE_S3_FORCE_PATH_STYLE",
      env.OLOS_LIVE_S3_ENDPOINT !== undefined
    ),
    prefix: readLiveS3Prefix(env),
    region: required.OLOS_LIVE_S3_REGION,
    secretAccessKey: required.OLOS_LIVE_S3_SECRET_ACCESS_KEY,
    status: "enabled",
  };
}

function readLiveS3Endpoint(env: LiveS3Env): string | undefined {
  const endpoint = env.OLOS_LIVE_S3_ENDPOINT;

  if (endpoint === undefined) {
    return;
  }

  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("OLOS_LIVE_S3_ENDPOINT must be an absolute HTTP(S) URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OLOS_LIVE_S3_ENDPOINT must be an absolute HTTP(S) URL");
  }

  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(
      "OLOS_LIVE_S3_ENDPOINT must not include a path, query, or fragment"
    );
  }

  return endpoint;
}

function readLiveS3Prefix(env: LiveS3Env): string {
  const prefix = (env.OLOS_LIVE_S3_PREFIX ?? "olos-live-s3").replace(
    /^\/+|\/+$/g,
    ""
  );

  if (
    prefix === "" ||
    hasControlCharacter(prefix) ||
    prefix.includes("?") ||
    prefix.includes("#") ||
    prefix
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      "OLOS_LIVE_S3_PREFIX must be a safe relative object prefix"
    );
  }

  return prefix;
}

function assertLiveS3Bucket(value: string): void {
  if (hasControlCharacter(value) || value.includes("/")) {
    throw new Error(
      "OLOS_LIVE_S3_BUCKET must not contain path separators or control characters"
    );
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function readRequiredLiveS3Env<const Names extends readonly string[]>(
  env: LiveS3Env,
  names: Names
): Record<Names[number], string> {
  const missing = names.filter(
    (name) => env[name] === undefined || env[name] === ""
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required live S3 env when OLOS_LIVE_S3=1: ${missing.join(", ")}`
    );
  }

  return Object.fromEntries(names.map((name) => [name, env[name]])) as Record<
    Names[number],
    string
  >;
}

function readBoolEnv(env: LiveS3Env, name: string, fallback: boolean): boolean {
  const value = env[name];

  if (value === undefined) {
    return fallback;
  }

  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }

  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }

  throw new Error(`${name} must be true, false, 1, or 0`);
}
