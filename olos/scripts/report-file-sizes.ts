import { formatLargeFileReport, largeFileReport } from "./file-size-report";
import { packageRoot } from "./script-paths";

const DEFAULT_MAX_LINES = 1000;

const report = await largeFileReport({
  maxLines: DEFAULT_MAX_LINES,
  root: packageRoot,
});

console.log(formatLargeFileReport(report, DEFAULT_MAX_LINES));
