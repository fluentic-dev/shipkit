import type {
  NativeAppCommandInput,
  NativeAppleVerifyInput,
  NativeBinding,
  NativeBuildInput,
  NativeCommandInput,
  NativeCredentialsInput
} from './types.js';

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

function assertLicense(_homeDir: string, _licenseKey?: string) {
  throw new Error('Shipkit native license verifier is required.');
}

export const fallbackNative: NativeBinding = {
  activateLicense() {
    throw new Error('Shipkit native license verifier is required for activation.');
  },

  runCommand(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeCommandInput;

    if (input.command === 'license-info') {
      emit(onRequest, 'warn', 'Shipkit native license verifier is not available.');
      return JSON.stringify({ ok: true, active: false });
    }

    if (input.command === 'license-support') {
      emit(onRequest, 'info', 'Email shipkit@fluenticstack.com with this support output.');
      emit(onRequest, 'warn', 'Shipkit native license verifier is not available.');
      return JSON.stringify({ ok: true, active: false });
    }

    throw new Error(`Unknown Shipkit native command: ${input.command}`);
  },

  runBuild(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeBuildInput;
    assertLicense(input.homeDir, input.licenseKey);

    const variant = input.config.variants.find((item) => item.name === input.name);
    if (!variant) throw new Error(`Unknown Shipkit build variant: ${input.name}`);

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
  },

  runAppCommand(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeAppCommandInput;

    const variant = input.config.variants.find((item) => item.name === input.name);
    if (!variant) throw new Error(`Unknown Shipkit build variant: ${input.name}`);

    if (input.command === 'ios-sign-auto') {
      throw new Error('iOS signing patch requires native Shipkit.');
    }

    emit(onRequest, 'warn', 'Rust addon is not built; this is the development JS fallback.');
    emit(onRequest, 'success', 'Placeholder command complete.');

    return JSON.stringify({
      ok: true,
      mode: 'development-fallback',
      command: input.command,
      env: input.env,
      name: input.name,
      platform: input.platform
    });
  },

  setupCredentials(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeCredentialsInput;

    emit(onRequest, 'warn', 'Rust addon is not built; credential setup requires native Shipkit.');
    emit(
      onRequest,
      'info',
      `Loaded ${input.config.variants.length} build variant(s) for credential setup.`
    );

    return JSON.stringify({
      ok: true,
      mode: 'development-fallback',
      variants: input.config.variants.length
    });
  },

  verifyAppleApi(inputJson, onRequest) {
    const input = JSON.parse(inputJson) as NativeAppleVerifyInput;
    void input;

    emit(
      onRequest,
      'warn',
      'Rust addon is not built; Apple API verification requires native Shipkit.'
    );
    return JSON.stringify({
      ok: true,
      mode: 'development-fallback',
      certificates: 0,
      profiles: 0
    });
  },

  listAppleCertificates() {
    throw new Error('Rust addon is not built; Apple certificate listing requires native Shipkit.');
  }
};
