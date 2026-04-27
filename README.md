# ParentsAPP


ParentsAPP is an inclusive, AI-supported family decision-making prototype.


Current state:
- Matrix is the messaging core for chat.
- Supabase stores family roles, calendar, decisions, and document metadata.
- A first Expo interface prototype is included (`App.tsx`) with screens for login, chat, calendar, decisions, and documents.
- The chat screen includes an AI button labeled `Work in progress`.

## Key Files

- Matrix architecture: [`docs/architecture-matrix.md`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/docs/architecture-matrix.md)
- App prototype UI: [`App.tsx`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/App.tsx)
- Matrix REST client (frontend): [`src/prototype/lib/matrixClient.ts`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/src/prototype/lib/matrixClient.ts)
- Supabase client/data adapters (frontend): [`src/prototype/lib/supabaseClient.ts`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/src/prototype/lib/supabaseClient.ts), [`src/prototype/lib/data.ts`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/src/prototype/lib/data.ts)
- Backend scaffold entry: [`src/index.ts`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/src/index.ts)
- Supabase schema: [`supabase/schema.sql`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/supabase/schema.sql)
- Supabase seed: [`supabase/seed.sql`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/supabase/seed.sql)

## Setup

1. Copy env template:

```bash
cp .env.example .env
```

2. Fill required vars in `.env`:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_DEMO_FAMILY_ID` (use `11111111-1111-1111-1111-111111111111` unless you changed seed data)
- `EXPO_PUBLIC_MATRIX_HOMESERVER_URL`
- `EXPO_PUBLIC_MATRIX_ACCESS_TOKEN`
- `EXPO_PUBLIC_MATRIX_USER_ID`

Optional backend vars for Node scaffold:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `MATRIX_HOMESERVER_URL`
- `MATRIX_ACCESS_TOKEN`
- `MATRIX_USER_ID`
- `OPENAI_API_KEY`

3. Install dependencies:

```bash
npm install
```

4. Apply DB scripts in Supabase SQL editor:
- [`supabase/schema.sql`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/supabase/schema.sql)
- [`supabase/seed.sql`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/supabase/seed.sql)
If your project was already running before this update, run `schema.sql` again so new columns/tables (`families.join_code`, `families.join_password`, `schedule_requests`) are created.

5. Run app prototype:

```bash
npm start
```

Then open iOS simulator / Android emulator / Expo Go.

## Useful Commands

```bash
npm run typecheck
npm run typecheck:app
npm run typecheck:backend
npm run dev:backend
```

## External Testing (No Expo Go, No Same Wi-Fi)

This project is now prepared for EAS internal builds:
- EAS config: [`eas.json`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/eas.json)
- App IDs set in [`app.json`](/Users/goldi/Documents/1-Uni-Unterlagen/MEICogSci/Assignments/ParentsAPP/app.json):
  - iOS bundle id: `com.parentsapp.mobile`
  - Android package: `com.parentsapp.mobile`

If you already use these IDs in another app, change them before building.

### Dummy-proof pipeline

1. Open terminal in this project folder.
2. Install dependencies:

```bash
npm install
```

3. Login to Expo account:

```bash
npm run eas:login
```

4. Confirm login:

```bash
npm run eas:whoami
```

5. Build Android test app (easiest for sharing):

```bash
npm run eas:build:android
```

6. Build iOS test app:

```bash
npm run eas:build:ios
```

7. Share the generated build links from EAS dashboard with testers.
8. Testers install from those links directly (no Expo Go required).

### iOS-specific note

For iPhone testers outside your device list, simplest public testing path is TestFlight:

```bash
npm run eas:submit:ios
```

Then invite testers via App Store Connect TestFlight.

## Notes

- Prototype family ID is fixed to `11111111-1111-1111-1111-111111111111` in the UI.
- For real login and writes, configure Supabase Auth users and use their UUIDs in `seed.sql`.
- Matrix room discovery uses joined rooms from the access token account.
- Shared calendar events in the Expo app are now synced through Supabase when env vars are set. Recurring events are currently local-only in the prototype.
- Live mode onboarding now supports family creation/join via `family code + family password` directly in the app after sign in.
- Live mode now also stores per-care-group `display name` on membership, and the app uses it in requests/chat attribution.
- Account signup now includes `username`; onboarding suggests it as the initial care-group display name.
- Display names are unique per care group at DB level to prevent member name collisions.
- Requests now require selecting affected members and required approvers; approvals are tracked per request via member IDs.
- Assistive communication now uses explicit intervention states (`informational`, `assistive`, `restricted`) with a local AI adapter that is prepared for future API-backed replacement.
