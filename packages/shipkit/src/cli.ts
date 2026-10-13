import { defineCommand, runMain } from 'citty';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { loadShipkitConfig } from './config.js';
import { printEvent, printHeader } from './logger.js';
import { loadNative } from './native.js';
import type {
  Artifact,
  BuildManifest,
  NativeBuildInput,
  Platform,
  ResolvedBuildVariantConfig
} from './types.js';

const native = loadNative();

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
    const message = error instanceof Error ? error.message : String(error);
    printEvent({ level: 'error', message });
    process.exitCode = 1;
    return null;
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

  printHeader('Shipkit Variants');
  config.variants.forEach((item, index) => {
    console.log(`${index + 1}. ${item.name}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = (await rl.question('Select variant: ')).trim();
  rl.close();

  const index = Number(answer);
  const match = Number.isInteger(index)
    ? config.variants[index - 1]
    : config.variants.find((item) => item.name === answer);

  if (!match) {
    throw new Error(
      `Invalid build variant selection "${answer}". Available variants: ${listVariants(config)}.`
    );
  }

  return match;
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
    aab: variant.abb
  };

  applyBooleanOverride(targets, 'apk', args.apk);
  applyBooleanOverride(targets, 'aab', args.aab ?? args.abb);

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
  if (target === 'abb') return 'aab';
  if (target === 'apk' || target === 'aab' || target === 'ipa') return target;
  throw new Error(`Invalid target "${target}". Expected apk, aab, abb, or ipa.`);
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
          required: true
        }
      },
      run({ args }) {
        printHeader('Shipkit License');
        runNativeJson(
          (input) => native.activateLicense(input, printEvent),
          {
            homeDir: os.homedir(),
            licenseKey: args.key
          }
        );
      }
    }),
    status: defineCommand({
      meta: {
        name: 'status',
        description: 'Show current license state.'
      },
      run() {
        printHeader('Shipkit License');
        runNativeJson(
          (input) => native.runCommand(input, printEvent),
          {
            appDir: process.cwd(),
            command: 'license-status',
            homeDir: os.homedir()
          }
        );
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
    abb: {
      type: 'string',
      description: 'Alias for --aab.'
    },
    ipa: {
      type: 'string',
      description: 'Override iOS IPA target. Use true or false.'
    },
    target: {
      type: 'string',
      description: 'Build one target: apk, aab, abb, or ipa.'
    },
    dryRun: {
      type: 'boolean',
      description: 'Plan the build without running native commands.'
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

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);
      const config = await loadShipkitConfig(configPath);
      const selected = await selectBuildVariant(config, args.env);
      const artifacts = resolveArtifacts(platform, selected, args);

      if (artifacts.length === 0) {
        throw new Error(`No ${platform} build targets are enabled for variant "${selected.name}".`);
      }

      printHeader(`Shipkit ${platform}`);

      for (const artifact of artifacts) {
        const input: NativeBuildInput = {
          appDir,
          artifact,
          config,
          dryRun: Boolean(args.dryRun),
          env: selected.env,
          homeDir: os.homedir(),
          name: selected.name,
          platform
        };

        if (args.license) {
          input.licenseKey = args.license;
        }

        runNativeJson((json) => native.runBuild(json, printEvent), input);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      printEvent({ level: 'error', message });
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
        printHeader('Shipkit Doctor');
        runNativeJson(
          (input) => native.runCommand(input, printEvent),
          {
            appDir: appDirFromArgs(process.cwd(), args.appDir),
            command: 'doctor',
            homeDir: os.homedir()
          }
        );
      }
    }),
    license: licenseCommand
  }
});

export function main() {
  return runMain(mainCommand);
}

main();
