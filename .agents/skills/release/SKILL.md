---
name: release
description: Release a new version of halc to npm. Use when the user wants to release, publish or tag a version, or asks how releasing works.
---

# Releasing halc

Releases are published to npm by the GitHub Actions workflow `.github/workflows/release.yml`
whenever a GitHub release is published. The workflow checks that the tag (`vX.Y.Z`) matches the
version in `package.json`, runs lint, typecheck, tests, build and the package checks, and publishes
with npm trusted publishing (OIDC, with provenance). Prereleases go to the npm dist-tag `next`.

A release therefore consists of: a release commit on `main` (version + changelog), a tag, and a
GitHub release. Follow these steps; a human can follow them just the same.

## 1. Check the state

```bash
git switch main && git pull
git status                 # must be clean
gh run list --branch main --limit 3   # CI on main must be green
git describe --tags --abbrev=0        # the previous release (none before the first one)
```

## 2. Choose the version

Look at the commits since the previous tag (`git log --oneline <previous tag>..HEAD`); they follow
Conventional Commits. Apply semantic versioning:

- a breaking change (`!` after the type, or `BREAKING CHANGE:` in the body) → major
- `feat:` → minor
- only `fix:`, `perf:`, `docs:`, `test:`, `chore:` … → patch
- `chore(deps)` updates of dev dependencies only → usually no release needed

Propose the version to the user and let them confirm it before continuing. For a prerelease, use
e.g. `1.1.0-beta.1`.

## 3. Update version and changelog

```bash
npm version <version> --no-git-tag-version   # updates package.json and package-lock.json
```

In `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)): rename the
`[Unreleased]` section (or create the section from the commits, grouped into Added / Changed /
Deprecated / Removed / Fixed / Security, written for users, not as a commit list) to
`## [<version>] - <YYYY-MM-DD>`, add a fresh empty `## [Unreleased]` section above it, and update
the link references at the bottom:

```markdown
[Unreleased]: https://github.com/ecamp/halc/compare/v<version>...HEAD
[<version>]: https://github.com/ecamp/halc/compare/v<previous>...v<version>
```

For the first release, the link is `https://github.com/ecamp/halc/releases/tag/v<version>`.

Then verify locally and commit:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run check:package
git commit -am "chore(release): v<version>"
```

## 4. Tag, push and create the GitHub release

Ask the user before pushing and creating the release: publishing to npm cannot be undone (npm only
allows unpublishing within 72 hours, and never reusing a version).

```bash
git tag -a v<version> -m "v<version>"
git push origin main v<version>
gh release create v<version> --title "v<version>" --notes-file <(sed -n '/^## \[<version>\]/,/^## \[/p' CHANGELOG.md | sed '1d;$d')
# for a prerelease, add --prerelease
```

## 5. Follow the publish

```bash
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
npm view halc version dist-tags
```

If the workflow fails before publishing, fix the problem on `main`, then delete and recreate the
release and tag (`gh release delete v<version> --cleanup-tag`) once the fix is in. If it fails after
publishing, the version is taken: release a new patch version instead.

## One-time setup (before the first release)

1. On GitHub (ecamp/halc → Settings → Environments), create the environment `npm`, optionally with
   required reviewers so every release needs an approval.
2. npm trusted publishing can only be configured for a package that exists. Publish the first
   version once by hand from a clean checkout of the release commit, by an owner of the npm package
   name (with 2FA):

   ```bash
   npm ci && npm run build && npm run check:package
   npm publish --access public
   ```

   (Skip step 5 of the regular process for this version; create the GitHub release anyway, its
   workflow run will fail because the version already exists, which is fine.)

3. On npmjs.com (halc → Settings → Trusted publishing), add a GitHub Actions trusted publisher:
   organization `ecamp`, repository `halc`, workflow `release.yml`, environment `npm`. Then, under
   Publishing access, require two-factor authentication and disallow tokens, so only the workflow
   can publish.
4. Add the other maintainers as owners of the npm package (`npm owner add <user> halc`).
