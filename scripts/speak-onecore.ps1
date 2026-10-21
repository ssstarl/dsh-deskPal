param(
  [string]$TextBase64 = "",
  [string]$Text = "",
  [string]$Voice = "",
  [string]$OutFile = "",
  [string]$EscCancel = "1",
  [switch]$ListVoices,
  [switch]$SaveOnly,
  [switch]$Demo
)

# OneCore（WinRT）语音合成：比 SAPI5 好一档，离线、零配置。
# 输出是 WAV 流，写到临时文件后用 SoundPlayer 播放，播放期间轮询 ESC 中断。

$ErrorActionPreference = "Stop"

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
} catch {
  exit 2
}

if ($ListVoices) {
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
    ForEach-Object { "{0} | {1} | {2}" -f $_.DisplayName, $_.Language, $_.Gender }
  exit 0
}

# WinRT 的 IAsyncOperation<T> → .NET Task，然后同步等结果
function Await($operation, $resultType) {
  # 注意：这里必须用 -like 通配匹配。泛型类型名是 "IAsyncOperation`1"，
  # 但在双引号字符串里反引号是转义符，会变成 "IAsyncOperation1" 匹配不到。
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -like "IAsyncOperation*"
  })[0]
  if ($null -eq $asTask) { throw "找不到 AsTask(IAsyncOperation<T>) 重载" }
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

function Speak-OneCore([string]$content, [string]$voiceName, [string]$escFlag) {
  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  try {
    $voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
    $picked = $null
    if ($voiceName) {
      $picked = $voices |
        Where-Object { $_.DisplayName -like "*$voiceName*" -or $_.Id -like "*$voiceName*" } |
        Select-Object -First 1
    }
    if (-not $picked) {
      $picked = $voices | Where-Object { $_.Language -like "zh*" } | Select-Object -First 1
    }
    if ($picked) { $synth.Voice = $picked }
  } catch {
    # 选不到就用默认音色
  }

  $out = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-tts-" + [guid]::NewGuid().ToString("N") + ".wav")
  $stream = Await ($synth.SynthesizeTextToStreamAsync($content)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $file = [System.IO.File]::Create($out)
  try {
    $netStream.CopyTo($file)
  } finally {
    $file.Close()
    $netStream.Close()
  }

  # WAV 头里读采样率/声道/位深，算准播放时长
  $bytes = [System.IO.File]::ReadAllBytes($out)
  $sampleRate = [BitConverter]::ToInt32($bytes, 24)
  $channels = [BitConverter]::ToInt16($bytes, 22)
  $bits = [BitConverter]::ToInt16($bytes, 34)
  $bytesPerSecond = [math]::Max(1, $sampleRate * $channels * ($bits / 8))
  $durationSec = [math]::Max(0.3, (($bytes.Length - 44) / $bytesPerSecond)) + 0.3

  $player = New-Object System.Media.SoundPlayer $out
  $player.Load()
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $player.Play()
  try {
    while ($sw.Elapsed.TotalSeconds -lt $durationSec) {
      if ($escFlag -eq "1" -and
          (([VoiceAnnouncer.Keys]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0)) {
        $player.Stop()
        break
      }
      Start-Sleep -Milliseconds 50
    }
  } finally {
    $player.Dispose()
    Remove-Item $out -Force -ErrorAction SilentlyContinue
  }
}

Add-Type -Namespace VoiceAnnouncer -Name Keys -MemberDefinition @'
[DllImport("user32.dll")]
public static extern short GetAsyncKeyState(int vKey);
'@

if ($Demo) {
  $voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
    Where-Object { $_.Language -like "zh*" }
  foreach ($v in $voices) {
    $sample = "你好，我是语音播报。这是" + $v.DisplayName + "的声音，你觉得这个好听吗？"
    Write-Host ("→ " + $v.DisplayName + " (" + $v.Language + ")")
    Speak-OneCore $sample $v.DisplayName "0"
    Start-Sleep -Milliseconds 600
  }
  exit 0
}

$content = if ($Text) {
  $Text
} else {
  [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TextBase64))
}
if ([string]::IsNullOrWhiteSpace($content)) { exit 0 }

if ($SaveOnly -and $OutFile) {
  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $stream = Await ($synth.SynthesizeTextToStreamAsync($content)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $file = [System.IO.File]::Create($OutFile)
  try { $netStream.CopyTo($file) } finally { $file.Close(); $netStream.Close() }
  exit 0
}

Speak-OneCore $content $Voice $EscCancel
