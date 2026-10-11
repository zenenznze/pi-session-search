import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSession } from "../parser";
import { buildContent, FtsSessionIndex } from "../fts-index";
import { spawnIndexWorker } from "../index-service";

it("finds an artifact created only inside codemode, through a real worker and FTS", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-artifact-search-"));
  const sessions = join(root, "sessions", "--original-project--");
  mkdirSync(sessions, { recursive: true });
  const file = join(sessions, "session.jsonl");
  const path = "/projects/封面 skill/PLAN.md";
  const header = { type: "session", version: 3, id: "artifact-origin", timestamp: "2026-01-01T00:00:00Z", cwd: "/projects/original" };
  const entry = (message: any) => ({ type: "message", timestamp: header.timestamp, message });
  writeFileSync(file, [header,
    entry({ role: "user", content: [{ type: "text", text: "make a cover tool" }] }),
    entry({ role: "assistant", content: [{ type: "toolCall", id: "r1", name: "read", arguments: { path: "/projects/input.md" } }] }),
    entry({ role: "toolResult", toolName: "read", toolCallId: "r1", content: [] }),
    entry({ role: "toolResult", toolName: "codemode", nestedCalls: { calls: [
      { name: "write", status: "ok", arguments: { path, content: "PRIVATE_CONTENT_NOT_SEARCHABLE" } },
      { name: "edit", status: "error", arguments: { path: "/failed.md" } },
    ] }, content: [] }),
  ].map(JSON.stringify).join("\n"));
  const index = new FtsSessionIndex(join(root, "index"), [], [], join(root, "sessions"), join(root, "archive"));
  let worker: ReturnType<typeof spawnIndexWorker> | undefined;
  try {
    const parsed = parseSession(file, false)!;
    assert.deepEqual(parsed.filesModified, [path]);
    assert.deepEqual(parsed.filesRead, ["/projects/input.md"]);
    assert.ok(buildContent(parsed).includes(path));
    await index.load();
    await index.sync();
    assert.equal((await index.search("封面"))[0].session.id, header.id);
    worker = spawnIndexWorker(join(import.meta.dirname, "../../dist/index-worker.js"), {
      indexDir: join(root, "worker-index"), extraSessionDirs: [], extraArchiveDirs: [],
      sessionDir: join(root, "sessions"), archiveDir: join(root, "archive"),
    }, err => { throw err; });
    await worker.load(); // Intentionally empty/stale index: literal mode must still work.
    assert.equal(await worker.size(), 0);
    const results = await worker.search(path, 10, "original", "literal");
    assert.equal(results[0].session.cwd, header.cwd);
    assert.equal(results[0].session.id, header.id);
    assert.deepEqual(await worker.search(path, 10, "unrelated", "literal"), []);
    assert.deepEqual(await worker.search("PRIVATE_CONTENT_NOT_SEARCHABLE", 10, undefined, "literal"), []);
  } finally {
    if (worker) await worker.close();
    try { index.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
