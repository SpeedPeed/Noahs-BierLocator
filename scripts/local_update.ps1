# Wöchentliches Preis-Update vom eigenen PC aus — für Ketten, die GitHub-Server
# blockieren (SPAR Österreich, Migros) und PENNY Deutschland als Nachzügler.
# Wird von der Windows-Aufgabe "Bier-Locator Preise" gestartet; manuell:
#   powershell -ExecutionPolicy Bypass -File scripts\local_update.ps1
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot 'local_update.log'
Set-Location $repo
$env:PYTHONIOENCODING = 'utf-8'

function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm')  $msg" | Out-File -Append -Encoding utf8 $log }

Log '--- Start'
git pull --rebase --autostash -q origin main 2>&1 | ForEach-Object { Log "git: $_" }

python scripts/scrape_prices.py at_spar ch_migros de_penny 2>&1 | ForEach-Object { Log $_ }

git diff --quiet -- data/
if ($LASTEXITCODE -eq 0) {
    Log 'Keine Preisänderungen.'
} else {
    git add data/
    git commit -q -m "Bierpreise aktualisiert: SPAR, Migros, PENNY DE ($(Get-Date -Format 'yyyy-MM-dd'), lokal)"
    git push -q origin main 2>&1 | ForEach-Object { Log "git: $_" }
    if ($LASTEXITCODE -eq 0) { Log 'Gepusht.' } else { Log 'Push fehlgeschlagen.' }
}
Log '--- Ende'
