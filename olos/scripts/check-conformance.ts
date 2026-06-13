import { summarizeConformance } from "./write-conformance-report";

const summary = summarizeConformance();

if (summary.unmapped > 0) {
  throw new Error(
    `conformance coverage has ${summary.unmapped} unmapped assertion(s)`
  );
}

console.log(
  `Conformance coverage: ${summary.covered}/${summary.known} covered, ${summary.unmapped} unmapped`
);
