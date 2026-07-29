<#
Verifies structural parity between database/schema.sql (the fresh-install
path) and `alembic upgrade head` run against a truly empty database (the
migration-chain path, never exercised end-to-end before this script
existed — see CLAUDE.md > Database Rules > Schema/Alembic Parity
Verification).

Builds two fully throwaway, network-isolated Postgres containers (anonymous
volumes, never-reused credentials), applies one path to each, dumps
schema-only DDL from both, normalizes away non-structural noise, and diffs
the result. Never touches the real dev postgres/pgdata volume or the
docker-compose.yml backend service definition.

Run this whenever database/schema.sql or any file under
backend/alembic/versions/ changes.
#>

# Deliberately NOT 'Stop': native commands (docker, psql, pg_dump, git) write
# expected non-fatal stderr (e.g. the idempotent pre-flight cleanup below,
# which is SUPPOSED to fail when there's nothing stale to remove). Under
# ErrorActionPreference='Stop', PowerShell 5.1 promotes every such stderr
# line to a terminating exception before this script's own $LASTEXITCODE
# checks ever run. Failure detection here is explicit: check $LASTEXITCODE
# after each native call, or `throw` deliberately.
$ErrorActionPreference = 'Continue'

$RepoRoot      = Split-Path -Parent $PSScriptRoot
$SchemaSqlPath = Join-Path $RepoRoot 'database\schema.sql'

$NetworkName = 'schema-verify-net'
$ContainerA  = 'schema-verify-pg-a'
$ContainerB  = 'schema-verify-pg-b'

$PgUser     = 'verify'
$PgPassword = 'verify_temp'
$PgDb       = 'verify_db'

$WorkDir = Join-Path $env:TEMP ("schema-verify-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

$DumpA = Join-Path $WorkDir 'schema-verify-a.sql'
$DumpB = Join-Path $WorkDir 'schema-verify-b.sql'
$NormA = Join-Path $WorkDir 'schema-verify-a.normalized.sql'
$NormB = Join-Path $WorkDir 'schema-verify-b.normalized.sql'

$ExitCode = 1

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host "==== $Message ====" -ForegroundColor Cyan
}

function Invoke-Docker {
    param([string[]]$Arguments, [string]$FailureMessage)
    $output = & docker @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ($output -join "`n") -ForegroundColor Red
        throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
    return $output
}

function Wait-PostgresReady {
    param([string]$ContainerName, [int]$TimeoutSeconds = 90)
    Write-Host "Waiting for $ContainerName to become ready..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        & docker exec $ContainerName pg_isready -U $PgUser -d $PgDb *> $null
        if ($LASTEXITCODE -eq 0) {
            & docker exec -e "PGPASSWORD=$PgPassword" $ContainerName psql -U $PgUser -d $PgDb -c "SELECT 1;" *> $null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "$ContainerName is ready."
                return
            }
        }
        Start-Sleep -Seconds 2
    }
    throw "$ContainerName did not become ready within $TimeoutSeconds seconds"
}

function Split-TopLevelCommas {
    param([string]$Text)
    $parts = New-Object System.Collections.Generic.List[string]
    $depth = 0
    $current = New-Object System.Text.StringBuilder
    foreach ($ch in $Text.ToCharArray()) {
        if ($ch -eq '(') { $depth++ }
        if ($ch -eq ')') { $depth-- }
        if ($ch -eq ',' -and $depth -eq 0) {
            $parts.Add($current.ToString())
            $current = New-Object System.Text.StringBuilder
        } else {
            [void]$current.Append($ch)
        }
    }
    if ($current.Length -gt 0) { $parts.Add($current.ToString()) }
    return $parts
}

function Get-CanonicalTableBlock {
    param([string]$Block)

    # A column added later via ALTER TABLE ADD COLUMN always appends at the
    # physical end of the table, while schema.sql declares it inline in its
    # "final" position - same structure, different column order. Sort each
    # CREATE TABLE's column/constraint list internally so that ordering
    # difference doesn't register as drift, while still catching a genuinely
    # missing/extra/differently-typed column (each stays its own comparable line).
    if ($Block -notmatch '(?s)^(CREATE TABLE [^\(]+\()(.*)(\)\s*;?)\s*$') {
        return $Block
    }
    $header = $Matches[1]
    $body = $Matches[2]
    $footer = $Matches[3]

    $parts = Split-TopLevelCommas -Text $body |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne '' } |
        Sort-Object

    return "$header`n    " + ($parts -join ",`n    ") + "`n$footer"
}

function Get-NormalizedSchemaDump {
    param([string]$Path)

    $raw = (Get-Content -Path $Path -Raw) -replace "`r`n", "`n"
    $lines = $raw -split "`n"

    # Noise pg_dump adds that carries no structural meaning: session SET
    # statements, dump-tool timestamps/version comments, per-object
    # "-- Name: ...; Type: ...; Schema: ..." headers (their content is
    # already implied by the statement that follows), and the psql
    # \restrict/\unrestrict guard tokens some pg_dump versions emit (random
    # per dump, carry no schema meaning).
    $noisePatterns = @(
        '^--\s*$',
        '^-- PostgreSQL database dump',
        '^-- Dumped from database version',
        '^-- Dumped by pg_dump version',
        '^SET\s',
        '^SELECT pg_catalog\.set_config',
        '^-- Name:.*Type:.*Schema:',
        '^\\restrict\s',
        '^\\unrestrict\s'
    )

    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        $isNoise = $false
        foreach ($pattern in $noisePatterns) {
            if ($line -match $pattern) { $isNoise = $true; break }
        }
        if (-not $isNoise) { $kept.Add($line) }
    }

    $cleanText = ($kept -join "`n") -replace "(`n\s*){2,}", "`n`n"

    # Split into per-object statement blocks (blank-line separated), drop
    # alembic_version (Alembic's own bookkeeping table + PK - created by
    # this script's Container B path, and by the real deploy's `alembic
    # stamp head` step, but not by a bare schema.sql load; not part of the
    # application schema this check cares about), canonicalize column order
    # within each CREATE TABLE, then sort blocks so the two dumps compare
    # equal regardless of which order schema.sql vs. the Alembic chain
    # happened to create objects in.
    $blocks = $cleanText -split "`n`n+" |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne '' -and $_ -notmatch '\balembic_version\b' } |
        ForEach-Object { Get-CanonicalTableBlock -Block $_ } |
        Sort-Object

    return ($blocks -join "`n`n") + "`n"
}

try {
    if (-not (Test-Path $SchemaSqlPath)) {
        throw "schema.sql not found at $SchemaSqlPath"
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "docker CLI not found on PATH"
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "git CLI not found on PATH (used to render the final diff)"
    }

    Write-Section "Pre-flight cleanup (stale containers/network from a prior crashed run)"
    & docker rm -f -v $ContainerA $ContainerB *> $null
    & docker network rm $NetworkName *> $null

    Write-Section "Creating isolated network: $NetworkName"
    Invoke-Docker -Arguments @('network', 'create', $NetworkName) `
        -FailureMessage "Failed to create network $NetworkName" | Out-Null

    # -----------------------------------------------------------------
    # Container A: fresh-install path (schema.sql via psql -f)
    # -----------------------------------------------------------------
    Write-Section "Container A ($ContainerA): schema.sql fresh-install path"
    Invoke-Docker -Arguments @(
        'run', '-d', '--name', $ContainerA, '--network', $NetworkName,
        '-e', "POSTGRES_USER=$PgUser",
        '-e', "POSTGRES_PASSWORD=$PgPassword",
        '-e', "POSTGRES_DB=$PgDb",
        'postgres:16'
    ) -FailureMessage "Failed to start $ContainerA" | Out-Null

    Wait-PostgresReady -ContainerName $ContainerA

    Invoke-Docker -Arguments @('cp', $SchemaSqlPath, "${ContainerA}:/schema.sql") `
        -FailureMessage "Failed to copy schema.sql into $ContainerA" | Out-Null

    Write-Host "Applying schema.sql against $ContainerA ..."
    $psqlArgs = @(
        'exec', '-e', "PGPASSWORD=$PgPassword", $ContainerA,
        'psql', '-v', 'ON_ERROR_STOP=1', '-U', $PgUser, '-d', $PgDb, '-f', '/schema.sql'
    )
    $schemaApplyOutput = & docker @psqlArgs 2>&1
    $schemaApplyExit = $LASTEXITCODE
    Write-Host ($schemaApplyOutput -join "`n")
    if ($schemaApplyExit -ne 0) {
        throw "schema.sql FAILED to apply cleanly against a genuinely fresh database (Container A). This is a real bug in database/schema.sql, not a script problem - see output above."
    }
    Write-Host "schema.sql applied cleanly." -ForegroundColor Green

    # -----------------------------------------------------------------
    # Container B: migration-chain path (alembic upgrade head)
    # -----------------------------------------------------------------
    Write-Section "Container B ($ContainerB): alembic upgrade head path"
    Invoke-Docker -Arguments @(
        'run', '-d', '--name', $ContainerB, '--network', $NetworkName,
        '-e', "POSTGRES_USER=$PgUser",
        '-e', "POSTGRES_PASSWORD=$PgPassword",
        '-e', "POSTGRES_DB=$PgDb",
        'postgres:16'
    ) -FailureMessage "Failed to start $ContainerB" | Out-Null

    Wait-PostgresReady -ContainerName $ContainerB

    # NOTE: deliberately NOT 'docker compose images backend' - that resolves
    # via the currently-RUNNING container's pinned image ID (docker inspect
    # under the hood), not the live tag. After a `docker compose build`
    # retags backend:latest to a new image, the old id a still-running dev
    # container was created from can become a dangling, garbage-collected
    # layer - and 'docker compose images' then reports "No such image" even
    # though the tag itself resolves fine. Resolve the tag directly instead:
    # docker compose auto-names an unnamed `build:`-only service's image as
    # "<project-name>-<service-name>:latest", where the project name comes
    # from compose config itself (never hardcoded here).
    Write-Host "Determining current backend image tag from the compose project name..."
    Push-Location $RepoRoot
    try {
        $configJson = & docker compose config --format json 2>&1
        $configExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($configExit -ne 0 -or [string]::IsNullOrWhiteSpace([string]$configJson)) {
        throw "Could not read 'docker compose config' to determine the project name"
    }
    $projectName = ($configJson | Out-String | ConvertFrom-Json).name
    if ([string]::IsNullOrWhiteSpace($projectName)) {
        throw "docker compose config returned no project name"
    }
    $BackendImage = "${projectName}-backend:latest"

    & docker image inspect $BackendImage *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Image '$BackendImage' not found - building it once via 'docker compose build backend'..."
        Push-Location $RepoRoot
        try {
            Invoke-Docker -Arguments @('compose', 'build', 'backend') `
                -FailureMessage "Failed to build backend image" | Out-Null
        } finally {
            Pop-Location
        }
        & docker image inspect $BackendImage *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "Backend image '$BackendImage' still not found after building it"
        }
    }
    Write-Host "Using backend image: $BackendImage"

    $databaseUrl = "postgresql+asyncpg://${PgUser}:${PgPassword}@${ContainerB}:5432/${PgDb}"

    Write-Host "Running 'alembic upgrade head' against $ContainerB (truly empty DB, no schema.sql involved) ..."
    $alembicArgs = @(
        'run', '--rm', '--network', $NetworkName,
        '-e', "DATABASE_URL=$databaseUrl",
        '-e', 'SECRET_KEY=schema-verify-throwaway-secret',
        '-e', 'ACCESS_TOKEN_EXPIRE_MINUTES=30',
        $BackendImage, 'alembic', 'upgrade', 'head'
    )
    $alembicOutput = & docker @alembicArgs 2>&1
    $alembicExit = $LASTEXITCODE
    Write-Host ($alembicOutput -join "`n")
    if ($alembicExit -ne 0) {
        $lastRevisionLine = ($alembicOutput | Select-String -Pattern 'Running upgrade' | Select-Object -Last 1)
        $revisionNote = if ($lastRevisionLine) { " Failed while applying: $($lastRevisionLine.Line.Trim())" } else { "" }
        throw "alembic upgrade head FAILED against a truly empty database (Container B).$revisionNote This is a real latent migration bug, not a script problem - see output above."
    }
    Write-Host "alembic upgrade head completed cleanly." -ForegroundColor Green

    # -----------------------------------------------------------------
    # Dump + normalize + diff
    # -----------------------------------------------------------------
    Write-Section "Dumping schema-only DDL from both containers"

    $dumpAArgs = @('exec', '-e', "PGPASSWORD=$PgPassword", $ContainerA,
        'pg_dump', '--schema-only', '--no-owner', '--no-privileges', '-U', $PgUser, '-d', $PgDb)
    $dumpAOutput = & docker @dumpAArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ($dumpAOutput -join "`n") -ForegroundColor Red
        throw "pg_dump against $ContainerA failed"
    }
    $dumpAOutput | Set-Content -Path $DumpA -Encoding utf8

    $dumpBArgs = @('exec', '-e', "PGPASSWORD=$PgPassword", $ContainerB,
        'pg_dump', '--schema-only', '--no-owner', '--no-privileges', '-U', $PgUser, '-d', $PgDb)
    $dumpBOutput = & docker @dumpBArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ($dumpBOutput -join "`n") -ForegroundColor Red
        throw "pg_dump against $ContainerB failed"
    }
    $dumpBOutput | Set-Content -Path $DumpB -Encoding utf8

    Write-Host "Raw dumps saved to:"
    Write-Host "  $DumpA"
    Write-Host "  $DumpB"

    Write-Section "Normalizing dumps (stripping SET/comments/timestamps, sorting objects to ignore creation order)"
    (Get-NormalizedSchemaDump -Path $DumpA) | Set-Content -Path $NormA -Encoding utf8 -NoNewline
    (Get-NormalizedSchemaDump -Path $DumpB) | Set-Content -Path $NormB -Encoding utf8 -NoNewline

    Write-Section "Diffing normalized schemas"
    $diffOutput = & git --no-pager diff --no-index -- $NormA $NormB 2>&1
    $diffExit = $LASTEXITCODE

    if ($diffExit -eq 0) {
        Write-Host ""
        Write-Host "PASS - schema.sql and 'alembic upgrade head' produce structurally identical schemas." -ForegroundColor Green
        $ExitCode = 0
    } elseif ($diffExit -eq 1) {
        Write-Host ""
        Write-Host "FAIL - structural drift detected between schema.sql and the Alembic migration chain:" -ForegroundColor Red
        Write-Host ($diffOutput -join "`n")
        Write-Host ""
        Write-Host "Normalized dumps kept for review:"
        Write-Host "  $NormA"
        Write-Host "  $NormB"
        $ExitCode = 1
    } else {
        throw "git diff --no-index exited unexpectedly (code $diffExit): $($diffOutput -join "`n")"
    }
}
catch {
    Write-Host ""
    Write-Host "SCRIPT FAILURE: $($_.Exception.Message)" -ForegroundColor Red
    $ExitCode = 1
}
finally {
    Write-Section "Cleanup (always runs)"
    & docker rm -f -v $ContainerA $ContainerB *> $null
    & docker network rm $NetworkName *> $null

    Write-Host ""
    Write-Host "docker ps -a (confirm A/B are gone):"
    & docker ps -a

    Write-Host ""
    Write-Host "docker network ls (confirm $NetworkName is gone):"
    & docker network ls

    Write-Host ""
    Write-Host "docker volume ls (confirm no new named volume from this run):"
    & docker volume ls
}

exit $ExitCode
