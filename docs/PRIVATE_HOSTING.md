# Private repository / public website

Public website: https://a-share-pulse-lxy-0924.reagan-park-6434.chatgpt.site

Sites project ID: `appgprj_6ab4a351f7c881918ae022a1ba0cf3b2`
GitHub source: `GitYx4029/Polaris-and-Compass`

## Continue editing with ChatGPT

The Sites project has a separate controlled Git source repository. A future ChatGPT session can use Sites `get_site`, `create_source_repository_write_credential` and the source workflow to reopen, edit and publish it without anonymous GitHub access. Website visibility is public; source access is controlled. Keep the Site and the current account connection.

GitHub collaboration is authorized separately: retain the GitHub connection's read/write grant for this repository after changing its visibility. If private-repository access is removed from the installed GitHub app, reselect this repository in that app's repository access settings. Do not make the repository public as a workaround or place a GitHub token in chat/browser code.

For future code changes, compare the latest Sites source and GitHub `main` before editing, preserve both histories, sync the intended source changes to both, and publish through Sites. Automated collection modifies datasets independently; never overwrite a collector's newer data with an old local checkout.

## GitHub Pages

Pages builds run only when repository variable `ENABLE_GITHUB_PAGES` is explicitly `true`. The default deployment target is Sites. Before making the repository private, verify the public Site and, where applicable, a real collection/publication/readback.

## Data pipeline

GitHub Actions keeps collection and verification independent of AI. After each successful collector it POSTs the allowed JSON file(s) to `/api/publish-data` with a short-lived GitHub OIDC identity. The Site validates the signed identity, immutable repository/owner IDs, main branch, workflow file, audience and expiration. Data is stored transactionally in D1 and read from `/api/data/<name>`. Older data cannot replace a newer session. Anonymous writes are rejected. No PAT is added to browser code, Site secrets or workflow files.

`publish-data.yml` can republish all four verified datasets without rebuilding the website. Each normal collector publishes only its own files. A Site deployment retains D1 data. The bundled snapshot is a dated fallback, never proof that a collector has run.

The optional external scheduler reads the public Site snapshot and still uses its existing scoped Actions credential only for dispatch. Deploy an updated scheduler if one was previously installed; this repository does not assert that the external Cloudflare scheduler is installed.

Private GitHub Actions consumes the account's included private-repository usage allowance; check actual workflow usage before switching visibility. No paid service or plan was enabled by this change.
