import packageJson from "../package.json" with { type: "json" };

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expected = `olos-v${packageJson.version}`;

if (tag !== expected) {
  throw new Error(`release tag must be ${expected}`);
}
