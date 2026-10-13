import fs from 'node:fs';
import path from 'node:path';
import type {
  NativeBinding,
  NativeBuildInput,
  NativeCommandInput,
  NativeLicenseInput
} from './types.js';

const allowedLicense = 'SHIPKIT-DEV-ALLOW';

function request(onRequest: (requestJson: string) => string, code: string, data: unknown) {
  const response = JSON.parse(onRequest(JSON.stringify({ code, data }))) as {
    ok: boolean;
    data?: unknown;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(response.error ?? `Native callback failed for ${code}.`);
  }

  return response.data;
}

function emit(
  onRequest: (requestJson: string) => string,
  level: 'debug' | 'info' | 'warn' | 'error' | 'success',
  message: string,
  data?: unknown
) {
  request(onRequest, 'log', {
    data,
    level,
    message
  });
}

function licenseFile(homeDir: string) {
  return path.join(homeDir, '.shipkit', 'license');
}

function readLicense(homeDir: string) {
  try {
    return JSON.parse(fs.readFileSync(licenseFile(homeDir), 'utf8')) as { licenseKey?: string; };
  } catch {
    return null;
  }
}

function assertLicense(homeDir: string, licenseKey?: string) {
  const activeKey = licenseKey ?? readLicense(homeDir)?.licenseKey;

  if (activeKey !== allowedLicense) {
    throw new Error(`Invalid Shipkit license. For local scaffolding use ${allowedLicense}.`);
  }
}

export const fallbackNative: NativeBinding = {
  activateLicense(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeLicenseInput;

    if (input.licenseKey !== allowedLicense) {
      throw new Error(`Invalid Shipkit license. For local scaffolding use ${allowedLicense}.`);
    }

    const file = licenseFile(input.homeDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          licenseKey: input.licenseKey,
          activatedAt: new Date().toISOString(),
          mode: 'development-placeholder'
        },
        null,
        2
      )
    );

    emit(onRequest, 'success', 'License activated with development placeholder.');
    return JSON.stringify({ ok: true });
  },

  runCommand(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeCommandInput;

    if (input.command === 'license-status') {
      const license = readLicense(input.homeDir);
      emit(
        onRequest,
        license?.licenseKey === allowedLicense ? 'success' : 'warn',
        license?.licenseKey === allowedLicense
          ? 'Development license is active.'
          : 'No valid license is active.'
      );
      return JSON.stringify({ ok: true, active: license?.licenseKey === allowedLicense });
    }

    throw new Error(`Unknown Shipkit native command: ${input.command}`);
  },

  runBuild(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeBuildInput;
    assertLicense(input.homeDir, input.licenseKey);

    const variant = input.config.variants.find((item) => item.name === input.name);
    if (!variant) throw new Error(`Unknown Shipkit build variant: ${input.name}`);

    emit(onRequest, 'info', 'License accepted.');
    emit(
      onRequest,
      'info',
      `Planning ${input.platform} ${input.artifact} build for ${input.name}.`,
      variant
    );
    emit(onRequest, 'warn', 'Rust addon is not built; this is the development JS fallback.');
    emit(onRequest, 'success', 'Placeholder build complete.');

    return JSON.stringify({
      ok: true,
      mode: 'development-fallback',
      env: input.env,
      name: input.name,
      platform: input.platform,
      artifact: input.artifact
    });
  }
};
