# temp-screenshots

Review evidence for open pull requests, kept **outside** `public/` so Vite never
copies it into `dist/` and it is never published to GitHub Pages.

Images here exist only so a PR body can embed them with commit-SHA-pinned raw
URLs (`.../raw/<sha>/temp-screenshots/<feature>/<name>.png`), which keep resolving
after the branch is deleted on merge. Safe to prune once a PR is merged — the
blobs stay reachable through the pinned historical commit.
