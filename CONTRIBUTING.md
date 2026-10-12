# Contributing

## Branches

`main` is the only long-lived branch. Work happens on short topic branches and lands through pull requests. Every push to `main` is a preview: CI builds the VSIX and publishes it to the Marketplace **pre-release** channel as `<year>.<month><day>.<run number>`, for example `2026.1012.10`. Users on the release channel are never moved to a preview.

## Working locally

```sh
npm ci
npm run build
npm test
```

The conformance tests run against the CCScript 1.337 reference compiler's own test scripts, vendored under `packages/ccscript-core/reference-tests`. `scripts/setup-ccscript-compiler.sh` fetches the full compiler distribution if you want the compiler itself or its documentation; starmen.net sits behind a browser challenge, so it may need a manual download.

`npm run vsce:package -w packages/vscode-extension` builds the VSIX. Press F5 in VS Code to run the extension from source; the **Run Extension (MaternalBound-Redux)** launch opens a real CoilSnake project from the submodule (`git submodule update --init MaternalBound-Redux`).

## CI

| Job | When | What |
| --- | --- | --- |
| Test | every PR and push to `main` | lint, build and unit tests on Linux and Windows |
| VSIX | after Test | packages the extension; the artifact is on the run |
| Publish preview | pushes to `main` only | publishes the VSIX to the Marketplace pre-release channel |

## Releases

Releases are cut by hand from the Actions tab: run **Release** on `main` with a version `X.Y.Z`. The workflow builds the VSIX with that version, creates the `vX.Y.Z` tag and a GitHub release holding it, then publishes it to the Marketplace. Nothing in the repo needs editing for a release.

Releases are plain `X.Y.Z` and previews are date-based, so the two channels never collide and every preview sorts above every release. That is deliberate: VS Code moves users to the highest version in their channel, so pre-release users stay on previews until they switch channels. Tick **prerelease** on a manual release only if you want a hand-cut pre-release; untick **publish** for a dry run that only creates a draft GitHub release.

## Commit messages

Imperative subject line under 72 characters, a blank line, then the why. No attribution trailers.
