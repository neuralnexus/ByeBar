# Custom domain: byebar.mattivan.com

The site in `docs/` deploys via GitHub Pages. `docs/CNAME` tells GitHub which hostname to serve.

**Both** are required:

1. `docs/CNAME` in the repo (already added)
2. Custom domain set under repo **Settings → Pages** (or the site 404s on your domain)

Default project URL: `https://neuralnexus.github.io/ByeBar/`  
Custom domain URL: `https://byebar.mattivan.com/` (no `/ByeBar` path)

## DNS

At your DNS host for `mattivan.com`:

| Type  | Name     | Target                  | Proxy (Cloudflare) |
| ----- | -------- | ----------------------- | ------------------ |
| CNAME | `byebar` | `neuralnexus.github.io` | DNS only (grey cloud) |

Do **not** use A records for `byebar` unless you know you need them. GitHub expects a CNAME to `neuralnexus.github.io` for project sites.

### Cloudflare

If you see Cloudflare IPs (`104.21.x.x`, `172.67.x.x`) and `dig byebar.mattivan.com CNAME` is empty, the record is wrong or proxied without a CNAME target.

Fix:

1. Delete any `byebar` A records
2. Add CNAME `byebar` → `neuralnexus.github.io`
3. Turn proxy **off** (grey cloud) until GitHub shows the domain as verified and HTTPS works
4. Optional: re-enable orange cloud after HTTPS is live

SSL/TLS mode: **Full** or **Full (strict)**

## GitHub

1. Repo **Settings → Pages**
2. Custom domain: `byebar.mattivan.com`
3. Wait for DNS check to pass
4. Enable **Enforce HTTPS**

## Verify

```bash
dig byebar.mattivan.com CNAME +short
# should show: neuralnexus.github.io

curl -sI https://byebar.mattivan.com/
# should return HTTP 200
```

GitHub DNS health (repo admin):

```bash
gh api repos/neuralnexus/ByeBar/pages/health
```

Look for `"is_cname_to_github_user_domain": true` and `"is_https_eligible": true`.

## After DNS propagates

- https://byebar.mattivan.com/
- https://byebar.mattivan.com/privacy.html