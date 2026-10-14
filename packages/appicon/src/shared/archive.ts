import {
  type GeneratedIcon,
  type IconGenerationOptions,
  type IconSourceOverrides,
  iconTargets
} from './icons.js';

export type AppIconArchiveFile = {
  data: string;
  path: string;
};

export type AppIconGeneratedArchive = {
  createdAt: string;
  files: AppIconArchiveFile[];
  kind: 'shipkit-appicon.generated';
  version: 1;
};

export type AppIconStateArchive = {
  createdAt: string;
  generated: AppIconGeneratedArchive;
  kind: 'shipkit-appicon.state';
  options: IconGenerationOptions;
  source: {
    data: string;
    name: string;
    type: string;
  } | null;
  sourceOverrides?: IconSourceOverrides;
  version: 1;
};

export type AppIconArchive = AppIconGeneratedArchive | AppIconStateArchive;

export function createGeneratedArchive(icons: GeneratedIcon[]): AppIconGeneratedArchive {
  const files = icons.map((icon) => ({
    data: dataUrlBase64(icon.dataUrl),
    path: icon.fileName
  }));

  if (icons.some((icon) => icon.platform === 'ios')) {
    files.push({
      data: textToBase64(JSON.stringify(createIosContentsJson(), null, 2)),
      path: 'ios/AppIcon.appiconset/Contents.json'
    });
  }

  return {
    createdAt: new Date().toISOString(),
    files,
    kind: 'shipkit-appicon.generated',
    version: 1
  };
}

export function createGeneratedAssetFiles(icons: GeneratedIcon[]): AppIconArchiveFile[] {
  const files = icons.map((icon) => ({
    data: dataUrlBase64(icon.dataUrl),
    path: downloadableAssetPath(icon)
  }));

  if (icons.some((icon) => icon.platform === 'ios')) {
    files.push({
      data: textToBase64(JSON.stringify(createIosContentsJson(), null, 2)),
      path: 'ios/AppIcon.appiconset/Contents.json'
    });
  }

  return files;
}

export function createStateArchive(options: {
  generated: AppIconGeneratedArchive;
  options: IconGenerationOptions;
  source: { data: string; name: string; type: string; } | null;
  sourceOverrides?: IconSourceOverrides;
}): AppIconStateArchive {
  return {
    createdAt: new Date().toISOString(),
    generated: options.generated,
    kind: 'shipkit-appicon.state',
    options: options.options,
    source: options.source,
    ...(options.sourceOverrides ? { sourceOverrides: options.sourceOverrides } : {}),
    version: 1
  };
}

export function iconsFromGeneratedArchive(archive: AppIconGeneratedArchive): GeneratedIcon[] {
  return iconTargets.flatMap((target) => {
    const file = archive.files.find((item) => item.path === target.fileName);
    if (!file) return [];

    return [{
      ...target,
      dataUrl: `data:image/png;base64,${file.data}`
    }];
  });
}

export function dataUrlBase64(dataUrl: string) {
  return dataUrl.split(',', 2)[1] ?? '';
}

function createIosContentsJson() {
  return {
    images: iconTargets
      .filter((target) => target.platform === 'ios')
      .map((target) => ({
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

function downloadableAssetPath(icon: GeneratedIcon) {
  if (icon.stylePlatform === 'androidRounded') {
    return icon.fileName.replace(/^android\//u, 'android-rounded/');
  }

  return icon.fileName;
}

function textToBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
