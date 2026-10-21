# dsh-pet-speak

**让桌宠替 AI 说话。**

每轮对话结束，插件从回复里挑**一句结论**，交给你的桌面宠物——她冒气泡、用她自己的声音念出来，
你继续干自己的事。按 **ESC** 随时让她闭嘴。

没有兼容的桌宠？自动退回系统语音（OneCore），不会静默。

[English](README.md) · [桥协议](PET-PROTOCOL.md)

## 为什么用它

市面上已有"把回复全文念出来"的插件，这个反着来：

| | 本插件 | 常见播报插件 |
|---|---|---|
| 声音来自 | **你的桌宠本体**（气泡 + 她的音色） | 系统语音 |
| 念什么 | **一句结论**，不是全文 | 全文 / 逐句 |
| 打断 | **ESC 立刻停** | 无 |
| 加引擎 | `command` 出口，任何 TTS CLI | 固定引擎 |
| 额外 token | **零**（用你已买到的回复文本） | 视实现 |

## 工作方式

```
turn 结束
  → 取播报文本：「播报: …」有就用，没有取最后一句
  → 交给出口：pet → onecore → sapi（谁可用用谁）
  → ESC 打断
```

不再次调用模型，文本来自你已有的回复。

## 四种出口

| sink | 行为 | 依赖 | ESC |
|---|---|---|---|
| `pet` | 写进本地桥，**你的桌宠来念** | 支持 `pet/say` 的桌宠（见 [PET-PROTOCOL.md](PET-PROTOCOL.md)） | ❌（后续） |
| `onecore`（默认） | Windows WinRT 语音（如 `Yaoyao`），离线 | 无 | ✅ |
| `sapi` | Windows `System.Speech`，离线、机械 | 无 | ✅ |
| `command` | 执行**你自己的** TTS 命令，`{text}` 替换 | 你的 TTS | 看你的后端 |

降级链：`pet`（锁文件不在就跳过）→ `onecore` → `sapi`。

## 接入你的桌宠

```json
// %USERPROFILE%\.dsh-pet-speak.json
{
  "sink": "pet",
  "petLockPath": "C:/Users/you/AppData/Roaming/<你的桌宠>/overlay-instance.lock"
}
```

`petLockPath` 可省略，但建议填：锁文件不在（桌宠没开）时插件会**跳过 pet 出口**，
改用系统语音，而不是写进空气里。

## 配置（优先级：内置默认 < 包内 patch < 用户覆盖文件）

| 键 | 默认 | 说明 |
|---|---|---|
| `sink` | `onecore` | `pet` / `onecore` / `sapi` / `command` |
| `voice` | `Yaoyao` | OneCore 音色（模糊匹配 `DisplayName`） |
| `command` | `""` | command 模板，必须含 `{text}`，**不经过 shell** |
| `commandTimeoutMs` | `15000` | 超时杀掉 |
| `speakMode` | `ending` | `ending` = 最后一句 / 播报行；`full` = 全文（去代码块） |
| `minReplyChars` | `120` | 短于此不播 |
| `maxSpeakChars` | 按模式 | `ending` 60 / `full` 400 |
| `quietHours` | `""` | `23:00-08:00`，空 = 关 |
| `escCancel` | `true` | 允许 ESC 打断 |
| `petBridgeDir` | `""` | 桥目录，默认 `%APPDATA%\dsh-pet-bridge` |
| `petLockPath` | `""` | 桌宠实例锁；不在就跳过 pet 出口 |

### 「播报：」约定

回复末尾写一行：

```
播报：余额还剩十一块二，省着点花。
```

念的就是这一行——本来就是你要写的 20 个字，**零额外 token**。没写就取最后一句。

## 安装

```bash
cd %USERPROFILE%\.dsh\profiles\desktop
pnpm add dsh-pet-speak
# 把 "dsh-pet-speak" 加进 package.json 的 dsh.profile.bundles
# 重启 DSH
```

目前仅 Windows（WinRT / System.Speech / GetAsyncKeyState）。
想先听听系统音色，运行 `demo-voices.cmd`。

## 隐私

- 不联网、不收集任何遥测；
- `onecore` / `sapi` 本地合成，只把你看得见的文字交给 Windows；
- `pet` 只往**本地**桥目录追加一行 JSON；
- `command` 跑的是**你自己**的命令（包括你自己配的网络请求）；
- 磁盘上只留一个实例/属主日志，位于 `%LOCALAPPDATA%\dsh-voice-announcer`。

## 已知限制

- `pet` 出口暂不支持 ESC 打断（声音在桌宠进程里）；
- 暂无设置界面，配置写在 `%USERPROFILE%\.dsh-pet-speak.json`；
- `command` 出口无 ESC，命令退出或超时才停。

## License

MIT
