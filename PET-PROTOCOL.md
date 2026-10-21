# pet/say — the bridge protocol

`dsh-pet-speak` hands a line of text to a desktop pet through a **local file bridge**.
Any pet that can tail that folder and speak the line is compatible. No sockets, no HTTP, no auth.

## Where

```
%APPDATA%\dsh-pet-bridge\            (Windows)
~/Library/Application Support/dsh-pet-bridge/   (macOS)
~/.config/dsh-pet-bridge/            (Linux)
```

The plugin writes one file: `dsh-voice-<pid>.jsonl` (append-only). Pets should **glob the folder**
for `dsh*.jsonl`, because other writers (the DSH status bridge, other plugin instances) live there too.

## What

One JSON object per line, UTF-8, appended:

```json
{"ts":1792540944.653,"agent":"dsh","event":"pet/say","text":"余额还剩十一块二，省着点花。","inst":"aa3fbb3e-…"}
```

| field | meaning |
|---|---|
| `ts` | Unix time in seconds (float) |
| `agent` | always `dsh` |
| `event` | always `pet/say` — **this is the only event that carries text** |
| `text` | the line to speak, already trimmed to ≤ `maxSpeakChars` |
| `inst` | per-process UUID; use it to tell writers apart |

## How a pet should consume it

1. **Tail by byte offset**, do not re-read the file from the start: on first sight of a file, seek to
   its current size; then poll every ~1–2 s and read only the new bytes. A half-written last line
   must be kept and completed on the next poll.
2. Skip **unknown events** (the folder also carries status records such as `AgentStatus`,
   `tool/call`, `turn/end` — those are metadata only, no text).
3. On `pet/say`: show the bubble and speak `text`. Rendering is up to the pet — a desktop pet
   usually shows a speech bubble and uses its own TTS voice.
4. **Never write back** to the folder. The bridge is one-way by design.

## Reference implementation (pseudo-code)

```python
seen = {}  # path -> offset
for path in glob(events_dir / "dsh*.jsonl"):
    offset = seen.setdefault(path, path.stat().st_size)
    with path.open("rb") as fh:
        fh.seek(offset)
        chunk = fh.read()
        seen[path] = fh.tell()
    text = (carry[path] + chunk.decode("utf-8", "replace")).split("\n")
    carry[path] = text.pop()            # keep the incomplete tail
    for line in text:
        rec = json.loads(line)
        if rec.get("event") == "pet/say" and rec.get("text"):
            pet.say(rec["text"])
```

## Why a file, not a socket

- Works across users/processes/permissions with zero setup;
- The pet can be restarted, or not installed at all — writers never block or fail;
- It is trivially inspectable (plain text), which matters when the payload is what a robot says to you.
