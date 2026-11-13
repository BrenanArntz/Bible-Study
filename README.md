# Scripture Study

A JavaScript study-notes app hosted on GitHub Pages. Supabase provides sign-in, a private database for Markdown notes, private image storage, and Edge Functions for ESV lookup and Gemini transcription. The app does not need a local Python server.

## Supabase setup

1. In the Supabase SQL Editor for your project, run [`supabase/migrations/20261113000000_create_study_notes.sql`](supabase/migrations/20261113000000_create_study_notes.sql). It creates the notes table, owner-only row-level security policies, and a private image bucket with per-user policies.
2. In Authentication settings, disable public sign-ups. Create each permitted user with an email and password in the Supabase dashboard. The app signs in existing accounts only; it does not provide public registration.
3. Configure the Supabase Auth site URL and redirect allowlist to include your GitHub Pages URL, for example `https://<github-user>.github.io/<repository>/`.
4. Deploy the Edge Functions from the repository root with the Supabase CLI:

   ```powershell
   supabase login
   supabase link --project-ref <project-ref>
   supabase functions deploy esv-lookup --use-api
   supabase functions deploy transcribe-image --use-api
   ```

5. Add `ESV_API_KEY` and `GEMINI_API_KEY` as Supabase Edge Function secrets in the Supabase dashboard. Never put these API keys in the frontend or GitHub repository. If either integration is not configured, the app reports that; browser OCR is the transcription fallback.

The Supabase URL and publishable/anon key in `frontend/supabase-config.js` are public client configuration. Security depends on the included row-level security and storage policies, not on hiding this key. Never use a Supabase `service_role` key in the browser.

## GitHub Pages

The workflow at `.github/workflows/pages.yml` publishes only `frontend/` and enables Pages for GitHub Actions on its first run. If deployment fails, verify **Settings → Pages → Build and deployment → Source** is set to **GitHub Actions**. Notes, Python environments, and local configuration are not deployed.

## First use and importing notes

1. Open the deployed Pages URL and sign in with an account and password created in Supabase.
2. Choose **Import local notes** and select the local `notes/` folder. This copies Markdown notes and image attachments into the signed-in Supabase account. Existing notes with the same path are skipped. The importer does not delete or modify the local originals.
3. The app keeps each account's notes separate with database and Storage row-level security policies.

Images are uploaded to a private Supabase Storage bucket. The upload page supports camera and gallery selection, attaching pages to existing notes, and transcription. Gemini receives images only when its Edge Function secret is configured; otherwise a browser OCR engine is loaded on demand. The original images stay in your private storage.

## Current project files

- `frontend/`: static pages, styles, and JavaScript for the GitHub Pages app.
- `supabase/migrations/`: database schema and access policies.
- `supabase/functions/`: server-side integrations; secrets remain in Supabase.
- `notes/`: local source material for import; excluded from Git.
- The previous Python server, dependency list, start script, and server-only tests have been removed. The local `.venv/` and `.env` are ignored and are not used by the hosted app.
