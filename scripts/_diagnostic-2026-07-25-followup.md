# Cloud sandbox network reachability diagnostic — follow-up — 2026-07-25

One-time follow-up diagnostic. Not a batch run. Purpose: test whether the
custom domain `api.kashvector.com` (set up in Cloudflare to route to the
same Worker as `stock-evaluator.anurag-kor.workers.dev`, verified working
from a normal internet connection) is reachable from this cloud sandbox,
as a possible workaround for the `*.workers.dev` egress block documented in
`scripts/_diagnostic-2026-07-25.md`.

## Timestamp

```
$ date -u
Sat Jul 25 06:31:14 UTC 2026
```

## Test 1 — custom domain (target): api.kashvector.com

```
$ curl -sS -o api_body.txt -w "HTTP_STATUS:%{http_code} TIME_TOTAL:%{time_total} EXIT:%{exitcode}\n" --max-time 20 "https://api.kashvector.com/search?q=AAPL"
curl: (56) CONNECT tunnel failed, response 403
HTTP_STATUS:000 TIME_TOTAL:0.327648 EXIT:56
CURL_EXIT_CODE: 56
```

`api_body.txt` was never created — curl failed before receiving any
response body (no file to show first-500-chars of).

Proxy status endpoint (`$HTTPS_PROXY/__agentproxy/status`) confirms this is
a policy-level block, not a DNS or upstream failure:

```json
{
  "ts": "2026-07-25T06:31:14.969Z",
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "api.kashvector.com:443"
}
```

## Test 2 — old workers.dev host (control): stock-evaluator.anurag-kor.workers.dev

```
$ curl -sS -o old_body.txt -w "HTTP_STATUS:%{http_code} TIME_TOTAL:%{time_total} EXIT:%{exitcode}\n" --max-time 20 "https://stock-evaluator.anurag-kor.workers.dev/search?q=AAPL"
curl: (56) CONNECT tunnel failed, response 403
HTTP_STATUS:000 TIME_TOTAL:0.365959 EXIT:56
CURL_EXIT_CODE: 56
```

`old_body.txt` was never created either.

```json
{
  "ts": "2026-07-25T06:31:15.346Z",
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "stock-evaluator.anurag-kor.workers.dev:443"
}
```

## Verdict

- **api.kashvector.com (target): NOT reachable.** Same `connect_rejected` /
  403-on-CONNECT failure as the `*.workers.dev` host, with the same timing
  profile (~0.33s, rejected before any TLS/HTTP round-trip).
- **stock-evaluator.anurag-kor.workers.dev (control): still NOT reachable,**
  as expected — consistent with the 2026-07-25 diagnostic.
- **Conclusion: the custom-domain workaround does NOT fix the problem.**
  The original hypothesis — that the block was specific to the
  `*.workers.dev` hostname pattern — is **falsified** by this test. Both a
  `*.workers.dev` host and an unrelated custom domain (`api.kashvector.com`)
  that both route to the same Cloudflare Worker are rejected identically at
  this sandbox's outbound proxy gateway. This points to either a default-deny
  egress policy (only explicitly allowlisted hosts pass) or a block on the
  underlying Cloudflare edge IP/network range rather than on hostname.
- **Recommendation:** do not rely on hostname-swapping as a fix. Either
  (a) explicitly add the needed host(s) to this sandbox environment's
  outbound network allowlist (see
  `https://code.claude.com/docs/en/claude-code-on-the-web` for how
  environment network policy is configured), or (b) continue running the
  `rank-*.js` batch refreshes from an environment already known to reach
  the Worker (per the `YAHOO_PROXY_URL_OVERRIDE` workaround added in commit
  `1b34500`, if that environment is reachable another way), rather than
  from this cloud sandbox.
