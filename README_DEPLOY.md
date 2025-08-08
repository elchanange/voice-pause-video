# Deploying Voice‑Pause‑Video

## GitHub Pages (recommended)
1. Create a new repo and push this folder.
2. Ensure your default branch is `main`.
3. The provided workflow at `.github/workflows/pages.yml` auto-builds and publishes on push.
4. Enable Pages in repo Settings → Pages → Source: GitHub Actions. Wait for green check, then open the URL shown.

## Netlify
- Drag & drop this folder into app.netlify.com → "Add new site".
- Or connect the repo. Command is `npm run build` (already in `netlify.toml`). Publish directory: `.`

## Vercel
- `vercel` → follow prompts (or import repo via dashboard). Uses `vercel.json` to serve as a static site.
