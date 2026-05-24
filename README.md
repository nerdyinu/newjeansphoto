# newjeans-random

Click-to-shuffle viewer for random NewJeans member photos. Pulls hashes from a checked-in `manifest.json` and renders images directly from `static.newjeans.network`. Pure static site — no build, no backend.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Refresh the photo manifest

```sh
node scripts/build-manifest.mjs
```

Crawls all five member sites (`minji.network` etc.), takes 5–15 minutes, writes `manifest.json`. A GitHub Actions cron also runs this weekly and commits if the manifest changed (`.github/workflows/refresh-manifest.yml`).

Env knobs for the builder:
- `LIMIT_MEMBERS=hyein,minji` — only crawl named members
- `LIMIT_PAGES=2` — only fetch first N pages per member (for smoke tests)
- `CONCURRENCY=6` — in-flight request cap (default 6)

## Deploy

Push to `main`. `.github/workflows/deploy.yml` publishes to GitHub Pages. One-time setup: repo Settings → Pages → Source: "GitHub Actions".

## Credits

Photos belong to their respective members. Source sites and CDN are operated by the fan community behind `newjeans.network`.
