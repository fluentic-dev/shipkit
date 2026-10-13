import { defineCommand, runMain, } from 'citty';
import os from 'node:os';
import path from 'node:path';
import { loadShipkitConfig, } from './config.js';
import { printEvent, printHeader, } from './logger.js';
import { loadNative, } from './native.js';
import type { NativeBuildInput, ShipkitArtifact, ShipkitPlatform, } from './types.js';

const native = loadNative();

function appDirFromArgs(cwd: string, appDir?: string,) {
  return path.resolve(cwd, appDir ?? process.cwd(),);
}

function configPathFromArgs(appDir: string, config?: string,) {
  return path.resolve(appDir, config ?? 'build.config.ts',);
}

function runNativeJson(fn: (input: string,) => string, input: unknown,) {
  const result = fn(JSON.stringify(input,),);
  return JSON.parse(result,) as unknown;
}

const licenseCommand = defineCommand({
  meta: {
    name: 'license',
    description: 'Manage Shipkit license activation.',
  },
  subCommands: {
    activate: defineCommand({
      meta: {
        name: 'activate',
        description: 'Activate a Shipkit license key.',
      },
      args: {
        key: {
          type: 'positional',
          description: 'License key. Development placeholder: SHIPKIT-DEV-ALLOW',
          required: true,
        },
      },
      run({ args, },) {
        printHeader('Shipkit License',);
        runNativeJson(
          (input,) => native.activateLicense(input, printEvent,),
          {
            homeDir: os.homedir(),
            licenseKey: args.key,
          },
        );
      },
    },),
    status: defineCommand({
      meta: {
        name: 'status',
        description: 'Show current license state.',
      },
      run() {
        printHeader('Shipkit License',);
        runNativeJson(
          (input,) => native.runCommand(input, printEvent,),
          {
            appDir: process.cwd(),
            command: 'license-status',
            homeDir: os.homedir(),
          },
        );
      },
    },),
  },
},);

const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Run a protected local native build.',
  },
  args: {
    platform: {
      type: 'positional',
      description: 'Target platform.',
      required: true,
      valueHint: 'android|ios',
    },
    env: {
      type: 'string',
      description: 'Build environment from build.config.ts.',
      required: true,
    },
    appDir: {
      type: 'string',
      description: 'Expo app directory.',
    },
    config: {
      type: 'string',
      description: 'Build config path relative to app dir.',
    },
    apk: {
      type: 'boolean',
      description: 'Build Android APK.',
    },
    aab: {
      type: 'boolean',
      description: 'Build Android AAB.',
    },
    dryRun: {
      type: 'boolean',
      description: 'Plan the build without running native commands.',
    },
    license: {
      type: 'string',
      description: 'License key override. Usually use shipkit license activate.',
    },
  },
  async run({ args, },) {
    const platform = args.platform as ShipkitPlatform;
    if (platform !== 'android' && platform !== 'ios') {
      throw new Error('Platform must be android or ios.',);
    }

    const appDir = appDirFromArgs(process.cwd(), args.appDir,);
    const configPath = configPathFromArgs(appDir, args.config,);
    const config = await loadShipkitConfig(configPath,);
    const artifact: ShipkitArtifact = platform === 'ios' ? 'ipa' : args.aab ? 'aab' : 'apk';

    printHeader(`Shipkit ${platform}`,);

    const input: NativeBuildInput = {
      appDir,
      artifact,
      config,
      dryRun: Boolean(args.dryRun,),
      env: args.env,
      homeDir: os.homedir(),
      platform,
    };

    if (args.license) {
      input.licenseKey = args.license;
    }

    runNativeJson((json,) => native.runBuild(json, printEvent,), input,);
  },
},);

const mainCommand = defineCommand({
  meta: {
    name: 'shipkit',
    description: 'Local native builds for Expo and React Native.',
  },
  subCommands: {
    build: buildCommand,
    doctor: defineCommand({
      meta: {
        name: 'doctor',
        description: 'Check that the native bridge can run.',
      },
      args: {
        appDir: {
          type: 'string',
          description: 'Expo app directory.',
        },
      },
      run({ args, },) {
        printHeader('Shipkit Doctor',);
        runNativeJson(
          (input,) => native.runCommand(input, printEvent,),
          {
            appDir: appDirFromArgs(process.cwd(), args.appDir,),
            command: 'doctor',
            homeDir: os.homedir(),
          },
        );
      },
    },),
    license: licenseCommand,
  },
},);

export function main() {
  return runMain(mainCommand,);
}

main();
