<#
  FridgeWise local server (PowerShell 7, no installs needed).

  - Serves the app at http://localhost:5178
  - POST /token  -> creates a short-lived OpenAI Realtime client secret for the voice agent.
                    Your real API key stays here on the server and never reaches the browser.
  - GET  /health -> { "voice": true|false }  (is an API key configured?)

  API key: set OPENAI_API_KEY in the terminal, or put it in a ".env" file in the project root:
      OPENAI_API_KEY=sk-...
  (.env is in .gitignore — never commit it.)

  Run:  pwsh -File server/serve.ps1
#>
param(
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 5178 }),
  [string]$Model = "gpt-realtime-2.1",
  [string]$Voice = "marin"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-ApiKey {
  if ($env:OPENAI_API_KEY) { return $env:OPENAI_API_KEY.Trim() }
  $envFile = Join-Path $Root ".env"
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*OPENAI_API_KEY\s*=\s*"?([^"#\s]+)"?') { return $Matches[1] }
    }
  }
  return $null
}

$types = @{
  ".html" = "text/html; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json"; ".svg" = "image/svg+xml"; ".png" = "image/png"; ".ico" = "image/x-icon"; ".md" = "text/plain; charset=utf-8"
}
# Never serve these, even if requested directly.
$blocked = @(".env", ".git", ".claude", "server")

function Send-Json($ctx, [int]$status, $obj) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 8 -Compress))
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = "application/json"
  $ctx.Response.Headers["Cache-Control"] = "no-store"
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "FridgeWise running at http://localhost:$Port/"
if (Get-ApiKey) { Write-Host "Voice agent: API key found ($Model, voice '$Voice')." }
else { Write-Host "Voice agent: no OPENAI_API_KEY set - the app works, voice is disabled." }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $req = $ctx.Request
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

    if ($path -eq "/health") {
      Send-Json $ctx 200 @{ voice = [bool](Get-ApiKey); model = $Model }
    }
    elseif ($path -eq "/token") {
      if ($req.HttpMethod -ne "POST") { Send-Json $ctx 405 @{ error = "Use POST" } }
      else {
        $key = Get-ApiKey
        if (-not $key) {
          Send-Json $ctx 503 @{ error = "No OPENAI_API_KEY configured on the server. See README > Voice agent." }
        } else {
          $body = @{
            expires_after = @{ anchor = "created_at"; seconds = 600 }
            session = @{ type = "realtime"; model = $Model; audio = @{ output = @{ voice = $Voice } } }
          } | ConvertTo-Json -Depth 8
          try {
            $res = Invoke-RestMethod -Method Post -Uri "https://api.openai.com/v1/realtime/client_secrets" `
              -Headers @{ Authorization = "Bearer $key" } -ContentType "application/json" -Body $body
            Send-Json $ctx 200 @{ value = $res.value; expires_at = $res.expires_at; model = $Model }
          } catch {
            $msg = $_.ErrorDetails.Message
            if (-not $msg) { $msg = $_.Exception.Message }
            Write-Host "OpenAI error: $msg"
            Send-Json $ctx 502 @{ error = "OpenAI rejected the request. Check the server terminal for details." }
          }
        }
      }
    }
    else {
      $rel = $path.TrimStart("/")
      if ($rel -eq "") { $rel = "index.html" }
      $first = ($rel -split "[/\\]")[0].ToLower()
      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
      if ($blocked -contains $first -or -not $full.StartsWith($Root) -or -not (Test-Path $full -PathType Leaf)) {
        $ctx.Response.StatusCode = 404
      } else {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { "application/octet-stream" })
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    }
  } catch {
    Write-Host "Request error: $($_.Exception.Message)"
    try { $ctx.Response.StatusCode = 500 } catch {}
  } finally {
    $ctx.Response.Close()
  }
}
