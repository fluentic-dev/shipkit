# Security

Shipkit is intended to become a paid local build tool. Keep secrets out of this repository.

## Do not commit

- npm tokens
- Polar API tokens or webhook secrets
- Apple `.p12` files, provisioning profiles, or passwords
- Android keystores or keystore passwords
- private signing keys used for entitlement tokens
- private Rust native source code

## GitHub repository settings

Recommended settings once this repo is on GitHub:

- Enable branch protection for `main`.
- Require the `CI` workflow before merging.
- Require pull request review before merging.
- Disable GitHub Actions write permissions by default.
- Keep Dependabot enabled for npm and GitHub Actions.

## Required secrets for future publishing

Only add these when you are ready to publish:

- `NPM_TOKEN`: npm automation token scoped to publishing `@fluentic/*`.

The release workflow will not publish unless the repository variable
`NPM_PUBLISH_ENABLED` is set to `true`, and it uses the protected
`npm-release` environment.

## Reporting vulnerabilities

Until a private security contact is configured, report vulnerabilities directly to the repository
owner.
