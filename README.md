# dsh-deskPal

**Let your desktop pal do the talking for the AI.**

Every time a turn ends, `dsh-deskPal` takes one short line from the reply and hands it to your
desktop companion — she shows it in her bubble and says it in her own voice while you keep
looking at whatever you were doing. Press **ESC** and she stops.

No compatible companion running? It falls back to the system voice, so it never just goes silent.

[中文说明](README.zh.md) · [Bridge protocol](PET-PROTOCOL.md)

---

## What it does today

Everything below is implemented and verified on a real machine.

### Spoken brief

- One line per turn: the `播报:` line if the reply has one, otherwise the **last sentence**.
- **ESC stops playback instantly.**
- Four sinks, picked in order until one works: desktop companion → OneCore → SAPI → (`command` never falls back).
- **Zero extra model calls** — the text comes from the reply you already paid for.
- Two modes: `ending` (conclusion only) or `full` (whole reply, code blocks stripped).
- Quiet hours, short-reply skip (< 120 chars), same-line de-duplication within 5 s.

### Desktop companion bridge

- Writes one `pet/say` JSON line into a local folder; a companion that tails that folder speaks it.
- The protocol is public and small: [PET-PROTOCOL.md](PET-PROTOCOL.md) (~30 lines on the pet side).
- `petLockPath` makes it skip the companion when she is not running, instead of writing into the void.

### Voice engines

| sink | What happens | Needs | ESC |
|---|---|---|---|
| `pet` | Your companion speaks the line in her own voice | a pet that reads `pet/say` | ❌ (later) |
| `onecore` (default) | Windows WinRT voices (`Yaoyao` / `Huihui` / `Kangkang`), offline | nothing | ✅ |
| `sapi` | Windows `System.Speech`, offline, robotic | nothing | ✅ |
| `command` | Runs **your** TTS command with `{text}` | your TTS | depends |

`command` is executed **without a shell**, so quotes, `;` and `&` in the text are passed through
verbatim. That makes it a drop-in slot for edge-tts, a local GPT-SoVITS, or a curl call to your
own TTS server.

### Configuration

User-level override file — `%USERPROFILE%\.dsh-pet-speak.json` (or `DSH_PET_SPEAK_CONFIG`):

```json
{
  "sink": "pet",
  "petLockPath": "C:/Users/you/AppData/Roaming/<your-pet>/overlay-instance.lock"
}
```

Precedence: built-in defaults < the bundle's `cordis.patch.yml` < this file.
The shipped patch contains **no personal paths**.

| key | default | meaning |
|---|---|---|
| `sink` | `onecore` | `pet` / `onecore` / `sapi` / `command` |
| `voice` | `Yaoyao` | OneCore voice, fuzzy-matched against installed `DisplayName`s |
| `command` | `""` | command template, must contain `{text}` |
| `commandTimeoutMs` | `15000` | kill the command after this long |
| `speakMode` | `ending` | `ending` = conclusion, `full` = whole reply |
| `minReplyChars` | `120` | shorter replies are not spoken |
| `maxSpeakChars` | by mode | `ending` → 60, `full` → 400 |
| `quietHours` | `""` | `23:00-08:00`, empty = off |
| `escCancel` | `true` | allow ESC to stop (`onecore` / `sapi`) |
| `petBridgeDir` | `""` | bridge folder, default `%APPDATA%\dsh-pet-bridge` |
| `petLockPath` | `""` | companion's `overlay-instance.lock`; missing ⇒ skip `pet` |

### The `播报:` convention

End a reply with a line like

```
播报：余额还剩十一块二，省着点花。
```

and exactly that gets spoken — twenty characters you were writing anyway. Without such a line the
last sentence is used. Either way: no extra tokens.

## Install

```bash
cd %USERPROFILE%\.dsh\profiles\desktop
pnpm add dsh-deskPal
# append "dsh-deskPal" to dsh.profile.bundles in package.json
# restart DSH
```

Windows only for now (WinRT / System.Speech / `GetAsyncKeyState`).
To audition the installed system voices, run `demo-voices.cmd`.

## Privacy

- No network requests of its own, no telemetry.
- `onecore` / `sapi` synthesise locally; only the text you already see reaches Windows.
- `pet` appends one JSON line to a **local** folder.
- `command` runs **your** command, including any network use you configure.
- The only file written is an instance/owner log under `%LOCALAPPDATA%\dsh-voice-announcer`.

## Current limits

- Windows only.
- The `pet` sink cannot be interrupted by ESC yet (audio plays inside the companion process).
- No settings UI — configuration is the JSON file above.
- `command` has no ESC; it stops when your command exits or times out.

## License

MIT
