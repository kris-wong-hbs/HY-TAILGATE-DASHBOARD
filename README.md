# Harvard-Yale Tailgate — Sales Dashboard

Live ticket sales for the 2026 Harvard-Yale Tailgate, read from Eventbrite and broken down by school and by the AASU hold.

## Deploy on Vercel

1. Import this repo in Vercel (New Project → Import).
2. Add environment variables (Settings → Environment Variables):
   - `EVENTBRITE_TOKEN` — your Eventbrite private token (Eventbrite → Account Settings → Developer Links → API Keys → Private token). Required.
   - `DASHBOARD_PASSWORD` — password viewers must enter. Required; the site refuses to serve without it.
   - `AASU_HOLDS` — optional fallback, used only if Eventbrite's sections can't be read. Format `HBS=125,HLS=15,SOM=40,YLS=20`.
   - `EVENTBRITE_EVENT_ID` — optional, defaults to `2003945094723`.
3. Deploy. Visitors get a browser password prompt; enter any username and the password.

Data refreshes about once a minute. `/api/stats` returns the same numbers as JSON.

## How the numbers are computed

- **Sold** counts attending (non-refunded, non-cancelled) attendees per ticket type. Regular ticket types map to a school by their Eventbrite section (`inventory_tier_id`); AASU hold ticket types map by the `AASU - <HBS|HLS|SOM|YLS>` prefix of their display name.
- **AASU sold** is any attendee on an AASU hold ticket type (or whose checkout code starts with `AASU_`); everything else is **public**.
- **AASU hold** is derived from Eventbrite: the school's contracted allocation (in `lib/config.ts`) minus its section's capacity.
- **Public capacity** is the school's allocation minus its AASU hold. **AASU remaining** is hold minus AASU sold.
- **Ticket revenue** is face value (what the SA receives). **Buyers paid** includes Eventbrite and processing fees passed through to attendees.

## Local development

```
cp .env.example .env.local   # fill in values
npm install
npm run dev
```
