#Requires -Version 5.1
<#
.SYNOPSIS
    Runs the Noor AI Tier B gateway tests against a disposable local Supabase stack.

.DESCRIPTION
    Tier B asserts what `verify_jwt` does, and that is enforced by the platform rather than by
    anything in this repository. So the only honest way to run those rows is against a real Edge
    gateway. This script brings one up, runs the suite against it, and destroys it again.

    ── The part that needs care: §J.2b ──────────────────────────────────────────
    Three of the four §J authentication rows need nothing but a URL. §J.2b needs a token that is
    *correctly signed* — signed by the key the gateway actually trusts — whose `exp` has passed. A
    token signed by any other key is §J.2a, a different row. That requirement kept §J.2b blocked
    for a long time, because §B.2 forbids key material entering this repository.

    What makes it runnable is that the key involved is not a credential of the hosted project. It
    belongs to a stack this script creates and deletes in the same run. The handling rules are
    still strict, and they are the reason this file exists rather than a README paragraph:

      • the secret is read from `supabase status -o json` into a variable and is never printed,
        never echoed, never written to a file and never placed on a command line;
      • it is assigned to the *child* process's environment block only (see `ProcessStartInfo`
        below), so it never enters this shell's environment and cannot leak into any other child;
      • a `finally` clears it and tears the stack down whether the tests pass, fail or throw;
      • nothing here is committed but the procedure. There is no key in this file, and there is no
        code path that would put one here.

    The token itself is minted inside the Deno test process, used once against 127.0.0.1, and
    discarded when that process exits.

    ── Why credential-bearing output is suppressed rather than filtered ─────────
    An earlier version of this script passed `supabase start` output through a filter that dropped
    lines matching known credential labels. That is the wrong shape of control: it can only remove
    what it recognises, so a CLI that one day prints a secret under a new label, in a new format, or
    on a stream the filter never saw would print it to the terminal and to whatever captured that
    terminal. The filter's failure mode is silent and its blast radius is a leaked key.

    Every external command that can emit a credential is therefore run through
    `Invoke-QuietProcess`, which redirects **both** stdout and stderr into this process. Nothing
    renders them:

      • `supabase start` — output captured, and on success discarded entirely;
      • `supabase status -o json` — captured into a variable, parsed in memory, never rendered, and
        removed as soon as the two fields Tier B needs have been read;
      • `supabase functions serve` — both pipes redirected and drained into memory so the runtime
        cannot block on a full buffer, and never read. Request-level runtime logging can carry an
        `Authorization` header value, so it is suppressed for the same reason;
      • `supabase stop --no-backup`, `docker ps`, `docker volume ls` — captured; only derived counts
        are printed.

    On failure this script reports the command name, its exit code, and a fixed diagnostic sentence.
    It never prints captured output, on any path, including the failure path — a diagnostic that
    echoes what a command printed is the same leak with a different trigger.

    The one child whose streams are deliberately left inherited is `deno test`. Its output is the
    Tier B result and has to be readable, it is produced by this repository's own assertions, and
    `gateway-integration_test.ts` compares tokens as booleans precisely so that no serialised token
    or secret can reach an assertion message.

    ── What this script will not do ─────────────────────────────────────────────
    It never passes `--no-verify-jwt`, which would disable the single control Tier B exists to
    test. It runs no remote Supabase command — no `link`, `db push`, `functions deploy` or
    `secrets set` — and contacts no provider.

    ── If `supabase start` cannot bind a port on Windows ────────────────────────
    Hyper-V reserves shifting blocks of TCP ports, and `netsh interface ipv4 show excludedportrange
    protocol=tcp` will show whether config.toml's `[api]`/`[db]` ports currently fall inside one.
    They are machine-specific and move across reboots. Retarget the ports in `supabase/config.toml`
    for the run and put them back afterwards — nothing in Tier B depends on a particular port,
    because the gateway URL is read from `supabase status` rather than assumed.

.PARAMETER SupabaseCli
    Path to the Supabase CLI. Defaults to `supabase` on PATH. The CLI is deliberately not a
    dependency of this repository; `npx --yes supabase@<version>` resolves one without adding it to
    package.json.

.PARAMETER DenoExe
    Path to the Deno executable. Defaults to `deno` on PATH.

.PARAMETER ExcludedServices
    Stack services Tier B does not need. Excluding them keeps startup fast and, on Windows, keeps
    the stack clear of ports the OS may have reserved. The gateway path under test — Kong, Auth and
    the edge runtime — is never excluded.

.EXAMPLE
    ./run-tier-b.ps1 -SupabaseCli C:\tools\supabase.exe -DenoExe C:\tools\deno.exe
#>
[CmdletBinding()]
param(
    [string] $SupabaseCli = 'supabase',
    [string] $DenoExe = 'deno',
    [string[]] $ExcludedServices = @(
        'studio', 'imgproxy', 'mailpit', 'logflare', 'vector',
        'supavisor', 'realtime', 'storage-api', 'postgres-meta'
    )
)

$ErrorActionPreference = 'Stop'

$testsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$functionsDir = (Resolve-Path (Join-Path (Join-Path $testsDir '..') '..')).ProviderPath
$repoRoot = (Resolve-Path (Join-Path (Join-Path $functionsDir '..') '..')).ProviderPath

$serveProcess = $null
$serveStdOutTask = $null
$serveStdErrTask = $null
$stackStarted = $false
$gatewayUri = $null
$psi = $null
# A failure anywhere below must not exit 0. Only a completed Tier B run overwrites this.
$testExitCode = 1

function Write-Step([string] $Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

<#
    Run an external command with both of its streams redirected into this process.

    Redirection rather than filtering is the whole point. `& cli …` in PowerShell leaves stderr
    attached to the console, so anything the CLI writes there reaches the terminal before this
    script can see it — and `2>&1` is not the fix, because under `$ErrorActionPreference = 'Stop'`
    it turns ordinary progress lines into fatal ErrorRecords. `ProcessStartInfo` with both
    `Redirect*` flags set is the only arrangement that guarantees *neither* stream can reach a
    console this script does not control.

    The function's only pipeline output is the integer exit code, deliberately: a helper that
    returned an object carrying the captured text would print that text the first time a caller
    forgot to assign it. Captured stdout is handed back only through the `-StdOut` reference
    parameter, which the caller must ask for explicitly.
#>
function Invoke-QuietProcess {
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [Parameter(Mandatory)][string] $WorkingDirectory,
        # Untyped on purpose: a `[ref]`-typed parameter applies a transformation that rejects the
        # `$null` default outright ("Reference type is expected in argument"), so every caller that
        # wants nothing back would have to pass a throwaway reference. The `-is` check below is the
        # type check instead, and it is stricter than the annotation would have been.
        $StdOut = $null
    )

    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $FilePath
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    # `Arguments` rather than `ArgumentList`, which .NET Framework — and so Windows PowerShell 5.1 —
    # does not have.
    $info.Arguments = (($ArgumentList | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }) -join ' ')

    $process = [System.Diagnostics.Process]::Start($info)
    # Both pipes are read concurrently. Reading one to completion first deadlocks as soon as the
    # other fills its buffer, which for a chatty CLI is a hang rather than a leak — but a hang here
    # would invite someone to "just let it print", so it is avoided rather than tolerated.
    $outTask = $process.StandardOutput.ReadToEndAsync()
    $errTask = $process.StandardError.ReadToEndAsync()
    $captured = $outTask.Result
    $errTask.Result | Out-Null
    $process.WaitForExit()
    $code = $process.ExitCode
    $process.Dispose()

    if ($StdOut -is [System.Management.Automation.PSReference]) { $StdOut.Value = $captured }
    $captured = $null

    return $code
}

try {
    Write-Step 'Starting a disposable local Supabase stack'
    # `supabase start` prints the stack's keys on completion. Its output is captured on both streams
    # and never rendered: on success it is discarded unread, and on failure only the exit code and a
    # fixed sentence below are reported.
    $startCode = Invoke-QuietProcess -FilePath $SupabaseCli `
        -ArgumentList @('start', '-x', ($ExcludedServices -join ',')) -WorkingDirectory $repoRoot
    if ($startCode -ne 0) {
        # No "re-run it yourself to see the output" advice here. That output carries the stack's keys,
        # so inviting a developer to reproduce it unsuppressed would undo the control this whole
        # script exists to hold. The message points at the prerequisites instead, which are what
        # actually fail. (ASCII only in the string: this file has no BOM, so Windows PowerShell 5.1
        # decodes it as ANSI and a UTF-8 em dash would arrive as a quote that closes the string.)
        throw "supabase start failed with exit code $startCode. Its stdout and stderr were suppressed for credential safety, because that output carries the stack's keys. Check the local prerequisites and configuration (Docker running, and the ports in supabase/config.toml free) without displaying credential-bearing output."
    }
    $stackStarted = $true

    # Read the stack's own credentials. Captured into a variable; never rendered.
    $statusJson = $null
    $statusCode = Invoke-QuietProcess -FilePath $SupabaseCli -ArgumentList @('status', '-o', 'json') `
        -WorkingDirectory $repoRoot -StdOut ([ref] $statusJson)
    if ($statusCode -ne 0) {
        $statusJson = $null
        throw "supabase status failed with exit code $statusCode. Its output was captured and is not rendered, because it carries the stack's keys."
    }
    try {
        $status = $statusJson | ConvertFrom-Json
    } catch {
        # Deliberately not `throw $_`: a parser error message quotes the text it could not parse,
        # and that text is the credential dump.
        throw 'supabase status -o json did not return parsable JSON. Its output was captured and is not rendered.'
    } finally {
        $statusJson = $null
        Remove-Variable statusJson -ErrorAction SilentlyContinue
    }

    $apiUrl = [string] $status.API_URL
    $signingSecret = [string] $status.JWT_SECRET
    $status = $null
    Remove-Variable status

    if ([string]::IsNullOrWhiteSpace($signingSecret)) {
        # Reported as a length-free absence. §J.2b is skipped rather than approximated: a token this
        # script could not sign correctly would be §J.2a wearing §J.2b's name.
        throw 'The local stack exposed no JWT signing secret, so §J.2b cannot be run honestly.'
    }

    $gatewayUri = [System.Uri] "$apiUrl/functions/v1/noor-ai"
    $netAllow = "$($gatewayUri.Host):$($gatewayUri.Port)"
    Write-Step "Gateway: $gatewayUri"

    Write-Step 'Serving the function (verify_jwt honoured; no bypass flag)'
    <#
        Started through ProcessStartInfo rather than Start-Process because only the former can
        redirect a long-running child's streams into memory. Start-Process can redirect to a *file*,
        which this script must not do: the runtime logs requests, a request carries an
        `Authorization` header, and §B.2's rule is that no credential reaches a file at all.
    #>
    $serveInfo = New-Object System.Diagnostics.ProcessStartInfo
    $serveInfo.FileName = $SupabaseCli
    $serveInfo.Arguments = 'functions serve'
    $serveInfo.WorkingDirectory = $repoRoot
    $serveInfo.UseShellExecute = $false
    $serveInfo.RedirectStandardOutput = $true
    $serveInfo.RedirectStandardError = $true
    $serveInfo.CreateNoWindow = $true
    $serveProcess = [System.Diagnostics.Process]::Start($serveInfo)
    # Drained so the runtime cannot stall on a full pipe, and never read. The tasks exist to consume
    # the streams, not to produce a value; nothing in this script inspects their results.
    $serveStdOutTask = $serveProcess.StandardOutput.ReadToEndAsync()
    $serveStdErrTask = $serveProcess.StandardError.ReadToEndAsync()

    $deadline = (Get-Date).AddSeconds(120)
    $ready = $false
    while (-not $ready -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 1500
        if ($serveProcess.HasExited) {
            throw "supabase functions serve exited early with exit code $($serveProcess.ExitCode). Its output was captured and is not rendered."
        }
        try {
            Invoke-WebRequest -Uri $gatewayUri -Method POST -UseBasicParsing -TimeoutSec 5 | Out-Null
            $ready = $true
        } catch {
            # A 401 is the expected answer to an unauthenticated probe and means the gateway is up.
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 401) { $ready = $true }
        }
    }
    if (-not $ready) { throw 'The local gateway did not become reachable.' }

    Write-Step 'Running Tier B'
    <#
        The secret is placed in the child's environment block and nowhere else. `$env:` is
        deliberately not used: that would put it in this shell's environment, where every later
        child would inherit it. ProcessStartInfo scopes it to exactly the process that needs it,
        and the block dies with that process.

        This child's streams are the one pair left inherited, so its results are readable. That is
        safe for a specific, checked reason rather than by assumption: the output is this
        repository's own test output, the suite prints no token and no secret, and the §J.2b
        assertions compare tokens as booleans so that a *failure* cannot print one either.

        Network permission is scoped to the local gateway's host and port, so the suite cannot
        reach anything else even if a future test tried to.
    #>
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $DenoExe
    $psi.WorkingDirectory = $functionsDir
    $psi.UseShellExecute = $false
    # `Arguments` rather than `ArgumentList`, which .NET Framework — and so Windows PowerShell 5.1 —
    # does not have. Only flags and paths go here. The secret never appears on a command line.
    $psi.Arguments = @(
        'test', '--no-remote', '--no-npm',
        "--allow-read=`"$repoRoot`"",
        '--allow-env=NOOR_AI_GATEWAY_URL,NOOR_AI_LOCAL_GATEWAY_JWT_SECRET',
        "--allow-net=$netAllow",
        'noor-ai/tests'
    ) -join ' '
    $psi.Environment['NOOR_AI_GATEWAY_URL'] = [string] $gatewayUri
    $psi.Environment['NOOR_AI_LOCAL_GATEWAY_JWT_SECRET'] = $signingSecret

    $deno = [System.Diagnostics.Process]::Start($psi)
    $deno.WaitForExit()
    $testExitCode = $deno.ExitCode
    Write-Step "Tier B exit code: $testExitCode"
} finally {
    # Everything below runs whether the tests passed, failed or threw.
    if (Get-Variable signingSecret -Scope 0 -ErrorAction SilentlyContinue) {
        $signingSecret = $null
        Remove-Variable signingSecret -ErrorAction SilentlyContinue
    }
    if ($psi) { $psi.Environment.Remove('NOOR_AI_LOCAL_GATEWAY_JWT_SECRET') | Out-Null; $psi = $null }
    # Defensive: this script never sets it here, and this makes sure a previous run could not have.
    Remove-Item Env:\NOOR_AI_LOCAL_GATEWAY_JWT_SECRET -ErrorAction SilentlyContinue
    [System.GC]::Collect()

    if ($serveProcess) {
        Write-Step 'Stopping the function server'
        <#
            Every wait here is bounded. Cleanup that can block forever is its own failure mode: a run
            that hangs at teardown leaves the stack up and invites someone to interrupt the script
            before the credential clearing below has run.

            The drains are waited on, never `.Result`-ed. `Wait` returns only whether the read
            finished; `.Result` would hand back the captured text, which is edge-runtime request
            logging and can carry an `Authorization` header value. Waiting is what lets the reads end
            with the pipes rather than being abandoned mid-read; reading them is what this script must
            never do.
        #>
        $serveCleanedUp = $true
        try {
            if (-not $serveProcess.HasExited) {
                Stop-Process -Id $serveProcess.Id -Force -ErrorAction SilentlyContinue
            }
            # `WaitForExit(ms)` is the bounded overload; unlike the argument-less form it waits for
            # the process only, which is why the drains are waited on separately just below.
            if (-not $serveProcess.WaitForExit(10000)) {
                # Forced termination retained as the fallback for a child that ignored the first kill.
                Stop-Process -Id $serveProcess.Id -Force -ErrorAction SilentlyContinue
                if (-not $serveProcess.WaitForExit(5000)) { $serveCleanedUp = $false }
            }
        } catch {
            $serveCleanedUp = $false
        }

        # Bounded per task, and guarded per task so one drain that faults or times out cannot skip
        # the other. A `Wait` that throws still means the task reached a terminal state, so
        # `IsCompleted` — not the exception — decides whether the drain is done.
        $pendingDrains = @()
        foreach ($drain in @($serveStdOutTask, $serveStdErrTask)) {
            if ($null -eq $drain) { continue }
            try {
                if (-not $drain.Wait(3000)) { $pendingDrains += $drain }
            } catch {
                if (-not $drain.IsCompleted) { $pendingDrains += $drain }
            }
        }
        if ($pendingDrains.Count -gt 0) {
            # `functions serve` runs the edge runtime in a container, and a grandchild can inherit the
            # write end of these pipes and outlive the CLI. Closing the read ends usually ends the
            # pending reads; it is best effort, not a guarantee, which is why the second wait is
            # bounded too and why a failure here degrades to a warning rather than a hang. Closing a
            # stream is not reading it: no captured text is touched on this path either.
            try { $serveProcess.StandardOutput.BaseStream.Close() } catch { }
            try { $serveProcess.StandardError.BaseStream.Close() } catch { }
            foreach ($drain in $pendingDrains) {
                try {
                    if (-not $drain.Wait(2000)) { $serveCleanedUp = $false }
                } catch {
                    if (-not $drain.IsCompleted) { $serveCleanedUp = $false }
                }
            }
        }

        try { $serveProcess.Dispose() } catch { $serveCleanedUp = $false }
        if (-not $serveCleanedUp) {
            # Fixed text, and deliberately vague about the cause: naming *what* did not wind down
            # would mean reporting the child's own output, which is the thing being protected. The
            # run continues to the stack teardown either way.
            Write-Warning ('Function server cleanup could not be confirmed complete. No captured ' +
                'output is shown; check docker ps -a yourself.')
        }
    }
    # Cleared on every path, including the path where no server was ever started. The captured text
    # is dropped unread with them.
    $serveProcess = $null
    $serveStdOutTask = $null
    $serveStdErrTask = $null

    if ($stackStarted) {
        Write-Step 'Stopping the stack (supabase stop --no-backup)'
        $stopCode = Invoke-QuietProcess -FilePath $SupabaseCli -ArgumentList @('stop', '--no-backup') `
            -WorkingDirectory $repoRoot
        if ($stopCode -ne 0) {
            Write-Warning ("supabase stop --no-backup exited with code $stopCode. Its output was " +
                'captured and is not rendered; check docker ps -a yourself.')
        }
    }

    Write-Step 'Verifying nothing was left behind'
    # Starts false and only becomes true if something actually answers, so a gateway that was never
    # reached — or a probe that never ran — can never be reported as still up.
    $stillUp = $false
    if ($gatewayUri) {
        try {
            Invoke-WebRequest -Uri $gatewayUri -Method POST -UseBasicParsing -TimeoutSec 5 | Out-Null
            $stillUp = $true
        } catch {
            # A transport-level failure means the gateway is gone, which is the desired state. An
            # HTTP status means something is still answering.
            $stillUp = $null -ne $_.Exception.Response
        }
    }
    # Captured like everything else and reduced to counts before anything is printed. Docker is not
    # a credential-producing command today, but routing it through the same helper is what makes
    # "no external process writes to this terminal unchecked" a property of the script rather than a
    # claim about one CLI's habits.
    $containerNames = $null
    $volumeNames = $null
    Invoke-QuietProcess -FilePath 'docker' -WorkingDirectory $repoRoot `
        -ArgumentList @('ps', '-a', '--filter', 'name=supabase_', '--format', '{{.Names}}') `
        -StdOut ([ref] $containerNames) | Out-Null
    Invoke-QuietProcess -FilePath 'docker' -WorkingDirectory $repoRoot `
        -ArgumentList @('volume', 'ls', '--filter', 'name=supabase_', '--format', '{{.Name}}') `
        -StdOut ([ref] $volumeNames) | Out-Null
    $containerCount = @(([string] $containerNames) -split "`r?`n" | Where-Object { $_.Trim() -ne '' }).Count
    $volumeCount = @(([string] $volumeNames) -split "`r?`n" | Where-Object { $_.Trim() -ne '' }).Count
    $containerNames = $null
    $volumeNames = $null

    Write-Host "    gateway reachable : $stillUp"
    Write-Host "    supabase containers: $containerCount"
    Write-Host "    supabase volumes   : $volumeCount"
    if ($stillUp -or $containerCount -gt 0 -or $volumeCount -gt 0) {
        Write-Warning 'Local Supabase state remains. Run `supabase stop --no-backup` before committing.'
    }
}

exit $testExitCode
