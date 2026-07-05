# Custom domain: byebar.mattivan.com

The site in `docs/` deploys via GitHub Pages. `docs/CNAME` points the site at **byebar.mattivan.com**.

## DNS (one-time)

At your DNS host for `mattivan.com`, add:

| Type  | Name    | Target                 |
| ----- | ------- | ---------------------- |
| CNAME | `byebar` | `neuralnexus.github.io` |

If you use Cloudflare, **DNS only** (grey cloud) is safest until GitHub provisions HTTPS; you can enable the proxy afterward.

## GitHub (one-time)

1. Repo **Settings → Pages**
2. Under **Custom domain**, enter `byebar.mattivan.com` and save
3. Wait for the DNS check, then enable **Enforce HTTPS**

The `Deploy GitHub Pages` workflow redeploys on every push to `main`; no extra build step.

## After DNS propagates

- https://byebar.mattivan.com/
- https://byebar.mattivan.com/privacy.html

The old URL (`neuralnexus.github.io/ByeBar/`) may keep working as a redirect once the custom domain is active.