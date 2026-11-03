# Backs up the Pause for Paws data from GitHub to a dated folder on this PC.
# Run it by hand, or monthly with Task Scheduler:
#   powershell -ExecutionPolicy Bypass -File scripts\backup-data.ps1
param(
  [string]$Repo = (Resolve-Path "$PSScriptRoot\.."),
  [string]$Dest = "C:\PauseForPawsBackups",   # kept outside OneDrive so sync cannot lock the files
  [int]$Keep = 12                              # how many dated copies to keep
)

$ErrorActionPreference = "Stop"
Set-Location $Repo

# Get the newest data from GitHub (fast-forward only, so local changes are never overwritten).
git pull --ff-only origin main

$target = Join-Path $Dest (Get-Date -Format "yyyy-MM-dd")
New-Item -ItemType Directory -Force -Path $target | Out-Null

Copy-Item "$Repo\data\*" $target -Recurse -Force      # raw crash CSVs and the alert corridor file
Copy-Item "$Repo\corridors.json" $target -Force       # corridor file for the map and table

# Keep only the newest copies.
Get-ChildItem $Dest -Directory |
  Sort-Object Name -Descending |
  Select-Object -Skip $Keep |
  Remove-Item -Recurse -Force

Write-Host "Backed up to $target"
