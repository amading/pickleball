# Pickleball UI redesign plan

## Goal
Make the tournament easy to understand at a glance for players and organizers, while giving the product a distinctive modern sports identity.

## Design direction
- Hybrid of a clean event dashboard and a live sports broadcast: warm paper canvas, dark ink panels, acid lime accents, and court inspired lines.
- Strong hierarchy: event identity, current section, one primary action, then compact data cards.
- One section visible at a time. Navigation remains available on desktop and mobile.
- Subtle glow, motion, and hover effects that respect reduced motion settings.

## Screens
1. Dashboard: event summary, quick paths to bracket and schedule, and at a glance court assignments.
2. Pools: all nine pools in readable cards.
3. Tournament flow: actual pool round robin first, with one pool's ten matches and standings visible at a time. A separately labeled sample playoff bracket demonstrates connected rounds, match states, winner advancement, and a team finder.
4. Schedule: court tabs and compact game rows.
5. Fairness: spacing metrics and longest gaps.

## Implementation checks
- Keep the existing pool and scheduling data intact.
- Mark sample playoff results as demo data until an organizer enters live results.
- Verify build and lint, then inspect desktop and narrow browser layouts.

## Registration and live draw extension

1. Add a shared API and persistent JSON data for categories, registrations, approval, and published draws.
2. Add an organizer section with category options: division, team format, eligibility, fees, capacity, pool size, courts, and written rules.
3. Add shareable, mobile-first public category pages with player names, photos, partner details, and registration confirmation.
4. Let the organizer approve entries, then publish a secure random pool draw and round-robin matches. Show assignments and upcoming opponents on the public link.
5. Verify cross-device behavior through the API, build/lint, and desktop/mobile browser inspection.

## QR scoring and qualification

1. Give every published match a private QR scoring token and a public live score/status. The QR opens a focused phone scoreboard for that exact matchup.
2. Save point updates on the server, reject stale concurrent edits, and finalize the winner from the configured points-to-win and win-by rules.
3. Let the organizer set the minimum pool wins needed to qualify. Show live standings and eligible teams to players and organizer.
4. After pool games finish, let the organizer publish a real single-elimination bracket from eligible teams. Scores on its matches advance winners automatically.
5. Redesign match cards around matchup, score, status, and a prominent organizer QR action; verify the flow across browsers and screens.
