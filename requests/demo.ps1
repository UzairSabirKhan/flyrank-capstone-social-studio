param([string]$Base = 'http://localhost:3000', [int]$Minutes = 2, [string]$Platform = 'x')

function Send($method, $url, $file) {
  if ($file) { curl.exe -s -X $method $url -H "Content-Type: application/json" --data "@$file" | ConvertFrom-Json }
  else { curl.exe -s -X $method $url | ConvertFrom-Json }
}

$post = Send POST "$Base/posts" 'requests/post.json'
@{ platforms = @($Platform) } | ConvertTo-Json -Compress | Set-Content -Encoding ascii 'requests/generate.json'
$gen = Send POST "$Base/posts/$($post.post.id)/variants/generate" 'requests/generate.json'
$variantId = $gen.created[0].id
Send POST "$Base/variants/$variantId/approve" | Out-Null

$when = [DateTime]::UtcNow.AddMinutes($Minutes).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture)
@{ scheduledAt = $when } | ConvertTo-Json -Compress | Set-Content -Encoding ascii 'requests/schedule.json'
$sched = Send POST "$Base/variants/$variantId/schedule" 'requests/schedule.json'

Write-Host "variant: $variantId"
Write-Host "slot:    $($sched.slot.id)  (scheduled for $when)"