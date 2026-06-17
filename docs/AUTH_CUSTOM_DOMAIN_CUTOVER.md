# Auth cutover: fixing Safari/iOS login with a custom domain

## The problem this solves
Today the frontend (`*.vercel.app`) and backend (`*.onrender.com`) are on **different
registrable domains**. With `SESSION_SECURE=true` the session cookie is
`SameSite=None; Secure`, which makes it a **third-party cookie** from the
frontend's perspective. Safari/iOS (ITP) block third-party cookies outright, and
Firefox/Brave block them under default privacy settings — so after GitHub OAuth
succeeds, the very next `/auth/me` call carries no cookie and login silently fails.
Chrome currently still allows it (which is why it appears to "work").

CORS is **not** the problem — it is correctly configured. The only fix is to make
the session cookie **first-party**, which means putting the FE and BE under one
parent domain.

## Target architecture
| Piece | Value (example) |
|-------|-----------------|
| Frontend | `https://app.example.com` (Vercel custom domain) |
| Backend  | `https://api.example.com` (Render custom domain) |
| Cookie `Domain` | `.example.com` (shared, first-party across subdomains) |

Because `app.example.com` and `api.example.com` share the registrable domain
`example.com`, the cookie is same-site / first-party → Safari sends it. Done.

## Cutover checklist (config-only — the code already supports it)

1. **DNS / custom domains**
   - Add `app.example.com` as a custom domain on the Vercel project.
   - Add `api.example.com` as a custom domain on the Render service.

2. **Backend env (Render)**
   ```
   FRONTEND_URL=https://app.example.com
   GITHUB_CALLBACK_URL=https://api.example.com/api/v1/auth/github/callback
   SESSION_COOKIE_DOMAIN=.example.com        # ← the hook added for this; leading dot
   ALLOWED_ORIGINS=https://app.example.com
   SESSION_SECURE=true                        # unchanged
   ```
   `SESSION_COOKIE_DOMAIN` is read in `src/config/app.config.ts` and applied to the
   cookie in `src/main.ts`. When unset, the cookie stays host-only (today's
   behavior) — so setting it is the entire backend change.

3. **Frontend env (Vercel)**
   ```
   NEXT_PUBLIC_API_URL=https://api.example.com
   ```

4. **GitHub OAuth App** (github.com → Settings → Developer settings → OAuth Apps)
   - Set **Authorization callback URL** to:
     `https://api.example.com/api/v1/auth/github/callback`
   - This must EXACTLY match `GITHUB_CALLBACK_URL`. (OAuth Apps allow only one
     callback URL — this is why preview-branch URLs can't be used for auth.)

5. **Redeploy** both services so the new env is picked up.

## Verify after cutover
- Open `https://app.example.com` **in Safari (or any iPhone)** and log in with GitHub.
- After the redirect, you should land on `/home` signed in (not bounced back to login).
- In Safari DevTools → Storage, confirm the `flowci_sid` cookie shows `Domain=.example.com`.

## Notes
- With a shared parent domain you *could* switch `sameSite` to `'lax'` (slightly
  stricter); `'none' + Secure` also works and is what the code uses when
  `SESSION_SECURE=true`. No change required.
- Preview deploys on dynamic `*.vercel.app` URLs will still have the third-party
  cookie limitation, because the GitHub OAuth callback is pinned to one domain.
  Auth testing should be done on the stable custom domain.
