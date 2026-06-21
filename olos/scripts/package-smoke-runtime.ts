import { expectedRuntimeExports } from "./public-surface";

const exactRuntimeExports = {
  olos: expectedRuntimeExports.olos,
  "olos/types": [],
} as const;

export function packageSmokeSource(): string {
  return `
import { readFile } from "node:fs/promises";

const expectedRuntimeExports = ${JSON.stringify(expectedRuntimeExports)};
const exactRuntimeExports = ${JSON.stringify(exactRuntimeExports)};
const packageJson = JSON.parse(
  await readFile(new URL("./node_modules/olos/package.json", import.meta.url))
);
const exportedSubpaths = Object.keys(packageJson.exports)
  .filter((subpath) => subpath !== "./package.json")
  .map((subpath) => (subpath === "." ? "olos" : \`olos/\${subpath.slice(2)}\`));
const expectedSubpaths = Object.keys(expectedRuntimeExports);

assertList("exported subpaths", exportedSubpaths, expectedSubpaths);

for (const [specifier, names] of Object.entries(expectedRuntimeExports)) {
  const module = await import(specifier);

  for (const name of names) {
    if (!(name in module)) {
      throw new Error(\`\${specifier} is missing \${name}\`);
    }
  }

  if (specifier in exactRuntimeExports) {
    assertList(
      \`\${specifier} runtime exports\`,
      Object.keys(module),
      exactRuntimeExports[specifier]
    );
  }
}

function assertList(name, actual, expected) {
  const actualList = [...actual].sort();
  const expectedList = [...expected].sort();

  if (JSON.stringify(actualList) !== JSON.stringify(expectedList)) {
    throw new Error(
      \`\${name} mismatch: expected \${expectedList.join(", ")}, received \${actualList.join(", ")}\`
    );
  }
}
`.trimStart();
}
