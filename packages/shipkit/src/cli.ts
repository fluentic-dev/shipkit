import { cancel, confirm, isCancel, multiselect, password, select, text } from '@clack/prompts';
import { defineCommand, runMain } from 'citty';
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access, appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { styleText } from 'node:util';
import { getShipkitEnvSnapshot } from './config-env.js';
import { loadShipkitConfig } from './config.js';
import {
  createNativeLogView,
  type NativeLogMode,
  printError,
  printEvent,
  printGuide,
  printIntro,
  printOutro,
  printPanel,
  printTablePanel,
  startSpinner
} from './logger.js';
import { createNativeRequestHandler } from './native-bridge.js';
import { loadNative } from './native.js';
import type {
  Artifact,
  BuildManifest,
  NativeAppCommandInput,
  NativeAppleCertificateSummary,
  NativeBuildInput,
  NativeCredentialsInput,
  NativeEvent,
  Platform,
  ResolvedBuildVariantConfig
} from './types.js';

const native = loadNative();
const nativeRequestHandler = createNativeRequestHandler(printEvent);
const execFileAsync = promisify(execFile);

function appDirFromArgs(cwd: string, appDir?: string) {
  return path.resolve(cwd, appDir ?? process.cwd());
}

function configPathFromArgs(appDir: string, config?: string) {
  return path.resolve(appDir, config ?? 'build.config.ts');
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function loadCredentialsBuildManifest(configPath: string) {
  const envKeys = await scanBuildConfigEnvKeys(configPath);
  const fileValues = await readBuildEnvFileValues(path.dirname(configPath));
  const restore = new Map<string, string | undefined>();

  for (const key of envKeys) {
    const fileValue = fileValues.get(key);
    if (process.env[key] !== undefined || (fileValue !== undefined && fileValue !== '')) {
      continue;
    }

    restore.set(key, process.env[key]);
    process.env[key] = missingEnvSentinel(key);
  }

  try {
    return await loadBuildManifest(configPath);
  } finally {
    for (const [key, value] of restore) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function scanBuildConfigEnvKeys(configPath: string) {
  const text = await readTextFile(configPath);
  const keys = new Set<string>();
  const pattern = /\benv\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/gu;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) keys.add(match[1]);
  }

  return keys;
}

async function readBuildEnvFileValues(appDir: string) {
  const values = new Map<string, string>();
  for (const file of ['build.env', 'build.local.env']) {
    const text = await readTextFile(path.join(appDir, file));
    for (const line of text.split(/\r?\n/u)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:!)?\s*=\s*(.*)$/u.exec(line.trim());
      if (match?.[1]) values.set(match[1], match[2] ?? '');
    }
  }

  return values;
}

function missingEnvSentinel(name: string) {
  return `__SHIPKIT_MISSING_ENV__${name}__`;
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

function shouldRunPrebuild(argv: string[]) {
  return !argv.some((arg) => /^--no-?prebuild(?:=.*)?$/i.test(arg));
}

function readRepeatedStringArg(argv: string[], name: string, fallback: unknown) {
  const values: string[] = [];
  const flag = `--${name}`;
  const equalsPrefix = `${flag}=`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith(equalsPrefix)) {
      values.push(arg.slice(equalsPrefix.length));
      continue;
    }

    if (arg === flag) {
      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        values.push(next);
        index += 1;
      }
    }
  }

  return values.length > 0 ? values : fallback;
}

async function selectBuildVariants(config: BuildManifest, value: unknown) {
  const selected = resolveBuildVariants(config, value);
  if (selected) {
    return selected;
  }

  if (config.variants.length === 1) {
    return [config.variants[0]!];
  }

  if (!process.stdin.isTTY) {
    throw new Error(`Build variant is required. Available variants: ${listVariants(config)}.`);
  }

  const answer = await multiselect({
    message: 'Select build variants',
    options: config.variants.map((variant) => ({
      ...(variant.env === variant.name ? {} : { hint: `env ${variant.env}` }),
      label: variant.name,
      value: variant.name
    })),
    withGuide: false
  });

  if (isCancel(answer)) {
    cancel('Build cancelled.');
    process.exit(0);
  }

  return answer.map((name) => {
    const match = config.variants.find((item) => item.name === name);
    if (!match) {
      throw new Error(
        `Invalid build variant selection "${name}". Available variants: ${listVariants(config)}.`
      );
    }

    return match;
  });
}

async function selectBuildVariant(config: BuildManifest, value: unknown, message: string) {
  const selected = resolveBuildVariants(config, value);
  if (selected) {
    if (selected.length > 1) {
      throw new Error('This command accepts one build variant at a time.');
    }

    return selected[0]!;
  }

  if (config.variants.length === 1) {
    return config.variants[0]!;
  }

  if (!process.stdin.isTTY) {
    throw new Error(`Build variant is required. Available variants: ${listVariants(config)}.`);
  }

  const answer = await select({
    message,
    options: config.variants.map((variant) => ({
      ...(variant.env === variant.name ? {} : { hint: `env ${variant.env}` }),
      label: variant.name,
      value: variant.name
    }))
  });

  if (isCancel(answer)) {
    cancel('Command cancelled.');
    process.exit(0);
  }

  const match = config.variants.find((item) => item.name === answer);
  if (!match) {
    throw new Error(`Invalid build variant selection "${answer}".`);
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

function cancelSetup(): never {
  cancel('Setup cancelled.');
  process.exit(0);
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

function resolveBuildVariants(config: BuildManifest, value: unknown) {
  const names = parseListArg(value);
  if (names.length === 0) return null;

  return names.map((name) => {
    const match = config.variants.find((item) => item.name === name);
    if (!match) {
      throw new Error(
        `Unknown build variant "${name}". Available variants: ${listVariants(config)}.`
      );
    }

    return match;
  });
}

type LicenseActivationSummary = {
  activationId?: string;
  email?: string;
  expiresAt?: number;
  licenseId?: string;
  supportCode?: string;
};

type PrebuildCleanTarget = {
  id: string;
  env: string;
  path: string;
  platform: Platform;
  state: 'current' | 'cached';
};

function applyLicenseActivationEvent(
  summary: LicenseActivationSummary,
  event: NativeEvent
) {
  if (event.level === 'success') {
    const match =
      /^Shipkit license activated for (?<email>.+)\. Offline until (?<expiresAt>\d+)\. Support code: (?<supportCode>[^.]+)\.?$/u
        .exec(
          event.message
        );
    if (match?.groups) {
      if (match.groups.email) summary.email = match.groups.email;
      if (match.groups.expiresAt) summary.expiresAt = Number(match.groups.expiresAt);
      if (match.groups.supportCode) summary.supportCode = match.groups.supportCode;
    }
  }

  if (event.level === 'info') {
    const match = /^License (?<licenseId>[^,]+), activation (?<activationId>[^.]+)\.?$/u.exec(
      event.message
    );
    if (match?.groups) {
      if (match.groups.licenseId) summary.licenseId = match.groups.licenseId;
      if (match.groups.activationId) summary.activationId = match.groups.activationId;
    }
  }
}

function printLicenseActivationSummary(summary: LicenseActivationSummary) {
  printPanel('License activated', [
    { label: 'Account', value: summary.email ?? 'activated' },
    { label: 'Offline access', value: formatLicenseTime(summary.expiresAt) },
    { label: 'Support code', value: summary.supportCode },
    { label: 'License', value: formatShortId(summary.licenseId) },
    { label: 'Activation', value: formatShortId(summary.activationId) }
  ]);

  printGuide('', [
    summary.supportCode
      ? `Keep the support code handy if activation gets stuck on another machine: ${
        formatCode(summary.supportCode)
      }.`
      : 'Keep this activation on this machine. You can run shipkit license info any time to check it.'
  ]);
}

function formatLicenseTime(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return undefined;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value * 1000));
}

function formatShortId(value: string | undefined) {
  if (!value) return undefined;
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

async function resolveBuildArtifacts(
  variants: ResolvedBuildVariantConfig[],
  args: Record<string, unknown>
) {
  if (hasExplicitTargetArgs(args)) {
    const artifacts = resolveExplicitArtifacts(args);
    if (artifacts.length === 0) {
      throw new Error('No build targets selected. Use --ipa, --apk, --aab, or --target.');
    }

    return artifacts;
  }

  if (!process.stdin.isTTY) {
    return null;
  }

  return selectBuildArtifacts(variants);
}

function resolveVariantArtifacts(
  variant: ResolvedBuildVariantConfig,
  selectedArtifacts: Artifact[] | null
) {
  const artifacts = selectedArtifacts ?? configuredArtifacts(variant);
  if (artifacts.length === 0) {
    throw new Error(`No build targets are enabled for variant "${variant.name}".`);
  }

  return artifacts;
}

function configuredArtifactsForVariants(variants: ResolvedBuildVariantConfig[]) {
  const artifacts = new Set<Artifact>();

  for (const variant of variants) {
    for (const artifact of configuredArtifacts(variant)) {
      artifacts.add(artifact);
    }
  }

  return sortArtifacts([...artifacts]);
}

async function selectBuildArtifacts(variants: ResolvedBuildVariantConfig[]) {
  const defaults = configuredArtifactsForVariants(variants);
  const answer = await multiselect({
    cursorAt: defaults[0] ?? 'ipa',
    initialValues: defaults,
    message: 'Select build targets',
    options: buildArtifactOptions(),
    withGuide: false
  });

  if (isCancel(answer)) {
    cancel('Build cancelled.');
    process.exit(0);
  }

  return sortArtifacts(answer);
}

function hasExplicitTargetArgs(args: Record<string, unknown>) {
  return args.target !== undefined
    || args.ipa !== undefined
    || args.apk !== undefined
    || args.aab !== undefined;
}

function resolveExplicitArtifacts(args: Record<string, unknown>) {
  const artifacts = new Set<Artifact>();

  for (const target of normalizeTargets(args.target)) {
    artifacts.add(target);
  }

  if (parseTargetFlag(args.ipa)) artifacts.add('ipa');
  if (parseTargetFlag(args.apk)) artifacts.add('apk');
  if (parseTargetFlag(args.aab)) artifacts.add('aab');

  return sortArtifacts([...artifacts]);
}

function configuredArtifacts(variant: ResolvedBuildVariantConfig) {
  return sortArtifacts([
    ...(variant.ipa ? ['ipa' as const] : []),
    ...(variant.apk ? ['apk' as const] : []),
    ...(variant.aab ? ['aab' as const] : [])
  ]);
}

function parseListArg(value: unknown) {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) =>
    String(item)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function normalizeTargets(target: unknown): Artifact[] {
  return parseListArg(target).map(normalizeTarget);
}

function normalizeTarget(target: string): Artifact {
  if (target === 'apk' || target === 'aab' || target === 'ipa') return target;
  throw new Error(`Invalid target "${target}". Expected apk, aab, or ipa.`);
}

function parseTargetFlag(value: unknown) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.some(parseTargetFlag);
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    if (value === '' || value === 'true') return true;
    if (value === 'false') return false;
  }

  throw new Error(`Expected target flag boolean, got "${String(value)}".`);
}

function buildArtifactOptions() {
  return [
    { hint: 'iOS', label: 'iOS: IPA', value: 'ipa' as const },
    { hint: 'Android', label: 'Android: APK', value: 'apk' as const },
    { hint: 'Android', label: 'Android: AAB', value: 'aab' as const }
  ];
}

function sortArtifacts(artifacts: Artifact[]) {
  const order: Record<Artifact, number> = {
    ipa: 0,
    apk: 1,
    aab: 2
  };

  return [...artifacts].sort((left, right) => order[left] - order[right]);
}

function platformForArtifact(artifact: Artifact): Platform {
  return artifact === 'ipa' ? 'ios' : 'android';
}

function parseNativeLogMode(value: unknown): NativeLogMode {
  if (value === undefined) return 'auto';
  if (value === true) return 'expanded';
  if (value === false) return 'auto';

  throw new Error('Use --logs without a value to stream native logs.');
}

function readForwardArgs(
  rawArgs: string[],
  options: {
    positionalCount?: number;
    reserved?: Record<string, 'boolean' | 'string'>;
  } = {}
) {
  const reserved = options.reserved ?? {};
  const forwarded: string[] = [];
  let skippedPositionals = 0;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg) continue;

    if (arg === '--') {
      forwarded.push(...rawArgs.slice(index + 1));
      break;
    }

    if (!arg.startsWith('-') && skippedPositionals < (options.positionalCount ?? 0)) {
      skippedPositionals += 1;
      continue;
    }

    const reservedFlag = readReservedFlag(arg, reserved);
    if (reservedFlag) {
      if (reservedFlag.kind === 'string' && !reservedFlag.hasValue) {
        index += 1;
      }
      continue;
    }

    forwarded.push(arg);
  }

  return forwarded;
}

function readReservedFlag(
  arg: string,
  reserved: Record<string, 'boolean' | 'string'>
) {
  if (!arg.startsWith('--')) return null;

  const raw = arg.startsWith('--no-') ? arg.slice(5) : arg.slice(2);
  const [name] = raw.split('=', 1);
  if (!name || !(name in reserved)) return null;

  return {
    hasValue: raw.includes('='),
    kind: reserved[name]
  };
}

function extractPrebuildPlatforms(args: string[]) {
  const platforms = new Set<Platform>();
  const forwarded: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--platform' || arg === '-p') {
      const next = args[index + 1];
      if (!next) throw new Error('Expected ios, android, or all after --platform.');
      addPrebuildPlatform(platforms, next);
      index += 1;
      continue;
    }

    if (arg.startsWith('--platform=')) {
      addPrebuildPlatform(platforms, arg.slice('--platform='.length));
      continue;
    }

    forwarded.push(arg);
  }

  return {
    args: forwarded,
    platforms: platforms.size > 0 ? [...platforms] : (['ios', 'android'] as Platform[])
  };
}

function addPrebuildPlatform(platforms: Set<Platform>, value: string) {
  for (const item of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    if (item === 'all') {
      platforms.add('ios');
      platforms.add('android');
      continue;
    }

    if (item === 'ios' || item === 'android') {
      platforms.add(item);
      continue;
    }

    throw new Error(`Invalid prebuild platform "${item}". Expected ios, android, or all.`);
  }
}

async function listPrebuildCleanTargets(appDir: string) {
  const targets: PrebuildCleanTarget[] = [];

  for (const platform of ['ios', 'android'] as const) {
    const platformDir = path.join(appDir, platform);
    if (await fileExists(platformDir)) {
      const env = (await readTextFile(path.join(platformDir, '.prebuild'))).trim() || 'unknown';
      targets.push({
        env,
        id: `current:${platform}`,
        path: platformDir,
        platform,
        state: 'current'
      });
    }
  }

  const cacheDir = path.join(appDir, '.prebuild');
  let entries: Array<{ isDirectory(): boolean; name: string; }> = [];
  try {
    entries = await readdir(cacheDir, { withFileTypes: true });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const parsed = parsePrebuildCacheName(entry.name);
    if (!parsed) continue;

    targets.push({
      env: parsed.env,
      id: `cached:${entry.name}`,
      path: path.join(cacheDir, entry.name),
      platform: parsed.platform,
      state: 'cached'
    });
  }

  return targets.sort((left, right) =>
    left.platform.localeCompare(right.platform)
    || left.env.localeCompare(right.env)
    || left.state.localeCompare(right.state)
  );
}

function parsePrebuildCacheName(name: string) {
  for (const platform of ['android', 'ios'] as const) {
    const suffix = `-${platform}`;
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return {
        env: name.slice(0, -suffix.length),
        platform
      };
    }
  }

  return null;
}

async function selectPrebuildCleanTargets(targets: PrebuildCleanTarget[]) {
  if (!process.stdin.isTTY) {
    throw new Error('prebuild:clean requires an interactive terminal.');
  }

  const answer = await multiselect({
    cursorAt: targets[0]?.id,
    initialValues: targets.map((target) => target.id),
    message: 'Select prebuilds to delete',
    options: targets.map((target) => ({
      hint: `${target.env} · ${target.state}`,
      label: formatPlatform(target.platform),
      value: target.id
    })),
    required: false,
    withGuide: false
  });

  if (isCancel(answer)) {
    cancel('Prebuild clean cancelled.');
    process.exit(0);
  }

  const selected = new Set(answer);
  return targets.filter((target) => selected.has(target.id));
}

async function confirmPrebuildClean(targets: PrebuildCleanTarget[]) {
  if (!process.stdin.isTTY) {
    throw new Error('prebuild:clean requires an interactive terminal.');
  }

  const answer = await confirm({
    initialValue: false,
    message: `Delete ${targets.length} selected prebuild${targets.length === 1 ? '' : 's'}?`
  });

  if (isCancel(answer)) {
    cancel('Prebuild clean cancelled.');
    process.exit(0);
  }

  return answer;
}

function printPrebuildCleanTargets(title: string, targets: PrebuildCleanTarget[]) {
  printTablePanel(
    title,
    [
      { key: 'platform', label: 'Platform', maxWidth: 10 },
      { key: 'env', label: 'Env', maxWidth: 24 },
      { key: 'state', label: 'State', maxWidth: 10 },
      { key: 'path', label: 'Path', maxWidth: 52 }
    ],
    targets.map((target) => ({
      env: target.env,
      path: formatPathForDisplay(target.path),
      platform: formatPlatform(target.platform),
      state: target.state
    }))
  );
}

const appCommandReservedArgs = {
  appDir: 'string',
  config: 'string',
  license: 'string',
  logs: 'boolean',
  variant: 'string'
} as const;

function readNativeLogArg(argv: string[]) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith('--logs=')) {
      throw new Error('Use --logs without a value. The default output is the capped log box.');
    }

    if (arg === '--logs') {
      return true;
    }
  }

  return undefined;
}

function formatPlatform(platform: Platform) {
  return platform === 'ios' ? 'iOS' : 'Android';
}

function formatPlatformBadge(platform: Platform) {
  return styleText(['bold', 'cyan'], formatPlatform(platform));
}

function formatArtifact(artifact: Artifact) {
  return artifact.toUpperCase();
}

function formatBuildTitle(platform: Platform, artifact: Artifact) {
  return `${formatPlatform(platform)} ${formatArtifact(artifact)} build`;
}

function formatBuildPlatforms(artifacts: Artifact[]) {
  const platforms = new Set(artifacts.map(platformForArtifact));
  if (platforms.size > 1) return 'iOS, Android';
  const platform = [...platforms][0];
  return platform ? formatPlatformBadge(platform) : 'none';
}

function formatPlatformScope(platform: Platform | null) {
  return platform ? formatPlatform(platform) : 'iOS + Android';
}

function formatVariantTitle(variant: string, env?: string) {
  return env ? `${styleText('bold', variant)} · ${env}` : styleText('bold', variant);
}

function formatTargets(platform: Platform | null, variant: ResolvedBuildVariantConfig) {
  const targets: string[] = [];
  if (platform !== 'ios' && variant.apk) targets.push('APK');
  if (platform !== 'ios' && variant.aab) targets.push('AAB');
  if (platform !== 'android' && variant.ipa) targets.push('IPA');
  return targets.join(', ') || 'none';
}

function formatFileName(variant: ResolvedBuildVariantConfig) {
  return variant.fileName.replaceAll('[env]', variant.env);
}

function formatOutputRows(variant: ResolvedBuildVariantConfig, artifacts: Artifact[]) {
  const baseName = formatFileName(variant);
  return artifacts.map((artifact, index) => ({
    label: index === 0 ? 'Output' : '',
    value: `${baseName}.${artifact}`
  }));
}

function printBuildGap() {
  process.stdout.write('\n');
}

function printBuildDivider() {
  process.stdout.write(`\n${styleText('dim', '---')}\n`);
}

function printTargetComplete(options: {
  artifact: Artifact;
  durationMs: number;
  output?: string;
  platform: Platform;
  variant: ResolvedBuildVariantConfig;
}) {
  printPanel('Complete', [
    { label: 'Target', value: formatBuildTitle(options.platform, options.artifact) },
    { label: 'Variant', value: options.variant.name },
    { label: 'Env', value: options.variant.env },
    { label: 'Output', value: options.output ? formatPathForDisplay(options.output) : 'done' },
    { label: 'Duration', value: formatDuration(options.durationMs) }
  ]);
}

function printTargetFailed(options: {
  artifact: Artifact;
  durationMs: number;
  platform: Platform;
  variant: ResolvedBuildVariantConfig;
}) {
  printPanel('Failed', [
    { label: 'Target', value: formatBuildTitle(options.platform, options.artifact) },
    { label: 'Variant', value: options.variant.name },
    { label: 'Env', value: options.variant.env },
    { label: 'Duration', value: formatDuration(options.durationMs) }
  ]);
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(Math.round(durationMs / 1000), 0);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function formatPathForDisplay(filePath: string) {
  return path.relative(process.cwd(), filePath) || '.';
}

function formatCode(value: string) {
  return styleText(['bold', 'cyan'], value);
}

function formatVariantTag(value: string) {
  return styleText(['bold', 'inverse', 'cyan'], ` ${value} `);
}

function formatIosTarget(value: string) {
  return styleText(['bold', 'magenta'], value);
}

function formatFileRef(value: string) {
  return styleText(['bold', 'cyan'], value);
}

function envTableRows(envs: Record<string, unknown>) {
  return Object.entries(envs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      key: name,
      value: formatEnvValue(name, value)
    }));
}

function formatEnvValue(name: string, value: unknown) {
  const text = String(value);
  if (text === '') return '-';
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

function resolveCredentialPlatforms(args: Record<string, unknown>): Platform[] | undefined {
  const android = parseTargetFlag(args.android);
  const ios = parseTargetFlag(args.ios);

  if (!android && !ios) return undefined;

  return [
    ...(android ? ['android' as const] : []),
    ...(ios ? ['ios' as const] : [])
  ];
}

async function resolveCredentialPlatformsForSetup(args: Record<string, unknown>) {
  const fromFlags = resolveCredentialPlatforms(args);
  if (fromFlags) return fromFlags;

  return ['ios' as const];
}

function readAppleApiCredentialsArgs(args: Record<string, unknown>) {
  return {
    issuerId: stringArg(args['apple-issuer-id']),
    keyId: stringArg(args['apple-key-id']),
    keyPath: stringArg(args['apple-key-path'])
  };
}

function readAppleApiCredentialsSource(
  args: Record<string, unknown>,
  fileValues?: Map<string, string>
) {
  const fromArgs = readAppleApiCredentialsArgs(args);
  return {
    issuerId: fromArgs.issuerId ?? stringArg(fileValues?.get(appleConnectEnvKeys.issuerId)),
    keyId: fromArgs.keyId ?? stringArg(fileValues?.get(appleConnectEnvKeys.keyId)),
    keyPath: fromArgs.keyPath ?? stringArg(fileValues?.get(appleConnectEnvKeys.keyPath))
  };
}

function completeAppleApiCredentials(
  args: Record<string, unknown>,
  fileValues?: Map<string, string>
) {
  const fromArgs = readAppleApiCredentialsSource(args, fileValues);
  if (!fromArgs.issuerId || !fromArgs.keyId || !fromArgs.keyPath) return undefined;

  assertAppleApiCredentialFormats(fromArgs);
  return {
    issuerId: fromArgs.issuerId,
    keyId: fromArgs.keyId,
    keyPath: expandHome(fromArgs.keyPath)
  };
}

function validateAppleKeyId(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return 'App Store Connect Key ID is required.';
  if (!/^[A-Z0-9]{10}$/u.test(trimmed)) {
    return 'App Store Connect Key ID must be 10 uppercase letters or numbers.';
  }

  return undefined;
}

function validateAppleIssuerId(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return 'App Store Connect Issuer ID is required.';
  if (
    !/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u.test(trimmed)
  ) {
    return 'App Store Connect Issuer ID must be a UUID/GUID, e.g. 12345678-1234-1234-1234-123456789ABC.';
  }

  return undefined;
}

function assertAppleApiCredentialFormats(apple: {
  issuerId: string | undefined;
  keyId: string | undefined;
}) {
  const keyIdError = validateAppleKeyId(apple.keyId);
  if (keyIdError) throw new Error(keyIdError);

  const issuerIdError = validateAppleIssuerId(apple.issuerId);
  if (issuerIdError) throw new Error(issuerIdError);
}

async function promptAppleApiCredentials(
  appDir: string,
  args: Record<string, unknown>,
  fileValues?: Map<string, string>
) {
  if (!process.stdin.isTTY) {
    return undefined;
  }

  printGuide('Connect to Apple', [
    "We'll use your API key to check certificates and find signing profiles.",
    'In App Store Connect, go to:',
    formatCode('Users and Access > Integrations > App Store Connect API'),
    'Or open this link in your browser:',
    formatCode('https://appstoreconnect.apple.com/access/integrations'),
    "Find your team's key with access to certificates and profiles.",
    "Keep this page open. We'll copy three values, one at a time."
  ]);

  const fromArgs = readAppleApiCredentialsSource(args, fileValues);

  if (!fromArgs.keyId) {
    printGuide('1 of 3 · Key ID', [
      'This identifies the API key Shipkit will use.',
      `Copy the 10-character ${formatCode('Key ID')} beside your key.`,
      `For example: ${formatCode('ABCDE12345')}`
    ]);
  }
  const keyId = fromArgs.keyId ?? await promptSetupText({
    defaultValue: '',
    message: 'What is your Key ID?',
    placeholder: 'ABCDE12345',
    validate: validateAppleKeyId
  });
  if (!fromArgs.issuerId) {
    printGuide('2 of 3 · Issuer ID', [
      'This identifies the team that issued your API key.',
      `Copy the ${formatCode('Issuer ID')} from the same page, including hyphens.`,
      `For example: ${formatCode('12345678-1234-1234-1234-123456789ABC')}`
    ]);
  }
  const issuerId = fromArgs.issuerId ?? await promptSetupText({
    defaultValue: '',
    message: 'What is your Issuer ID?',
    placeholder: '12345678-1234-1234-1234-123456789ABC',
    validate: validateAppleIssuerId
  });
  if (!fromArgs.keyPath) {
    printGuide('3 of 3 · Private key file', [
      `Your ${formatCode('.p8')} file lets Shipkit authenticate requests to Apple.`,
      'Enter the path to the file you downloaded when creating the key.',
      `For example: ${formatFileRef('~/Downloads/AuthKey_ABCDE12345.p8')}`
    ]);
  }
  const keyPath = fromArgs.keyPath ?? await promptSetupText({
    defaultValue: '',
    message: 'Where is your .p8 key file?',
    placeholder: '~/AuthKey_XXXXXXXXXX.p8',
    validate(value) {
      return value?.trim() ? undefined : 'Apple .p8 key path is required.';
    }
  });

  const apple = {
    issuerId: issuerId.trim(),
    keyId: keyId.trim(),
    keyPath: expandHome(keyPath.trim())
  };
  assertAppleApiCredentialFormats(apple);

  printGuide('Save for next time', [
    `I'll save the IDs and key file path in ${formatFileRef('build.local.env')}.`,
    "You won't need to enter them again on your next setup run.",
    `The saved names are ${formatCode(appleConnectEnvKeys.keyId)},`,
    `${formatCode(appleConnectEnvKeys.issuerId)}, and ${formatCode(appleConnectEnvKeys.keyPath)}.`,
    `Read them in ${formatFileRef('build.config.ts')} with, for example:`,
    formatCode("env('APP_STORE_CONNECT_KEY_ID')"),
    'Choose No to continue without saving.'
  ]);
  const shouldSave = await promptSetupConfirm(
    'Save App Store Connect values to build.local.env?',
    true
  );
  if (shouldSave) {
    await saveAppleConnectEnvValues(appDir, apple);
  }

  return apple;
}

function verifyAppleApi(options: {
  apple: { issuerId: string; keyId: string; keyPath: string; };
}) {
  const task = startSpinner('Connecting to App Store Connect');
  const result = runNativeJson(
    (json) =>
      native.verifyAppleApi(
        json,
        createNativeRequestHandler({
          onEvent(event) {
            if (event.level === 'debug' && !process.env.SHIPKIT_DEBUG) return;
            if (event.level === 'success') {
              task.stop('App Store Connect connected');
              return;
            }
            printEvent(event);
          }
        })
      ),
    {
      apple: options.apple,
      homeDir: os.homedir()
    },
    {
      onError(error) {
        task.error('App Store Connect failed');
        printError(error);
      }
    }
  ) as { certificates?: number; profiles?: number; } | null;

  if (!result) return null;

  printGuide('', [
    `You're connected to App Store Connect. Apple returned ${
      result.certificates ?? 0
    } certificates and ${
      result.profiles ?? 0
    } provisioning profiles. We'll now check what your app needs for signing; nothing has been downloaded yet.`
  ]);

  return result;
}

function stringArg(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function expandHome(value: string) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function printLicenseGuide() {
  printGuide('', [
    `Before we can continue, you'll need to activate Shipkit on this machine. Run ${
      formatCode('shipkit license activate')
    }, then return to this command.`
  ]);
  printOutro('Activate Shipkit before running build commands.');
}

function hasAvailableLicense(_licenseOverride: unknown) {
  try {
    readFileSync(path.join(os.homedir(), '.shipkit', 'license'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function isLicenseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /license/u.test(message);
}

function assertLicenseAvailable(licenseOverride: unknown) {
  if (hasAvailableLicense(licenseOverride)) return true;

  printLicenseGuide();
  process.exitCode = 1;
  return false;
}

const setupEnvKeys = [
  'API_URL',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
  'ANDROID_STORE_PASSWORD',
  'IOS_TEAM_ID',
  'IOS_CERT_PASSWORD'
] as const;

const appleConnectEnvKeys = {
  issuerId: 'APP_STORE_CONNECT_ISSUER_ID',
  keyId: 'APP_STORE_CONNECT_KEY_ID',
  keyPath: 'APP_STORE_CONNECT_KEY_PATH'
} as const;

const setupGitignoreItems = [
  'build.local.env',
  'credentials/',
  '*.keystore',
  '*.jks',
  '*.p12',
  '*.mobileprovision'
] as const;

async function readPackageName(appDir: string) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(appDir, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    return typeof packageJson.name === 'string' ? packageJson.name : null;
  } catch {
    return null;
  }
}

type ExpoIosTarget = {
  bundleId: string;
  env: string;
  profilePath: string;
  target: string;
  variant: string;
};

async function resolveExpoIosTargets(appDir: string, config: BuildManifest) {
  const rows: ExpoIosTarget[] = [];

  for (const variant of config.variants) {
    const expoConfig = await readExpoConfigForVariant(appDir, variant);
    const bundleId = readStringPath(expoConfig, ['ios', 'bundleIdentifier']);
    const extensions = readIosAppExtensions(expoConfig);
    const profileTemplates = readIosProfileTemplates(variant);

    if (bundleId) {
      rows.push({
        bundleId,
        env: variant.env,
        profilePath: profileTemplates.find((profile) => !profile.target)?.path ?? '-',
        target: 'App',
        variant: variant.name
      });
    }

    for (const profile of profileTemplates.filter((item) => item.target)) {
      const extension = extensions.find((item) => item.target === profile.target);
      rows.push({
        bundleId: extension?.bundleId ?? `${bundleId || '<app id>'}.${profile.target}`,
        env: variant.env,
        profilePath: profile.path,
        target: profile.target ?? 'Extension',
        variant: variant.name
      });
    }
  }

  return rows;
}

async function readExpoConfigForVariant(
  appDir: string,
  variant: ResolvedBuildVariantConfig
) {
  const expoBin = await resolveExpoBin(appDir);
  const task = startSpinner(`Reading Expo config for ${variant.name}`);
  const env = {
    ...process.env,
    ENV: variant.env,
    SHIPKIT_ENV: variant.env,
    SHIPKIT_ENVS: JSON.stringify(variant.envs),
    SHIPKIT_NAME: variant.name,
    SHIPKIT_PLATFORM: 'ios'
  };

  try {
    const { stdout } = await execFileAsync(
      expoBin.command,
      [...expoBin.args, 'config', '--json', '--type', 'introspect'],
      {
        cwd: appDir,
        env,
        maxBuffer: 32 * 1024 * 1024
      }
    );
    task.clear();
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    task.error(`Could not read Expo config for ${variant.name}`);
    throw error;
  }
}

async function resolveExpoBin(appDir: string) {
  const localBin = path.join(
    appDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'expo.cmd' : 'expo'
  );

  if (await fileExists(localBin)) {
    return { args: [] as string[], command: localBin };
  }

  return {
    args: ['--yes', 'expo'],
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx'
  };
}

function readIosProfileTemplates(variant: ResolvedBuildVariantConfig) {
  const ios = variant.credentials?.ios;
  const profiles: Array<{ path: string; target?: string; }> = [];

  if (ios?.profile) {
    profiles.push(ios.profile);
  }

  if (ios?.profiles) {
    profiles.push(...ios.profiles);
  }

  return profiles.map((profile) => ({
    path: replaceEnvPlaceholder(profile.path, variant.env),
    target: profile.target
  }));
}

function readIosAppExtensions(expoConfig: unknown) {
  const raw = readUnknownPath(expoConfig, [
    'extra',
    'eas',
    'build',
    'experimental',
    'ios',
    'appExtensions'
  ]);

  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => ({
      bundleId: readStringPath(item, ['bundleIdentifier']),
      target: readStringPath(item, ['targetName'])
    }))
    .filter((item): item is { bundleId: string; target: string; } =>
      Boolean(item.bundleId && item.target)
    );
}

function readStringPath(input: unknown, keys: string[]) {
  const value = readUnknownPath(input, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readUnknownPath(input: unknown, keys: string[]) {
  let current = input;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function replaceEnvPlaceholder(value: string, env: string) {
  return value.replaceAll('[env]', env);
}

function defaultSetupName(packageName: string | null) {
  const raw = packageName?.split('/').at(-1) ?? 'app';
  const name = raw
    .replace(/^@/u, '')
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return name || 'app';
}

function normalizeSetupName(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

async function promptSetupText(options: {
  defaultValue: string;
  message: string;
  placeholder?: string;
  validate?: (value: string | undefined) => string | undefined;
}) {
  const promptOptions: Parameters<typeof text>[0] = {
    defaultValue: options.defaultValue,
    message: options.message,
    withGuide: true
  };
  if (options.placeholder) promptOptions.placeholder = options.placeholder;
  if (options.validate) promptOptions.validate = options.validate;

  const answer = await text(promptOptions);

  if (isCancel(answer)) cancelSetup();
  return answer;
}

async function promptSetupPassword(options: {
  message: string;
  validate?: (value: string | undefined) => string | undefined;
}) {
  const promptOptions: Parameters<typeof password>[0] = {
    message: options.message,
    withGuide: true
  };
  if (options.validate) promptOptions.validate = options.validate;

  const answer = await password(promptOptions);

  if (isCancel(answer)) cancelSetup();
  return answer;
}

async function promptSetupConfirm(message: string, initialValue = true) {
  const answer = await confirm({
    initialValue,
    message,
    withGuide: true
  });

  if (isCancel(answer)) cancelSetup();
  return answer;
}

async function promptSetupSelect(options: {
  message: string;
  options: Array<{ hint?: string; label: string; value: string; }>;
}) {
  const selectOptions = options.options.map((item) =>
    item.hint
      ? { hint: item.hint, label: item.label, value: item.value }
      : { label: item.label, value: item.value }
  );
  const answer = await select({
    message: options.message,
    options: selectOptions,
    withGuide: true
  });

  if (isCancel(answer)) cancelSetup();
  return answer;
}

async function confirmIosTargets(targets: ExpoIosTarget[]) {
  if (targets.length === 0) {
    printGuide('', [
      `I couldn't find an iOS Bundle ID for your app. Set ${
        formatCode('ios.bundleIdentifier')
      } in your Expo app config, then run setup again so Shipkit can find a matching provisioning profile.`
    ]);
    return targets;
  }

  printGuide('Review iOS app IDs', [
    'Shipkit reads your Expo config to find each iOS app or extension that needs signing.',
    `Each ${
      formatCode('Bundle ID')
    } must match the App ID and provisioning profile in Apple Developer.`,
    'If a value is wrong, answer No and enter the correct Bundle ID before profiles are checked.'
  ]);
  printIosTargetDetails('Detected iOS targets', targets);

  if (!process.stdin.isTTY) return targets;

  const confirmed: ExpoIosTarget[] = [];
  for (const target of targets) {
    const keep = await promptSetupConfirm(
      `${formatVariantTag(target.variant)} iOS target ${
        formatIosTarget(target.target)
      }: use ${target.bundleId}?`,
      true
    );
    if (keep) {
      confirmed.push(target);
      continue;
    }

    const bundleId = await promptSetupText({
      defaultValue: target.bundleId,
      message: `${formatVariantTag(target.variant)} iOS target ${
        formatIosTarget(target.target)
      } Bundle ID`,
      validate(value) {
        return value?.trim() ? undefined : 'Bundle ID is required.';
      }
    });
    confirmed.push({
      ...target,
      bundleId: bundleId.trim()
    });
  }

  printIosTargetDetails('Confirmed iOS targets', confirmed);

  return confirmed;
}

function printIosProfilePlan(plan: string) {
  if (plan === 'download') {
    printGuide('Profile plan', [
      'Shipkit will download matching profiles from App Store Connect after the certificate is ready.',
      `If it finds one, it downloads the ${
        formatCode('.mobileprovision')
      } file to the path configured in ${formatFileRef('build.config.ts')}.`,
      'If no matching remote profile exists, Shipkit will explain what is missing so you can create it in Apple Developer.'
    ]);
    return;
  }

  if (plan === 'create') {
    printGuide('Profile plan', [
      'Shipkit will guide creation or refresh of provisioning profiles after the certificate is ready.',
      `Created profiles are saved as ${
        formatCode('.mobileprovision')
      } files at the configured paths from ${formatFileRef('build.config.ts')}.`,
      'If a matching profile is not already available from App Store Connect, setup will show the exact action to take.'
    ]);
    return;
  }

  printGuide('Profile plan', [
    'Shipkit will keep the local provisioning profile files already configured.',
    'If a file is missing or invalid, setup will stop and show the path to fix.'
  ]);
}

function printIosTargetDetails(title: string, targets: ExpoIosTarget[]) {
  printTablePanel(
    title,
    [
      { key: 'variant', label: 'Variant', maxWidth: 22, style: formatVariantTag },
      { key: 'target', label: 'iOS target', maxWidth: 24, style: formatIosTarget },
      { key: 'bundleId', label: 'Bundle ID', maxWidth: 42 },
      { key: 'profilePath', label: 'Profile file', maxWidth: 48 }
    ],
    targets.map((target) => ({
      bundleId: target.bundleId,
      profilePath: target.profilePath,
      target: target.target,
      variant: target.env && target.env !== target.variant
        ? `${target.variant} (${target.env})`
        : target.variant
    }))
  );
}

function buildConfigTemplate(options: {
  fileName: string;
  productionVariant: string;
  stagingVariant: string;
}) {
  return `import { defineBuild, defineVariant, env } from '@fluentic/shipkit';

const app = defineBuild({
  fileName: '${options.fileName}',
  envs: {
    API_URL: env('API_URL', '')
  },
  credentials: {
    android: {
      keystore: {
        path: './credentials/android/release.keystore',
        keyAlias: env('ANDROID_KEY_ALIAS'),
        keyPassword: env('ANDROID_KEY_PASSWORD'),
        storePassword: env('ANDROID_STORE_PASSWORD')
      }
    },
    ios: {
      teamId: env('IOS_TEAM_ID'),
      certificate: {
        path: './credentials/ios/cert.p12',
        password: env('IOS_CERT_PASSWORD')
      },
      profiles: [
        {
          path: './credentials/ios/[env].mobileprovision'
        }
      ]
    }
  }
});

export default [
  defineVariant(app, {
    name: '${options.stagingVariant}',
    env: 'staging',
    aab: false
  }),
  defineVariant(app, {
    name: '${options.productionVariant}',
    env: 'production'
  })
];
`;
}

async function printExistingConfig(configPath: string) {
  const manifest = await loadBuildManifest(configPath);
  printGuide('Existing config', [
    `${formatFileRef(formatPathForDisplay(configPath))} already exists. I found these variants:`,
    ...manifest.variants.map((variant) =>
      `- ${formatVariantTitle(variant.name, variant.env)} builds ${
        formatCode(formatTargets(null, variant))
      } as ${formatCode(formatFileName(variant))}.`
    )
  ]);
}

async function mergeBuildLocalEnv(appDir: string, keys: readonly string[]) {
  const file = path.join(appDir, 'build.local.env');
  const existing = await readTextFile(file);
  const existingKeys = new Set(
    existing
      .split(/\r?\n/u)
      .map((line) => /^([A-Za-z_][A-Za-z0-9_]*)!?\s*=/u.exec(line.trim())?.[1])
      .filter((key): key is string => Boolean(key))
  );
  const missing = keys.filter((key) => !existingKeys.has(key));

  if (missing.length === 0) {
    return { file, added: [] as string[] };
  }

  const prefix = existing.trim().length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}${existing.trim().length > 0 ? '\n' : ''}# Shipkit local build env\n${
    missing.map((key) => `${key}=`).join('\n')
  }\n`;

  await appendFile(file, block);
  return { file, added: missing };
}

async function upsertBuildLocalEnvValue(appDir: string, key: string, value: string) {
  const file = path.join(appDir, 'build.local.env');
  const existing = await readTextFile(file);
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(`^(${escapedKey}(?:!)?\\s*=).*$`, 'mu');

  if (pattern.test(existing)) {
    await writeFile(
      file,
      existing.replace(pattern, (_line, prefix: string) => `${prefix}${value}`)
    );
    return file;
  }

  const prefix = existing.trim().length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}${
    existing.trim().length > 0 ? '\n' : ''
  }# Shipkit iOS certificate\n${key}=${value}\n`;
  await appendFile(file, block);
  return file;
}

async function saveAppleConnectEnvValues(
  appDir: string,
  apple: { issuerId: string; keyId: string; keyPath: string; }
) {
  const file = await upsertBuildLocalEnvValue(appDir, appleConnectEnvKeys.keyId, apple.keyId);
  await upsertBuildLocalEnvValue(appDir, appleConnectEnvKeys.issuerId, apple.issuerId);
  await upsertBuildLocalEnvValue(appDir, appleConnectEnvKeys.keyPath, apple.keyPath);

  printGuide('Saved App Store Connect values', [
    `I saved them to ${formatFileRef(formatPathForDisplay(file))}.`,
    `Key ID is stored as ${formatCode(appleConnectEnvKeys.keyId)}.`,
    `Issuer ID is stored as ${formatCode(appleConnectEnvKeys.issuerId)}.`,
    `The .p8 path is stored as ${formatCode(appleConnectEnvKeys.keyPath)}.`
  ]);
}

async function readTextFile(file: string) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isNotFoundError(error)) return '';
    throw error;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function updateGitignore(appDir: string, items: readonly string[]) {
  const gitignorePath = path.join(appDir, '.gitignore');
  const existing = await readTextFile(gitignorePath);
  const lines = new Set(
    existing
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = items.filter((item) => !lines.has(item));

  if (missing.length === 0) {
    return { gitignorePath, added: [] as string[], skipped: [] as string[] };
  }

  printGuide('Git ignore items', [
    'Shipkit should keep local signing files and secrets out of git.',
    ...missing.map((item) => `- ${formatFileRef(item)}`)
  ]);
  const shouldAdd = await promptSetupConfirm('Add these Shipkit local files to .gitignore?', true);
  if (!shouldAdd) {
    return { gitignorePath, added: [] as string[], skipped: missing };
  }

  const prefix = existing.trim().length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}${existing.trim().length > 0 ? '\n' : ''}# Shipkit local files\n${
    missing.join('\n')
  }\n`;
  await appendFile(gitignorePath, block);

  return { gitignorePath, added: missing, skipped: [] as string[] };
}

function isNotFoundError(error: unknown) {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT'
  );
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
          description: 'License key.',
          required: false
        }
      },
      async run({ args }) {
        printIntro('Shipkit License');
        const licenseKey = await resolveLicenseKey(args.key);
        const task = startSpinner('Checking Shipkit license');
        const summary: LicenseActivationSummary = {};
        let didStopTask = false;
        const result = runNativeJson(
          (input) =>
            native.activateLicense(
              input,
              createNativeRequestHandler({
                onEvent(event) {
                  if (event.level === 'success') {
                    applyLicenseActivationEvent(summary, event);
                    task.stop('License verified');
                    didStopTask = true;
                    return;
                  }
                  if (event.level === 'info') {
                    applyLicenseActivationEvent(summary, event);
                    return;
                  }
                  printEvent(event);
                }
              })
            ),
          {
            homeDir: os.homedir(),
            licenseKey
          },
          {
            onError(error) {
              task.error('License activation failed');
              didStopTask = true;
              printError(error);
            }
          }
        );
        if (result && !didStopTask) task.stop('License checked');
        if (result) {
          printLicenseActivationSummary(summary);
          printOutro('Shipkit is ready to build.');
        }
      }
    }),
    info: defineCommand({
      meta: {
        name: 'info',
        description: 'Show current license state.'
      },
      run() {
        printIntro('Shipkit License');
        const result = runNativeJson(
          (input) => native.runCommand(input, nativeRequestHandler),
          {
            command: 'license-info',
            homeDir: os.homedir()
          }
        );
        if (result) printOutro('License info ready.');
      }
    }),
    support: defineCommand({
      meta: {
        name: 'support',
        description: 'Show license support details to send when activation is stuck.'
      },
      run() {
        printIntro('Shipkit Support');
        const result = runNativeJson(
          (input) => native.runCommand(input, nativeRequestHandler),
          {
            command: 'license-support',
            homeDir: os.homedir()
          }
        );
        if (result) printOutro('Support details ready.');
      }
    })
  }
});

async function promptSetupKind() {
  if (!process.stdin.isTTY) return 'project';

  const answer = await select({
    message: 'What do you want to set up?',
    options: [
      {
        hint: 'build.config.ts, build.local.env, folders, .gitignore',
        label: 'Setup build config',
        value: 'project'
      },
      {
        hint: 'certificates, profiles, app ids, and extensions',
        label: 'Setup iOS credentials',
        value: 'ios-credentials'
      }
    ],
    withGuide: false
  });

  if (isCancel(answer)) cancelSetup();
  return answer;
}

async function runProjectSetup(args: {
  appDir?: string | undefined;
  config?: string | undefined;
}) {
  const appDir = appDirFromArgs(process.cwd(), args.appDir);
  const configPath = configPathFromArgs(appDir, args.config);
  const packageName = await readPackageName(appDir);
  const defaultName = defaultSetupName(packageName);
  const configExists = await fileExists(configPath);

  printGuide('Project setup', [
    `Let's set up builds for ${
      formatFileRef(appDir)
    }. You'll choose a name for your build files and two build variants: one for testing and one for release. I'll use your answers to write ${
      formatFileRef(formatPathForDisplay(configPath))
    }, which tells Shipkit what to build and where to find your signing files.`
  ]);

  if (configExists) {
    try {
      await printExistingConfig(configPath);
    } catch (error) {
      printError(error);
    }

    printGuide('', [
      `You already have a build config. Continuing will replace ${
        formatFileRef(formatPathForDisplay(configPath))
      } with a new one based on your answers. Choose No to keep it and leave this setup.`
    ]);
    const replace = await promptSetupConfirm('Replace your existing build config?', false);
    if (!replace) {
      printOutro('Setup skipped existing build config.');
      return;
    }
  }

  printGuide('', [
    `First, choose the base name for the files you'll share or upload after a build. For example, ${
      formatCode('myapp')
    } makes it easy to recognize your app's build output.`
  ]);
  const fileNameAnswer = await promptSetupText({
    defaultValue: defaultName,
    message: 'What should your build files be called?',
    placeholder: 'myapp',
    validate(value) {
      return normalizeSetupName(value ?? '') ? undefined : 'File name is required.';
    }
  });
  const fileName = normalizeSetupName(fileNameAnswer);
  printGuide('', [
    `Next, let's name your testing variant. A variant is a saved build configuration you can select later. You can keep ${
      formatCode('staging')
    } or choose a name your team uses for test builds.`
  ]);
  const stagingVariant = normalizeSetupName(
    await promptSetupText({
      defaultValue: 'staging',
      message: 'What should we call your testing variant?',
      placeholder: 'staging',
      validate(value) {
        return normalizeSetupName(value ?? '') ? undefined : 'Variant name is required.';
      }
    })
  );
  printGuide('', [
    `Now choose a name for the variant you'll use for releases. We'll connect this one to the ${
      formatCode('production')
    } environment.`
  ]);
  const productionVariant = normalizeSetupName(
    await promptSetupText({
      defaultValue: 'production',
      message: 'What should we call your release variant?',
      placeholder: 'production',
      validate(value) {
        return normalizeSetupName(value ?? '') ? undefined : 'Variant name is required.';
      }
    })
  );

  await mkdir(path.dirname(configPath), { recursive: true });
  await mkdir(path.join(appDir, 'credentials', 'android'), { recursive: true });
  await mkdir(path.join(appDir, 'credentials', 'ios'), { recursive: true });
  await writeFile(
    configPath,
    buildConfigTemplate({
      fileName,
      productionVariant,
      stagingVariant
    })
  );

  printGuide('', [
    `I'll also prepare ${
      formatFileRef('build.local.env')
    } with empty entries for the signing values you'll add later. Keep local passwords and machine-specific paths there. Shared values can go in ${
      formatFileRef('build.env')
    }; your ${formatFileRef('build.config.ts')} reads either file with ${
      formatCode("env('NAME')")
    }. Next, we'll review which local files to keep out of Git.`
  ]);
  const envResult = await mergeBuildLocalEnv(appDir, setupEnvKeys);
  const gitignoreResult = await updateGitignore(appDir, setupGitignoreItems);

  printGuide('Generated files', [
    `Created or updated ${formatFileRef(formatPathForDisplay(configPath))}.`,
    `Created or updated ${formatFileRef(formatPathForDisplay(envResult.file))}.`,
    envResult.added.length > 0
      ? `Added env keys: ${envResult.added.map(formatCode).join(', ')}.`
      : 'All expected env keys were already present.',
    gitignoreResult.added.length > 0
      ? `Added ${gitignoreResult.added.length} local signing item(s) to ${
        formatFileRef('.gitignore')
      }.`
      : `${formatFileRef('.gitignore')} was already up to date.`
  ]);

  if (gitignoreResult.skipped.length > 0) {
    printGuide(
      'Manual .gitignore items',
      gitignoreResult.skipped.map((item) => `- ${formatFileRef(item)}`)
    );
  }

  printGuide('Next steps', [
    `Fill ${formatFileRef('build.local.env')} with your local signing values.`,
    `Put Android and iOS signing files under ${formatFileRef('credentials/android')} and ${
      formatFileRef('credentials/ios')
    }.`,
    `Use ${formatCode("env('XXX')")} in ${
      formatFileRef('build.config.ts')
    } whenever a value should come from env files.`,
    `Add ${formatCode("'@fluentic/shipkit'")} to ${formatCode('plugins')} in ${
      formatFileRef('app.config.ts')
    }.`,
    `Use ${formatCode('getBuildInfo')} from ${
      formatCode('@fluentic/shipkit/env')
    } inside React Native code.`
  ]);
  printOutro('Shipkit setup complete.');
}

async function runCredentialsSetup(args: {
  appDir?: string | undefined;
  config?: string | undefined;
  android?: boolean | undefined;
  ios?: boolean | undefined;
  'apple-key-id'?: string | undefined;
  'apple-issuer-id'?: string | undefined;
  'apple-key-path'?: string | undefined;
  license?: string | undefined;
}) {
  const appDir = appDirFromArgs(process.cwd(), args.appDir);
  const configPath = configPathFromArgs(appDir, args.config);
  const platforms = await resolveCredentialPlatformsForSetup(args);
  const envFileValues = await readBuildEnvFileValues(appDir);
  let config = await loadCredentialsBuildManifest(configPath);
  let apple = completeAppleApiCredentials(args, envFileValues);

  printGuide('Set up signing', [
    'Your app needs signing credentials before you can install or publish a build.',
    platforms.includes('ios')
      ? "We'll check the iOS certificate first, then handle provisioning profiles once the certificate is ready."
      : "We'll check your Android keystore and its passwords.",
    'These files identify who built the app and which app they belong to.',
    "If anything is missing, we'll show you what you still need to provide."
  ]);

  let result: unknown = true;

  if (platforms.includes('ios')) {
    printIosTeamInfo(config);
    const iosTargets = await resolveExpoIosTargets(appDir, config);
    const confirmedIosTargets = await confirmIosTargets(iosTargets);
    const certificateSetup = await promptIosCertificatePlan({
      appDir,
      apple,
      args,
      config,
      configPath,
      envFileValues
    });
    apple = certificateSetup.apple;
    config = certificateSetup.config;

    const certificateReport = runCredentialCheck({
      appDir,
      apple,
      config,
      iosCertificate: certificateSetup.plan,
      iosPhase: 'certificates',
      platforms: ['ios']
    });
    certificateReport.print();
    result = certificateReport.result;

    if (!result || certificateReport.hasCertificateIssues()) {
      printGuide('Profiles paused', [
        'Finish the iOS signing certificate first, then rerun setup to validate or download provisioning profiles.',
        `A provisioning profile is tied to the signing certificate, so Shipkit checks profiles only after the ${
          formatCode('.p12')
        } is ready.`
      ]);
      process.exitCode = result ? process.exitCode : 1;
      return;
    }

    const profilePlan = await promptIosProfilePlan(appDir, confirmedIosTargets);
    if ((profilePlan === 'download' || profilePlan === 'create') && !apple) {
      apple = await promptAppleApiCredentials(appDir, args, envFileValues);
    }

    if ((profilePlan === 'download' || profilePlan === 'create') && apple) {
      if (!verifyAppleApi({ apple })) {
        process.exitCode = 1;
        return;
      }
    }

    printBuildDivider();
    const profileReport = runCredentialCheck({
      appDir,
      ...(profilePlan === 'keep' ? {} : { apple }),
      config,
      iosPhase: 'profiles',
      platforms: ['ios']
    });
    profileReport.print();
    result = profileReport.result;

    if (profilePlan === 'create' && profileReport.hasProfileIssues()) {
      printGuide('Create profiles', [
        `Create matching provisioning profiles in App Store Connect for the listed Bundle IDs, then save each ${
          formatCode('.mobileprovision')
        } file to the configured path.`,
        'After that, rerun setup and choose Keep local profiles.'
      ]);
    }
  }

  if (platforms.includes('android')) {
    if (platforms.includes('ios')) printBuildDivider();
    const androidReport = runCredentialCheck({
      appDir,
      config,
      platforms: ['android']
    });
    androidReport.print();
    result = androidReport.result;
  }

  if (result) printOutro('Credential setup complete.');
}

function printIosTeamInfo(config: BuildManifest) {
  printGuide('Apple Team ID', [
    `This is your 10-character Apple Developer Team ID. It tells Xcode which team should sign each iOS target.`,
    `Shipkit reads it from ${formatCode("env('IOS_TEAM_ID')")} in ${
      formatFileRef('build.config.ts')
    }.`,
    `Put the actual value in ${formatFileRef('build.local.env')} as ${
      formatCode('IOS_TEAM_ID=XXXXXXXXXX')
    }.`
  ]);

  printGuide(
    'iOS team',
    config.variants.map((variant) =>
      `- ${formatVariantTitle(variant.name, variant.env)} uses Apple Team ID ${
        formatCode(formatCredentialEnvValue('IOS_TEAM_ID', variant.credentials?.ios?.teamId))
      }.`
    )
  );
}

function formatCredentialEnvValue(name: string, value: unknown) {
  const text = String(value ?? '');
  if (text.startsWith('__SHIPKIT_MISSING_ENV__')) return 'missing';
  return formatEnvValue(name, text);
}

function collectIosCertificatePaths(appDir: string, config: BuildManifest) {
  const paths = new Set<string>();
  for (const variant of config.variants) {
    const certPath = variant.credentials?.ios?.certificate?.path;
    if (!certPath || isMissingCredentialValue(certPath)) continue;
    paths.add(path.resolve(appDir, certPath));
  }

  return [...paths];
}

function printIosCertificatePlanGuide(appDir: string, config: BuildManifest) {
  const certPaths = collectIosCertificatePaths(appDir, config);
  printGuide('Certificate plan', [
    `An iOS signing certificate must be a local ${
      formatCode('.p12')
    } file because it contains the private key needed by Xcode.`,
    'Apple can create a new certificate from a CSR, but it cannot download a usable private key for an existing certificate.',
    certPaths.length > 0
      ? `Configured certificate path: ${formatFileRef(formatCredentialPath(appDir, certPaths[0]!))}`
      : `Add ${formatCode('credentials.ios.certificate.path')} in ${
        formatFileRef('build.config.ts')
      }.`
  ]);
}

type IosCertificateSetupPlan = NonNullable<NativeCredentialsInput['iosCertificate']>;

async function promptIosCertificatePlan(input: {
  appDir: string;
  apple: { issuerId: string; keyId: string; keyPath: string; } | undefined;
  args: {
    'apple-key-id'?: string | undefined;
    'apple-issuer-id'?: string | undefined;
    'apple-key-path'?: string | undefined;
  };
  config: BuildManifest;
  configPath: string;
  envFileValues: Map<string, string>;
}): Promise<{
  apple: { issuerId: string; keyId: string; keyPath: string; } | undefined;
  config: BuildManifest;
  plan: IosCertificateSetupPlan;
}> {
  const certPaths = collectIosCertificatePaths(input.appDir, input.config);
  printIosCertificatePlanGuide(input.appDir, input.config);

  const answer = await promptSetupSelect({
    message: 'How should Shipkit handle the iOS signing certificate?',
    options: [
      {
        hint: 'validate the .p12 path already configured',
        label: 'Keep current config',
        value: 'keep'
      },
      {
        hint: 'copy a .p12 from another path into the configured destination',
        label: 'Specify .p12 path',
        value: 'path'
      },
      {
        hint: 'make a new private key/CSR-backed .p12 for this project',
        label: 'Create new certificate',
        value: 'create'
      },
      {
        hint: 'select an App Store Connect certificate that has a private key on this Mac',
        label: 'Use remote certificate',
        value: 'remote'
      }
    ]
  });

  if (answer === 'keep') {
    const { config, p12Password } = await ensureIosCertificatePassword(input);
    return {
      apple: input.apple,
      config,
      plan: {
        action: 'keep',
        ...(p12Password ? { p12Password } : {})
      }
    };
  }

  if (answer === 'path') {
    const sourcePath = await promptSetupText({
      defaultValue: '',
      message: 'Path to existing .p12',
      placeholder: '~/Downloads/distribution.p12',
      validate(value) {
        return value?.trim() ? undefined : 'Enter the .p12 path.';
      }
    });
    const { config, p12Password } = await promptAndSaveIosCertificatePassword(input);
    return {
      apple: input.apple,
      config,
      plan: {
        action: 'path',
        p12Password,
        sourcePath: expandHome(sourcePath.trim())
      }
    };
  }

  let apple = input.apple;
  if (!apple) {
    apple = await promptAppleApiCredentials(input.appDir, input.args, input.envFileValues);
  }
  if (!apple) {
    throw new Error('App Store Connect credentials are required for this certificate option.');
  }
  if (!verifyAppleApi({ apple })) {
    throw new Error('App Store Connect connection failed.');
  }

  if (answer === 'create') {
    printGuide('Create certificate', [
      'Shipkit will generate a private key on this Mac, create a CSR, ask Apple for an iOS Distribution certificate, and export a password-protected .p12.',
      certPaths.length > 0
        ? `Destination: ${formatFileRef(formatCredentialPath(input.appDir, certPaths[0]!))}`
        : `First add a certificate path in ${formatFileRef('build.config.ts')}.`
    ]);
    const { config, p12Password } = await promptAndSaveIosCertificatePassword(input);
    const savePrivateKey = await promptSetupConfirm(
      'Keep the generated private key PEM next to the .p12?',
      false
    );
    if (savePrivateKey) {
      printGuide('Private key', [
        `Shipkit will save the CSR private key beside the ${
          formatCode('.p12')
        }. Keep it private; anyone with the key and certificate can sign as this distribution identity.`
      ]);
    }
    return {
      apple,
      config,
      plan: {
        action: 'create',
        p12Password,
        savePrivateKey
      }
    };
  }

  const remoteCertificateId = await promptRemoteIosCertificate(apple);
  const { config, p12Password } = await promptAndSaveIosCertificatePassword(input);
  printGuide('Remote certificate export', [
    'Shipkit found the matching private key in your macOS keychain.',
    `The exported ${formatCode('.p12')} will contain a protected copy of that private key.`,
    'The original private key remains in Keychain; Shipkit does not export a separate raw PEM key for remote certificates.'
  ]);
  return {
    apple,
    config,
    plan: {
      action: 'remote',
      p12Password,
      remoteCertificateId
    }
  };
}

async function ensureIosCertificatePassword(input: {
  appDir: string;
  config: BuildManifest;
  configPath: string;
}) {
  if (!hasMissingIosCertificatePassword(input.config)) {
    return { config: input.config, p12Password: undefined as string | undefined };
  }
  return await promptAndSaveIosCertificatePassword(input);
}

async function promptAndSaveIosCertificatePassword(input: {
  appDir: string;
  config: BuildManifest;
  configPath: string;
}) {
  const p12Password = await promptConfirmedP12Password();
  const envKey = await scanIosCertificatePasswordEnvKey(input.configPath);

  if (envKey) {
    const shouldSave = await promptSetupConfirm(`Save ${envKey} to build.local.env?`, true);
    if (shouldSave) {
      const file = await upsertBuildLocalEnvValue(input.appDir, envKey, p12Password);
      printGuide('Saved certificate password', [
        `Saved ${formatCode(envKey)} to ${formatFileRef(formatPathForDisplay(file))}.`
      ]);
      return {
        config: await loadCredentialsBuildManifest(input.configPath),
        p12Password
      };
    }
  }

  printGuide('Certificate password', [
    envKey
      ? `Add ${formatCode(`${envKey}=<password>`)} to ${formatFileRef('build.local.env')}.`
      : `Store the ${formatCode('.p12')} password in ${formatFileRef('build.local.env')}.`
  ]);
  return { config: input.config, p12Password };
}

async function promptConfirmedP12Password() {
  while (true) {
    const first = await promptSetupPassword({
      message: '.p12 export password',
      validate(value) {
        return value?.trim() ? undefined : 'Enter a password for the .p12.';
      }
    });
    const second = await promptSetupPassword({
      message: 'Confirm .p12 password',
      validate(value) {
        return value?.trim() ? undefined : 'Confirm the .p12 password.';
      }
    });
    if (first === second) return first;
    printGuide('Password mismatch', ['The two .p12 passwords did not match. Try again.']);
  }
}

async function promptRemoteIosCertificate(
  apple: { issuerId: string; keyId: string; keyPath: string; }
) {
  const certificates = listAppleCertificates({ apple });
  const distribution = certificates.filter((certificate) =>
    /DISTRIBUTION/u.test(certificate.certificateType ?? '')
  );
  const usable = distribution.filter((certificate) => certificate.hasLocalPrivateKey);
  const unavailable = distribution.filter((certificate) => !certificate.hasLocalPrivateKey);

  if (unavailable.length > 0) {
    printGuide(
      'Remote certificates without local private key',
      unavailable.map((certificate) =>
        `- ${formatRemoteCertificate(certificate)} · private key not found on this Mac`
      )
    );
  }

  if (usable.length === 0) {
    throw new Error(
      'No remote distribution certificate has a matching private key on this Mac. Choose Create new certificate or import the original private key first.'
    );
  }

  const selected = await promptSetupSelect({
    message: 'Select remote iOS distribution certificate',
    options: usable.map((certificate) => ({
      hint: [
        certificate.certificateType,
        certificate.expirationDate ? `expires ${certificate.expirationDate}` : undefined,
        certificate.sha1 ? shortIdentifier(certificate.sha1) : undefined
      ].filter(Boolean).join(' · '),
      label: formatRemoteCertificate(certificate),
      value: certificate.id
    }))
  });

  printGuide('Selected certificate', [
    `${
      formatRemoteCertificate(usable.find((certificate) => certificate.id === selected)!)
    } will be exported to the configured .p12 path.`
  ]);

  return selected;
}

function listAppleCertificates(options: {
  apple: { issuerId: string; keyId: string; keyPath: string; };
}) {
  const task = startSpinner('Loading Apple certificates');
  const result = runNativeJson(
    (json) =>
      native.listAppleCertificates(
        json,
        createNativeRequestHandler({
          onEvent(event) {
            if (event.level === 'debug' && !process.env.SHIPKIT_DEBUG) return;
            printEvent(event);
          }
        })
      ),
    {
      apple: options.apple,
      homeDir: os.homedir()
    },
    {
      onError(error) {
        task.error('Apple certificates failed');
        printError(error);
      }
    }
  ) as { certificates?: NativeAppleCertificateSummary[]; } | null;

  task.stop('Apple certificates loaded');
  return result?.certificates ?? [];
}

function formatRemoteCertificate(certificate: NativeAppleCertificateSummary) {
  const name = certificate.displayName || certificate.id;
  const serial = certificate.serialNumber ? ` ${shortIdentifier(certificate.serialNumber)}` : '';
  return `${name}${serial}`;
}

async function promptIosCertificatePassword(
  appDir: string,
  configPath: string,
  config: BuildManifest
) {
  if (!hasMissingIosCertificatePassword(config)) {
    return config;
  }

  const envKey = await scanIosCertificatePasswordEnvKey(configPath);

  printGuide('Certificate password guide', [
    `Next, enter the password you chose when exporting your ${
      formatCode('.p12')
    } signing file. Shipkit needs it to open the certificate during builds. This is the file's password, not your Apple account password.`
  ]);

  if (!process.stdin.isTTY) return config;

  const value = await promptSetupPassword({
    message: 'iOS certificate password',
    validate(input) {
      return input?.trim() ? undefined : 'Certificate password is required.';
    }
  });

  if (envKey) {
    printGuide('', [
      `I can save this password as ${formatCode(envKey)} in ${
        formatFileRef('build.local.env')
      }. Your ${formatFileRef('build.config.ts')} already reads it with ${
        formatCode(`env('${envKey}')`)
      }, so saving it here lets future builds use it automatically.`
    ]);
    const shouldSave = await promptSetupConfirm(`Save ${envKey} to build.local.env?`, true);
    if (shouldSave) {
      const file = await upsertBuildLocalEnvValue(appDir, envKey, value);
      printGuide('Saved certificate password', [
        `I saved the password to ${formatFileRef(formatPathForDisplay(file))}.`,
        `The env key is ${formatCode(envKey)}.`,
        `Your config can read it with ${formatCode(`env('${envKey}')`)}.`
      ]);
      return await loadCredentialsBuildManifest(configPath);
    }
  }

  printGuide('Save certificate password', [
    envKey
      ? `Add ${formatCode(`${envKey}=<password>`)} to ${formatFileRef('build.local.env')}.`
      : `Add your certificate password to ${formatFileRef('build.local.env')} and read it with ${
        formatCode("env('IOS_CERT_PASSWORD')")
      }.`,
    `Or set ${formatCode('credentials.ios.certificate.password')} directly in ${
      formatFileRef('build.config.ts')
    }.`,
    'Then rerun setup if you want Shipkit to validate the .p12 immediately.'
  ]);
  await promptSetupConfirm('I saved the iOS certificate password. Continue?', true);

  return await loadCredentialsBuildManifest(configPath);
}

function hasMissingIosCertificatePassword(config: BuildManifest) {
  return config.variants.some((variant) =>
    isMissingCredentialValue(variant.credentials?.ios?.certificate?.password)
  );
}

function isMissingCredentialValue(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  return value.trim() === '' || value.startsWith('__SHIPKIT_MISSING_ENV__');
}

async function scanIosCertificatePasswordEnvKey(configPath: string) {
  const text = await readTextFile(configPath);
  const certificateIndex = text.search(/\bcertificate\s*:/u);
  const searchText = certificateIndex >= 0 ? text.slice(certificateIndex) : text;
  const match = /\bpassword\s*:\s*env\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/u.exec(
    searchText
  );
  return match?.[1] ?? null;
}

function runCredentialCheck(options: {
  appDir: string;
  apple?: { issuerId: string; keyId: string; keyPath: string; } | undefined;
  config: BuildManifest;
  iosCertificate?: NativeCredentialsInput['iosCertificate'] | undefined;
  iosPhase?: NativeCredentialsInput['iosPhase'] | undefined;
  platforms: Platform[];
}) {
  const report = createCredentialsReport(options.appDir, options.platforms);
  const input: NativeCredentialsInput = {
    appDir: options.appDir,
    config: options.config,
    homeDir: os.homedir(),
    platforms: options.platforms
  };
  if (options.apple) input.apple = options.apple;
  if (options.iosCertificate) input.iosCertificate = options.iosCertificate;
  if (options.iosPhase) input.iosPhase = options.iosPhase;

  report.result = runNativeJson(
    (json) =>
      native.setupCredentials(
        json,
        createNativeRequestHandler({
          onEvent: report.onEvent
        })
      ),
    input
  );

  return report;
}

async function promptIosProfilePlan(appDir: string, targets: ExpoIosTarget[]) {
  const hasLocalProfiles = await hasExistingIosProfiles(appDir, targets);
  const options: Array<{ hint: string; label: string; value: string; }> = [
    ...(hasLocalProfiles
      ? [{
        hint: 'validate the .mobileprovision files already on disk',
        label: 'Keep local profiles',
        value: 'keep'
      }]
      : []),
    {
      hint: 'download matching profiles already listed in App Store Connect',
      label: 'Download from App Store Connect',
      value: 'download'
    },
    {
      hint: 'create or refresh profiles after the signing certificate is ready',
      label: 'Create new profiles',
      value: 'create'
    }
  ] as const;

  if (!process.stdin.isTTY) {
    return hasLocalProfiles ? 'keep' : 'download';
  }

  const answer = await promptSetupSelect({
    message: 'How should Shipkit handle iOS provisioning profiles?',
    options
  });
  printIosProfilePlan(answer);
  return answer;
}

async function hasExistingIosProfiles(appDir: string, targets: ExpoIosTarget[]) {
  for (const target of targets) {
    if (target.profilePath === '-') continue;
    if (await fileExists(path.resolve(appDir, target.profilePath))) {
      return true;
    }
  }

  return false;
}

type CredentialRow = {
  detail: string;
  group: string;
  item: string;
  status: string;
};

function printCredentialRows(title: string, rows: CredentialRow[]) {
  const grouped = new Map<string, CredentialRow[]>();
  const visibleRows = rows.length > 0
    ? rows
    : [{
      detail: 'No credential checks were needed for this platform.',
      group: '-',
      item: 'Status',
      status: 'ok'
    }];

  for (const row of visibleRows) {
    const group = row.group || '-';
    grouped.set(group, [...(grouped.get(group) ?? []), row]);
  }

  printGuide(
    title,
    [...grouped].flatMap(([group, groupRows]) => [
      group === '-' ? 'General:' : `${group}:`,
      ...groupRows.map((row) => `- ${row.item}: ${row.status}. ${row.detail}`)
    ])
  );
}

function createCredentialsReport(appDir: string, platforms: Platform[]) {
  const androidRows: CredentialRow[] = [];
  const iosRows: CredentialRow[] = [];
  const appleRows: CredentialRow[] = [];
  let currentAndroidGroup = '';
  let currentIosGroup = '';

  function addRow(rows: CredentialRow[], row: CredentialRow) {
    rows.push(row);
  }

  function onEvent(event: NativeEvent) {
    if (event.level === 'debug' && !process.env.SHIPKIT_DEBUG) return;

    const message = event.message;
    const androidGroup = /^Android credentials for (.+)$/u.exec(message);
    if (androidGroup?.[1]) {
      currentAndroidGroup = formatCredentialGroup(androidGroup[1]);
      return;
    }

    const iosGroup = /^iOS credentials for (.+)$/u.exec(message);
    if (iosGroup?.[1]) {
      currentIosGroup = formatCredentialGroup(iosGroup[1]);
      return;
    }

    if (message === 'No Android credential config found.') {
      addRow(androidRows, {
        detail: 'No Android credentials block in build config',
        group: '-',
        item: 'Config',
        status: 'missing'
      });
      return;
    }

    if (message === 'No iOS credential config found.') {
      addRow(iosRows, {
        detail: 'No iOS credentials block in build config',
        group: '-',
        item: 'Config',
        status: 'missing'
      });
      return;
    }

    const androidMissingValues = /^Android credentials need values for (.+)\. Put them/u.exec(
      message
    );
    if (androidMissingValues?.[1]) {
      addRow(androidRows, {
        detail: androidMissingValues[1],
        group: currentAndroidGroup,
        item: 'Env',
        status: 'needs values'
      });
      return;
    }

    const androidKeystoreExists = /^Android keystore exists: (.+)$/u.exec(message);
    if (androidKeystoreExists?.[1]) {
      addRow(androidRows, {
        detail: formatCredentialPath(appDir, androidKeystoreExists[1]),
        group: currentAndroidGroup,
        item: 'Keystore',
        status: 'ready'
      });
      return;
    }

    const androidKeystoreMissing = /^Android keystore missing: (.+?)\. Create it/u.exec(message);
    if (androidKeystoreMissing?.[1]) {
      addRow(androidRows, {
        detail: formatCredentialPath(appDir, androidKeystoreMissing[1]),
        group: currentAndroidGroup,
        item: 'Keystore',
        status: 'missing'
      });
      return;
    }

    const certValid = /^iOS certificate valid: (.+)$/u.exec(message);
    if (certValid?.[1]) {
      addRow(iosRows, {
        detail: formatCredentialPath(appDir, certValid[1]),
        group: currentIosGroup,
        item: 'Certificate',
        status: 'ready'
      });
      return;
    }

    const certInvalid = /^iOS certificate invalid: (.+) \((.+)\)$/u.exec(message);
    if (certInvalid?.[1]) {
      addRow(iosRows, {
        detail: `${formatCredentialPath(appDir, certInvalid[1])} (${certInvalid[2] ?? 'invalid'})`,
        group: currentIosGroup,
        item: 'Certificate',
        status: 'invalid'
      });
      return;
    }

    const certMissing = /^iOS \.p12 missing: (.+?)\. Apple can/u.exec(message);
    if (certMissing?.[1]) {
      addRow(iosRows, {
        detail: formatCredentialPath(appDir, certMissing[1]),
        group: currentIosGroup,
        item: 'Certificate',
        status: 'missing'
      });
      return;
    }

    if (message === 'iOS certificate config is missing.') {
      addRow(iosRows, {
        detail: 'Missing certificate config',
        group: currentIosGroup,
        item: 'Certificate',
        status: 'missing'
      });
      return;
    }

    if (
      message === 'iOS certificate path/password need values. Put local secrets in build.local.env.'
    ) {
      addRow(iosRows, {
        detail: 'path/password',
        group: currentIosGroup,
        item: 'Certificate env',
        status: 'needs values'
      });
      return;
    }

    if (message === 'iOS provisioning profile config is missing.') {
      addRow(iosRows, {
        detail: 'Missing provisioning profile config',
        group: currentIosGroup,
        item: 'Profiles',
        status: 'missing'
      });
      return;
    }

    const profileValid = /^Provisioning profile valid: (.+) \(([^)]+)\)$/u.exec(message);
    if (profileValid?.[1]) {
      addRow(iosRows, {
        detail: `${formatCredentialPath(appDir, profileValid[1])} (${
          shortIdentifier(
            profileValid[2] ?? ''
          )
        })`,
        group: currentIosGroup,
        item: 'Profile',
        status: 'ready'
      });
      return;
    }

    const profileInvalid = /^Provisioning profile invalid: (.+) \((.+)\)$/u.exec(message);
    if (profileInvalid?.[1]) {
      addRow(iosRows, {
        detail: `${formatCredentialPath(appDir, profileInvalid[1])} (${
          profileInvalid[2] ?? 'invalid'
        })`,
        group: currentIosGroup,
        item: 'Profile',
        status: 'invalid'
      });
      return;
    }

    const profileDownloaded = /^Downloaded provisioning profile (.+) to (.+)$/u.exec(message);
    if (profileDownloaded?.[2]) {
      addRow(iosRows, {
        detail: `${formatCredentialPath(appDir, profileDownloaded[2])} from ${
          profileDownloaded[1] ?? 'Apple'
        }`,
        group: currentIosGroup,
        item: 'Profile',
        status: 'downloaded'
      });
      return;
    }

    const profileMissing = /^Provisioning profile missing: (.+?)\. No matching/u.exec(message);
    if (profileMissing?.[1]) {
      addRow(iosRows, {
        detail: formatCredentialPath(appDir, profileMissing[1]),
        group: currentIosGroup,
        item: 'Profile',
        status: 'missing'
      });
      return;
    }

    const appleProfiles = /^Apple API returned (\d+) provisioning profile/u.exec(message);
    if (appleProfiles?.[1]) {
      addRow(appleRows, {
        detail: `${appleProfiles[1]} remote profile(s) available`,
        group: 'App Store Connect',
        item: 'Profiles',
        status: 'connected'
      });
      return;
    }

    const appleCertificates = /^Apple API returned (\d+) certificate/u.exec(message);
    if (appleCertificates?.[1]) {
      addRow(appleRows, {
        detail: `${appleCertificates[1]} remote certificate(s) available`,
        group: 'App Store Connect',
        item: 'Certificates',
        status: 'connected'
      });
      return;
    }

    if (message.startsWith('Apple API credentials were not usable:')) {
      addRow(appleRows, {
        detail: message.replace(/^Apple API credentials were not usable:\s*/u, ''),
        group: 'App Store Connect',
        item: 'API',
        status: 'invalid'
      });
      return;
    }

    if (message.startsWith('Could not list Apple provisioning profiles:')) {
      addRow(appleRows, {
        detail: message.replace(/^Could not list Apple provisioning profiles:\s*/u, ''),
        group: 'App Store Connect',
        item: 'Profiles',
        status: 'unavailable'
      });
      return;
    }

    if (message.startsWith('Could not list Apple certificates:')) {
      addRow(appleRows, {
        detail: message.replace(/^Could not list Apple certificates:\s*/u, ''),
        group: 'App Store Connect',
        item: 'Certificates',
        status: 'unavailable'
      });
      return;
    }

    if (
      message
        === 'Pass --apple-key-id, --apple-issuer-id, and --apple-key-path to download remote iOS profiles.'
    ) {
      return;
    }

    printEvent(event);
  }

  function print() {
    if (platforms.includes('android')) {
      printCredentialRows('Android', androidRows);
    }

    if (platforms.includes('ios')) {
      printCredentialRows('iOS', iosRows);
    }

    if (appleRows.length > 0) {
      printCredentialRows('Apple API', appleRows);
    }
  }

  function needsAppleSync() {
    return iosRows.some((row) =>
      row.item === 'Profile' && (row.status === 'missing' || row.status === 'invalid')
    );
  }

  function hasCertificateIssues() {
    return iosRows.some((row) =>
      (row.item === 'Certificate' || row.item === 'Certificate env')
      && row.status !== 'ready'
    );
  }

  function hasProfileIssues() {
    return iosRows.some((row) =>
      row.item === 'Profile' && row.status !== 'ready' && row.status !== 'downloaded'
    );
  }

  return {
    hasCertificateIssues,
    hasProfileIssues,
    needsAppleSync,
    onEvent,
    print,
    result: null as unknown
  };
}

function formatCredentialGroup(value: string) {
  const variants = value
    .split(',')
    .map((part) => /^(.*?)\s+\(([^)]+)\)$/u.exec(part.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match));

  if (variants.length === 0) return value;

  const names = variants
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name));
  const envs = [
    ...new Set(
      variants
        .map((match) => match[2]?.trim())
        .filter((env): env is string => Boolean(env))
    )
  ];
  if (variants.length <= 2) {
    return variants
      .map((match) => formatVariantTitle(match[1]?.trim() ?? '', match[2]?.trim()))
      .join(', ');
  }

  const prefix = commonVariantPrefix(names);
  const scope = prefix ? `${prefix} variants` : `${variants.length} variants`;
  return `${scope} · ${envs.join(', ')}`;
}

function commonVariantPrefix(names: string[]) {
  if (names.length === 0) return '';
  const segments = names
    .map((name) => /^([A-Za-z][A-Za-z0-9]*)[_-]/u.exec(name)?.[1])
    .filter((segment): segment is string => Boolean(segment));
  if (segments.length !== names.length) return '';
  return new Set(segments).size === 1 ? segments[0]! : '';
}

function formatCredentialPath(appDir: string, value: string) {
  const normalizedValue = value.trim();
  const absolute = path.isAbsolute(normalizedValue)
    ? path.resolve(normalizedValue)
    : path.resolve(appDir, normalizedValue);
  const relative = path.relative(appDir, absolute);
  return relative && !relative.startsWith('..') ? relative : formatPathForDisplay(absolute);
}

function shortIdentifier(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function printVariantPanel(
  title: string,
  options: {
    appDir: string;
    platforms: Platform[];
    variant: ResolvedBuildVariantConfig;
  }
) {
  printPanel(title, [
    { label: 'Scope', value: options.platforms.map(formatPlatform).join(', ') },
    { label: 'Variant', value: options.variant.name },
    { label: 'Env', value: options.variant.env },
    { label: 'App', value: formatPathForDisplay(options.appDir) }
  ]);
}

function runNativeAppCommand(options: {
  appDir: string;
  args: string[];
  command: NativeAppCommandInput['command'];
  config: BuildManifest;
  mode: NativeLogMode;
  platform: Platform;
  license?: unknown;
  title: string;
  variant: ResolvedBuildVariantConfig;
}) {
  const input: NativeAppCommandInput = {
    appDir: options.appDir,
    args: options.args,
    command: options.command,
    config: options.config,
    env: options.variant.env,
    homeDir: os.homedir(),
    name: options.variant.name,
    platform: options.platform
  };
  if (typeof options.license === 'string') {
    input.licenseKey = options.license;
  }

  const nativeLogView = createNativeLogView({
    mode: options.mode,
    title: options.title
  });
  const handler = createNativeRequestHandler({
    onEvent: nativeLogView.event,
    onNativeLog: nativeLogView.nativeLog
  });

  let commandError: unknown;
  nativeLogView.start();
  const result = runNativeJson(
    (json) => native.runAppCommand(json, handler),
    input,
    {
      onError(error) {
        commandError = error;
      }
    }
  );

  if (result) {
    nativeLogView.finish(true);
    return true;
  }

  if (isLicenseError(commandError)) {
    nativeLogView.clear();
    printLicenseGuide();
    process.exitCode = 1;
    return false;
  }

  nativeLogView.finish(false);
  if (commandError) printError(commandError);
  return false;
}

function appCommandEnv(
  variant: ResolvedBuildVariantConfig,
  platform: Platform | 'packager'
) {
  return {
    ...process.env,
    ENV: variant.env,
    SHIPKIT_ENV: variant.env,
    SHIPKIT_ENVS: JSON.stringify(variant.envs),
    SHIPKIT_NAME: variant.name,
    SHIPKIT_PLATFORM: platform
  };
}

async function runExpoPackager(options: {
  appDir: string;
  args: string[];
  variant: ResolvedBuildVariantConfig;
}) {
  const expoBin = await resolveExpoBin(options.appDir);
  const child = spawn(expoBin.command, [...expoBin.args, 'start', ...options.args], {
    cwd: options.appDir,
    env: appCommandEnv(options.variant, 'packager'),
    stdio: 'inherit'
  });

  return await new Promise<boolean>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(false);
        return;
      }

      resolve(code === 0);
    });
  });
}

const setupCommand = defineCommand({
  meta: {
    name: 'setup',
    description: 'Set up a Shipkit project or signing credentials.'
  },
  args: {
    appDir: {
      type: 'string',
      description: 'Expo app directory.'
    },
    config: {
      type: 'string',
      description: 'Build config path relative to app dir.'
    },
    android: {
      type: 'boolean',
      description: 'Only process Android credentials.'
    },
    ios: {
      type: 'boolean',
      description: 'Only process iOS credentials.'
    },
    'apple-key-id': {
      type: 'string',
      description: 'App Store Connect API Key ID.'
    },
    'apple-issuer-id': {
      type: 'string',
      description: 'App Store Connect Issuer ID.'
    },
    'apple-key-path': {
      type: 'string',
      description: 'Path to App Store Connect .p8 key.'
    },
    license: {
      type: 'string',
      description: 'License key override. Usually use shipkit license activate.'
    }
  },
  async run({ args }) {
    try {
      printIntro('Setup');
      const kind = await promptSetupKind();
      if (kind === 'ios-credentials') {
        await runCredentialsSetup({ ...args, ios: true });
      } else {
        await runProjectSetup(args);
      }
    } catch (error) {
      if (isLicenseError(error)) {
        printLicenseGuide();
      } else {
        printError(error);
      }
      process.exitCode = 1;
    }
  }
});

const switchCommand = defineCommand({
  meta: {
    name: 'switch',
    description: 'Switch the native project to a Shipkit build variant.'
  },
  args: {
    variant: {
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
    license: {
      type: 'string',
      description: 'License key override. Usually use shipkit license activate.'
    }
  },
  async run({ args }) {
    try {
      printIntro('Switch');

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);
      const config = await loadBuildManifest(configPath);
      const selected = await selectBuildVariant(config, args.variant, 'Select build variant');
      const platforms: Platform[] = ['ios', 'android'];

      printVariantPanel('Switch', {
        appDir,
        platforms,
        variant: selected
      });

      for (const [index, platform] of platforms.entries()) {
        if (index > 0) printBuildDivider();
        const ok = runNativeAppCommand({
          appDir,
          args: [],
          command: 'switch',
          config,
          mode: 'collapsed',
          platform,
          title: `${formatPlatform(platform)} switch`,
          variant: selected
        });
        if (!ok) return;
      }

      printOutro('Shipkit switch complete.');
    } catch (error) {
      if (isLicenseError(error)) {
        printLicenseGuide();
      } else {
        printError(error);
      }
      process.exitCode = 1;
    }
  }
});

const prebuildCommand = defineCommand({
  meta: {
    name: 'prebuild',
    description: 'Switch env and rerun Expo prebuild.'
  },
  args: {
    variant: {
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
    logs: {
      type: 'boolean',
      description: 'Stream native logs as-is instead of showing the capped log tail.'
    },
    license: {
      type: 'string',
      description: 'License key override. Usually use shipkit license activate.'
    }
  },
  async run({ args, rawArgs }) {
    try {
      printIntro('Prebuild');

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);
      const config = await loadBuildManifest(configPath);
      const selected = await selectBuildVariant(config, args.variant, 'Select build variant');
      const extracted = extractPrebuildPlatforms(readForwardArgs(rawArgs, {
        positionalCount: args.variant ? 1 : 0,
        reserved: appCommandReservedArgs
      }));
      const nativeLogMode = parseNativeLogMode(readNativeLogArg(rawArgs));

      printVariantPanel('Prebuild', {
        appDir,
        platforms: extracted.platforms,
        variant: selected
      });

      for (const [index, platform] of extracted.platforms.entries()) {
        if (index > 0) printBuildDivider();
        const ok = runNativeAppCommand({
          appDir,
          args: extracted.args,
          command: 'prebuild',
          config,
          mode: nativeLogMode,
          platform,
          title: `${formatPlatform(platform)} prebuild`,
          variant: selected
        });
        if (!ok) return;
      }

      printOutro('Shipkit prebuild complete.');
    } catch (error) {
      if (isLicenseError(error)) {
        printLicenseGuide();
      } else {
        printError(error);
      }
      process.exitCode = 1;
    }
  }
});

const prebuildCleanCommand = defineCommand({
  meta: {
    name: 'prebuild:clean',
    description: 'Delete selected current and cached native prebuilds.'
  },
  args: {
    appDir: {
      type: 'string',
      description: 'Expo app directory.'
    }
  },
  async run({ args }) {
    try {
      printIntro('Prebuild', 'clean');

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const targets = await listPrebuildCleanTargets(appDir);

      if (targets.length === 0) {
        printGuide('No prebuilds found', [
          `No current ${formatCode('ios')}/${formatCode('android')} directories or cached ${
            formatCode('.prebuild')
          } entries were found in ${formatFileRef(formatPathForDisplay(appDir))}.`
        ]);
        printOutro('Nothing to clean.');
        return;
      }

      printPrebuildCleanTargets('Available prebuilds', targets);
      const selected = await selectPrebuildCleanTargets(targets);

      if (selected.length === 0) {
        printOutro('No prebuilds selected.');
        return;
      }

      printPrebuildCleanTargets('Selected for deletion', selected);
      const shouldDelete = await confirmPrebuildClean(selected);
      if (!shouldDelete) {
        printOutro('Prebuild clean cancelled.');
        return;
      }

      for (const target of selected) {
        await rm(target.path, { force: true, recursive: true });
      }

      printOutro('Selected prebuilds deleted.');
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  }
});

const iosSignCommand = defineCommand({
  meta: {
    name: 'ios:sign',
    description: 'Patch the current iOS prebuild signing settings.'
  },
  args: {
    mode: {
      type: 'positional',
      description: 'Signing mode. Currently only auto is supported.',
      required: false
    },
    variant: {
      type: 'string',
      description: 'Build variant name from build.config.ts.'
    },
    appDir: {
      type: 'string',
      description: 'Expo app directory.'
    },
    config: {
      type: 'string',
      description: 'Build config path relative to app dir.'
    },
    logs: {
      type: 'boolean',
      description: 'Stream native logs as-is instead of showing the capped log tail.'
    }
  },
  async run({ args, rawArgs }) {
    try {
      printIntro('iOS', 'sign');

      const mode = stringArg(args.mode);
      if (mode !== 'auto') {
        throw new Error(
          mode
            ? `Unsupported iOS signing mode "${mode}". Currently supported: auto.`
            : 'iOS signing mode is required. Run shipkit ios:sign auto.'
        );
      }

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);
      const config = await loadBuildManifest(configPath);
      const selected = await selectBuildVariant(config, args.variant, 'Select build variant');
      const nativeLogMode = parseNativeLogMode(readNativeLogArg(rawArgs));

      printVariantPanel('iOS automatic signing', {
        appDir,
        platforms: ['ios'],
        variant: selected
      });

      const ok = runNativeAppCommand({
        appDir,
        args: [],
        command: 'ios-sign-auto',
        config,
        mode: nativeLogMode,
        platform: 'ios',
        title: 'iOS signing',
        variant: selected
      });
      if (!ok) return;

      printOutro('Shipkit iOS signing updated.');
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  }
});

function createDevCommand(platform: Platform) {
  return defineCommand({
    meta: {
      name: `dev:${platform}`,
      description: `Switch env, ensure prebuild, and run Expo ${platform}.`
    },
    args: {
      variant: {
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
      logs: {
        type: 'boolean',
        description: 'Stream native logs as-is instead of showing the capped log tail.'
      },
      license: {
        type: 'string',
        description: 'License key override. Usually use shipkit license activate.'
      }
    },
    async run({ args, rawArgs }) {
      try {
        printIntro(formatPlatform(platform), 'dev');

        const appDir = appDirFromArgs(process.cwd(), args.appDir);
        const configPath = configPathFromArgs(appDir, args.config);
        const config = await loadBuildManifest(configPath);
        const selected = await selectBuildVariant(config, args.variant, 'Select build variant');
        const forwardArgs = readForwardArgs(rawArgs, {
          positionalCount: args.variant ? 1 : 0,
          reserved: appCommandReservedArgs
        });
        const nativeLogMode = parseNativeLogMode(readNativeLogArg(rawArgs));

        printVariantPanel('Dev', {
          appDir,
          platforms: [platform],
          variant: selected
        });

        const ok = runNativeAppCommand({
          appDir,
          args: forwardArgs,
          command: 'dev',
          config,
          mode: nativeLogMode,
          platform,
          title: `${formatPlatform(platform)} dev`,
          variant: selected
        });
        if (!ok) return;

        printOutro(`Shipkit ${formatPlatform(platform)} dev complete.`);
      } catch (error) {
        if (isLicenseError(error)) {
          printLicenseGuide();
        } else {
          printError(error);
        }
        process.exitCode = 1;
      }
    }
  });
}

const devPackagerCommand = defineCommand({
  meta: {
    name: 'dev:packager',
    description: 'Switch env and run the Expo packager.'
  },
  args: {
    variant: {
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
    license: {
      type: 'string',
      description: 'License key override. Usually use shipkit license activate.'
    }
  },
  async run({ args, rawArgs }) {
    try {
      printIntro('Packager', 'dev');

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);
      const config = await loadBuildManifest(configPath);
      const selected = await selectBuildVariant(config, args.variant, 'Select build variant');
      const forwardArgs = readForwardArgs(rawArgs, {
        positionalCount: args.variant ? 1 : 0,
        reserved: appCommandReservedArgs
      });

      printPanel('Packager', [
        { label: 'Variant', value: selected.name },
        { label: 'Env', value: selected.env },
        { label: 'App', value: formatPathForDisplay(appDir) },
        { label: 'Command', value: ['expo', 'start', ...forwardArgs].join(' ') }
      ]);

      const ok = await runExpoPackager({
        appDir,
        args: forwardArgs,
        variant: selected
      });
      if (!ok) {
        process.exitCode = 1;
        return;
      }

      printOutro('Shipkit packager stopped.');
    } catch (error) {
      if (isLicenseError(error)) {
        printLicenseGuide();
      } else {
        printError(error);
      }
      process.exitCode = 1;
    }
  }
});

const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Run a protected local native build.'
  },
  args: {
    appDir: {
      type: 'string',
      description: 'Expo app directory.'
    },
    config: {
      type: 'string',
      description: 'Build config path relative to app dir.'
    },
    variant: {
      type: 'string',
      description: 'Build variant name. Repeat or separate with commas for multiple variants.'
    },
    apk: {
      type: 'boolean',
      description: 'Build Android APK.'
    },
    aab: {
      type: 'boolean',
      description: 'Build Android AAB.'
    },
    ipa: {
      type: 'boolean',
      description: 'Build iOS IPA.'
    },
    target: {
      type: 'string',
      description: 'Build targets: ipa, apk, aab. Repeat or separate with commas.'
    },
    logs: {
      type: 'boolean',
      description: 'Stream native logs as-is instead of showing the capped log box.'
    },
    'no-prebuild': {
      type: 'boolean',
      description: 'Reuse an available native prebuild for this run.'
    },
    license: {
      type: 'string',
      description: 'License key override. Usually use shipkit license activate.'
    }
  },
  async run({ args }) {
    try {
      assertNoRemovedBuildFlags(process.argv);

      printIntro('Build');
      if (!assertLicenseAvailable(args.license)) {
        return;
      }

      const appDir = appDirFromArgs(process.cwd(), args.appDir);
      const configPath = configPathFromArgs(appDir, args.config);
      const config = await loadBuildManifest(configPath);
      const selectedVariants = await selectBuildVariants(
        config,
        readRepeatedStringArg(process.argv, 'variant', args.variant)
      );
      const buildArgs = {
        ...args,
        target: readRepeatedStringArg(process.argv, 'target', args.target)
      };
      const selectedArtifacts = await resolveBuildArtifacts(selectedVariants, buildArgs);
      const nativeLogMode = parseNativeLogMode(readNativeLogArg(process.argv));
      const prebuild = shouldRunPrebuild(process.argv);

      let failed = false;

      for (const [variantIndex, selected] of selectedVariants.entries()) {
        const artifacts = resolveVariantArtifacts(selected, selectedArtifacts);
        const prebuiltPlatforms = new Set<Platform>();

        if (variantIndex > 0) printBuildDivider();
        printPanel('Build', [
          { label: 'Platform', value: formatBuildPlatforms(artifacts) },
          { label: 'Variant', value: selected.name },
          { label: 'Env', value: selected.env },
          { label: 'Targets', value: artifacts.join(', ') },
          { label: 'App', value: formatPathForDisplay(appDir) },
          ...formatOutputRows(selected, artifacts)
        ]);

        for (const [artifactIndex, artifact] of artifacts.entries()) {
          const platform = platformForArtifact(artifact);
          const shouldPrebuild = prebuild && !prebuiltPlatforms.has(platform);
          prebuiltPlatforms.add(platform);

          const input: NativeBuildInput = {
            appDir,
            artifact,
            config,
            env: selected.env,
            homeDir: os.homedir(),
            name: selected.name,
            platform,
            prebuild: shouldPrebuild
          };

          if (args.license) {
            input.licenseKey = args.license;
          }

          const nativeLogView = createNativeLogView({
            mode: nativeLogMode,
            title: formatBuildTitle(platform, artifact)
          });
          let outputPath: string | undefined;
          const buildRequestHandler = createNativeRequestHandler({
            onEvent(event) {
              if (event.message.startsWith('output: ')) {
                outputPath = event.message.slice('output: '.length);
              }
              nativeLogView.event(event);
            },
            onNativeLog: nativeLogView.nativeLog
          });

          let buildError: unknown;
          const startedAt = Date.now();
          if (artifactIndex > 0) printBuildDivider();
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
            printTargetComplete({
              artifact,
              durationMs: Date.now() - startedAt,
              platform,
              variant: selected,
              ...(outputPath ? { output: outputPath } : {})
            });
          } else {
            if (isLicenseError(buildError)) {
              nativeLogView.clear();
              printLicenseGuide();
              process.exitCode = 1;
              return;
            }

            nativeLogView.finish(false);
            printBuildGap();
            printTargetFailed({
              artifact,
              durationMs: Date.now() - startedAt,
              platform,
              variant: selected
            });
            if (buildError) printError(buildError);
            failed = true;
            break;
          }
        }

        if (failed) break;
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
      const appEnvRows = variants.flatMap((variant) =>
        envTableRows(variant.envs).map((entry) => ({
          variant: variant.name,
          ...entry
        }))
      );

      printPanel('Project', [
        { label: 'App dir', value: formatPathForDisplay(appDir) },
        { label: 'Config', value: formatPathForDisplay(configPath) },
        { label: 'Target scope', value: formatPlatformScope(platform) },
        { label: 'Current env', value: process.env.SHIPKIT_ENV ?? process.env.ENV ?? 'not set' }
      ]);

      printTablePanel(
        'Variants',
        [
          { key: 'variant', label: 'Variant', maxWidth: 32 },
          { key: 'env', label: 'Env', maxWidth: 24 },
          { key: 'targets', label: 'Targets', maxWidth: 18 },
          { key: 'file', label: 'File name', maxWidth: 42 }
        ],
        variants.map((variant) => ({
          env: variant.env,
          file: formatFileName(variant),
          targets: formatTargets(platform, variant),
          variant: variant.name
        }))
      );

      printTablePanel(
        'Loaded envs',
        [
          { key: 'key', label: 'Key', maxWidth: 34 },
          { key: 'value', label: 'Value', maxWidth: 42 },
          { key: 'mode', label: 'Mode', maxWidth: 10 }
        ],
        loadedEnvEntries.map((entry) => ({
          key: entry.name,
          mode: entry.forced ? 'forced' : 'file',
          value: formatEnvValue(entry.name, entry.value)
        }))
      );

      printTablePanel(
        'App envs',
        [
          { key: 'variant', label: 'Variant', maxWidth: 32 },
          { key: 'key', label: 'Key', maxWidth: 28 },
          { key: 'value', label: 'Value', maxWidth: 42 }
        ],
        appEnvRows
      );
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  }
});

const appIconCommand = defineCommand({
  meta: {
    name: 'appicon',
    description: 'Print the Shipkit app icon generator guide.'
  },
  async run() {
    try {
      printIntro('App Icon');
      printGuide('Generate app icons', [
        'Open https://fluenticstack.com/appicon in your browser.',
        'Generate your iOS, Android, and Android rounded app icons there.',
        'Download the generated .gz archive.',
        'Put the downloaded archive in your app folder.',
        'Then follow https://fluenticstack.com/shipkit/docs/appicon to configure the Expo plugin for your app.'
      ]);
      printOutro('App icon guide printed.');
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
    appicon: appIconCommand,
    build: buildCommand,
    'dev:android': createDevCommand('android'),
    'dev:ios': createDevCommand('ios'),
    'dev:packager': devPackagerCommand,
    info: infoCommand,
    'ios:sign': iosSignCommand,
    license: licenseCommand,
    prebuild: prebuildCommand,
    'prebuild:clean': prebuildCleanCommand,
    setup: setupCommand,
    switch: switchCommand
  }
});

export function main() {
  return runMain(mainCommand);
}
