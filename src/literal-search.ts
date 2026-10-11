import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { discoverSessionFiles, parseSession } from "./parser";
import type { SearchResult } from "./session-index";
import { buildSummary, createYielder } from "./utils";

export interface LiteralSearchScope {
  extraSessionDirs: string[];
  extraArchiveDirs: string[];
  sessionDir?: string;
  archiveDir?: string;
}

/** Exact identifiers bypass stale/partial indexes and need no embedding request.
 * Read only configured session roots. Return metadata, never matching raw logs.
 */
export async function searchLiteral(
  scope: LiteralSearchScope, query: string, limit = 10, project?: string,
): Promise<SearchResult[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results = new Map<string, SearchResult>();
  const pause = createYielder();
  for (const { file, archived } of discoverSessionFiles(
    scope.extraSessionDirs, scope.extraArchiveDirs, scope.sessionDir, scope.archiveDir,
  )) {
    if (pause.due()) await pause.yield();
    let raw: string;
    try { raw = readFileSync(file, "utf8"); } catch { continue; }
    // Decode selected searchable fields; raw JSON escaping is not path matching.
    let matches = false;
    let header: any;
    for (const line of raw.split("\n")) {
      let entry: any;
      try { entry = JSON.parse(line.replace(/^\uFEFF/, "")); } catch { continue; }
      const fields: unknown[] = [];
      if (entry.type === "session") {
        header = entry;
        fields.push(entry.id, entry.cwd);
      }
      if (["session_info", "compaction", "branch_summary"].includes(entry.type)) {
        fields.push(entry.name, entry.summary);
      }
      const msg = entry.type === "message" ? entry.message : undefined;
      if (msg && ["user", "assistant"].includes(msg.role)) {
        if (typeof msg.content === "string") fields.push(msg.content);
        if (Array.isArray(msg.content)) for (const block of msg.content) {
          if (block.type === "text") fields.push(block.text);
          if (block.type === "toolCall") fields.push(block.arguments?.path);
        }
      }
      if (msg?.role === "toolResult") {
        fields.push(msg.details?.path);
        if (Array.isArray(msg.nestedCalls?.calls)) {
          for (const call of msg.nestedCalls.calls) fields.push(call.arguments?.path);
        }
      }
      if (fields.some(value => typeof value === "string" && value.toLowerCase().includes(needle))) matches = true;
    }
    if (!header || !matches) continue;
    if (project && ![header.cwd, basename(dirname(file))].some(value => typeof value === "string" && value.toLowerCase().includes(project.toLowerCase()))) continue;
    const session = parseSession(file, archived);
    if (!session) continue;
    const prior = results.get(session.id);
    if (!prior || prior.session.endedAt < session.endedAt) {
      results.set(session.id, { session, summary: buildSummary(session), score: 1 });
    }
  }
  return [...results.values()].sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt)).slice(0, limit);
}
