import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { which } from "bun";
import { packageRoot } from "./script-paths";

// Subpaths come from the installed export map so a new export needs no edit
// here; KNOWN_SYMBOLS spot-checks one value per subpath. Export-map shape is
// publint/attw's job (`pack:check`), presence is `check-types:dist`'s.
const SMOKE_FILE = `import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifest = require("@arsenstorm/olos/package.json");

const KNOWN_SYMBOLS = new Map([
  [".", "OLOS_WIRE_VERSION"],
  ["./config", "OLOS_ERROR_CODES"],
  ["./conformance", "OLOS_CONFORMANCE_ASSERTION_IDS"],
  ["./hls", "renderMediaPlaylist"],
  ["./media", "assertMediaSession"],
  ["./protocol", "OLOS_PROTOCOL_NAME"],
  ["./runtime", "commitRuntimeUpload"],
  ["./schema", "OLOS_JSON_SCHEMAS"],
  ["./s3", "createStoredS3CoordinatorRuntimeHandler"],
  ["./state", "createDeliveryCachePolicy"],
  ["./validation", "assertCommit"],
]);

const subpaths = Object.keys(manifest.exports).filter(
  (subpath) => subpath !== "./package.json"
);

assert.ok(subpaths.length > 0, "package exports no subpaths");

for (const subpath of subpaths) {
  const specifier =
    subpath === "."
      ? "@arsenstorm/olos"
      : \`@arsenstorm/olos/\${subpath.slice(2)}\`;
  const namespace = await import(specifier);
  const symbol = KNOWN_SYMBOLS.get(subpath);

  if (symbol !== undefined) {
    assert.ok(symbol in namespace, \`expected \${specifier} to export \${symbol}\`);
  }
}

console.log(
  \`package smoke passed for \${subpaths.length} subpaths on node \${process.version}\`
);
`;

export async function writeSmokeConsumerFiles(
  consumerRoot: string
): Promise<void> {
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`
  );
  await writeFile(join(consumerRoot, "smoke.mjs"), SMOKE_FILE);
}

// The smoke run prefers node — the package declares engines.node >= 22 and
// CI provides it via setup-node — but falls back to bun on node-less
// development machines so publish:check stays runnable everywhere.
export function smokeRuntime(): string {
  const node = which("node");

  if (node === null) {
    console.warn(
      "node not found on PATH; running the package smoke under bun instead"
    );
    return "bun";
  }

  return node;
}

// `./s3` needs `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, but
// they are optional peer dependencies, so npm/bun never install them
// alongside the tarball on their own — install them explicitly, at the
// versions the package itself declares, so the smoke run exercises `./s3`.
export async function optionalPeerDependencySpecs(): Promise<string[]> {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8")
  ) as { peerDependencies?: Record<string, string> };
  const peers = manifest.peerDependencies ?? {};

  return Object.entries(peers).map(([name, range]) => `${name}@${range}`);
}
