import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename, dirname } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────

export interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: any;
}

export interface ParsedSession {
  /** Absolute path to the .jsonl file */
  file: string;
  /** Session UUID */
  id: string;
  /** ISO timestamp of session start */
  startedAt: string;
  /** ISO timestamp of last entry */
  endedAt: string;
  /** Working directory */
  cwd: string;
  /** Display name (from session_info entry) */
  name?: string;
  /** Whether this is from the archive */
  archived: boolean;
  /** Project directory slug (the session folder name) */
  projectSlug: string;
  /** Models used */
  models: string[];
  /** User message count */
  userMessageCount: number;
  /** Assistant message count */
  assistantMessageCount: number;
  /** Tool calls made */
  toolCalls: ToolCallSummary[];
  /** Files read */
  filesRead: string[];
  /** Files written/edited */
  filesModified: string[];
  /** First user message (for display) */
  firstUserMessage: string;
  /** All user messages (for indexing) */
  userMessages: string[];
  /** All assistant text (for indexing, truncated) */
  assistantText: string;
  /** Compaction summaries */
  compactionSummaries: string[];
  /** Branch summaries */
  branchSummaries: string[];
  /** Total token cost */
  totalCost: number;
  /** Total tokens used */
  totalTokens: number;
}

export interface ToolCallSummary {
  name: string;
  count: number;
}

// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Return the default session directory.
 * Honours `PI_SESSION_DIR` env var (set by Pi when `settings.json` specifies
 * a custom `sessionDir`), falling back to the standard global location.
 */
function getDefaultSessionDir(): string {
  return (
    process.env.PI_SESSION_DIR ||
    join(process.env.HOME || "~", ".pi", "agent", "sessions")
  );
}

/**
 * Return the default session archive directory.
 * Honours `PI_SESSION_ARCHIVE_DIR` env var, falling back to the standard
 * global location.
 */
function getDefaultArchiveDir(): string {
  return (
    process.env.PI_SESSION_ARCHIVE_DIR ||
    join(process.env.HOME || "~", ".pi", "agent", "sessions-archive")
  );
}

/**
 * Find all .jsonl session files in the default + extra directories.
 *
 * @param extraSessionDirs  Additional session dirs to scan (appended to default).
 * @param extraArchiveDirs  Additional archive dirs to scan (appended to default).
 * @param sessionDir        Override the default session directory entirely.
 * @param archiveDir        Override the default archive directory entirely.
 */
export function discoverSessionFiles(
  extraSessionDirs: string[] = [],
  extraArchiveDirs: string[] = [],
  sessionDir?: string,
  archiveDir?: string,
): { file: string; archived: boolean }[] {
  const sDirs = [sessionDir ?? getDefaultSessionDir(), ...extraSessionDirs];
  const aDirs = [archiveDir ?? getDefaultArchiveDir(), ...extraArchiveDirs];

  const results: { file: string; archived: boolean }[] = [];

  for (const dir of sDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of walkJsonl(dir)) {
      results.push({ file: entry, archived: false });
    }
  }

  for (const dir of aDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of walkJsonl(dir)) {
      results.push({ file: entry, archived: true });
    }
  }

  return results;
}

function walkJsonl(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkJsonl(full));
      } else if (entry.name.endsWith(".jsonl") && entry.name !== "pins.json" && entry.name !== "active-sessions.json") {
        files.push(full);
      }
    }
  } catch {
    // permission error or similar — skip
  }
  return files;
}

// ─── Header-only read ────────────────────────────────────────────────

/**
 * Read just the session UUID from the JSONL header line.
 * Much cheaper than a full parse — used to correlate files with index entries
 * when a session has been moved (e.g. active → archive).
 */
export function readSessionId(file: string): string | null {
  try {
    const fd = openSync(file, "r");
    try {
      // Read just enough for the first line (headers are ~200 bytes)
      const buf = Buffer.alloc(1024);
      const bytesRead = readSync(fd, buf, 0, 1024, 0);
      const firstLine = buf.toString("utf8", 0, bytesRead).split("\n")[0];
      if (!firstLine) return null;
      const obj = JSON.parse(firstLine.replace(/^\uFEFF/, "").trim());
      return obj.type === "session" ? obj.id : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

// ─── Parsing ─────────────────────────────────────────────────────────

const MAX_ASSISTANT_TEXT = 50_000; // cap assistant text for indexing

/** Strip BOM (U+FEFF) and whitespace from a JSONL line before parsing. */
function cleanLine(line: string): string {
  return line.replace(/^\uFEFF/, "").trim();
}

export function parseSession(
  file: string,
  archived: boolean
): ParsedSession | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  const lines = raw.trim().split("\n");
  if (lines.length === 0) return null;

  let header: SessionHeader | null = null;
  const entries: SessionEntry[] = [];

  for (const line of lines) {
    const cleaned = cleanLine(line);
    if (!cleaned) continue;
    try {
      const obj = JSON.parse(cleaned);
      if (obj.type === "session") {
        header = obj as SessionHeader;
      } else {
        entries.push(obj as SessionEntry);
      }
    } catch {
      // skip malformed lines
    }
  }

  if (!header) return null;

  // Determine project slug from the directory name
  const parentDir = basename(dirname(file));
  const projectSlug = parentDir.startsWith("--") ? parentDir : "unknown";

  // Extract data
  const models = new Set<string>();
  const toolCallMap = new Map<string, number>();
  const filesRead = new Set<string>();
  const filesModified = new Set<string>();
  const callArguments = new Map<string, { name: string; arguments: any }>();
  const trackFile = (toolName: string, args: any) => {
    const path = args?.path;
    if (typeof path !== "string" || !path) return;
    if (["read", "lsp_hover", "lsp_definition"].includes(toolName)) filesRead.add(path);
    if (["write", "edit"].includes(toolName)) filesModified.add(path);
  };
  const userMessages: string[] = [];
  const compactionSummaries: string[] = [];
  const branchSummaries: string[] = [];
  let assistantText = "";
  let name: string | undefined;
  let lastTimestamp = header.timestamp;
  let totalCost = 0;
  let totalTokens = 0;
  let userMsgCount = 0;
  let assistantMsgCount = 0;

  for (const entry of entries) {
    if (entry.timestamp) lastTimestamp = entry.timestamp;

    switch (entry.type) {
      case "message": {
        const msg = entry.message;
        if (!msg) break;

        if (msg.role === "user") {
          userMsgCount++;
          const text = extractTextContent(msg.content);
          if (text) userMessages.push(text);
        }

        if (msg.role === "assistant") {
          assistantMsgCount++;
          if (msg.provider && msg.model) {
            models.add(`${msg.provider}/${msg.model}`);
          }
          if (msg.usage) {
            totalCost += msg.usage.cost?.total ?? 0;
            totalTokens += msg.usage.totalTokens ?? 0;
          }
          // Extract text + tool calls
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === "text" && assistantText.length < MAX_ASSISTANT_TEXT) {
                assistantText += block.text + "\n";
              }
              if (block.type === "toolCall") {
                const name = block.name;
                toolCallMap.set(name, (toolCallMap.get(name) ?? 0) + 1);
                if (typeof block.id === "string") callArguments.set(block.id, block);
              }
            }
          }
        }

        if (msg.role === "toolResult") {
          // A request is not evidence of a completed file operation. Correlate
          // successful results with arguments, including codemode nested calls.
          if (!msg.isError) {
            const call = callArguments.get(msg.toolCallId);
            const tn = call?.name ?? msg.toolName;
            const path = call?.arguments?.path ?? msg.details?.path;
            trackFile(tn, { path });
          }
          if (Array.isArray(msg.nestedCalls?.calls)) {
            for (const call of msg.nestedCalls.calls) {
              if (call.status !== "ok") continue;
              toolCallMap.set(call.name, (toolCallMap.get(call.name) ?? 0) + 1);
              trackFile(call.name, call.arguments);
            }
          }
        }
        break;
      }

      case "model_change":
        if (entry.provider && entry.modelId) {
          models.add(`${entry.provider}/${entry.modelId}`);
        }
        break;

      case "compaction":
        if (entry.summary) compactionSummaries.push(entry.summary);
        break;

      case "branch_summary":
        if (entry.summary) branchSummaries.push(entry.summary);
        break;

      case "session_info":
        if (entry.name) name = entry.name;
        break;
    }
  }

  const toolCalls = Array.from(toolCallMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    file,
    id: header.id,
    startedAt: header.timestamp,
    endedAt: lastTimestamp,
    cwd: header.cwd,
    name,
    archived,
    projectSlug,
    models: Array.from(models),
    userMessageCount: userMsgCount,
    assistantMessageCount: assistantMsgCount,
    toolCalls,
    filesRead: Array.from(filesRead).slice(0, 100),
    filesModified: Array.from(filesModified).slice(0, 100),
    firstUserMessage: userMessages[0] ?? "",
    userMessages,
    assistantText: assistantText.slice(0, MAX_ASSISTANT_TEXT),
    compactionSummaries,
    branchSummaries,
    totalCost,
    totalTokens,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}
