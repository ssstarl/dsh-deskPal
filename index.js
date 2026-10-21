// dsh-voice-announcer
//
// 作用：每轮回复结束后，念一句「简短总结」。
//
// 内容来源（重要，决定成本）：
//   1) 优先取回复里的「播报：……」那一行（模型自己写的，**零额外 token**）；
//   2) 没有就退化成第一句（纯规则，同样零 token）；
//   3) 永远不额外调用模型——这是刻意的：语音播报不该再烧一遍额度。
//
// 出口（sink）：
//   - sapi：Windows 系统 TTS，离线、免费、ESC 可打断（默认）；
//   - pet ：把同一句写进桌宠桥目录的 `pet/say` 记录，由桌宠气泡+语音播放；
//           桌宠不在时自动退回 sapi。
//
// ESC 打断：由播放器进程自己轮询 GetAsyncKeyState(VK_ESCAPE) 实现。
// 轮询（而不是 RegisterHotKey）是实机验证过的可靠做法：热键消息会"只投递第一次"。
//
// 零外部依赖：只用 node 内置模块；Windows 上的语音交给 PowerShell + System.Speech。

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "voice-announcer";

// 不强制依赖任何服务：没有会话、没有桌宠时插件照常加载，只是不播报。
export const inject = [];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEAK_PS1 = path.join(HERE, "scripts", "speak.ps1");
const SPEAK_ONECORE_PS1 = path.join(HERE, "scripts", "speak-onecore.ps1");

const DEFAULTS = {
  /**
   * 出口：
   *   sapi    —— 系统 SAPI5，离线、音色机械；
   *   onecore —— WinRT OneCore 语音，离线、比 SAPI5 自然（失败自动回落 sapi）；
   *   pet     —— 交给桌宠念（edge 神经语音，最好听，但需要她在跑）。
   */
  sink: "onecore",
  /** onecore 出口用的音色（模糊匹配 DisplayName，如 "Yaoyao"） */
  voice: "Yaoyao",
  /**
   * 播报模式：
   *   "ending"（默认）只念结尾——优先「播报：」行，没有就取最后一句；
   *   "full" 念全文（去掉代码块），适合"边做边听"。
   */
  speakMode: "ending",
  /** 回复短于这个字数就不播报（避免"好的""收到"也念） */
  minReplyChars: 120,
  /** 播报文本上限；null = 按模式取默认（ending 60 / full 400） */
  maxSpeakChars: null,
  /** 免打扰时段，如 "23:00-08:00"；空串表示关闭 */
  quietHours: "",
  /** ESC 打断（仅 sapi 出口有效） */
  escCancel: true,
  /** 一次性最多播报多少轮（调试用；0 = 不限制） */
  maxTurns: 0,
  /** 桌宠桥目录；留空则用 %APPDATA%\dsh-pet-bridge */
  petBridgeDir: "",
  /**
   * 桌宠的实例锁路径（overlay-instance.lock）。配了才判断她是否在跑：
   * 锁文件不在 → 视为离线，自动降级到 onecore/sapi，而不是"写进去没人念"。
   * 留空 = 不判断（兼容旧行为）。
   */
  petLockPath: "",
  /**
   * command 出口：用户自己的 TTS 命令模板，`{text}` 会被替换成要念的文本。
   * 例：'python D:/tts/speak.py --text "{text}"'
   * 不走 shell，参数按空格/引号拆分，所以文本里的引号不会被当成命令。
   */
  command: "",
  /** command 出口的超时（毫秒），超时杀掉，避免卡死 */
  commandTimeoutMs: 15000,
};

const MAX_BY_MODE = { ending: 60, full: 400 };

const INST = randomUUID();

/**
 * 用户级覆盖文件：`%USERPROFILE%\.dsh-pet-speak.json`（或环境变量
 * DSH_PET_SPEAK_CONFIG 指定的路径）。
 *
 * 为什么要它：插件包里的 cordis.patch.yml 是**发布用的通用默认值**，
 * 而每台机器上的桌宠路径、音色偏好是私人的——写进包里既会泄露路径，
 * 也会让所有人共用一份配置。覆盖文件让"包"和"本机偏好"彻底分开。
 * 优先级：内置默认 < 包里的 patch 配置 < 用户覆盖文件。
 */
function userConfigPath() {
  const explicit = process.env.DSH_PET_SPEAK_CONFIG;
  if (explicit) return explicit;
  const home = process.env.USERPROFILE || os.homedir();
  return path.join(home, ".dsh-pet-speak.json");
}

function readUserConfig() {
  try {
    const file = userConfigPath();
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // 配置写坏了不能把插件搞挂
  }
}

function mergeKnown(target, source) {
  if (!source || typeof source !== "object") return;
  for (const key of Object.keys(DEFAULTS)) {
    if (source[key] !== undefined && source[key] !== null) target[key] = source[key];
  }
}

function pickConfig(raw) {
  const cfg = { ...DEFAULTS };
  mergeKnown(cfg, raw);          // 包里的 patch 配置
  mergeKnown(cfg, readUserConfig()); // 本机覆盖（最高优先级）
  cfg.minReplyChars = Number(cfg.minReplyChars) || 0;
  cfg.speakMode = cfg.speakMode === "full" ? "full" : "ending";
  const fallbackCap = MAX_BY_MODE[cfg.speakMode];
  cfg.maxSpeakChars = Math.max(8, Number(cfg.maxSpeakChars) || fallbackCap);
  return cfg;
}

// ---------------------------------------------------------------- 文本抽取

/** 从 assistant 消息的内容块里取纯文本。 */
function messageText(data) {
  const message = (data && data.message) || {};
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

function clip(text, maxChars) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  return flat.slice(0, maxChars).replace(/[，,、；;：:]+$/, "") + "…";
}

/** 去 markdown 噪音，留下能念的纯文本。 */
function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")        // 代码块整体跳过：念出来是噪音
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接留文字
    .replace(/^[>\-*#\s]+/gm, "")            // 引用/列表/标题符号
    .replace(/[*_~]{1,3}/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 决定念什么（两处都不额外调用模型，所以是零 token）：
 *
 * - `mode: "ending"`（默认，结尾播报）
 *     1) 优先「播报：xxx」行——模型主动写的总结，质量最好；
 *     2) 没有就取**最后一句**（结尾是结论）；
 * - `mode: "full"`（全部内容）
 *     去掉代码块后念全文，上限默认 400 字，超出截断。
 */
export function pickSpeakText(markdown, options = {}) {
  const opts = typeof options === "number" ? { maxChars: options } : (options || {});
  const mode = opts.mode === "full" ? "full" : "ending";
  const maxChars = Math.max(8, Number(opts.maxChars) || MAX_BY_MODE[mode]);
  const text = String(markdown || "");

  const plain = stripMarkdown(text);

  if (mode === "full") {
    // 全文模式里「播报：」是元信息，念出来会重复一遍结论，去掉
    const withoutMarker = plain.replace(/^\s*播报\s*[:：].*$/gm, " ").trim();
    return clip(withoutMarker, maxChars);
  }

  const marked = text.match(/^\s*(?:[>\-*]\s*)?播报\s*[:：]\s*(.+)$/m);
  if (marked && marked[1].trim()) return clip(marked[1], maxChars);

  // 结尾兜底：取最后一句（句号/问号/感叹号/分号/换行分隔）
  const sentences = plain
    .split(/[。！？!?；;]|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const last = sentences.length ? sentences[sentences.length - 1] : "";
  return clip(last, maxChars);
}

/** "23:00-08:00" 判断此刻是否在免打扰时段（支持跨零点）。 */
export function inQuietHours(spec, now = new Date()) {
  const m = String(spec || "").match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const toMin = (h, mi) => Number(h) * 60 + Number(mi);
  const start = toMin(m[1], m[2]);
  const end = toMin(m[3], m[4]);
  const cur = now.getHours() * 60 + now.getMinutes();
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

// ---------------------------------------------------------------- 播放器

let currentChild = null;
/** 所有在播的播放器（防止同一时刻有两条声音） */
const liveChildren = new Set();
/** 被我们主动掐掉的播放器：它们的非零退出码不算"失败"，不触发兜底 */
const cancelledChildren = new WeakSet();

function stopAllChildren() {
  for (const child of liveChildren) {
    cancelledChildren.add(child);
    try {
      child.kill();
    } catch {
      /* 已经退出 */
    }
  }
  liveChildren.clear();
  currentChild = null;
}

function stopCurrent() {
  stopAllChildren();
}

/** sapi 出口：PowerShell + System.Speech，脚本内轮询 ESC 自行打断。 */
function playerEnv() {
  // Add-Type / WinRT 都要一个可写的 TEMP；用插件自己的目录，
  // 免得系统 TEMP 被策略限制或指向只读位置
  const env = { ...process.env };
  try {
    const runtimeTmp = path.join(
      process.env.LOCALAPPDATA || os.tmpdir(), "dsh-voice-announcer", "tmp");
    fs.mkdirSync(runtimeTmp, { recursive: true });
    env.TMP = runtimeTmp;
    env.TEMP = runtimeTmp;
  } catch {
    /* 建不出来就用系统的 */
  }
  return env;
}

/**
 * 起一个 PowerShell 播放器；退出码非零时回调 onFail（用于降级）。
 * 被我们主动掐掉的（说话被打断/换一句）不算失败。
 */
function spawnPlayer(scriptPath, extraArgs, onFail) {
  if (process.platform !== "win32") return false;
  try {
    if (!fs.existsSync(scriptPath)) return false;
  } catch {
    return false;
  }
  stopCurrent();
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    ...extraArgs,
  ];
  try {
    const child = spawn("powershell.exe", args, {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
      env: playerEnv(),
    });
    child.on("exit", (code) => {
      liveChildren.delete(child);
      if (currentChild === child) currentChild = null;
      if (code && !cancelledChildren.has(child) && typeof onFail === "function") {
        onFail(code);
      }
    });
    child.unref?.();
    liveChildren.add(child);
    currentChild = child;
    return true;
  } catch {
    return false;
  }
}

/** sapi 出口：System.Speech（SAPI5），离线但音色机械。 */
function speakWithSapi(text, cfg) {
  const b64 = Buffer.from(String(text), "utf8").toString("base64");
  return spawnPlayer(SPEAK_PS1, [
    "-TextBase64", b64,
    "-EscCancel", cfg.escCancel ? "1" : "0",
  ]);
}

/** onecore 出口：WinRT OneCore 语音（比 SAPI5 好一档，离线）。失败自动回落 sapi。 */
function speakWithOneCore(text, cfg) {
  const b64 = Buffer.from(String(text), "utf8").toString("base64");
  const args = [
    "-TextBase64", b64,
    "-EscCancel", cfg.escCancel ? "1" : "0",
  ];
  if (cfg.voice) args.push("-Voice", String(cfg.voice));
  return spawnPlayer(SPEAK_ONECORE_PS1, args, () => {
    // OneCore 不可用（老系统/被策略禁）→ 退回 sapi，别哑掉
    speakWithSapi(text, cfg);
  });
}

/** pet 出口：写一条 pet/say 记录，桌宠会冒气泡并念出来。 */
function speakWithPet(text, cfg) {
  // 配了锁路径就先确认她活着：锁不在 = 没跑，返回 false 让调用方降级
  if (cfg.petLockPath) {
    try {
      if (!fs.existsSync(String(cfg.petLockPath))) return false;
    } catch {
      return false;
    }
  }
  const base = cfg.petBridgeDir
    || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "dsh-pet-bridge");
  const dir = base;
  const file = path.join(dir, `dsh-voice-${process.pid}.jsonl`);
  const record = {
    ts: Date.now() / 1000,
    agent: "dsh",
    event: "pet/say",
    text,
    inst: INST,
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 把命令模板拆成 argv：支持用双/单引号包住带空格的参数。
 * 不走 shell，所以 `{text}` 里的引号、`&`、`;` 都不会被解释成命令。
 */
export function splitCommandTemplate(template) {
  const out = [];
  let current = "";
  let quote = null;
  for (const ch of String(template || "")) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { out.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/**
 * command 出口：把文本交给用户自己配置的 TTS 命令。
 * 任何能读参数并出声的程序都能接（edge-tts、本地 GPT-SoVITS、curl 到自建服务……）。
 * 失败（非零退出）降级到 sapi；超时/被打断不算失败。
 */
function speakWithCommand(text, cfg) {
  const template = String(cfg.command || "").trim();
  if (!template) return false;
  const parts = splitCommandTemplate(template)
    .map((part) => part.split("{text}").join(String(text)));
  if (parts.length === 0) return false;
  const [file, ...args] = parts;
  stopCurrent();
  try {
    const child = spawn(file, args, {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
      env: playerEnv(),
    });
    const timeoutMs = Number(cfg.commandTimeoutMs) || 15000;
    const timer = setTimeout(() => {
      cancelledChildren.add(child); // 超时算"我们掐的"，不触发兜底
      try { child.kill(); } catch { /* 已退出 */ }
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.on("exit", (code) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      if (currentChild === child) currentChild = null;
      if (code && !cancelledChildren.has(child)) {
        // 用户命令失败了：至少让 SAPI 兜个底，别完全没声音
        speakWithSapi(text, cfg);
      }
    });
    child.unref?.();
    liveChildren.add(child);
    currentChild = child;
    return true;
  } catch {
    return false;
  }
}

function announce(text, cfg) {
  if (!text) return;
  // 降级链：command/pet（不可用就跳过）→ onecore（失败自己回 sapi）→ sapi
  if (cfg.sink === "command" && speakWithCommand(text, cfg)) return;
  if (cfg.sink === "pet" && speakWithPet(text, cfg)) return;
  if (speakWithOneCore(text, cfg)) return;
  speakWithSapi(text, cfg);
}

// ---------------------------------------------------------------- 插件主体

// 进程内单例：profile 里 bundle 与 patch 可能把同一个插件挂两次，
// 那样会有两个实例各自起播放器——用户会听到两条声音叠在一起（实机反馈）。
// 用 globalThis 上的符号占位，保证同一进程里只有第一个实例说话。
const GLOBAL_OWNER = Symbol.for("dsh-voice-announcer.owner");

function logInstance(state) {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "dsh-voice-announcer");
    fs.mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()} pid=${process.pid} state=${state}\n`;
    fs.appendFileSync(path.join(dir, "instances.log"), line, "utf8");
  } catch {
    /* 日志写不了不影响播报 */
  }
}

function releaseOwner() {
  try {
    const file = path.join(
      process.env.LOCALAPPDATA || os.tmpdir(), "dsh-voice-announcer", "owner.json");
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number(prev && prev.pid) === process.pid) fs.rmSync(file, { force: true });
  } catch {
    /* 没有就算了 */
  }
}

/**
 * 跨进程单例：DSH 可能在多个进程里各加载一次插件，两个播放器会同时出声。
 * owner.json 记持有者 pid；持有者还活着就让位，死了/没有就接管。
 */
function acquireOwner() {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "dsh-voice-announcer");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "owner.json");
    if (fs.existsSync(file)) {
      try {
        const prev = JSON.parse(fs.readFileSync(file, "utf8"));
        const pid = Number(prev && prev.pid);
        if (pid && pid !== process.pid) {
          try {
            process.kill(pid, 0); // 只探活，不发信号
            return false;         // 另一个进程还在负责播报
          } catch {
            /* 进程已死：接管 */
          }
        }
      } catch {
        /* 文件坏了：覆盖 */
      }
    }
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, ts: Date.now() }), "utf8");
    return true;
  } catch {
    return true; // 锁不可用时别把功能整个关掉
  }
}

export function apply(ctx, rawConfig) {
  if (globalThis[GLOBAL_OWNER]) {
    logInstance("duplicate-ignored");
    return; // 已经有一个实例在负责播报
  }
  if (!acquireOwner()) {
    logInstance("duplicate-other-process");
    return; // 另一个 DSH 进程在负责播报
  }
  globalThis[GLOBAL_OWNER] = true;
  logInstance("active");

  const cfg = pickConfig(rawConfig);
  const lastText = new Map(); // sessionId -> 最近一条 assistant 文本
  const spokenAt = new Map(); // text -> 上次播报时间（去重）
  let turns = 0;

  ctx.on("session/event", (session, event) => {
    try {
      const type = event && event.type;
      const key = String((session && session.id) || (event && event.data && event.data.turn) || "session");

      if (type === "assistant/message") {
        const text = messageText(event.data);
        if (text) lastText.set(key, text); // 只留最后一条：中间步骤不念
        return;
      }

      if (type !== "turn/end") return;

      const reasonKind = event?.data?.reason?.kind;
      const text = lastText.get(key) || "";
      lastText.delete(key);
      if (reasonKind && reasonKind !== "completed") return; // 失败/中止不念
      if (text.length < cfg.minReplyChars) return;
      if (inQuietHours(cfg.quietHours)) return;
      if (cfg.maxTurns && turns >= cfg.maxTurns) return;

      const speakable = pickSpeakText(text, {
        mode: cfg.speakMode,
        maxChars: cfg.maxSpeakChars,
      });
      if (!speakable) return;

      const now = Date.now();
      const prev = spokenAt.get(speakable) || 0;
      if (now - prev < 5000) return; // 同一句 5 秒内不重复
      spokenAt.set(speakable, now);
      if (spokenAt.size > 64) {
        for (const [k, ts] of spokenAt) if (now - ts > 600000) spokenAt.delete(k);
      }

      turns += 1;
      // 让回复先落到界面上再开口，避免"声音比字先到"
      setTimeout(() => announce(speakable, cfg), 400);
    } catch {
      // 播报失败绝不影响 DSH 本体
    }
  });

  // 会话/进程结束时掐掉还在播的声音，并交还单例占位
  ctx.on("dispose", () => {
    stopCurrent();
    if (globalThis[GLOBAL_OWNER] === true) {
      globalThis[GLOBAL_OWNER] = false;
      releaseOwner();
    }
  });
}
