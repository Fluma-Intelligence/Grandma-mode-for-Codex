param(
    [switch]$RunOnce,
    [switch]$Disable,
    [string]$ProfileRoot = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' })
)

$ErrorActionPreference = 'Stop'
$taskName = 'Grandma Mode GitHub Update'
$taskScript = Join-Path $profileRoot 'grandma-mode\grandma-auto-update.ps1'

if ($Disable) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    return
}

if (-not $RunOnce) {
    $taskDirectory = Split-Path -Parent $taskScript
    New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
    if ($PSCommandPath -ne $taskScript) { Copy-Item -LiteralPath $PSCommandPath -Destination $taskScript -Force }

    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $action = New-ScheduledTaskAction -Execute $windowsPowerShell `
        -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -RunOnce -ProfileRoot "{1}"' -f $taskScript, $profileRoot) `
        -WorkingDirectory $taskDirectory
    $triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $account)
    foreach ($hour in 0, 6, 12, 18) {
        $triggers += New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours($hour))
    }
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal `
        -Settings $settings -Description 'Refresh the Grandma Mode GitHub marketplace for Codex.' -Force | Out-Null
    return
}

$codex = (Get-Command codex.exe -ErrorAction SilentlyContinue).Source
if (-not $codex) {
    $desktop = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    if ($desktop) { $codex = Join-Path $desktop.InstallLocation 'app\resources\codex.exe' }
}
if (-not $codex -or -not (Test-Path -LiteralPath $codex -PathType Leaf)) { throw 'Codex CLI was not found.' }

# Use the same Codex profile when Windows runs the task from outside the app.
$env:CODEX_HOME = $profileRoot
$marketplaces = & $codex plugin marketplace list --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$marketplace = $marketplaces.marketplaces | Where-Object name -eq 'grandma-mode'
$source = $marketplace.marketplaceSource
if ($source.sourceType -ne 'git' -or $source.source -notmatch '^https://github\.com/Fluma-Intelligence/Grandma-mode-for-Codex(?:\.git)?/?$') {
    throw 'The Grandma Mode GitHub marketplace is not configured.'
}
$plugins = & $codex plugin list --marketplace grandma-mode --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$installed = $plugins.installed | Where-Object { $_.pluginId -eq 'plain-speech@grandma-mode' -and $_.enabled }
if (-not $installed) { return }

$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'
$gitConfig = $null
try {
    $gh = Get-Command gh.exe -ErrorAction SilentlyContinue
    if ($gh) {
        & $gh.Source auth status --hostname github.com *> $null
        if ($LASTEXITCODE -eq 0) {
            $gitConfig = New-TemporaryFile
            $ghPath = $gh.Source.Replace('\', '/')
            @"
[credential]
    helper =
[credential "https://github.com"]
    helper = !'$ghPath' auth git-credential
[core]
    longpaths = true
"@ | Set-Content -LiteralPath $gitConfig.FullName -Encoding ascii
            $env:GIT_CONFIG_GLOBAL = $gitConfig.FullName
            $env:GIT_CONFIG_NOSYSTEM = '1'
        }
    }
    & $codex plugin marketplace upgrade grandma-mode --json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # A failed earlier refresh may have updated the Git checkout before it could replace the cache.
    # Retrying a same-version update needs to check the installed files, not just the Git revision.
    $sourcePlugin = Join-Path $marketplace.root 'plugins\plain-speech'
    $version = (Get-Content -Raw -LiteralPath (Join-Path $sourcePlugin 'plugin.json') -Encoding UTF8 | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'The plugin version is invalid.' }
    $installedPlugin = Join-Path $profileRoot "plugins\cache\grandma-mode\plain-speech\$version"
    $pkgFiles = @(& git -C $sourcePlugin -c core.quotepath=false ls-files)
    if ($LASTEXITCODE -ne 0 -or -not $pkgFiles) { throw 'Could not read the downloaded package files.' }
    foreach ($file in $pkgFiles) {
        $localFile = Join-Path $installedPlugin $file
        if (-not (Test-Path -LiteralPath $localFile -PathType Leaf) -or
            (Get-FileHash -LiteralPath $localFile).Hash -ne (Get-FileHash -LiteralPath (Join-Path $sourcePlugin $file)).Hash) {
            & $codex plugin add plain-speech@grandma-mode --json
            exit $LASTEXITCODE
        }
    }
} finally {
    if ($gitConfig) { Remove-Item -LiteralPath $gitConfig.FullName -ErrorAction SilentlyContinue }
}
