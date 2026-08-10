param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Lifecycle", "ApiFailure", "Performance", "UpdaterInstall", "Evaluate")]
    [string]$Mode,

    [string]$AppExecutable,
    [Parameter(Mandatory = $true)]
    [string[]]$EvidencePath,
    [string]$PolicyPath,
    [string]$OutputPath,
    [string]$ApiUrl,
    [int]$TimeoutSeconds = 300,
    [switch]$ResetEvidence,

    [string]$InstallerPath,
    [string]$SignaturePath,
    [string]$LatestJsonPath,
    [string]$TauriConfigPath,
    [string]$ExpectedReleaseUrl,
    [string]$ExpectedNewVersion
)

$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
$script:ActiveEvidencePath = $null

function Assert-WindowsHost {
    if (-not $IsWindows) {
        throw "Windows acceptance phases require Windows; no acceptance claim was produced."
    }
}

function Assert-File {
    param([string]$Path, [string]$Label)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label does not exist: $Path"
    }
}

function Initialize-PhaseEvidence {
    if ($EvidencePath.Count -ne 1) { throw "$Mode mode requires exactly one fresh -EvidencePath" }
    $script:ActiveEvidencePath = [System.IO.Path]::GetFullPath($EvidencePath[0])
    if (Test-Path -LiteralPath $script:ActiveEvidencePath) {
        if (-not $ResetEvidence) { throw "Evidence already exists; use a fresh path or explicit -ResetEvidence" }
        Remove-Item -LiteralPath $script:ActiveEvidencePath -Force
    }
    $parent = Split-Path -Parent $script:ActiveEvidencePath
    if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
}

function Read-EvidenceRecords {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $records = @()
    foreach ($line in [System.IO.File]::ReadLines($resolved)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $record = $line | ConvertFrom-Json } catch { throw "Invalid acceptance JSONL record in $Path" }
        if (-not $record.sessionId) { throw "Acceptance record is missing sessionId in $Path" }
        $records += $record
    }
    return $records
}

function Write-EvidenceRecord {
    param([hashtable]$Record)
    $line = ($Record | ConvertTo-Json -Compress -Depth 8) + [Environment]::NewLine
    [System.IO.File]::AppendAllText($script:ActiveEvidencePath, $line, [System.Text.UTF8Encoding]::new($false))
}

function Get-SingleSessionId {
    param([Parameter(Mandatory = $true)][string]$Path)
    $sessions = @(Read-EvidenceRecords $Path | Select-Object -ExpandProperty sessionId -Unique)
    if ($sessions.Count -ne 1) { throw "Evidence must contain exactly one session in $Path" }
    return [string]$sessions[0]
}

function Wait-ForCheck {
    param([string]$Name, [string]$SessionId, [datetime]$After = [datetime]::MinValue)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $matches = @(Read-EvidenceRecords $script:ActiveEvidencePath | Where-Object {
            $_.type -eq "check" -and $_.name -eq $Name -and
            (-not $SessionId -or $_.sessionId -eq $SessionId) -and
            ([datetime]$_.observedAt) -gt $After
        } | Sort-Object { [datetime]$_.observedAt })
        if ($matches.Count -gt 0) { return $matches[-1] }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for current-session acceptance check: $Name"
}

function Wait-ForWorkload {
    param([object]$Policy, [string]$SessionId)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $samples = @(Read-EvidenceRecords $script:ActiveEvidencePath | Where-Object {
            $_.type -eq "opponent_rendered" -and $_.sessionId -eq $SessionId -and
            $_.ranked -eq $true -and $_.outcome -eq "opponent_rendered"
        })
        $modeSatisfied = $true
        foreach ($mode in @("ranked1v1", "ranked2v2", "ranked3v3")) {
            $required = [int]$Policy.requiredModeSamples.$mode
            $observed = @($samples | Where-Object { $_.mode -eq $mode }).Count
            if ($observed -lt $required) { $modeSatisfied = $false }
        }
        if ($samples.Count -ge [int]$Policy.minimumSamples -and $modeSatisfied) { return }
        Write-Progress -Activity "Windows opponent presentation workload" -Status "$($samples.Count) / $($Policy.minimumSamples) samples"
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for the owner-approved ranked mode mix"
}

function Start-AcceptanceApp {
    param([string]$FailureApiUrl)
    Assert-File $AppExecutable "Installed desktop executable"
    $previousEvidence = $env:BRAWLTOME_WINDOWS_ACCEPTANCE_EVIDENCE
    $previousApi = $env:BRAWLTOME_API_URL
    try {
        $env:BRAWLTOME_WINDOWS_ACCEPTANCE_EVIDENCE = $script:ActiveEvidencePath
        if ($FailureApiUrl) { $env:BRAWLTOME_API_URL = $FailureApiUrl } else { $env:BRAWLTOME_API_URL = $null }
        return Start-Process -FilePath $AppExecutable -PassThru
    } finally {
        $env:BRAWLTOME_WINDOWS_ACCEPTANCE_EVIDENCE = $previousEvidence
        $env:BRAWLTOME_API_URL = $previousApi
    }
}

function Invoke-LifecyclePhase {
    Assert-WindowsHost
    Initialize-PhaseEvidence
    $app = Start-AcceptanceApp
    Read-Host "Start Brawlhalla and sign in, then press Enter"
    $detected = Wait-ForCheck "gameProcessDetected"
    $sessionId = [string]$detected.sessionId
    Wait-ForCheck "processAttached" $sessionId | Out-Null
    Wait-ForCheck "detectionReady" $sessionId | Out-Null
    Wait-ForCheck "overlayVisible" $sessionId | Out-Null
    Wait-ForCheck "overlayAlwaysOnTop" $sessionId | Out-Null

    Read-Host "Move the pointer over interactive overlay content and then out; press Enter"
    $disabled = Wait-ForCheck "clickThroughDisabled" $sessionId
    Wait-ForCheck "clickThroughEnabled" $sessionId ([datetime]$disabled.observedAt) | Out-Null

    Read-Host "Use the tray menu to hide and then show the overlay; press Enter"
    $hidden = Wait-ForCheck "trayHidden" $sessionId
    Wait-ForCheck "trayShown" $sessionId ([datetime]$hidden.observedAt) | Out-Null

    Read-Host "Close Brawlhalla; press Enter"
    Wait-ForCheck "processDetached" $sessionId | Out-Null
    Read-Host "Quit BrawlTome through its tray menu; press Enter"
    Wait-ForCheck "trayQuit" $sessionId | Out-Null
    if (-not $app.WaitForExit($TimeoutSeconds * 1000)) { throw "BrawlTome did not exit through the tray" }
    if ((Get-SingleSessionId $script:ActiveEvidencePath) -ne $sessionId) { throw "Lifecycle evidence mixed sessions" }
}

function Invoke-ApiFailurePhase {
    Assert-WindowsHost
    Initialize-PhaseEvidence
    $failureUrl = if ($ApiUrl) { $ApiUrl } else { "http://127.0.0.1:9" }
    $app = Start-AcceptanceApp $failureUrl
    Read-Host "With Brawlhalla running, enter a ranked match to exercise generated lookup failure; press Enter"
    $failed = Wait-ForCheck "apiFailurePresented"
    $sessionId = [string]$failed.sessionId
    Wait-ForCheck "appSurvivedApiFailure" $sessionId ([datetime]$failed.observedAt).AddMilliseconds(-1) | Out-Null
    if ($app.HasExited) { throw "BrawlTome exited during API failure presentation" }
    Read-Host "Quit BrawlTome through its tray menu; press Enter"
    Wait-ForCheck "trayQuit" $sessionId | Out-Null
    if ((Get-SingleSessionId $script:ActiveEvidencePath) -ne $sessionId) { throw "API failure evidence mixed sessions" }
}

function Invoke-PerformancePhase {
    Assert-WindowsHost
    Initialize-PhaseEvidence
    Assert-File $PolicyPath "Acceptance policy"
    $policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
    $app = Start-AcceptanceApp
    Read-Host "Start Brawlhalla, then perform the exact owner-approved ranked workload; press Enter"
    $detected = Wait-ForCheck "gameProcessDetected"
    $sessionId = [string]$detected.sessionId
    Wait-ForWorkload $policy $sessionId
    if ($app.HasExited) { throw "BrawlTome exited during the performance workload" }
    Read-Host "Quit BrawlTome through its tray menu; press Enter"
    Wait-ForCheck "trayQuit" $sessionId | Out-Null
    if ((Get-SingleSessionId $script:ActiveEvidencePath) -ne $sessionId) { throw "Performance evidence mixed sessions" }
}

function Invoke-UpdaterInstallPhase {
    Assert-WindowsHost
    Initialize-PhaseEvidence
    foreach ($artifact in @(
        @{ Path = $InstallerPath; Label = "Updater installer" },
        @{ Path = $SignaturePath; Label = "Updater signature" },
        @{ Path = $LatestJsonPath; Label = "latest.json" },
        @{ Path = $TauriConfigPath; Label = "Tauri configuration" }
    )) { Assert-File $artifact.Path $artifact.Label }
    Assert-File $AppExecutable "Previously installed desktop executable"
    if (-not $ExpectedReleaseUrl -or -not $ExpectedNewVersion) {
        throw "UpdaterInstall requires -ExpectedReleaseUrl and -ExpectedNewVersion"
    }

    $config = Get-Content -LiteralPath $TauriConfigPath -Raw | ConvertFrom-Json
    $endpoint = [string]$config.plugins.updater.endpoints[0]
    if (-not $endpoint.StartsWith("https://")) { throw "Updater endpoint must use HTTPS" }
    $publishedLatestPath = "$($script:ActiveEvidencePath).latest.json"
    $publishedInstallerPath = "$($script:ActiveEvidencePath).installer.exe"
    Invoke-WebRequest -Uri $endpoint -OutFile $publishedLatestPath
    $published = Get-Content -LiteralPath $publishedLatestPath -Raw | ConvertFrom-Json
    if ($published.version -ne $ExpectedNewVersion -or $published.platforms.'windows-x86_64'.url -ne $ExpectedReleaseUrl) {
        throw "Published updater metadata does not match the expected release"
    }
    $publishedSignaturePath = "$($script:ActiveEvidencePath).installer.exe.sig"
    [System.IO.File]::WriteAllText(
        $publishedSignaturePath,
        [string]$published.platforms.'windows-x86_64'.signature,
        [System.Text.UTF8Encoding]::new($false)
    )
    Invoke-WebRequest -Uri $ExpectedReleaseUrl -OutFile $publishedInstallerPath

    Push-Location $DesktopRoot
    try {
        $localVerification = & cargo run --locked -p brawltome-desktop --bin verify_updater_artifact -- `
            $InstallerPath $SignaturePath $LatestJsonPath $TauriConfigPath $ExpectedReleaseUrl
        if ($LASTEXITCODE -ne 0) { throw "Local updater artifact verification failed" }
        $publishedVerification = & cargo run --locked -p brawltome-desktop --bin verify_updater_artifact -- `
            $publishedInstallerPath $publishedSignaturePath $publishedLatestPath $TauriConfigPath $ExpectedReleaseUrl
        if ($LASTEXITCODE -ne 0) { throw "Published updater artifact verification failed" }
    } finally { Pop-Location }
    $localVerified = $localVerification | ConvertFrom-Json
    $publishedVerified = $publishedVerification | ConvertFrom-Json
    if (-not $localVerified.signatureVerified -or -not $publishedVerified.signatureVerified -or
        $localVerified.updaterInstallClaim -or $publishedVerified.updaterInstallClaim) {
        throw "Updater verifier returned an unsafe claim"
    }
    if ($localVerified.installerSha256 -ne $publishedVerified.installerSha256) {
        throw "Published updater differs from the verified release artifact"
    }

    $oldVersion = (Get-Item -LiteralPath $AppExecutable).VersionInfo.ProductVersion
    if ($oldVersion -eq $ExpectedNewVersion) { throw "Updater smoke requires an older installed build" }
    $oldProcess = Start-Process -FilePath $AppExecutable -PassThru
    $processName = [System.IO.Path]::GetFileNameWithoutExtension($AppExecutable)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $newProcess = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        $currentVersion = (Get-Item -LiteralPath $AppExecutable).VersionInfo.ProductVersion
        if ($oldProcess.HasExited -and $currentVersion -eq $ExpectedNewVersion) {
            $newProcess = Get-Process -Name $processName -ErrorAction SilentlyContinue |
                Where-Object { $_.Id -ne $oldProcess.Id -and $_.Path -eq $AppExecutable } |
                Select-Object -First 1
            if ($newProcess) { break }
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $oldProcess.HasExited) { throw "Original desktop process did not exit for updater installation" }
    if ((Get-Item -LiteralPath $AppExecutable).VersionInfo.ProductVersion -ne $ExpectedNewVersion) {
        throw "Updater did not replace $oldVersion with $ExpectedNewVersion"
    }
    if (-not $newProcess) { throw "Updated desktop process did not relaunch from the expected path" }

    $after = Invoke-RestMethod -Uri $endpoint
    if ($after.version -ne $published.version -or
        $after.platforms.'windows-x86_64'.url -ne $published.platforms.'windows-x86_64'.url -or
        $after.platforms.'windows-x86_64'.signature -ne $published.platforms.'windows-x86_64'.signature) {
        throw "Published updater metadata changed during installation"
    }
    $sessionId = "updater-$([guid]::NewGuid())"
    foreach ($name in @("updaterSignatureVerified", "updaterInstalled", "updaterRelaunched", "updaterVersionReplaced")) {
        Write-EvidenceRecord @{
            type = "check"
            name = $name
            sessionId = $sessionId
            installerSha256 = $publishedVerified.installerSha256
            releaseUrl = $ExpectedReleaseUrl
            observedAt = [DateTime]::UtcNow.ToString("o")
        }
    }
}

function Invoke-Evaluation {
    Assert-WindowsHost
    Assert-File $PolicyPath "Acceptance policy"
    if (-not $OutputPath) { throw "Evaluate mode requires -OutputPath" }
    if ($EvidencePath.Count -ne 4) {
        throw "Evaluate mode requires four fresh phase artifacts: lifecycle, API failure, performance, updater"
    }
    $resolvedPaths = @($EvidencePath | ForEach-Object { Assert-File $_ "Phase evidence"; (Resolve-Path $_).Path })
    if (@($resolvedPaths | Select-Object -Unique).Count -ne 4) { throw "Phase evidence paths must be distinct" }
    $phaseRecords = @{}
    foreach ($path in $resolvedPaths) {
        $records = @(Read-EvidenceRecords $path)
        if (@($records | Select-Object -ExpandProperty sessionId -Unique).Count -ne 1) {
            throw "Each phase artifact must contain exactly one session: $path"
        }
        if ($records | Where-Object { $_.name -eq "updaterInstalled" }) {
            $phaseRecords.updater = $records
        } elseif ($records | Where-Object { $_.name -eq "apiFailurePresented" }) {
            $phaseRecords.apiFailure = $records
        } elseif (($records | Where-Object { $_.name -eq "processDetached" }) -and
                  ($records | Where-Object { $_.name -eq "trayHidden" })) {
            $phaseRecords.lifecycle = $records
        } elseif ($records | Where-Object { $_.type -eq "opponent_rendered" -and $_.outcome -eq "opponent_rendered" }) {
            $phaseRecords.performance = $records
        }
    }
    foreach ($phase in @("lifecycle", "apiFailure", "performance", "updater")) {
        if (-not $phaseRecords[$phase]) { throw "Missing distinct $phase phase evidence" }
    }

    $policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
    $os = Get-CimInstance Win32_OperatingSystem
    $computer = Get-CimInstance Win32_ComputerSystem
    $displayVersion = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").DisplayVersion
    $records = @($phaseRecords.Values | ForEach-Object { $_ })
    $checks = @{}
    foreach ($record in $records | Where-Object { $_.type -eq "check" }) { $checks[$record.name] = $true }
    $samples = @($phaseRecords.performance | Where-Object {
        $_.type -eq "opponent_rendered" -and $_.ranked -eq $true -and $_.outcome -eq "opponent_rendered"
    } | ForEach-Object {
        @{ id = $_.sampleId; durationMs = [int64]$_.durationMs; outcome = "opponent-rendered"; mode = $_.mode }
    })

    $evidence = @{
        schema = 1
        status = "observed"
        observedAt = [DateTime]::UtcNow.ToString("o")
        platform = @{
            productName = $os.Caption
            displayVersion = $displayVersion
            build = [int]$os.BuildNumber
            productType = [int]$os.ProductType
            hardware = "$($computer.Manufacturer) $($computer.Model)".Trim()
        }
        workload = @{ id = $policy.workloadId; samples = $samples }
        checks = $checks
        claims = @{ windows11 = $false; hardware = $false; updaterInstall = $false; performance = $false }
    }
    $parent = Split-Path -Parent $OutputPath
    if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
    [System.IO.File]::WriteAllText(
        $OutputPath,
        ($evidence | ConvertTo-Json -Depth 10),
        [System.Text.UTF8Encoding]::new($false)
    )
    & bun run (Join-Path $DesktopRoot "src/windows-acceptance.ts") $OutputPath $PolicyPath
    if ($LASTEXITCODE -ne 0) { throw "Windows acceptance remains failed or pending; inspect evaluator output" }
}

switch ($Mode) {
    "Lifecycle" { Invoke-LifecyclePhase }
    "ApiFailure" { Invoke-ApiFailurePhase }
    "Performance" { Invoke-PerformancePhase }
    "UpdaterInstall" { Invoke-UpdaterInstallPhase }
    "Evaluate" { Invoke-Evaluation }
}
