# Release candidate checklist

This checklist creates and verifies a local 0.1.0 candidate only. Do not publish
it, create a Git tag or hosted release, or deploy it.

## Repository gates and archive inspection

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm build && pnpm vitest run tests/package/packed-cli.test.ts
pnpm pack --json
tar -tzf releasemango-0.1.0.tgz
```

Confirm the archive contains only the manifest, README, changelog, license,
`dist`, `scenarios/tutorial-01.yml`, and the required `fixtures/tiny-node-api`
runtime subset.

## Clean temporary consumer

Run from the repository root after packing. The pnpm store is populated by the
frozen repository install; `--offline` prevents registry access.

```sh
consumer="$(mktemp -d "${TMPDIR:-/tmp}/releasemango-consumer.XXXXXX")"
trap 'rm -rf "$consumer"' EXIT
pnpm --dir "$consumer" add --offline "$PWD/releasemango-0.1.0.tgz"
cli="$consumer/node_modules/.bin/releasemango"
workspace="$consumer/tutorial"
"$cli" --version
"$cli" new tutorial-01 "$workspace" --seed 16
cd "$workspace"
"$cli" brief
"$cli" status
"$cli" hint
# Use ordinary Git commands to assemble release/acceptance and release/production.
"$cli" evaluate acceptance
"$cli" evaluate production
cd /
rm -rf "$consumer"
trap - EXIT
```

Only remove the path created by `mktemp`; never use an unverified or broad path
for cleanup.
