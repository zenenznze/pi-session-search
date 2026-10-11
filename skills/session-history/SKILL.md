---
name: session-history
description: Search, browse, and read past pi coding sessions. Use when the user asks about previous work, past decisions, what was done before, or wants to find a specific session. Covers both active and archived sessions.
---

# Session History

Search, browse, and introspect on past pi coding sessions — including archived ones.

## Available Tools

This skill provides three tools:

### session_search
Search topics through the index, or exact names/paths directly through configured session records. Literal mode makes no embedding request and does not depend on index freshness.

```
session_search(query="cover-skill", mode="literal")
session_search(query="/projects/cover-skill/PLAN.md", mode="literal")
session_search(query="refactoring the auth module")
session_search(query="Lambda timeout debugging", limit=5)
session_search(query="setting up CI pipeline for myapp")
```

### session_list
Browse sessions with filters. Good for time-based queries or project-specific browsing.

```
session_list(project="myapp")                    # Sessions in the myapp project
session_list(after="2026-03-01", limit=10)       # Recent sessions
session_list(archived=true, limit=20)            # Archived sessions only
session_list(project="pi-slack-bot", after="2026-03-10")
```

### session_read
Read the full conversation from a specific session. Use the file path or UUID from search/list results.

```
session_read(session="~/.pi/agent/sessions/--home-user-projects-myapp--/2026-03-10T21-36-44.jsonl")
session_read(session="124c2fe2-820c-4d63-8899-eb8d48007d39")
session_read(session="...", offset=50, limit=50)           # Pagination for long sessions
session_read(session="...", include_tools=true)             # Include tool call results
```

## Workflow

1. **Find sessions**: For an artifact name/path or session ID use `session_search(mode="literal")`; for a topic use indexed search, scoped to the known project first. Expand scope only when the artifact may have been developed elsewhere.
2. **Verify provenance**: A mention is only a candidate. Read actual creation/edit events with `session_read(include_tools=true)` and compare repository history when available. After one or two unproductive indexed queries, switch modes instead of repeatedly rephrasing.
3. **Recover identity**: Report session ID and original CWD independently of the artifact repository. Resuming uses the session header CWD; opening in another project can fork the history.
4. **Extract context**: Read only relevant pages; unavailable fields or no matches are coverage limits, not proof of absence.

## Setup

If not yet configured, run `/session-embeddings-setup` to choose an embedding provider (OpenAI, Bedrock, or Ollama).

To force a full re-index, run `/session-reindex`.

## What Gets Indexed

- All active sessions from `~/.pi/agent/sessions/`
- All archived sessions from `~/.pi/agent/sessions-archive/`
- User messages, assistant responses, tool usage patterns
- Compaction summaries (condensed session context)
- Files read/modified, models used, project directories

## Tips

- Session search is best for "when did we...", "how did we handle...", "what approach did we use for..." queries
- Session list is best for "show me recent sessions", "what did we work on in project X" queries
- For very long sessions, use `session_read` with pagination (`offset`/`limit`)
- Set `include_tools=true` on `session_read` when you need to see the actual tool outputs (verbose)
