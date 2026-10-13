# Shipkit

`@fluentic/shipkit` is a local native build CLI for Expo and React Native apps.

This public repository contains the TypeScript CLI, Expo plugin, runtime env helper, examples, and
documentation. Protected build execution and license enforcement live in the private Rust native
repository.

## Repository Layout

```text
packages/shipkit/       Public TypeScript CLI, Expo plugin, and runtime env helper
examples/expo/          Expo CNG example app
private/                Optional private Rust native core submodule
```

The private submodule is intentionally visible so users can understand the product boundary:
the public package owns ergonomics and integration, while the private native core owns protected
execution and license enforcement.

Public development does not require access to the private submodule.

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

## Private Core

Maintainers with access can initialize the private native core:

```bash
git submodule update --init private
```

If you do not have access, this step will fail and can be ignored for public package work.
