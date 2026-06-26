import { packageReleaseTag } from "./release-metadata";
import { assertReleaseTag } from "./release-tag";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expected = packageReleaseTag();

assertReleaseTag(tag, expected);
