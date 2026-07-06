# Custom domain: byebar.mattivan.com

The site in `docs/` deploys via GitHub Pages.

**Custom domain in GitHub:** repo **Settings → Pages** → `byebar.mattivan.com`

Do **not** commit `docs/CNAME`. When that file is bundled in the Pages artifact, GitHub validates DNS on every deploy and rejects the build while Cloudflare uses proxied A records instead of a CNAME to `neuralnexus.github.io`.

Default project URL: `https://neuralnexus.github.io/ByeBar/`  
Custom domain URL: `https://byebar.mattivan.com/` (no `/ByeBar` path)

## Why deploys fail (fix this first)

If the **Deploy GitHub Pages** workflow fails with `Deployment failed, try again later`, GitHub cannot publish a new build for the custom domain. The usual cause is **Cloudflare proxying without a CNAME to GitHub**.

Check:

```bash
gh api repos/neuralnexus/ByeBar/pages/health --jq '.domain | {is_https_eligible, is_cname_to_github_user_domain, is_proxied, has_cname_record}'
```

You want:

```json
{
  "is_https_eligible": true,
  "is_cname_to_github_user_domain": true,
  "is_proxied": false,
  "has_cname_record": true
}
```

If `is_proxied` is `true` and `has_cname_record` is `false`, fix DNS below before redeploying.

## DNS (Cloudflare)

At your DNS host for `mattivan.com`:

| Type  | Name     | Target                  | Proxy (Cloudflare)    |
| ----- | -------- | ----------------------- | --------------------- |
| CNAME | `byebar` | `neuralnexus.github.io` | DNS only (grey cloud) |

Do **not** use A records for `byebar`. Delete any `byebar` A/AAAA records.

### Cloudflare steps

1. **DNS → Records**
2. Delete all `byebar` **A** and **AAAA** records
3. Add **CNAME** `byebar` → `neuralnexus.github.io`
4. Set proxy to **DNS only** (grey cloud) until GitHub verifies the domain and issues HTTPS
5. Wait 5–30 minutes

SSL/TLS mode: **Full** or **Full (strict)** (after GitHub cert exists)

Optional: re-enable orange-cloud proxy only **after** GitHub Pages shows the domain as verified and **Enforce HTTPS** works.

## GitHub

1. Repo **Settings → Pages**
2. Custom domain: `byebar.mattivan.com`
3. Wait for DNS check to pass (green)
4. Enable **Enforce HTTPS** (only after DNS is correct)

Redeploy after DNS is fixed:

```bash
gh workflow run pages.yml
```

## Verify

```bash
dig byebar.mattivan.com CNAME +short
# should show: neuralnexus.github.io

gh api repos/neuralnexus/ByeBar/pages/health --jq '.domain.is_https_eligible'
# should show: true

curl -sI https://byebar.mattivan.com/
# should return HTTP 200
```

## After DNS propagates

- https://byebar.mattivan.com/
- https://byebar.mattivan.com/support.html
- https://byebar.mattivan.com/privacy.html
