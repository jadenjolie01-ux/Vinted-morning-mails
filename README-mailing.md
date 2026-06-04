# Vinted ochtendmails

Deze map bevat nu een eenvoudige PowerShell-mailer voor 3 dagelijkse mails.

## Bestanden

- `send_vinted_morning_emails.ps1`: verstuurt alle ingeschakelde mails uit de config.
- `register_vinted_morning_emails_task.ps1`: maakt een dagelijkse Windows Taakplanner-taak aan.
- `vinted_mail_config.json`: SMTP- en ontvangerconfiguratie.
- `vinted_sneaker_deals_jaden.html`: mail 1.
- `vinted_sneaker_deals_jelle.html`: mail 2.
- `vinted_sneaker_deals_derde_mail.html`: algemene top 6-mail.

## Invullen

1. Vul in `vinted_mail_config.json` je eigen afzender, gebruikersnaam, app-wachtwoord en 3 ontvangers in.
2. Controleer of `vinted_sneaker_deals_derde_mail.html` inhoudelijk klopt als algemene top 6-mail.

## Testen

Voer handmatig uit:

```powershell
powershell -ExecutionPolicy Bypass -File .\send_vinted_morning_emails.ps1
```

## Dagelijks plannen

Voer daarna uit als administrator:

```powershell
powershell -ExecutionPolicy Bypass -File .\register_vinted_morning_emails_task.ps1 -Time "08:00"
```
