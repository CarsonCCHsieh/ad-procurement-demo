import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function formEncode(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.append(k, String(v));
  return usp.toString();
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json, text/plain, */*" },
    body: formEncode(params),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Non-JSON response", httpStatus: res.status, raw: text.slice(0, 800) };
  }
}

const VENDORS = [
  { key: "smmraja", baseUrl: "https://www.smmraja.com/api/v3", envKey: "SMMRAJA_KEY" },
  { key: "urpanel", baseUrl: "https://urpanel.com/api/v2", envKey: "URPANEL_KEY" },
  { key: "justanotherpanel", baseUrl: "https://justanotherpanel.com/api/v2", envKey: "JAP_KEY" },
];

const outDir = path.resolve(process.cwd(), "public", "services");

await fs.mkdir(outDir, { recursive: true });

let wrote = 0;

for (const v of VENDORS) {
  const key = (process.env[v.envKey] ?? "").trim();
  if (!key) {
    // Skip if secret is not configured; keep CI green.
    console.log(`[skip] ${v.key}: missing env ${v.envKey}`);
    continue;
  }

  console.log(`[fetch] ${v.key} services...`);
  const payload = await postForm(v.baseUrl, { key, action: "services" });

  const outPath = path.join(outDir, `${v.key}.json`);
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  wrote += 1;
  console.log(`[ok] wrote ${outPath}`);
}

console.log(`[done] wrote files: ${wrote}`);

