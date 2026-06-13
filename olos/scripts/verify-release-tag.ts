import packageJson from "../package.json" with { type: "json" };
import { assertReleaseTag } from "./release-tag";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expected = `olos-v${packageJson.version}`;

assertReleaseTag(tag, expected);
