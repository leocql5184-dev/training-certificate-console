[CmdletBinding()]
param(
    [string]$AnswerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'written-answers.md')
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($true)
$AnswerPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($AnswerPath)
$signature = '<!-- powershell-answer-session:v1 -->'
$newline = [Environment]::NewLine

$questions = @(
    @{
        Title = '数据库字段变更与滚动部署'
        Text = @'
某服务将用户姓名存储在 users.display_name 中。拟发布的新版本会引入 users.full_name，将应用中所有读取和写入都切换到新列，并在同一次部署中删除 display_name。

该服务采用滚动部署，因此新旧版本的应用实例会同时运行。这次发布还必须支持回滚。

请解释为什么这样的发布可能失败，并提出一套安全的数据库与应用变更顺序。
'@
    },
    @{
        Title = '证书撤销与缓存一致性'
        Text = @'
证书详情会缓存 60 秒。请求 A 未命中缓存，从数据库读取到 ACTIVE 状态。在 A 写入缓存之前，请求 B 撤销了该证书，提交数据库事务，并删除缓存条目。随后，A 将已经过时的 ACTIVE 值写入缓存。

一位同事建议将缓存 TTL 缩短到 5 秒。请解释为什么这无法解决问题。

请重新设计读取流程和撤销流程，确保任何在 B 返回成功之后才开始的读取请求，都不会收到这个过时的 ACTIVE 值。
'@
    },
    @{
        Title = '下游变慢、重试与服务可用性'
        Text = @'
服务 A 有 50 个请求处理工作单元（request workers）。每个发往 /report 接口的请求都会调用服务 B，调用超时时间为 100 毫秒，最多重试三次。

/report 的流量持续保持在每秒 1,000 个请求。B 的延迟突然从 20 毫秒增加到 2 秒，随后 A 上与 /report 无关的其他接口也很快停止响应。

请解释这一连串故障的形成过程，包括重试带来的影响。请重新设计 /report，使其他无关接口保持可用，并说明当 B 不健康时，/report 应返回什么。
'@
    }
)

if ([System.IO.File]::Exists($AnswerPath)) {
    $existing = [System.IO.File]::ReadAllText($AnswerPath, $utf8)
    if (-not $existing.StartsWith($signature)) {
        throw "已有答案文件不是由本脚本创建，已保留原文件，未覆盖：$AnswerPath"
    }
} else {
    $initial = "$signature$newline# 独立书面回答$newline"
    # CreateNew prevents an existing file from being overwritten.
    $stream = [System.IO.File]::Open($AnswerPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try {
        $bom = $utf8.GetPreamble()
        $stream.Write($bom, 0, $bom.Length)
        $bytes = $utf8.GetBytes($initial)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
}

Write-Host ''
Write-Host '三道书面题 · 中文作答' -ForegroundColor Cyan
Write-Host '逐行输入，每行按回车立即保存。可输入空行分段。'
Write-Host '输入 :done 完成本题并进入下一题；输入 :quit 保存退出，下次运行继续。'
Write-Host "答案文件：$AnswerPath"

for ($index = 0; $index -lt $questions.Count; $index++) {
    $number = $index + 1
    $question = $questions[$index]
    $startMarker = "<!-- question:${number}:start -->"
    $answerMarker = "<!-- question:${number}:answer -->"
    $completeMarker = "<!-- question:${number}:complete -->"
    $saved = [System.IO.File]::ReadAllText($AnswerPath, $utf8)
    if ($saved.Contains($completeMarker)) { continue }

    if (-not $saved.Contains($startMarker)) {
        $section = "$newline$startMarker$newline## 第 $number 题：$($question.Title)$newline$newline$($question.Text.Trim())$newline$newline### 回答$newline$answerMarker$newline"
        [System.IO.File]::AppendAllText($AnswerPath, $section, $utf8)
    }

    Write-Host ''
    Write-Host "========== 第 $number / 3 题：$($question.Title) ==========" -ForegroundColor Cyan
    Write-Host $question.Text
    Write-Host ''
    $saved = [System.IO.File]::ReadAllText($AnswerPath, $utf8)
    $answerStart = $saved.IndexOf($answerMarker)
    if ($answerStart -lt 0) { throw '答案文件的续写标记缺失；文件已保留，请检查后再继续。' }
    $previousAnswer = $saved.Substring($answerStart + $answerMarker.Length).Trim()
    if ($previousAnswer.Length -gt 0) {
        Write-Host '本题已保存的回答：' -ForegroundColor DarkCyan
        Write-Host $previousAnswer
        Write-Host '请继续输入，或输入 :done 进入下一题。'
    }

    while ($true) {
        $line = Read-Host '作答'
        if ($null -eq $line) {
            Write-Host "输入已结束；已保存：$AnswerPath"
            return
        }
        if ($line.Trim() -eq ':quit') {
            Write-Host "已保存。下次运行同一命令，即可继续：$AnswerPath" -ForegroundColor Green
            return
        }
        if ($line.Trim() -eq ':done') {
            $saved = [System.IO.File]::ReadAllText($AnswerPath, $utf8)
            $currentAnswer = $saved.Substring($saved.IndexOf($answerMarker) + $answerMarker.Length).Trim()
            if ($currentAnswer.Length -eq 0) {
                Write-Host '本题还没有回答，请先输入内容；若要退出，请输入 :quit。' -ForegroundColor Yellow
                continue
            }
            [System.IO.File]::AppendAllText($AnswerPath, "$newline$completeMarker$newline", $utf8)
            Write-Host "第 $number 题已保存。" -ForegroundColor Green
            break
        }
        if ($line -match '<!--\s*(question:|powershell-answer-session:)') {
            Write-Host '这一行包含脚本续写标记，请改用普通文字输入。' -ForegroundColor Yellow
            continue
        }
        [System.IO.File]::AppendAllText($AnswerPath, "$line$newline", $utf8)
    }
}

Write-Host ''
Write-Host "三道题均已保存：$AnswerPath" -ForegroundColor Green
Write-Host '如需修改，可以用文本编辑器打开该文件。'
