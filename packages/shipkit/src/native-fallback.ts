import fs from 'node:fs';
import path from 'node:path';
import type {
  NativeBinding,
  NativeBuildInput,
  NativeCommandInput,
  NativeEventSink,
  NativeLicenseInput,
} from './types.js';

const allowedLicense = 'SHIPKIT-DEV-ALLOW';

function emit(onEvent: NativeEventSink, message: string, data?: unknown,) {
  onEvent({ level: 'info', message, data, },);
}

function licenseFile(homeDir: string,) {
  return path.join(homeDir, '.fluentic', 'shipkit', 'license.json',);
}

function readLicense(homeDir: string,) {
  try {
    return JSON.parse(fs.readFileSync(licenseFile(homeDir,), 'utf8',),) as { licenseKey?: string; };
  } catch {
    return null;
  }
}

function assertLicense(homeDir: string, licenseKey?: string,) {
  const activeKey = licenseKey ?? readLicense(homeDir,)?.licenseKey;

  if (activeKey !== allowedLicense) {
    throw new Error(`Invalid Shipkit license. For local scaffolding use ${allowedLicense}.`,);
  }
}

export const fallbackNative: NativeBinding = {
  activateLicense(inputJson, onEvent,) {
    const input = JSON.parse(inputJson,) as NativeLicenseInput;

    if (input.licenseKey !== allowedLicense) {
      throw new Error(`Invalid Shipkit license. For local scaffolding use ${allowedLicense}.`,);
    }

    const file = licenseFile(input.homeDir,);
    fs.mkdirSync(path.dirname(file,), { recursive: true, },);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          licenseKey: input.licenseKey,
          activatedAt: new Date().toISOString(),
          mode: 'development-placeholder',
        },
        null,
        2,
      ),
    );

    onEvent({ level: 'success', message: 'License activated with development placeholder.', },);
    return JSON.stringify({ ok: true, },);
  },

  runCommand(inputJson, onEvent,) {
    const input = JSON.parse(inputJson,) as NativeCommandInput;

    if (input.command === 'license-status') {
      const license = readLicense(input.homeDir,);
      onEvent({
        level: license?.licenseKey === allowedLicense ? 'success' : 'warn',
        message: license?.licenseKey === allowedLicense
          ? 'Development license is active.'
          : 'No valid license is active.',
      },);
      return JSON.stringify({ ok: true, active: license?.licenseKey === allowedLicense, },);
    }

    emit(onEvent, 'Shipkit native fallback is reachable.',);
    emit(onEvent, `App directory: ${input.appDir}`,);
    return JSON.stringify({ ok: true, },);
  },

  runBuild(inputJson, onEvent,) {
    const input = JSON.parse(inputJson,) as NativeBuildInput;
    assertLicense(input.homeDir, input.licenseKey,);

    const envConfig = input.config.envs[input.env];
    if (!envConfig) throw new Error(`Unknown Shipkit env: ${input.env}`,);

    onEvent({ level: 'info', message: 'License accepted.', },);
    onEvent({
      level: 'info',
      message: `Planning ${input.platform} ${input.artifact} build for ${input.env}.`,
      data: envConfig,
    },);
    onEvent({
      level: 'warn',
      message: 'Rust addon is not built; this is the development JS fallback.',
    },);
    onEvent({
      level: 'success',
      message: input.dryRun ? 'Dry run complete.' : 'Placeholder build complete.',
    },);

    return JSON.stringify({
      ok: true,
      mode: 'development-fallback',
      env: input.env,
      platform: input.platform,
      artifact: input.artifact,
    },);
  },
};
