param(
  [string]$RepoRoot = (Resolve-Path ".").Path,
  [int]$GatewayPort = 5000,
  [int]$UiPort = 5173,
  [int]$WaitSeconds = 30,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Start-Background {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  return Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -PassThru
}

function Write-If {
  param([string]$Text)
  Write-Host $Text
}

function Get-TunnelUrlFromLog {
  param(
    [string]$LogPath,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $LogPath) {
      $content = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
      if ($content) {
        $match = Select-String -InputObject $content -Pattern "https://[a-zA-Z0-9-]+\\.trycloudflare\\.com" -AllMatches
        if ($match.Matches.Count -gt 0) {
          return $match.Matches[0].Value
        }
      }
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

$logsDir = Join-Path $RepoRoot ".tunnels"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$uiCmd = "npm run dev:client:remote"
$serverCmd = "npm run dev:server"
$gatewayCmd = "powershell -Command `"`$env:GATEWAY_VITE_PORT='$UiPort'; `$env:GATEWAY_PROXY_UI='1'; npm run dev:gateway`""
$tunnelCmd = "cloudflared tunnel --url http://127.0.0.1:$GatewayPort --logfile `"$logsDir\\gateway.log`" --loglevel info"

if ($DryRun.IsPresent) {
  Write-If "Dry run only. Commands that would run:"
  Write-If "1) $serverCmd"
  Write-If "2) $uiCmd"
  Write-If "3) $gatewayCmd"
  Write-If "4) $tunnelCmd"
  exit 0
}

Write-Host "Starting backend (API + WS)..."
Start-Background -FilePath "npm" -Arguments @("run", "dev:server") -WorkingDirectory $RepoRoot | Out-Null

Write-Host "Starting UI (remote mode, same-origin)..."
Start-Background -FilePath "npm" -Arguments @("run", "dev:client:remote") -WorkingDirectory $RepoRoot | Out-Null

Write-Host "Starting gateway (proxy UI + API + WS)..."
Start-Background -FilePath "powershell" -Arguments @(
  "-Command",
  "`$env:GATEWAY_VITE_PORT='$UiPort'; `$env:GATEWAY_PROXY_UI='1'; npm run dev:gateway"
) -WorkingDirectory $RepoRoot | Out-Null

Write-Host "Starting Cloudflare quick tunnel to http://127.0.0.1:$GatewayPort ..."
Start-Background -FilePath "cloudflared" -Arguments @(
  "tunnel",
  "--url", "http://127.0.0.1:$GatewayPort",
  "--logfile", (Join-Path $logsDir "gateway.log"),
  "--loglevel", "info"
) -WorkingDirectory $RepoRoot | Out-Null

$url = Get-TunnelUrlFromLog -LogPath (Join-Path $logsDir "gateway.log") -TimeoutSeconds $WaitSeconds
Write-Host ""
Write-Host "Local gateway: http://127.0.0.1:$GatewayPort"
if ($url) {
  Write-Host "Remote URL:    $url"
} else {
  Write-Host "Remote URL:    not detected yet (check .tunnels\\gateway.log)"
}
