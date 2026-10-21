param(
  [Parameter(Mandatory = $true)][string]$TextBase64,
  [string]$EscCancel = "1"
)

# 念一句短文本；ESC 可打断。
#
# 为什么用轮询而不是 RegisterHotKey：实机验证过热键消息只有第一次能收到，
# 之后整个失效（桌宠的抓图热键踩过同样的坑）。轮询 GetAsyncKeyState 稳定，
# 每 50ms 一次，开销可以忽略。

$ErrorActionPreference = "Stop"

try {
  Add-Type -AssemblyName System.Speech
} catch {
  exit 2
}

Add-Type -Namespace VoiceAnnouncer -Name Keys -MemberDefinition @'
[DllImport("user32.dll")]
public static extern short GetAsyncKeyState(int vKey);
'@

$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TextBase64))
if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  # 优先选中文语音；没有就用系统默认。
  # SelectVoice 在受限令牌下会抛"没有可用语音"——不能让它把整次播报打断，
  # 捕获后继续用默认语音（真·没有语音时 Speak 会自己失败，不会静默）。
  try {
    $zh = $synth.GetInstalledVoices() |
      Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "zh*" } |
      Select-Object -First 1
    if ($zh) { $synth.SelectVoice($zh.VoiceInfo.Name) }
  } catch {
    # 选不了就保持默认音色
  }

  # 语速稍微快一点：播报是"听个大概"，不是朗读课
  $synth.Rate = 1

  $synth.SpeakAsync($text) | Out-Null

  if ($EscCancel -ne "1") {
    while ($synth.State -eq [System.Speech.Synthesis.SynthesizerState]::Speaking) {
      Start-Sleep -Milliseconds 100
    }
  } else {
    while ($synth.State -eq [System.Speech.Synthesis.SynthesizerState]::Speaking) {
      # 0x1B = VK_ESCAPE
      if (([VoiceAnnouncer.Keys]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0) {
        $synth.SpeakAsyncCancelAll()
        break
      }
      Start-Sleep -Milliseconds 50
    }
  }
} finally {
  $synth.Dispose()
}
