# Changelog

## 0.2.0 — 2026-10-21

- Add `onecore` sink (WinRT OneCore voices, offline, better than SAPI5).
- Add `command` sink: plug in any TTS by command template (`{text}`), no shell involved.
- Add `speakMode`: `ending` (last sentence / `播报:` line) or `full` (whole reply).
- Add `petLockPath`: skip the `pet` sink when the pet is not running, then fall back.
- Add instance/owner locks so the plugin cannot speak in two voices at once.
- Fix ESC polling reliability (poll `GetAsyncKeyState` instead of `RegisterHotKey`).

## 0.1.0 — 2026-10-20

- First working version: `sapi` sink, ending-mode extraction, ESC to stop, quiet hours.
