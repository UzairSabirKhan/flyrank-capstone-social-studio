param(
  [string]$Base = 'http://localhost:3000',
  [int]$WaitSeconds = 240   # how long to wait for the scheduled post to publish (0 = skip waiting)
)
$ErrorActionPreference = 'Stop'
$curl = if ($env:OS -eq 'Windows_NT') { 'curl.exe' } else { 'curl' }

function Call([string]$Method, [string]$Path, $Body = $null) {
  $out = [IO.Path]::GetTempFileName()
  $in = $null
  $curlArgs = @('-s', '-o', $out, '-w', '%{http_code}', '-X', $Method, "$Base$Path")
  if ($null -ne $Body) {
    $in = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($in, ($Body | ConvertTo-Json -Compress -Depth 5))
    $curlArgs += @('-H', 'Content-Type: application/json', '--data', "@$in")
  }
  $status = [int](& $curl @curlArgs)
  $raw = Get-Content -Raw $out
  Remove-Item $out -ErrorAction SilentlyContinue
  if ($in) { Remove-Item $in -ErrorAction SilentlyContinue }
  $json = if ($raw) { $raw | ConvertFrom-Json } else { $null }
  [pscustomobject]@{ Status = $status; Body = $json }
}

$script:failed = 0
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if (-not $Ok) { $script:failed++ }
  Write-Host ('[{0}] {1} {2}' -f ($(if ($Ok) { 'PASS' } else { 'FAIL' })), $Name, $Detail)
}

$health = Call GET '/health'
if ($health.Status -ne 200) { throw "API not reachable at $Base. Is 'docker compose up' running?" }

# Ingest the sample post
$sample = Get-Content -Raw (Join-Path $PSScriptRoot 'post.json') | ConvertFrom-Json
$postId = (Call POST '/posts' $sample).Body.post.id

# Probe 1: variants for each platform, each passing its profile
$gen = Call POST "/posts/$postId/variants/generate" @{}
$created = @($gen.Body.created)
Check 'Probe 1: one post -> a variant per platform' `
  (($gen.Status -eq 201) -and ($created.Count -eq 2) -and ($created[0].text -ne $created[1].text)) `
  "($($created.Count) variants, blocked: $(@($gen.Body.blocked).Count))"

# Probe 2: a rule-breaking variant is blocked before review
$bad = Call POST "/posts/$postId/variants" @{ platform = 'x'; text = ('a' * 300) }
$codes = @($bad.Body.error.details | ForEach-Object { $_.code })
Check 'Probe 2: rule-breaking variant blocked' `
  (($bad.Status -eq 422) -and ($codes -contains 'TOO_LONG')) "(HTTP $($bad.Status) $($codes -join ','))"

# Probe 3: an unapproved variant cannot be scheduled
$li = $created | Where-Object { $_.platform -eq 'linkedin' }
$x = $created | Where-Object { $_.platform -eq 'x' }
$when = [DateTime]::UtcNow.AddMinutes(2).ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
$refused = Call POST "/variants/$($li.id)/schedule" @{ scheduledAt = $when }
Check 'Probe 3: unapproved variant refused' `
  (($refused.Status -eq 409) -and ($refused.Body.error.code -eq 'VARIANT_NOT_APPROVED')) `
  "(HTTP $($refused.Status) $($refused.Body.error.code))"

# Probe 4: approve, schedule 2 minutes out, the worker publishes
$null = Call POST "/variants/$($x.id)/approve"
$sched = Call POST "/variants/$($x.id)/schedule" @{ scheduledAt = $when }
$slotId = $sched.Body.slot.id
Check 'Probe 4a: approved variant scheduled 2 minutes out' ($sched.Status -eq 201) "(slot $slotId)"

if ($WaitSeconds -gt 0) {
  Write-Host "Waiting up to $WaitSeconds s for the worker (its cron runs once a minute)..."
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $row = $null
  while ((Get-Date) -lt $deadline -and -not $row) {
    Start-Sleep -Seconds 10
    $h = Call GET "/history?slotId=$slotId"
    $row = @($h.Body.history) | Where-Object { $_.result -eq 'published' } | Select-Object -First 1
  }
  $detail = if ($row) { "(externalId $($row.externalId) url $($row.externalUrl))" } else { '(timed out; try: docker compose logs worker)' }
  Check 'Probe 4b: the worker published the slot' ([bool]$row) $detail
  $h = Call GET "/history?slotId=$slotId"
  $ok = @(@($h.Body.history) | Where-Object { $_.result -eq 'published' }).Count
  Check 'Probe 4c: exactly one successful attempt' ($ok -eq 1) "($ok)"
}

Write-Host ''
Write-Host 'Probes 5 and 6 are separate commands. See the README.'
if ($script:failed -gt 0) { Write-Host "$($script:failed) check(s) FAILED"; exit 1 }
Write-Host 'All scripted checks passed'