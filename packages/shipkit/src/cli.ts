import { cancel, isCancel, password, select } from '@clack/prompts';
import { defineCommand, runMain } from 'citty';
import os from 'node:os';
import path from 'node:path';
import { loadShipkitConfig } from './config.js';
import {
  printError,
  printEvent,
  printIntro,
  printNote,
  printOutro,
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

function runNativeJson(fn: (input: string) => string, input: unknown) {
  try {
    const result = fn(JSON.stringify(input));
    return JSON.parse(result) as unknown;
  } catch (error) {
    printError(error);
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

function objectEntries<T extends Record<string, boolean>>(value: T) {
  return Object.entries(value) as Array<[keyof T & Artifact, boolean]>;
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
            appDir: process.cwd(),
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
      printIntro(`Shipkit ${platform}`);

      const loadTask = startSpinner('Loading build configuration');
      let config: BuildManifest;
      try {
        config = await loadShipkitConfig(configPath);
        loadTask.stop('Build configuration ready');
      } catch (error) {
        loadTask.error('Build configuration failed');
        throw error;
      }

      const selected = await selectBuildVariant(config, args.env);
      const artifacts = resolveArtifacts(platform, selected, args);

      if (artifacts.length === 0) {
        throw new Error(`No ${platform} build targets are enabled for variant "${selected.name}".`);
      }

      printNote('Build', [
        `Variant  ${selected.name}`,
        `Env      ${selected.env}`,
        `Targets  ${artifacts.join(', ')}`,
        `App      ${path.relative(process.cwd(), appDir) || '.'}`
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

        const buildTask = startSpinner(`Running ${platform} ${artifact} build`);
        const result = runNativeJson((json) => native.runBuild(json, nativeRequestHandler), input);

        if (result) {
          buildTask.stop(`${platform} ${artifact} finished`);
        } else {
          buildTask.error(`${platform} ${artifact} failed`);
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

const mainCommand = defineCommand({
  meta: {
    name: 'shipkit',
    description: 'Local native builds for Expo and React Native.'
  },
  subCommands: {
    build: buildCommand,
    doctor: defineCommand({
      meta: {
        name: 'doctor',
        description: 'Check that the native bridge can run.'
      },
      args: {
        appDir: {
          type: 'string',
          description: 'Expo app directory.'
        }
      },
      run({ args }) {
        printIntro('Shipkit Doctor');
        const result = runNativeJson(
          (input) => native.runCommand(input, nativeRequestHandler),
          {
            appDir: appDirFromArgs(process.cwd(), args.appDir),
            command: 'doctor',
            homeDir: os.homedir()
          }
        );
        if (result) printOutro('Shipkit is ready.');
      }
    }),
    license: licenseCommand
  }
});

export function main() {
  return runMain(mainCommand);
}

main();
