# Rally HQ - Pickleball Tournament Dashboard

Interactive pickleball tournament dashboard with player registration, random pool draw, QR live scoring, standings, and playoff bracket publishing.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite site and a shared registration API. Open the URL shown by Vite. The terminal prints the **setup PIN**: the first run generates it and keeps it in `admin-pin.txt` next to the data file. Open **Organizer** and use it once to create the owner account (your own username and password); after that everyone signs in with their own account. The PIN is only needed again to reset a forgotten password. To choose your own PIN, set `ADMIN_PIN` before starting, for example in PowerShell:

```powershell
$env:ADMIN_PIN = 'choose-a-private-pin'
npm run dev
```

Use `npm run build` and `npm run lint` to check changes. `npm run smoke` runs the end-to-end API check against a running API (defaults: `http://127.0.0.1:8791/api`, setup PIN `test-pin-6742`; override with `SMOKE_URL` / `SMOKE_PIN`). It creates a `smoke-owner` account on a fresh data file. Point it at a throwaway `DATA_FILE`, never your real one.

### Single-server mode

```bash
npm start
```

Builds the site and serves it together with the API from one port (`API_PORT`, default 8787). Player and QR links then use that port.

## Organizer-created live tournaments

1. Open **Organizer**, sign in, and create a category. Options include division, doubles/mixed doubles/singles, eligibility, fee, team slots, teams per pool, courts, and written rules.
2. Copy the **phone-ready registration link**. Players on the same Wi-Fi can open it, submit their team and player names/photos, and save their confirmation page.
3. Registration asks for a contact mobile number (organizer-only) and, when there is a fee, an optional GCash/payment reference. On the organizer board, mark each team **PAID**, then approve or reject it. With **Require payment** on (the default when there is a fee), unpaid teams cannot be approved. Filter the roster by Need review / Unpaid / Approved, and use the pencil to fix team names, player names, contact, or reference. Only approved teams join the draw.
4. Click **Randomize & publish draw**. The server shuffles approved teams, fills pools evenly, and builds one round-robin match for each pair in a pool. Games are scheduled in waves across every court: no team plays twice in a wave, teams get a rest between games when possible, and no court sits idle while games are waiting. Until the first point is scored you can **Undo draw**, change entries, and draw again. Players see their pool, court, standings, and assigned matchups; their own games are highlighted. Pages refresh automatically every few seconds.
5. Set the scoring rule and bracket rule per category (**Edit settings** changes them later; fields lock once they would change published results). Playoff entry is either **Top N per pool** (default Top 2, seeded bracket: pool winners meet runners-up from other pools first, and pool-mates are kept apart in the first round) or **Minimum wins** (random bracket). Pool ties are broken by head-to-head among the tied teams, then point difference, then points scored, then draw position.
6. From the organizer live board, open **Scoring QR** for a match. Scan it at the court to open a mobile scoreboard with team names, player names, photos, large tap controls, and a final winner button. Each point is saved to the server and updates player pages. A final score must be valid: reach the target and win by the margin, and past the target the lead is exactly the margin (11-9 or 13-11, never 15-2). Only the organizer can reopen a final, and a playoff result cannot be reopened while the next round's match is already live or final.
7. After every pool match is final, click **Publish playoff bracket**. Eligible teams are randomized into a single-elimination bracket, and QR scoring advances playoff winners automatically.

**Dashboard**, **Live board**, and **Schedule** all read the same saved server results: games final, matches on court now, the next match per court, standings, and champions. Organizers can delete a category (with its registrations, draw, and scores) from its summary card.

**Export CSV** on each category downloads registrations with payment and contact details, match results, or standings (opens in Excel or Google Sheets). **Full backup** downloads the whole data file.

Score QR links are only shown in organizer views. Public category and player pages never include scoring tokens.

Categories, registrations, and draws are saved outside the web folder at `~/.rally-hq/data.json` (or `DATA_FILE` if configured). Player photos are separate files in `photos/` beside it and are served with long-lived caching; pages poll with ETags, so an unchanged board costs phones almost no data. Automatic backups go to `backups/` every 30 minutes of activity and always before a category delete, a draw undo, or a data upgrade (the newest 48 are kept; tune with `BACKUP_MINUTES` and `BACKUPS_KEPT`). To restore, stop the server and copy a backup over `data.json`. The phone link uses the computer's detected LAN address; set `PUBLIC_BASE_URL` if the detected address is unsuitable. Phones must be able to reach the host computer and its Vite port. Photos are checked by their actual file bytes (JPG, PNG, or WebP only). This is a local-network implementation by default.

### Organizer accounts

Each organizer has their own username and password (8+ characters, stored as scrypt hashes). Sessions last 14 days on that device or until **Sign out**. Click your name on the organizer desk for **Team & security**:

- **Organizers** (owners only): add organizers or other owners with a temporary password, reset passwords, disable accounts (signs them out everywhere), or change roles. At least one active owner always remains.
- **Activity**: who approved, marked paid, renamed, drew, edited settings, finalized or reopened scores, and when. Court QR finals show as "Court QR".
- **My password**: change your own password; other devices are signed out.

Forgot a password? On the sign-in screen choose **Forgot password?** and use the setup PIN. Five failed sign-ins or PIN attempts lock that address out for a few minutes.

### Putting it online (VPS)

For players to register from home, run it on a small Linux VPS (Ubuntu 22.04/24.04 or Debian 12, 1 GB RAM is enough) with a domain name:

1. Point your domain's DNS **A record** at the VPS IP address.
2. On the VPS, get the code and run the setup script:
   ```bash
   git clone https://github.com/amading/pickleball.git && cd pickleball
   sudo bash deploy/setup.sh pbb.your-domain.com
   ```
   It installs Node.js 22 and Caddy, runs the app as a locked-down `pbb` system user under systemd (listening only on 127.0.0.1), gets an HTTPS certificate automatically, opens only SSH/HTTP/HTTPS in the firewall, and prints a long random setup PIN (kept in `/etc/pbb.env`).
3. Open `https://pbb.your-domain.com`, go to **Organizer**, and create the owner account with that PIN.
4. To bring over your current data, stop the app (`sudo systemctl stop pbb`), copy `~/.rally-hq/data.json` and the `photos/` folder into `/var/lib/pbb/`, run `sudo chown -R pbb:pbb /var/lib/pbb`, and start it again. Existing accounts come along with the data.
5. Updates: `git pull && sudo bash deploy/update.sh`. Logs: `journalctl -u pbb -f`.
6. Backups are written to `/var/lib/pbb/backups/`. Also copy that folder (and `photos/`) off the server regularly, for example with your VPS provider's snapshot feature.

Other hosts work too: run `npm ci && npm start` with a persistent disk for `DATA_FILE`, HTTPS in front, `PUBLIC_BASE_URL=https://your-domain`, and `TRUST_PROXY=1`.

## Supplied Regall sheet reference

The original Regall sheet data stays separate from organizer-created live categories. The **Regall sheet** section shows the supplied pool lineup, matchups, court order, and rest check as a read-only reference. It records no scores or winners, and it no longer has a sample playoff bracket. Those sheets define nine pools, A-I, with five teams each. Every team plays the other four teams in its own pool once: ten matches per pool and 90 pool matches altogether. Court 1 alternates Pools A/B/C, Court 2 alternates D/E/F, and Court 3 alternates G/H/I.

The supplied sheets do not define playoff qualifiers, seeding, or tiebreaks. The **Sheet order** mode reproduces the supplied matchup order, while **Smart schedule** is a proposed reorder of the same 90 matchups to improve rest spacing. Use **Organizer** for real live tournament results, QR scoring, and published playoff brackets.
