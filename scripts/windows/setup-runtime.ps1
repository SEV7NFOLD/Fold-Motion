# FOLD Motion: makes sure this Windows PC has Node.js 20+ and FFmpeg/FFprobe,
# without the Node.js installer and without admin rights.
#
# Called by "Start FOLD Motion.cmd". If a suitable Node.js or FFmpeg is already
# installed, it is used as-is. Otherwise a portable copy is downloaded once into
# the project's .runtime folder (git-ignored), checked against its published
# SHA-256 checksum, and unpacked there. Nothing is installed system-wide.
#
#   .runtime\node\node.exe          portable Node.js (latest LTS, win-x64)
#   .runtime\ffmpeg\bin\ffmpeg.exe  portable FFmpeg + FFprobe (BtbN GPL build, includes libx264)

param([Parameter(Mandatory = $true)][string]$Root)

$ErrorActionPreference = 'Stop'
# The progress bar makes Invoke-WebRequest many times slower on Windows PowerShell 5.
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell 5 may default to old TLS versions that these sites refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Runtime = Join-Path $Root '.runtime'
$NodeDir = Join-Path $Runtime 'node'
$FfmpegDir = Join-Path $Runtime 'ffmpeg'

function Write-Step([string]$Message) { Write-Host "  $Message" }

function Test-NodeExe([string]$Exe) {
  try {
    $version = (& $Exe -p 'process.versions.node' 2>$null | Select-Object -First 1)
    if (-not $version) { return $false }
    return ([int]($version.Trim().Split('.')[0]) -ge 20)
  } catch { return $false }
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-File([string]$Url, [string]$OutFile) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
      return
    } catch {
      if ($attempt -eq 3) { throw "Download failed: $Url ($($_.Exception.Message))" }
      Start-Sleep -Seconds (3 * $attempt)
    }
  }
}

function Assert-Checksum([string]$File, [string]$Expected) {
  $actual = (Get-FileHash -Algorithm SHA256 -Path $File).Hash
  if (-not $Expected -or $actual.ToLowerInvariant() -ne $Expected.Trim().ToLowerInvariant()) {
    Remove-Item $File -Force -ErrorAction SilentlyContinue
    throw "The download $(Split-Path $File -Leaf) didn't match its published checksum, so it was deleted. Check your connection and try again."
  }
}

function Expand-Zip([string]$Zip, [string]$Destination) {
  if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
  New-Item -ItemType Directory -Path $Destination | Out-Null
  # tar.exe ships with Windows 10 (1803+) and unpacks far faster than Expand-Archive.
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) {
    & $tar -xf $Zip -C $Destination
    if ($LASTEXITCODE -eq 0) { return }
  }
  Expand-Archive -Path $Zip -DestinationPath $Destination -Force
}

# Moves the single top-level folder inside an unpacked zip to $Target.
function Move-Unpacked([string]$Unpacked, [string]$Target) {
  $inner = Get-ChildItem -Path $Unpacked -Directory | Select-Object -First 1
  if (-not $inner) { throw "Unexpected archive layout in $Unpacked." }
  if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
  Move-Item -Path $inner.FullName -Destination $Target
  Remove-Item $Unpacked -Recurse -Force -ErrorAction SilentlyContinue
}

function Install-PortableNode {
  Write-Step 'Downloading a portable Node.js (about 30 MB, once)...'
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $release = $index | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
  if (-not $release) { throw 'Could not find a current Node.js LTS release for Windows.' }
  $version = $release.version
  $name = "node-$version-win-x64.zip"
  $base = "https://nodejs.org/dist/$version"
  $zip = Join-Path $Runtime $name
  $sums = Join-Path $Runtime 'node-SHASUMS256.txt'
  Get-File "$base/$name" $zip
  Get-File "$base/SHASUMS256.txt" $sums
  $line = Get-Content $sums | Where-Object { $_ -match ("\s" + [regex]::Escape($name) + '$') } | Select-Object -First 1
  Assert-Checksum $zip ($line -split '\s+')[0]
  $unpacked = Join-Path $Runtime 'node-unpacked'
  Expand-Zip $zip $unpacked
  Move-Unpacked $unpacked $NodeDir
  Remove-Item $zip, $sums -Force -ErrorAction SilentlyContinue
  Write-Step "Node.js $version is ready."
}

function Install-PortableFfmpeg {
  Write-Step 'Downloading a portable FFmpeg (about 150 MB, once)...'
  $base = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
  $name = 'ffmpeg-master-latest-win64-gpl.zip'
  $zip = Join-Path $Runtime $name
  $sums = Join-Path $Runtime 'ffmpeg-checksums.sha256'
  Get-File "$base/$name" $zip
  Get-File "$base/checksums.sha256" $sums
  $line = Get-Content $sums | Where-Object { $_ -match ("\s\*?" + [regex]::Escape($name) + '$') } | Select-Object -First 1
  Assert-Checksum $zip ($line -split '\s+')[0]
  $unpacked = Join-Path $Runtime 'ffmpeg-unpacked'
  Expand-Zip $zip $unpacked
  Move-Unpacked $unpacked $FfmpegDir
  Remove-Item $zip, $sums -Force -ErrorAction SilentlyContinue
  Write-Step 'FFmpeg is ready.'
}

try {
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'FOLD Motion needs 64-bit Windows.'
  }
  New-Item -ItemType Directory -Path $Runtime -Force | Out-Null

  $portableNode = Join-Path $NodeDir 'node.exe'
  $systemNode = (Test-Command 'node') -and (Test-NodeExe 'node')
  if (-not $systemNode -and -not (Test-NodeExe $portableNode)) { Install-PortableNode }

  $portableFfmpeg = Join-Path $FfmpegDir 'bin\ffmpeg.exe'
  $portableFfprobe = Join-Path $FfmpegDir 'bin\ffprobe.exe'
  $systemFfmpeg = (Test-Command 'ffmpeg') -and (Test-Command 'ffprobe')
  if (-not $systemFfmpeg -and -not ((Test-Path $portableFfmpeg) -and (Test-Path $portableFfprobe))) { Install-PortableFfmpeg }

  exit 0
} catch {
  Write-Host ''
  Write-Host "Setup couldn't finish: $($_.Exception.Message)"
  Write-Host 'Check your internet connection and double-click Start FOLD Motion again.'
  Write-Host 'You can also install Node.js (LTS) from https://nodejs.org and FFmpeg yourself.'
  exit 1
}
