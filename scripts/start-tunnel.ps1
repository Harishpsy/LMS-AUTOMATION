param(
    [string]$port = "3001"
)

$cfExe = "cloudflared"
if (!(Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    if (Test-Path "C:\Program Files (x86)\cloudflared\cloudflared.exe") {
        $cfExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    } elseif (Test-Path "C:\Program Files\cloudflared\cloudflared.exe") {
        $cfExe = "C:\Program Files\cloudflared\cloudflared.exe"
    } elseif (Test-Path "$PSScriptRoot\..\cloudflared.exe") {
        $cfExe = "$PSScriptRoot\..\cloudflared.exe"
    } else {
        Write-Host "[ERROR] cloudflared.exe was not found." -ForegroundColor Red
        Write-Host "Please download cloudflared from: https://github.com/cloudflare/cloudflared/releases/latest"
        pause
        exit 1
    }
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "      CAREERSCLOUD LMS - CLOUDFLARE PUBLIC TUNNEL" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Connecting tunnel to http://localhost:$port..." -ForegroundColor Yellow
Write-Host "Generating live public URL..." -ForegroundColor Yellow
Write-Host ""

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cfExe
$psi.Arguments = "tunnel --url http://localhost:$port"
$psi.RedirectStandardError = $true
$psi.RedirectStandardOutput = $false
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$urlFound = $false

while (!$proc.HasExited) {
    $line = $proc.StandardError.ReadLine()
    if ($null -ne $line) {
        Write-Host $line
        if (!$urlFound -and $line -match "(https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com)") {
            $urlFound = $true
            $url = $matches[1]
            Write-Host ""
            Write-Host "================================================================" -ForegroundColor Green
            Write-Host "🎉 YOUR LIVE PUBLIC URL IS READY:" -ForegroundColor Green
            Write-Host "👉 $url" -ForegroundColor Green
            Write-Host "================================================================" -ForegroundColor Green
            Write-Host "(Opening in your browser & copied to clipboard!)" -ForegroundColor Cyan
            Write-Host ""
            try { Set-Clipboard -Value $url } catch {}
            try { Start-Process $url } catch {}
        }
    }
}

Write-Host ""
Write-Host "Tunnel stopped." -ForegroundColor Yellow
pause
