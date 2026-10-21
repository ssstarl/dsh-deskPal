# dsh-pet-speak

**Let your desktop pet do the talking for the AI.**

Every time a turn ends, `dsh-pet-speak` picks one short line from the reply and hands it to
**your desktop pet** — she shows it in her bubble and says it in her own voice, while you keep
looking at whatever you were doing. Press **ESC** to make her stop.

No compatible pet around? It falls back to the system voice (OneCore), so the feature never
just goes silent.

[中文说明](README.zh.md) · [Bridge protocol](PET-PROTOCOL.md)

## Why this one

There are already TTS plugins that read everything aloud. This one does the opposite:

| | This plugin | Typical announcer |
|---|---|---|
| Where the voice comes from | **your pet's own voice + bubble** | the system voice |
| What is spoken | **one concluding line**, not the whole reply | the whole reply / every sentence |
| Stopping it | **ESC, instantly** | none |
| Adding an engine | **`command` sink**: any TTS CLI | fixed engines |
| Extra model cost | **none** — the line is taken from the reply you already paid for | varies |

## How it works

```
turn ends
  → pick the line:  「播报: …」 if present, else the last sentence
  → hand it to a sink:  pet → onecore → sapi   (first one available wins)
  → ESC stops the player
```

Nothing calls a model again. The text comes from the reply you already have.

## Sinks

| sink | What happens | Needs | ESC |
|---|---|---|---|
| `pet` | The line is appended to the local bridge; **your pet speaks it** | a pet that reads `pet/say` (see [PET-PROTOCOL.md](PET-PROTOCOL.md)) | ❌ (future) |
| `onecore` (default) | Windows WinRT voices (e.g. `Yaoyao`), offline | nothing | ✅ |
| `sapi` | Windows `System.Speech`, offline, robotic | nothing | ✅ |
| `command` | Runs **your own** TTS command with `{text}` | your TTS | up to you |

Fallback chain: `pet` (skipped when `petLockPath` says she is not running) → `onecore` → `sapi`.

## Connect your pet

If your pet speaks the `pet/say` JSON-lines protocol (documented in [PET-PROTOCOL.md](PET-PROTOCOL.md),
~30 lines of code on the pet side), point the plugin at it with a **user-level override file** —
`%USERPROFILE%\.dsh-pet-speak.json` (or the path in `DSH_PET_SPEAK_CONFIG`):

```json
{
  "sink": "pet",
  "petLockPath": "C:/Users/you/AppData/Roaming/<your-pet>/overlay-instance.lock"
}
```

Precedence: built-in defaults < the bundle's `cordis.patch.yml` < this file.
The shipped patch deliberately contains **no personal paths**, so your pet stays yours.

`petLockPath` is optional but recommended: when the lock file is missing (pet not running),
the plugin **skips** the pet and uses the system voice instead of writing into the void.

## Configuration

| key | default | meaning |
|---|---|---|
| `sink` | `onecore` | `pet` / `onecore` / `sapi` / `command` |
| `voice` | `Yaoyao` | OneCore voice, fuzzy-matched against installed `DisplayName`s |
| `command` | `""` | command template, must contain `{text}`; executed **without a shell** |
| `commandTimeoutMs` | `15000` | kill the command after this long |
| `speakMode` | `ending` | `ending` = last sentence / `播报:` line; `full` = whole reply (code blocks stripped) |
| `minReplyChars` | `120` | shorter replies are not spoken |
| `maxSpeakChars` | by mode | `ending` → 60, `full` → 400 |
| `quietHours` | `""` | `23:00-08:00`, empty = off |
| `escCancel` | `true` | allow ESC to stop (`onecore` / `sapi`) |
| `maxTurns` | `0` | stop after N announcements (debugging) |
| `petBridgeDir` | `""` | bridge folder (default `%APPDATA%\dsh-pet-bridge`) |
| `petLockPath` | `""` | pet's `overlay-instance.lock`; missing ⇒ skip the pet sink |

### The `播报:` convention

End a reply with a line like

```
播报：余额还剩十一块二，省着点花。
```

and that is exactly what gets spoken — 20 characters that you wrote anyway. Without the line the
plugin falls back to the last sentence. Either way: no extra tokens.

## Install

```bash
cd %USERPROFILE%\.dsh\profiles\desktop
pnpm add dsh-pet-speak
# append "dsh-pet-speak" to dsh.profile.bundles in package.json
# restart DSH
```

Windows only for now (`WinRT` / `System.Speech` / `GetAsyncKeyState`).
To audition the installed voices, run `demo-voices.cmd`.

## Privacy

- No network requests, no telemetry.
- `onecore` / `sapi` synthesise locally; only the text you already see reaches Windows.
- `pet` appends one JSON line to a **local** folder.
- `command` runs **your** command — including any network use you configure.
- Only an instance/owner log is written, under `%LOCALAPPDATA%\dsh-voice-announcer`.

## Limitations

- The `pet` sink cannot be interrupted by ESC yet (audio plays inside the pet process).
- No settings UI yet — configuration lives in `cordis.patch.yml`.
- `command` sink has no ESC; it stops when your command exits or times out.

## License

MIT
