import { withDangerousMod, withPlugins } from '@expo/config-plugins';
import type { ConfigPlugin } from '@expo/config-plugins';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import type { AppIconArchive, AppIconGeneratedArchive } from './shared/archive.js';
import { iconTargets } from './shared/icons.js';
import type { IconTarget } from './shared/icons.js';

export type AppIconPluginOptions = {
  androidAssetDir?: string;
  iosAssetDir?: string;
  source?: string;
};

const defaultSource = 'assets/shipkit/shipkit-appicon.tar.gz';
const androidArchivePrefix = 'android/res/';
const androidRoundedArchivePrefix = 'android-rounded/res/';
const iosArchivePrefix = 'ios/AppIcon.appiconset/';
const iosContentsJson = 'Contents.json';

type AppIconArchiveEntry = {
  data: Buffer;
  path: string;
};

type AndroidTargetFile = {
  archivePaths: string[];
  relativePath: string;
};

type IosTargetFile = {
  archivePath: string;
  relativePath: string;
  target: IconTarget;
};

const withShipkitAppIcon: ConfigPlugin<AppIconPluginOptions | string | undefined> = (
  config,
  rawOptions
) => {
  const options = normalizeOptions(rawOptions);
  return withPlugins(config, [
    [withAndroidAssets, options],
    [withIosAssets, options]
  ]);
};

const withAndroidAssets: ConfigPlugin<AppIconPluginOptions> = (config, options) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const outputDir = path.resolve(config.modRequest.platformProjectRoot, 'app/src/main/res');

      if (options.androidAssetDir) {
        await removeAndroidTargetFiles(outputDir);
        await copyDir(
          path.resolve(config.modRequest.projectRoot, options.androidAssetDir, 'res'),
          outputDir
        );
      } else {
        await syncAndroidArchiveFiles(
          outputDir,
          await readArchiveEntries(config.modRequest.projectRoot, options.source ?? defaultSource)
        );
      }

      return config;
    }
  ]);

const withIosAssets: ConfigPlugin<AppIconPluginOptions> = (config, options) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const iconsetDir = 'AppIcon.appiconset';
      const outputDir = path.resolve(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName!,
        'Images.xcassets',
        iconsetDir
      );

      if (options.iosAssetDir) {
        await removeIosTargetFiles(outputDir);
        await copyDir(
          path.resolve(config.modRequest.projectRoot, options.iosAssetDir, iconsetDir),
          outputDir
        );
      } else {
        await syncIosArchiveFiles(
          outputDir,
          await readArchiveEntries(config.modRequest.projectRoot, options.source ?? defaultSource)
        );
      }

      return config;
    }
  ]);

function normalizeOptions(
  options: AppIconPluginOptions | string | undefined
): AppIconPluginOptions {
  if (typeof options === 'string') return { source: options };
  return options ?? { source: defaultSource };
}

async function readArchiveEntries(
  projectRoot: string,
  source: string
): Promise<AppIconArchiveEntry[]> {
  const archivePath = path.resolve(projectRoot, source);
  const raw = await readFile(archivePath);
  const buffers = isGzip(raw) ? [gunzipSync(raw), raw] : [raw];

  for (const buffer of buffers) {
    const jsonArchive = parseJsonArchive(buffer);
    if (jsonArchive) {
      return generatedArchiveEntries(jsonArchive);
    }

    const zipEntries = readZipArchiveEntries(buffer, archivePath);
    if (zipEntries) return zipEntries;

    const tarEntries = readTarArchiveEntries(buffer, archivePath);
    if (tarEntries) return tarEntries;
  }

  throw new Error(`Unsupported Shipkit app icon archive: ${archivePath}`);
}

function parseJsonArchive(buffer: Buffer): AppIconGeneratedArchive | null {
  try {
    const archive = JSON.parse(buffer.toString('utf8')) as AppIconArchive;
    if (archive.kind === 'shipkit-appicon.generated') return archive;
    if (archive.kind === 'shipkit-appicon.state') return archive.generated;
  } catch {
    return null;
  }

  return null;
}

function generatedArchiveEntries(archive: AppIconGeneratedArchive): AppIconArchiveEntry[] {
  return archive.files.map((file) => ({
    data: Buffer.from(file.data, 'base64'),
    path: normalizeArchivePath(file.path)
  }));
}

function readTarArchiveEntries(
  buffer: Buffer,
  archivePath: string
): AppIconArchiveEntry[] | null {
  if (!isTar(buffer)) return null;

  const entries: AppIconArchiveEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buffer.byteLength) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const filePath = normalizeArchivePath(prefix ? `${prefix}/${name}` : name);
    const size = readTarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0).replace(/\0/u, '');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (dataEnd > buffer.byteLength) {
      throw new Error(`Invalid Shipkit app icon tar archive: ${archivePath}`);
    }

    if ((type === '' || type === '0') && filePath) {
      entries.push({
        data: buffer.subarray(dataStart, dataEnd),
        path: filePath
      });
    }

    offset = dataStart + size + tarPadding(size);
  }

  if (entries.length === 0) {
    return null;
  }

  return entries;
}

function readZipArchiveEntries(
  buffer: Buffer,
  archivePath: string
): AppIconArchiveEntry[] | null {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) return null;

  const entries: AppIconArchiveEntry[] = [];
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let offset = centralDirectoryOffset;

  while (offset + 46 <= centralDirectoryEnd) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid Shipkit app icon zip archive: ${archivePath}`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const filePath = normalizeArchivePath(
      buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8')
    );

    offset += 46 + fileNameLength + extraLength + commentLength;

    if (!filePath || filePath.endsWith('/')) continue;

    const data = readZipLocalFile(
      buffer,
      localHeaderOffset,
      compressedSize,
      compressionMethod,
      archivePath
    );
    entries.push({ data, path: filePath });
  }

  return entries.length > 0 ? entries : null;
}

function readZipLocalFile(
  buffer: Buffer,
  offset: number,
  compressedSize: number,
  compressionMethod: number,
  archivePath: string
) {
  if (offset + 30 > buffer.byteLength || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid Shipkit app icon zip archive: ${archivePath}`);
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > buffer.byteLength) {
    throw new Error(`Invalid Shipkit app icon zip archive: ${archivePath}`);
  }

  const data = buffer.subarray(dataStart, dataEnd);
  if (compressionMethod === 0) return data;
  if (compressionMethod === 8) return inflateRawSync(data);

  throw new Error(
    `Unsupported compression method ${compressionMethod} in Shipkit app icon zip archive: ${archivePath}`
  );
}

async function syncAndroidArchiveFiles(outputDir: string, entries: AppIconArchiveEntry[]) {
  const targetFiles = androidTargetFiles();
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));

  await removeAndroidTargetFiles(outputDir);

  for (const targetFile of targetFiles) {
    const entry = targetFile.archivePaths
      .map((archivePath) => entryByPath.get(archivePath))
      .find((item): item is AppIconArchiveEntry => Boolean(item));
    if (!entry) continue;

    await writeOutputFile(outputDir, targetFile.relativePath, entry.data);
  }
}

async function syncIosArchiveFiles(outputDir: string, entries: AppIconArchiveEntry[]) {
  const targetFiles = iosTargetFiles();
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const availableTargets: IconTarget[] = [];

  await removeIosTargetFiles(outputDir);

  for (const targetFile of targetFiles) {
    const entry = entryByPath.get(targetFile.archivePath);
    if (!entry) continue;

    await writeOutputFile(outputDir, targetFile.relativePath, entry.data);
    availableTargets.push(targetFile.target);
  }

  if (availableTargets.length > 0) {
    await writeOutputFile(
      outputDir,
      iosContentsJson,
      Buffer.from(JSON.stringify(createIosContentsJson(availableTargets), null, 2))
    );
  }
}

async function removeAndroidTargetFiles(outputDir: string) {
  await Promise.all(
    androidTargetFiles().map((file) => rm(path.join(outputDir, file.relativePath), { force: true }))
  );
}

async function removeIosTargetFiles(outputDir: string) {
  await Promise.all([
    ...iosTargetFiles().map((file) => rm(path.join(outputDir, file.relativePath), { force: true })),
    rm(path.join(outputDir, iosContentsJson), { force: true })
  ]);
}

async function writeOutputFile(outputDir: string, relativePath: string, data: Buffer) {
  assertSafeRelativePath(relativePath);
  const destination = path.resolve(outputDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

function androidTargetFiles(): AndroidTargetFile[] {
  return iconTargets
    .filter((target) => target.platform === 'android')
    .map((target) => {
      const relativePath = target.fileName.slice(androidArchivePrefix.length);
      const archivePaths = [target.fileName];

      if (target.stylePlatform === 'androidRounded') {
        archivePaths.push(target.fileName.replace(/^android\/res\//u, androidRoundedArchivePrefix));
      }

      return { archivePaths, relativePath };
    });
}

function iosTargetFiles(): IosTargetFile[] {
  return iconTargets
    .filter((target) => target.platform === 'ios')
    .map((target) => ({
      archivePath: target.fileName,
      relativePath: target.fileName.slice(iosArchivePrefix.length),
      target
    }));
}

function createIosContentsJson(targets: IconTarget[]) {
  return {
    images: targets.map((target) => ({
      filename: target.fileName.split('/').at(-1),
      idiom: target.iosIdiom,
      scale: target.iosScale,
      size: target.iosSize
    })),
    info: {
      author: 'xcode',
      version: 1
    }
  };
}

function normalizeArchivePath(filePath: string) {
  return filePath.replace(/\\/gu, '/').replace(/^\.?\//u, '').replace(/^\/+/u, '');
}

function isGzip(buffer: Buffer) {
  return buffer.byteLength >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isTar(buffer: Buffer) {
  return buffer.byteLength >= 265 && buffer.subarray(257, 262).toString('utf8') === 'ustar';
}

function findZipEndOfCentralDirectory(buffer: Buffer) {
  const minimumSize = 22;
  const maxCommentSize = 0xffff;
  if (buffer.byteLength < minimumSize) return -1;

  const firstOffset = Math.max(0, buffer.byteLength - minimumSize - maxCommentSize);

  for (let offset = buffer.byteLength - minimumSize; offset >= firstOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }

  return -1;
}

function assertSafeRelativePath(relativePath: string) {
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe Shipkit app icon archive path: ${relativePath}`);
  }
}

function readTarString(header: Buffer, offset: number, length: number) {
  const value = header.subarray(offset, offset + length);
  const end = value.indexOf(0);
  return value.subarray(0, end === -1 ? undefined : end).toString('utf8');
}

function readTarOctal(header: Buffer, offset: number, length: number) {
  const value = readTarString(header, offset, length).trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function tarPadding(size: number) {
  return (512 - (size % 512)) % 512;
}

async function copyDir(inputDir: string, outputDir: string) {
  await cp(inputDir, outputDir, { force: true, recursive: true });
}

export { withShipkitAppIcon };
export default withShipkitAppIcon;
