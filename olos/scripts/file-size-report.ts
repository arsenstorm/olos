import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { listDirectoryEntries } from "./directory-walk";

const DEFAULT_EXCLUDED_PREFIXES = [
  "dist/",
  "node_modules/",
  "out/",
  "coverage/",
] as const;
const DEFAULT_INCLUDED_EXTENSIONS = [
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
] as const;

export interface FileSizeReportOptions {
  excludedPrefixes?: readonly string[];
  includedExtensions?: readonly string[];
  maxLines: number;
  root: string;
}

export interface LargeFileReportEntry {
  lines: number;
  relativePath: string;
}

interface ResolvedFileSizeReportOptions {
  excludedPrefixes: readonly string[];
  includedExtensions: readonly string[];
  maxLines: number;
  root: string;
}

export async function largeFileReport(
  options: FileSizeReportOptions
): Promise<LargeFileReportEntry[]> {
  const resolvedOptions = resolveFileSizeReportOptions(options);
  const report: LargeFileReportEntry[] = [];

  for (const entry of await listDirectoryEntries(resolvedOptions.root)) {
    if (!isReportableFileEntry(entry, resolvedOptions)) {
      continue;
    }

    const lines = countLines(await readFile(entry.absolutePath, "utf8"));

    if (lines > resolvedOptions.maxLines) {
      report.push({
        lines,
        relativePath: relative(resolvedOptions.root, entry.absolutePath),
      });
    }
  }

  return report.sort(compareLargeFileReportEntries);
}

function isReportableFileEntry(
  entry: Awaited<ReturnType<typeof listDirectoryEntries>>[number],
  options: ResolvedFileSizeReportOptions
): boolean {
  return (
    entry.isFile &&
    !shouldSkipFile(
      entry.relativePath,
      options.excludedPrefixes,
      options.includedExtensions
    )
  );
}

function resolveFileSizeReportOptions(
  options: FileSizeReportOptions
): ResolvedFileSizeReportOptions {
  return {
    excludedPrefixes: options.excludedPrefixes ?? DEFAULT_EXCLUDED_PREFIXES,
    includedExtensions:
      options.includedExtensions ?? DEFAULT_INCLUDED_EXTENSIONS,
    maxLines: options.maxLines,
    root: options.root,
  };
}

function compareLargeFileReportEntries(
  left: LargeFileReportEntry,
  right: LargeFileReportEntry
): number {
  if (right.lines !== left.lines) {
    return right.lines - left.lines;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

export function formatLargeFileReport(
  entries: readonly LargeFileReportEntry[],
  maxLines: number
): string {
  if (entries.length === 0) {
    return `No source files exceed ${maxLines} lines.`;
  }

  const lines = [
    `Advisory: ${entries.length} source files exceed ${maxLines} lines.`,
    "Consider splitting these when touching related code:",
  ];

  for (const entry of entries) {
    lines.push(`- ${entry.relativePath}: ${entry.lines} lines`);
  }

  return lines.join("\n");
}

function shouldSkipFile(
  relativePath: string,
  excludedPrefixes: readonly string[],
  includedExtensions: readonly string[]
): boolean {
  return (
    excludedPrefixes.some((prefix) => relativePath.startsWith(prefix)) ||
    !includedExtensions.some((extension) => relativePath.endsWith(extension))
  );
}

function countLines(source: string): number {
  if (source.length === 0) {
    return 0;
  }

  return source.endsWith("\n")
    ? source.slice(0, -1).split("\n").length
    : source.split("\n").length;
}
