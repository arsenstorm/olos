import { expectedRuntimeExports } from "./public-surface";

const exactRuntimeExports = {
  "@arsenstorm/olos": expectedRuntimeExports["@arsenstorm/olos"],
  "@arsenstorm/olos/types": [],
} as const;

const runtimeSmokeImports = `import { readFile } from "node:fs/promises";

const expectedRuntimeExports = ${JSON.stringify(expectedRuntimeExports)};
const exactRuntimeExports = ${JSON.stringify(exactRuntimeExports)};
`;

const runtimeSmokePackageExportAssertions = `
const packageJson = JSON.parse(
  await readFile(new URL("./node_modules/@arsenstorm/olos/package.json", import.meta.url))
);
const exportedSubpaths = Object.keys(packageJson.exports)
  .filter(isPackageModuleExportSubpath)
  .map(packageExportSpecifier);
const expectedSubpaths = Object.keys(expectedRuntimeExports);

assertList("exported subpaths", exportedSubpaths, expectedSubpaths);
`;

const runtimeSmokeModuleExportAssertions = `
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
`;

const runtimeSmokeHelpers = `
function assertList(name, actual, expected) {
  const actualList = [...actual].sort();
  const expectedList = [...expected].sort();

  if (JSON.stringify(actualList) !== JSON.stringify(expectedList)) {
    throw new Error(
      \`\${name} mismatch: expected \${expectedList.join(", ")}, received \${actualList.join(", ")}\`
    );
  }
}

function isPackageModuleExportSubpath(subpath) {
  return subpath !== "./package.json";
}

function packageExportSpecifier(subpath) {
  return subpath === "."
    ? "@arsenstorm/olos"
    : \`@arsenstorm/olos/\${subpath.slice(2)}\`;
}
`;

const runtimeSmokeSourceSections = [
  runtimeSmokeImports,
  runtimeSmokePackageExportAssertions,
  runtimeSmokeModuleExportAssertions,
  runtimeSmokeHelpers,
] as const;

export function packageSmokeSource(): string {
  return `${runtimeSmokeSourceSections.join("\n")}\n`;
}
