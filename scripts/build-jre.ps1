# build-jre.ps1 — Build a trimmed JRE for Windows using jlink.
#
# Prerequisites:
#   - A JDK 21+ must be on PATH (tested with Eclipse Adoptium / Temurin)
#   - Run this script from the repository root:
#       .\scripts\build-jre.ps1
#
# Output:
#   src-tauri\resources\jre-windows\

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $RootDir "src-tauri\resources\jre-windows"

# Modules required by PlantUML
$Modules = "java.base,java.desktop,java.xml,java.naming,java.datatransfer,java.prefs"

Write-Host "==> Building JRE for windows -> $OutDir"

if (Test-Path $OutDir) {
    Remove-Item -Recurse -Force $OutDir
}

& jlink `
    --add-modules $Modules `
    --strip-debug `
    --no-man-pages `
    --no-header-files `
    --compress=2 `
    --output $OutDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "jlink failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

$size = (Get-ChildItem $OutDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("    Done. Size: {0:N1} MB" -f $size)
Write-Host ""
Write-Host "JRE build complete."
