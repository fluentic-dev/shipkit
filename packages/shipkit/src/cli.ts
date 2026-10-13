import { cancel, isCancel, password, select } from '@clack/prompts';
import { defineCommand, runMain } from 'citty';
import os from 'node:os';
import path from 'node:path';
import { getShipkitEnvSnapshot } from './config-env.js';
import { loadShipkitConfig } from './config.js';
import {
  createNativeLogView,
  type NativeLogMode,
  printError,
  printEvent,
  printIntro,
  printListPanel,
  printOutro,
  printPanel,
  startSpinner
} from './logger.js';
import { createNativeRequestHandler } from './native-bridge.js';
import { loadNative } from './native.js';
import type {
  Artifact,
  BuildManifest,
  NativeBuildInput,
  Platform,
  ResolvedBuildVariantConfig
} from './types.js';

const native = loadNative();
const nativeRequestHandler = createNativeRequestHandler(printEvent);

function appDirFromArgs(cwd: string, appDir?: string) {
  return path.resolve(cwd, appDir ?? process.cwd());
}

function configPathFromArgs(appDir: string, config?: string) {
  return path.resolve(appDir, config ?? 'build.config.ts');
}

async function loadBuildManifest(configPath: string) {
  const loadTask = startSpinner('Resolving build config');

  try {
    const config = await loadShipkitConfig(configPath);
    loadTask.clear();
    return config;
  } catch (error) {
    loadTask.error('Build config failed');
    throw error;
  }
}

function runNativeJson(
  fn: (input: string) => string,
  input: unknown,
  options?: { onError?: (error: unknown) => void; }
) {
  try {
    const result = fn(JSON.stringify(input));
    return JSON.parse(result) as unknown;
  } catch (error) {
    if (options?.onError) {
      options.onError(error);
    } else {
      printError(error);
    }

    process.exitCode = 1;
    return null;
  }
}

function assertNoRemovedBuildFlags(argv: string[]) {
  const dryRunFlag = argv.find((arg) => /^--dry-?run(?:=.*)?$/i.test(arg));
  if (dryRunFlag) {
    throw new Error(`${dryRunFlag} was removed. Shipkit build now always runs the build.`);
  }
}

async function selectBuildVariant(config: BuildManifest, name?: string) {
  if (name) {
    const match = config.variants.find((item) => item.name === name);
    if (!match) {
      throw new Error(
        `Unknown build variant "${name}". Available variants: ${listVariants(config)}.`
      );
    }

    return match;
  }

  if (config.variants.length === 1) {
    return config.variants[0]!;
  }

  if (!process.stdin.isTTY) {
    throw new Error(`Build variant is required. Available variants: ${listVariants(config)}.`);
  }

  const answer = await select({
    message: 'Select build variant',
    options: config.variants.map((variant) => ({
      ...(variant.env === variant.name ? {} : { hint: `env ${variant.env}` }),
      label: variant.name,
      value: variant.name
    }))
  });

  if (isCancel(answer)) {
    cancel('Build cancelled.');
    process.exit(0);
  }

  const match = config.variants.find((item) => item.name === answer);
  if (!match) {
    throw new Error(
      `Invalid build variant selection "${answer}". Available variants: ${listVariants(config)}.`
    );
  }

  return match;
}

async function resolveLicenseKey(key?: string) {
  if (key) return key;

  if (!process.stdin.isTTY) {
    throw new Error(
      'License key is required. Pass it as an argument or run in an interactive terminal.'
    );
  }

  const answer = await password({
    message: 'Enter your Shipkit license key',
    validate(value) {
      if (!value?.trim()) return 'License key is required.';
      return undefined;
    }
  });

  if (isCancel(answer)) {
    cancel('Activation cancelled.');
    process.exit(0);
  }

  return answer;
}

function listVariants(config: BuildManifest) {
  return config.variants.map((item) => item.name).join(', ');
}

function findBuildVariant(config: BuildManifest, name?: string) {
  if (!name) return null;
  const match = config.variants.find((item) => item.name === name);
  if (!match) {
    throw new Error(
      `Unknown build variant "${name}". Available variants: ${listVariants(config)}.`
    );
  }

  return match;
}

function resolveArtifacts(
  platform: Platform,
  variant: ResolvedBuildVariantConfig,
  args: Record<string, unknown>
) {
  const target = normalizeTarget(typeof args.target === 'string' ? args.target : undefined);

  if (target) {
    assertPlatformTarget(platform, target);
    return [target];
  }

  if (platform === 'ios') {
    return resolveIosArtifacts(variant, args);
  }

  return resolveAndroidArtifacts(variant, args);
}

function resolveAndroidArtifacts(
  variant: ResolvedBuildVariantConfig,
  args: Record<string, unknown>
): Artifact[] {
  const targets = {
    apk: variant.apk,
    aab: variant.aab
  };

  applyBooleanOverride(targets, 'apk', args.apk);
  applyBooleanOverride(targets, 'aab', args.aab);

  return objectEntries(targets)
    .filter(([, enabled]) => enabled)
    .map(([target]) => target);
}

function resolveIosArtifacts(
  variant: ResolvedBuildVariantConfig,
  args: Record<string, unknown>
): Artifact[] {
  const targets = {
    ipa: variant.ipa
  };

  applyBooleanOverride(targets, 'ipa', args.ipa);

  return targets.ipa ? ['ipa'] : [];
}

function normalizeTarget(target: string | undefined): Artifact | null {
  if (!target) return null;
  if (target === 'apk' || target === 'aab' || target === 'ipa') return target;
  throw new Error(`Invalid target "${target}". Expected apk, aab, or ipa.`);
}

function assertPlatformTarget(platform: Platform, target: Artifact) {
  if (platform === 'android' && target === 'ipa') {
    throw new Error('Android builds support apk or aab targets.');
  }

  if (platform === 'ios' && target !== 'ipa') {
    throw new Error('iOS builds support ipa targets.');
  }
}

function applyBooleanOverride<T extends Record<string, boolean>>(
  targets: T,
  key: keyof T,
  value: unknown
) {
  const parsed = parseBooleanOverride(value);
  if (parsed !== null) {
    targets[key] = parsed as T[keyof T];
  }
}

function parseBooleanOverride(value: unknown) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    if (value === '' || value === 'true') return true;
    if (value === 'false') return false;
  }

  throw new Error(`Expected boolean override, got "${String(value)}".`);
}

function parseNativeLogMode(value: unknown): NativeLogMode {
  if (value === undefined) return 'auto';

  if (value === 'auto' || value === 'expanded' || value === 'collapsed') {
    return value;
  }

  if (value === 'show' || value === 'open') return 'expanded';
  if (value === 'hide' || value === 'closed') return 'collapsed';

  throw new Error('Native log mode must be auto, expanded, or collapsed.');
}

function objectEntries<T extends Record<string, boolean>>(value: T) {
  return Object.entries(value) as Array<[keyof T & Artifact, boolean]>;
}

function formatPlatform(platform: Platform) {
  return platform === 'ios' ? 'iOS' : 'Android';
}

function formatTargets(platform: Platform | null, variant: ResolvedBuildVariantConfig) {
  const targets: string[] = [];
  if (platform !== 'ios' && variant.apk) targets.push('apk');
  if (platform !== 'ios' && variant.aab) targets.push('aab');
  if (platform !== 'android' && variant.ipa) targets.push('ipa');
  return targets.join(', ') || 'none';
}

function formatFileName(variant: ResolvedBuildVariantConfig) {
  return variant.fileName.replaceAll('[env]', variant.env);
}

function formatOutputNames(variant: ResolvedBuildVariantConfig, artifacts: Artifact[]) {
  const baseName = formatFileName(variant);
  return artifacts.map((artifact) => `${baseName}.${artifact}`).join(', ');
}

function formatPathForDisplay(filePath: string) {
  return path.relative(process.cwd(), filePath) || '.';
}

function formatEnvEntries(envs: Record<string, unknown>) {
  return Object.entries(envs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${formatEnvValue(name, value)}`);
}

function formatEnvValue(name: string, value: unknown) {
  const text = String(value);
  if (/TOKEN|SECRET|PASSWORD|PASS|KEY|CERT|PROFILE|LICENSE/u.test(name)) {
    return text.length <= 4 ? '••••' : `${text.slice(0, 2)}••••${text.slice(-2)}`;
  }

  return text;
}

function parseOptionalPlatform(input: unknown): Platform | null {
  if (input === undefined) return null;
  if (input === 'android' || input === 'ios') return input;
  throw new Error('Platform must be android or ios.');
}

const licenseCommand = defineCommand({
  meta: {
    name: 'license',
    description: 'Manage Shipkit license activation.'
  },
  subCommands: {
    activate: defineCommand({
      meta: {
        name: 'activate',
        description: 'Activate a Shipkit license key.'
      },
      args: {
        key: {
          type: 'positional',
          description: 'License key. Development placeholder: SHIPKIT-DEV-ALLOW',
          required: false
        }
      },
      async run({ args }) {
        printIntro('Shipkit License');
        const licenseKey = await resolveLicenseKey(args.key);
        const result = runNativeJson(
          (input) => native.activateLicense(input, nativeRequestHandler),
          {
            homeDir: os.homedir(),
            licenseKey
          }
        );
        if (result) printOutro('License activated.');
      }
    }),
    status: defineCommand({
      meta: {
        name: 'status',
        description: 'Show current license state.'
      },
      run() {
        printIntro('Shipkit License');
        const result = runNativeJson(
          (input) => native.runCommand(input, nativeRequestHandler),
          {
            command: 'license-status',
            homeDir: os.homedir()
          }
        );
        if (result) printOutro('License check complete.');
      }
    })
  }
});

const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Run a protected local native build.'
  },
  args: {
    platform: {
      type: 'positional',
      description: 'Target platform.',
      required: true,
      valueHint: 'android|ios'
    },
    env: {
      type: 'positional',
      description: 'Build variant name from build.config.ts.',
      required: false
    },
    appDir: {
      type: 'string',
      description: 'Expo app directory.'
    },
    config: {
      type: 'string',
      description: 'Build config path relative to app dir.'
    },
    apk: {
      type: 'string',
      description: 'Override Android APK target. Use true or false.'
    },
    aab: {
      type: 'string',
      description: 'Override Android AAB target. Use true or false.'
    },
    ipa: {
      type: 'string',
      description: 'Override iOS IPA target. Use true or false.'
    },
    target: {
      type: 'string',
      description: 'Build one target: apk, aab, or ipa.'
    },
    logs: {
      type: 'string',
      description: 'Native logs display: auto, expanded, or collapsed.'
    },
    license: {
      type: 'string',
      description: 'License key override. Usually use shipkit license activate.'
    }
  },
  async run({ args }) {
    try {
      const platform = args.platform as Platform;
      if (platform !== 'android' && platform !== 'ios') {
        throw new Error('Platform must be android or ios.');
      }

      assertNoRemovedBuildFlags(process.argv);

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);
      printIntro(formatPlatform(platform), 'build');

      const config = await loadBuildManifest(configPath);
      const selected = await selectBuildVariant(config, args.env);
      const artifacts = resolveArtifacts(platform, selected, args);
      const nativeLogMode = parseNativeLogMode(args.logs);

      if (artifacts.length === 0) {
        throw new Error(`No ${platform} build targets are enabled for variant "${selected.name}".`);
      }

      printPanel('Build', [
        { label: 'Platform', value: formatPlatform(platform) },
        { label: 'Variant', value: selected.name },
        { label: 'Env', value: selected.env },
        { label: 'Targets', value: artifacts.join(', ') },
        { label: 'App', value: formatPathForDisplay(appDir) },
        { label: 'Output', value: formatOutputNames(selected, artifacts) }
      ]);

      let failed = false;

      for (const artifact of artifacts) {
        const input: NativeBuildInput = {
          appDir,
          artifact,
          config,
          env: selected.env,
          homeDir: os.homedir(),
          name: selected.name,
          platform
        };

        if (args.license) {
          input.licenseKey = args.license;
        }

        const nativeLogView = createNativeLogView({
          mode: nativeLogMode,
          title: `Running ${platform} ${artifact} build`
        });
        const buildRequestHandler = createNativeRequestHandler({
          onEvent: nativeLogView.event,
          onNativeLog: nativeLogView.nativeLog
        });

        let buildError: unknown;
        nativeLogView.start();
        const result = runNativeJson(
          (json) => native.runBuild(json, buildRequestHandler),
          input,
          {
            onError(error) {
              buildError = error;
            }
          }
        );

        if (result) {
          nativeLogView.finish(true);
        } else {
          nativeLogView.finish(false);
          if (buildError) printError(buildError);
          failed = true;
          break;
        }
      }

      printOutro(failed ? 'Shipkit build failed.' : 'Shipkit build complete.');
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  }
});

const infoCommand = defineCommand({
  meta: {
    name: 'info',
    description: 'Show Shipkit build configuration and env context.'
  },
  args: {
    platform: {
      type: 'positional',
      description: 'Optional target platform.',
      required: false,
      valueHint: 'android|ios'
    },
    env: {
      type: 'positional',
      description: 'Optional build variant name from build.config.ts.',
      required: false
    },
    appDir: {
      type: 'string',
      description: 'Expo app directory.'
    },
    config: {
      type: 'string',
      description: 'Build config path relative to app dir.'
    }
  },
  async run({ args }) {
    try {
      const platform = parseOptionalPlatform(args.platform);
      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);

      printIntro('Info');

      const config = await loadBuildManifest(configPath);
      const selected = findBuildVariant(config, args.env);
      const variants = selected ? [selected] : config.variants;
      const envSnapshot = getShipkitEnvSnapshot();
      const loadedEnvEntries = [
        ...Object.entries(envSnapshot.normal).map(([name, value]) => ({
          forced: false,
          name,
          value
        })),
        ...Object.entries(envSnapshot.forced).map(([name, value]) => ({
          forced: true,
          name,
          value
        }))
      ].sort((left, right) => left.name.localeCompare(right.name));
      const appEnvEntries = variants.flatMap((variant) =>
        formatEnvEntries(variant.envs).map((entry) => `${variant.name}: ${entry}`)
      );

      printPanel('Project', [
        { label: 'App', value: formatPathForDisplay(appDir) },
        { label: 'Config', value: formatPathForDisplay(configPath) },
        { label: 'Platform', value: platform ? formatPlatform(platform) : 'all' },
        { label: 'Prebuild env', value: process.env.SHIPKIT_ENV ?? process.env.ENV ?? 'not set' }
      ]);

      printListPanel(
        'Variants',
        variants.map((variant) =>
          `${variant.name}  env=${variant.env}  targets=${formatTargets(platform, variant)}  file=${
            formatFileName(variant)
          }`
        )
      );

      printListPanel(
        'Loaded envs',
        loadedEnvEntries.map((entry) =>
          `${entry.name}${entry.forced ? '!' : ''}=${formatEnvValue(entry.name, entry.value)}`
        )
      );

      printListPanel('App envs', appEnvEntries);
      printOutro('Shipkit info complete.');
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  }
});

const mainCommand = defineCommand({
  meta: {
    name: 'shipkit',
    description: 'Local native builds for Expo and React Native.'
  },
  subCommands: {
    build: buildCommand,
    info: infoCommand,
    license: licenseCommand
  }
});

export function main() {
  return runMain(mainCommand);
}

main();
