# Releasing the Pi extension

This is the per-repo release file. The full cross-family runbook
(branching strategy, semver rules, version-coordination across the
plugin family) lives in the monorepo at
[`the-librarian/docs/release-runbook.md`](https://github.com/JimJafar/the-librarian/blob/main/docs/release-runbook.md).
Read that first if you're new to releases here.

## When to cut a release

Any merged PR that's user-visible (lifecycle hook change, MCP wiring
change, install / config change, README claim change) earns a release.
Internal-only refactors, test-only changes, and CI-only changes don't.

A coordinated cross-repo change ships at the **same MINOR version**
as the monorepo. PATCH numbers drift freely.

## Semver, the short version

- **MAJOR** — lifecycle hook signature break, removal of a public
  export, install path break.
- **MINOR** — new lifecycle hook, new MCP wiring, additive feature,
  new env var with a default.
- **PATCH** — bug fix, doc tweak, internal refactor, test-only change.

## Pi specifics: git-installed, version in package.json

Users install via `pi install git:github.com/JimJafar/the-librarian-pi-extension`
which clones the repo and reads `package.json`. The git tag is the
release anchor; updating users get the latest tagged commit via
`pi update the-librarian-pi-extension`.

## Steps

```sh
cd ~/code/the-librarian-pi-extension
git checkout main && git pull

# 1. Bump package.json
NEW=<X.Y.Z>
jq ".version = \"$NEW\"" package.json > tmp && mv tmp package.json

# 2. Move CHANGELOG [Unreleased] entries under [vX.Y.Z] - YYYY-MM-DD.
$EDITOR CHANGELOG.md

# 3. Branch, commit, PR
git checkout -b release/v$NEW
git add -A
git commit -m "chore(release): v$NEW"
git push -u origin release/v$NEW
gh pr create --title "chore(release): v$NEW"

# 4. After CI green + merge
git checkout main && git pull
git tag -a v$NEW -m "v$NEW"
git push origin v$NEW
gh release create v$NEW --title "v$NEW" --notes-from-tag
```
