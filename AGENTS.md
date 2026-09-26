# Rally HQ working agreement

- Keep the supplied Regall pool schedule separate from organizer-created categories. Never present sample playoff seeds as official results.
- Build mobile registration first: readable on a phone, clear category rules, and a short form.
- Admin actions must be protected on the server. Public links can read published categories and submit registrations, but cannot approve or draw teams.
- Store registrations and draws on the server so different devices see the same state. Browser local storage is only for the older preview views.
- Random draws must use a secure shuffle, save the resulting assignments, and show exactly which pool and match each approved team received.
- Validate inputs on both client and server. Limit photo size and accepted MIME types.
- Keep match scoring tokens out of public category responses. Anyone holding a QR token can score that match, so show QR codes only in organizer views.
- A winner comes from a valid final score, not a bare team click. Persist scores and recompute standings and playoff advancement from saved match results.
- Run lint and build after changes, then verify registration, approval, draw, and mobile layout.
