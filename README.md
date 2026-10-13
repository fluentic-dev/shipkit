# Shipkit

`@fluentic/shipkit` is a local native build CLI for Expo and React Native apps.

This public repository contains the TypeScript CLI, Expo plugin, runtime env helper, examples, and
documentation. Protected build execution and license enforcement live in the private Rust native
repository.

## Development

```bash
pnpm install
pnpm --filter @fluentic/shipkit dev license activate SHIPKIT-DEV-ALLOW
pnpm --filter @fluentic/shipkit dev doctor
pnpm --filter @fluentic/shipkit dev build android --env demo --apk
```

This scaffold includes a development-only JS native fallback so the TypeScript CLI can be tried
without the private native package.

## CI and Release

GitHub Actions are included for:

- `CI`: TypeScript checks, linting, and formatting.
- `Release`: tag-driven guarded npm publishing for the public TS package.

Publishing is intentionally disabled by default. To enable it later, add an `NPM_TOKEN` secret,
create an `npm-release` environment, and set repository variable `NPM_PUBLISH_ENABLED=true`.

Native `.node` platform packages are built and published from the private `shipkit-private`
repository.
