param(
    [switch]$CheckOnly,
    [string]$Distribution = $env:JIAGOUTU_WSL_DISTRO,
    [string]$LinuxUser = $env:JIAGOUTU_WSL_USER
)
$ErrorActionPreference = 'Stop'
# WSL may forward a reduced PATHEXT; this only repairs the launcher process.
if (($env:PATHEXT -split ';') -notcontains '.EXE') { $env:PATHEXT += ';.EXE' }
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
    if (-not (Test-Path -LiteralPath $wsl)) { throw '找不到 Windows WSL 启动程序。' }
    $wslArgs = @()
    if ($Distribution) { $wslArgs += @('-d', $Distribution) }
    if ($LinuxUser) { $wslArgs += @('-u', $LinuxUser) }
    $project = Split-Path -Parent $PSScriptRoot
    $linuxRoot = (& $wsl @wslArgs --exec wslpath -u $project | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $linuxRoot.StartsWith('/')) { throw '无法定位 WSL 项目目录。' }
    $result = @(& $wsl @wslArgs --exec bash -lc 'exec "$1"' -- "$linuxRoot/scripts/launch-local.sh" 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ($result -join [Environment]::NewLine) }
    $url = ($result | Select-Object -Last 1).ToString().Trim()
    if ($url -ne 'http://127.0.0.1:4173/') { throw "启动器没有返回预期的本地地址：$url" }
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'WSL 服务已就绪，但 Windows 无法访问本地页面；请检查 WSL 本机端口转发。' }
    if (-not $CheckOnly) { Start-Process $url }
    Write-Output $url
    exit 0
} catch {
    $message = "无法打开 jiagoutu。`n`n$($_.Exception.Message)"
    if ($CheckOnly) { [Console]::Error.WriteLine($message) }
    else {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($message, 'jiagoutu', 'OK', 'Error') | Out-Null
    }
    exit 1
}
