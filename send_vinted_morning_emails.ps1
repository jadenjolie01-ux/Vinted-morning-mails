$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir "vinted_mail_config.json"

if (-not (Test-Path $configPath)) {
    throw "Configbestand niet gevonden: $configPath"
}

$config = Get-Content -Path $configPath -Raw | ConvertFrom-Json

if (-not $config.smtp.host -or -not $config.smtp.username -or -not $config.smtp.password) {
    throw "SMTP-config is niet volledig ingevuld in vinted_mail_config.json"
}

foreach ($mail in $config.mails) {
    if (-not $mail.enabled) {
        continue
    }

    $bodyPath = Join-Path $scriptDir $mail.bodyFile
    if (-not (Test-Path $bodyPath)) {
        throw "Mailtemplate niet gevonden: $bodyPath"
    }

    $message = New-Object System.Net.Mail.MailMessage
    $message.From = $config.smtp.from
    $message.To.Add($mail.to)
    $message.Subject = $mail.subject
    $message.SubjectEncoding = [System.Text.Encoding]::UTF8
    $message.BodyEncoding = [System.Text.Encoding]::UTF8
    $message.IsBodyHtml = $true
    $message.Body = Get-Content -Path $bodyPath -Raw

    $smtp = New-Object System.Net.Mail.SmtpClient($config.smtp.host, [int]$config.smtp.port)
    $smtp.EnableSsl = [bool]$config.smtp.useSsl
    $smtp.Credentials = New-Object System.Net.NetworkCredential($config.smtp.username, $config.smtp.password)

    try {
        $smtp.Send($message)
        Write-Host ("Verzonden: {0} -> {1}" -f $mail.subject, $mail.to)
    }
    finally {
        $message.Dispose()
        $smtp.Dispose()
    }
}
