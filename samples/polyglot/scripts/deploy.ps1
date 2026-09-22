param(
  [string]$Environment = 'staging',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

Write-Host "deploying to $Environment"
if ($DryRun) {
  Write-Host 'dry run, nothing changed'
  exit 0
}

Get-ChildItem -Path ./dist -Recurse -File | ForEach-Object {
  Write-Verbose "uploading $($_.Name)"
}
