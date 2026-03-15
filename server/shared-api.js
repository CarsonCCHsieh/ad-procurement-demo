import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = Number(process.env.SHARED_API_PORT || 8787);
const DB_PATH = resolve(process.cwd(), process.env.SHARED_API_DB || "./data/shared-demo.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS state_entries (
    storage_key TEXT PRIMARY KEY,
    storage_value TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS state_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO state_meta (id, revision, updated_at)
  VALUES (1, 0, CURRENT_TIMESTAMP)
  ON CONFLICT(id) DO NOTHING;
`);

const selectAllStmt = db.prepare("SELECT storage_key, storage_value FROM state_entries");
const selectMetaStmt = db.prepare("SELECT revision, updated_at FROM state_meta WHERE id = 1");
const upsertEntryStmt = db.prepare(`
  INSERT INTO state_entries (storage_key, storage_value, updated_at, updated_by)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(storage_key) DO UPDATE SET
    storage_value = excluded.storage_value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
`);
const deleteEntryStmt = db.prepare("DELETE FROM state_entries WHERE storage_key = ?");
const bumpRevisionStmt = db.prepare(`
  UPDATE state_meta
  SET revision = revision + 1,
      updated_at = ?
  WHERE id = 1
`);

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        rejectBody(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(raw));
    req.on("error", rejectBody);
  });
}

function currentState() {
  const values = {};
  for (const row of selectAllStmt.all()) {
    values[row.storage_key] = row.storage_value;
  }
  const meta = selectMetaStmt.get();
  return {
    revision: Number(meta?.revision ?? 0),
    updatedAt: String(meta?.updated_at ?? new Date().toISOString()),
    values,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 404, { ok: false, error: "Not found" });
      return;
    }

    if (req.method === "OPTIONS") {
      json(res, 204, {});
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      json(res, 200, { ok: true, dbPath: DB_PATH, ...currentState() });
      return;
    }

    if (req.method === "GET" && req.url === "/api/state") {
      json(res, 200, { ok: true, ...currentState() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/state/batch") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const values = payload?.values;
      const clientId = typeof payload?.clientId === "string" ? payload.clientId : "unknown";
      if (!values || typeof values !== "object") {
        json(res, 400, { ok: false, error: "values is required" });
        return;
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        for (const [key, value] of Object.entries(values)) {
          if (typeof key !== "string" || !key.trim()) continue;
          if (value == null) {
            deleteEntryStmt.run(key);
          } else {
            upsertEntryStmt.run(key, String(value), now, clientId);
          }
        }
        bumpRevisionStmt.run(now);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      json(res, 200, { ok: true, ...currentState() });
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Shared demo API listening on http://127.0.0.1:${PORT}`);
  console.log(`SQLite file: ${DB_PATH}`);
});
