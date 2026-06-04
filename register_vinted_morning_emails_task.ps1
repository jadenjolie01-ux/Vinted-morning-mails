$ErrorActionPreference = "Stop"

param(
    [string]$TaskName = "Vinted Morning Emails",
    [string]$Time = "08:00"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sendScript = Join-Path $scriptDir "send_vinted_morning_emails.ps1"

if (-not (Test-Path $sendScript)) {
    throw "Mailer-script niet gevonden: $sendScript"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$sendScript`""

$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Verstuurt elke ochtend 3 Vinted mails." `
    -Force
