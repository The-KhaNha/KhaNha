#!/usr/bin/env bash
# .claude/scripts/agent-progress-monitor.sh
#
# Live-progress tailer for sub-agent JSONL transcripts. Designed to be the
# command of a `Monitor` tool invocation so each tool-call event becomes one
# user-visible notification — without ever dumping raw transcript content.
#
# Usage:
#   bash .claude/scripts/agent-progress-monitor.sh <transcript-path>
#
# The transcript path is the `output-file` from the Agent tool result (it
# symlinks to `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`).
# Lines emitted on stdout:
#   🔧 <tool_name>: <short summary>
#   💬 <short text excerpt>
#   ✅ DONE (subtype=...)
# Each line is ≤ 140 chars. Exits cleanly when the agent emits its `result`
# event.

set -u
TRANSCRIPT="${1:?usage: $0 <transcript-path>}"
# Bounds for the two failure paths: the agent never creates the transcript (crashes before spawn), or it creates
# the transcript but stalls and never emits a `result` event (hangs after spawn).
STARTUP_TIMEOUT="${AGENT_MONITOR_STARTUP_TIMEOUT:-120}"   # seconds to wait for the transcript file to appear
IDLE_TIMEOUT="${AGENT_MONITOR_IDLE_TIMEOUT:-600}"          # seconds of no new transcript line before giving up

# Wait for the file to exist (the agent process creates it after spawn), bounded so a crash before spawn exits.
waited=0
while [ ! -e "$TRANSCRIPT" ]; do
  if [ "$waited" -ge "$STARTUP_TIMEOUT" ]; then
    echo "⏱️ timeout: transcript never appeared after ${STARTUP_TIMEOUT}s ($TRANSCRIPT)"
    exit 1
  fi
  sleep 0.5
  waited=$((waited + 1))
done

# Follow the file, parse each new JSON line, emit a short one-liner.
python3 -u - "$TRANSCRIPT" "$IDLE_TIMEOUT" <<'PYEOF'
import json, sys
import selectors
import subprocess

path, idle_timeout = sys.argv[1], float(sys.argv[2])

tail = subprocess.Popen(
    ["tail", "-F", "-n", "+1", path],
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
    bufsize=1,
)

sel = selectors.DefaultSelector()
sel.register(tail.stdout, selectors.EVENT_READ)

def readline_with_timeout(timeout):
    events = sel.select(timeout=timeout)
    if not events:
        return None
    return tail.stdout.readline()

while True:
    raw = readline_with_timeout(idle_timeout)
    if raw is None:
        print(f"⏱️ timeout: no activity for {int(idle_timeout)}s, agent may be stalled", flush=True)
        break
    if raw == "":
        break  # tail's stdout closed
    raw = raw.strip()
    if not raw:
        continue
    try:
        ev = json.loads(raw)
    except Exception:
        continue
    t = ev.get("type")
    if t == "assistant":
        msg = ev.get("message", {})
        for block in msg.get("content", []):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                name = block.get("name", "?")
                inp = block.get("input", {}) or {}
                # Pick the most-informative single field per tool.
                summary = (
                    inp.get("command")
                    or inp.get("description")
                    or inp.get("prompt")
                    or inp.get("script")
                    or inp.get("url")
                    or inp.get("file_path")
                    or json.dumps(inp)[:200]
                )
                summary = str(summary).replace("\n", " ").strip()[:120]
                print(f"\U0001f527 {name}: {summary}", flush=True)
            elif block.get("type") == "text":
                text = (block.get("text") or "").strip().replace("\n", " ")
                if text:
                    print(f"\U0001f4ac {text[:140]}", flush=True)
    elif t == "result":
        sub = ev.get("subtype", "?")
        print(f"✅ DONE (subtype={sub})", flush=True)
        break
tail.terminate()
PYEOF
