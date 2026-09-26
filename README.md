# Rally HQ - Pickleball Tournament Dashboard

Interactive pickleball tournament dashboard with player registration, random pool draw, QR live scoring, standings, and playoff bracket publishing.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite site and a shared registration API. Open the URL shown by Vite. The terminal also prints the organizer PIN for that run. To keep a stable PIN, set `ADMIN_PIN` before starting, for example in PowerShell:

```powershell
$env:ADMIN_PIN = 'choose-a-private-pin'
npm run dev
```

Use `npm run build` and `npm run lint` to check changes.

## Organizer-created live tournaments

1. Open **Organizer**, enter the PIN, and create a category. Options include division, doubles/mixed doubles/singles, eligibility, fee, team slots, teams per pool, courts, and written rules.
2. Copy the **phone-ready registration link**. Players on the same Wi-Fi can open it, submit their team and player names/photos, and save their confirmation page.
3. Approve or reject entries on the organizer board. Only approved teams join the draw.
4. Click **Randomize & publish draw**. The server shuffles approved teams, fills pools evenly, and builds one round-robin match for each pair in a pool. Players see their pool, court, standings, and assigned matchups; their own games are highlighted. Pages refresh automatically every few seconds.
5. Set the scoring rule and bracket rule per category: points to win, win by, and how many pool wins qualify a team for playoffs.
6. From the organizer live board, open **Scoring QR** for a match. Scan it at the court to open a mobile scoreboard with team names, player names, photos, large tap controls, and a final winner button. Each point is saved to the server and updates player pages.
7. After every pool match is final, click **Publish playoff bracket**. Eligible teams are randomized into a single-elimination bracket, and QR scoring advances playoff winners automatically.

Score QR links are only shown in organizer views. Public category and player pages never include scoring tokens.

Categories, registrations, photos, and draws are saved outside the web folder at `~/.rally-hq/data.json` (or `DATA_FILE` if configured). The phone link uses the computer's detected LAN address; set `PUBLIC_BASE_URL` if the detected address is unsuitable. Phones must be able to reach the host computer and its Vite port. This is a local-network implementation; public internet use requires deployment with HTTPS, a durable database/backup, and stronger organizer authentication.

## Supplied Regall sheet reference

The original Regall sheet data stays separate from organizer-created live categories. The **Bracket** section still includes the supplied pool lineup and schedules as a reference view. Those sheets define nine pools, A-I, with five teams each. Every team plays the other four teams in its own pool once: ten matches per pool and 90 pool matches altogether. Court 1 alternates Pools A/B/C, Court 2 alternates D/E/F, and Court 3 alternates G/H/I.

The supplied sheets do not define playoff qualifiers, seeding, or tiebreaks. The **Sheet order** mode reproduces the supplied matchup order, while **Smart schedule** is a proposed reorder of the same 90 matchups to improve rest spacing. Use **Organizer** for real live tournament results, QR scoring, and published playoff brackets.
