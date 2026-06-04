# Vinted cloud-oplossing

Dit is de pc-onafhankelijke route.

## Wat dit doet

- draait elke ochtend in GitHub Actions
- zoekt live Vinted-links opnieuw op
- stuurt 3 mails via SMTP:
  - sneakers
  - kleding
  - top 6
- bewaart eerder verzonden links in `cloud_state/sent_links.json`

## Nodig

1. Zet deze map in een GitHub-repository.
2. Voeg in GitHub bij `Settings > Secrets and variables > Actions` deze secrets toe:
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `MAIL_FROM`
   - `MAIL_TO`
3. Gebruik bij Gmail een app-wachtwoord, niet je gewone wachtwoord.

## Trigger

- automatisch elke dag via `.github/workflows/vinted-morning-mails.yml`
- handmatig via `Run workflow` in GitHub Actions

## Belangrijke nuance

GitHub Actions cron gebruikt UTC. De workflow staat nu op `06:05 UTC`.
Dat is `08:05` in de zomer in Nederland en `07:05` in de winter.

Als je precies `08:00` Nederlandse tijd wilt in zomer en winter, moeten we dat nog strakker oplossen.
