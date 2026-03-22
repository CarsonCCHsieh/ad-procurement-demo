import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
]);

const SCAN_PATHS = [
  "src",
  "server",
  "scripts",
  "docs",
  ".github/workflows",
  "README.md",
  "index.html",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
];

const MOJIBAKE_MARKERS = ["鍝", "瑷", "鏁", "鎶", "璜", "鐩", "閫", "寤"];
const QUESTION_LITERAL_RE = /["'`][^"'`\n]*\?{3,}[^"'`\n]*["'`]/;

function shouldSkip(pathname) {
  return pathname.includes("node_modules") || pathname.includes(".git") || pathname.startsWith("dist/");
}

function isAllowedMojibakeLine(pathname, line) {
  if (pathname === "src/config/appConfig.ts" && line.includes("value.includes(")) return true;
  if (pathname === "scripts/check_encoding.mjs" && line.includes("MOJIBAKE_MARKERS")) return true;
  return false;
}

async function walk(entryPath, files) {
  const abs = join(ROOT, entryPath);
  const info = await stat(abs);
  if (info.isDirectory()) {
    const items = await readdir(abs, { withFileTypes: true });
    for (const item of items) {
      await walk(join(entryPath, item.name), files);
    }
    return;
  }
  files.push(entryPath.replaceAll("\\", "/"));
}

function collectLineIssues(pathname, text) {
  const issues = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes("\uFFFD")) {
      issues.push(`${pathname}:${i + 1} contains U+FFFD replacement character`);
    }
    if (QUESTION_LITERAL_RE.test(line)) {
      issues.push(`${pathname}:${i + 1} contains suspicious placeholder question marks`);
    }
    if (MOJIBAKE_MARKERS.some((marker) => line.includes(marker)) && !isAllowedMojibakeLine(pathname, line)) {
      issues.push(`${pathname}:${i + 1} contains suspicious mojibake marker`);
    }
  }
  return issues;
}

async function main() {
  const files = [];
  for (const scanPath of SCAN_PATHS) {
    try {
      await walk(scanPath, files);
    } catch {
      // ignore missing path
    }
  }

  const issues = [];
  for (const filePath of files) {
    if (shouldSkip(filePath)) continue;
    const ext = extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && !["README.md", "index.html", "package.json"].includes(filePath)) continue;

    const abs = join(ROOT, filePath);
    const raw = await readFile(abs);
    if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
      issues.push(`${relative(ROOT, abs).replaceAll("\\", "/")}:1 has UTF-8 BOM (must be UTF-8 without BOM)`);
    }

    const text = raw.toString("utf8");
    issues.push(...collectLineIssues(filePath, text));
  }

  if (issues.length > 0) {
    console.error("[encoding-check] failed:");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log("[encoding-check] ok");
}

void main();
