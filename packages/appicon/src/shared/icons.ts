export type IconPlatform = 'android' | 'ios';
export type IconStylePlatform = IconPlatform | 'androidRounded';
export type IconBackgroundMode = 'gradient' | 'none' | 'solid';
export type IconBorderStyle = 'solid';
export type IconShape = 'circle' | 'organic' | 'original' | 'square' | 'squircle';
export type IconStyleScopeMode = 'multi' | 'single';

export type IconTarget = {
  id: string;
  platform: IconPlatform;
  stylePlatform?: IconStylePlatform;
  group: string;
  name: string;
  fileName: string;
  iosIdiom?: string;
  iosScale?: string;
  iosSize?: string;
  size: number;
};

export type IconStyleOptions = {
  background: string;
  backgroundAngle: number;
  backgroundEnd: string;
  backgroundMode: IconBackgroundMode;
  borderColor: string;
  borderAngle: number;
  borderEnd: string;
  borderMode: IconBackgroundMode;
  borderRadius: number;
  borderSize: number;
  borderStyle: IconBorderStyle;
  padding: number;
  scale: number;
  shadow: number;
  shape: IconShape;
};

export type IconStyleOverride = Partial<IconStyleOptions>;

export const iconTargets = [
  {
    id: 'android-mdpi',
    platform: 'android',
    group: 'Android legacy',
    name: 'mipmap-mdpi',
    fileName: 'android/res/mipmap-mdpi/ic_launcher.png',
    size: 48
  },
  {
    id: 'android-hdpi',
    platform: 'android',
    group: 'Android legacy',
    name: 'mipmap-hdpi',
    fileName: 'android/res/mipmap-hdpi/ic_launcher.png',
    size: 72
  },
  {
    id: 'android-xhdpi',
    platform: 'android',
    group: 'Android legacy',
    name: 'mipmap-xhdpi',
    fileName: 'android/res/mipmap-xhdpi/ic_launcher.png',
    size: 96
  },
  {
    id: 'android-xxhdpi',
    platform: 'android',
    group: 'Android legacy',
    name: 'mipmap-xxhdpi',
    fileName: 'android/res/mipmap-xxhdpi/ic_launcher.png',
    size: 144
  },
  {
    id: 'android-xxxhdpi',
    platform: 'android',
    group: 'Android legacy',
    name: 'mipmap-xxxhdpi',
    fileName: 'android/res/mipmap-xxxhdpi/ic_launcher.png',
    size: 192
  },
  {
    id: 'android-rounded-mdpi',
    platform: 'android',
    stylePlatform: 'androidRounded',
    group: 'Android rounded',
    name: 'mipmap-mdpi round',
    fileName: 'android/res/mipmap-mdpi/ic_launcher_round.png',
    size: 48
  },
  {
    id: 'android-rounded-hdpi',
    platform: 'android',
    stylePlatform: 'androidRounded',
    group: 'Android rounded',
    name: 'mipmap-hdpi round',
    fileName: 'android/res/mipmap-hdpi/ic_launcher_round.png',
    size: 72
  },
  {
    id: 'android-rounded-xhdpi',
    platform: 'android',
    stylePlatform: 'androidRounded',
    group: 'Android rounded',
    name: 'mipmap-xhdpi round',
    fileName: 'android/res/mipmap-xhdpi/ic_launcher_round.png',
    size: 96
  },
  {
    id: 'android-rounded-xxhdpi',
    platform: 'android',
    stylePlatform: 'androidRounded',
    group: 'Android rounded',
    name: 'mipmap-xxhdpi round',
    fileName: 'android/res/mipmap-xxhdpi/ic_launcher_round.png',
    size: 144
  },
  {
    id: 'android-rounded-xxxhdpi',
    platform: 'android',
    stylePlatform: 'androidRounded',
    group: 'Android rounded',
    name: 'mipmap-xxxhdpi round',
    fileName: 'android/res/mipmap-xxxhdpi/ic_launcher_round.png',
    size: 192
  },
  {
    id: 'android-adaptive-mdpi',
    platform: 'android',
    group: 'Android adaptive foreground',
    name: 'mdpi foreground',
    fileName: 'android/res/mipmap-mdpi/ic_launcher_foreground.png',
    size: 108
  },
  {
    id: 'android-adaptive-hdpi',
    platform: 'android',
    group: 'Android adaptive foreground',
    name: 'hdpi foreground',
    fileName: 'android/res/mipmap-hdpi/ic_launcher_foreground.png',
    size: 162
  },
  {
    id: 'android-adaptive-xhdpi',
    platform: 'android',
    group: 'Android adaptive foreground',
    name: 'xhdpi foreground',
    fileName: 'android/res/mipmap-xhdpi/ic_launcher_foreground.png',
    size: 216
  },
  {
    id: 'android-adaptive-xxhdpi',
    platform: 'android',
    group: 'Android adaptive foreground',
    name: 'xxhdpi foreground',
    fileName: 'android/res/mipmap-xxhdpi/ic_launcher_foreground.png',
    size: 324
  },
  {
    id: 'android-adaptive-xxxhdpi',
    platform: 'android',
    group: 'Android adaptive foreground',
    name: 'xxxhdpi foreground',
    fileName: 'android/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
    size: 432
  },
  {
    id: 'ios-notification-20-2x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'Notification 20pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-20@2x.png',
    iosIdiom: 'iphone',
    iosScale: '2x',
    iosSize: '20x20',
    size: 40
  },
  {
    id: 'ios-notification-20-3x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'Notification 20pt @3x',
    fileName: 'ios/AppIcon.appiconset/Icon-20@3x.png',
    iosIdiom: 'iphone',
    iosScale: '3x',
    iosSize: '20x20',
    size: 60
  },
  {
    id: 'ios-settings-29-2x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'Settings 29pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-29@2x.png',
    iosIdiom: 'iphone',
    iosScale: '2x',
    iosSize: '29x29',
    size: 58
  },
  {
    id: 'ios-settings-29-3x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'Settings 29pt @3x',
    fileName: 'ios/AppIcon.appiconset/Icon-29@3x.png',
    iosIdiom: 'iphone',
    iosScale: '3x',
    iosSize: '29x29',
    size: 87
  },
  {
    id: 'ios-spotlight-40-2x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'Spotlight 40pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-40@2x.png',
    iosIdiom: 'iphone',
    iosScale: '2x',
    iosSize: '40x40',
    size: 80
  },
  {
    id: 'ios-spotlight-40-3x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'Spotlight 40pt @3x',
    fileName: 'ios/AppIcon.appiconset/Icon-40@3x.png',
    iosIdiom: 'iphone',
    iosScale: '3x',
    iosSize: '40x40',
    size: 120
  },
  {
    id: 'ios-app-60-2x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'App 60pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-60@2x.png',
    iosIdiom: 'iphone',
    iosScale: '2x',
    iosSize: '60x60',
    size: 120
  },
  {
    id: 'ios-app-60-3x',
    platform: 'ios',
    group: 'iOS iPhone',
    name: 'App 60pt @3x',
    fileName: 'ios/AppIcon.appiconset/Icon-60@3x.png',
    iosIdiom: 'iphone',
    iosScale: '3x',
    iosSize: '60x60',
    size: 180
  },
  {
    id: 'ios-ipad-20-1x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'Notification 20pt',
    fileName: 'ios/AppIcon.appiconset/Icon-20.png',
    iosIdiom: 'ipad',
    iosScale: '1x',
    iosSize: '20x20',
    size: 20
  },
  {
    id: 'ios-ipad-20-2x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'Notification 20pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-20-ipad@2x.png',
    iosIdiom: 'ipad',
    iosScale: '2x',
    iosSize: '20x20',
    size: 40
  },
  {
    id: 'ios-ipad-29-1x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'Settings 29pt',
    fileName: 'ios/AppIcon.appiconset/Icon-29.png',
    iosIdiom: 'ipad',
    iosScale: '1x',
    iosSize: '29x29',
    size: 29
  },
  {
    id: 'ios-ipad-29-2x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'Settings 29pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-29-ipad@2x.png',
    iosIdiom: 'ipad',
    iosScale: '2x',
    iosSize: '29x29',
    size: 58
  },
  {
    id: 'ios-ipad-40-1x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'Spotlight 40pt',
    fileName: 'ios/AppIcon.appiconset/Icon-40.png',
    iosIdiom: 'ipad',
    iosScale: '1x',
    iosSize: '40x40',
    size: 40
  },
  {
    id: 'ios-ipad-40-2x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'Spotlight 40pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-40-ipad@2x.png',
    iosIdiom: 'ipad',
    iosScale: '2x',
    iosSize: '40x40',
    size: 80
  },
  {
    id: 'ios-ipad-76-1x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'App 76pt',
    fileName: 'ios/AppIcon.appiconset/Icon-76.png',
    iosIdiom: 'ipad',
    iosScale: '1x',
    iosSize: '76x76',
    size: 76
  },
  {
    id: 'ios-ipad-76-2x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'App 76pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-76@2x.png',
    iosIdiom: 'ipad',
    iosScale: '2x',
    iosSize: '76x76',
    size: 152
  },
  {
    id: 'ios-ipad-pro-83-5-2x',
    platform: 'ios',
    group: 'iOS iPad',
    name: 'iPad Pro 83.5pt @2x',
    fileName: 'ios/AppIcon.appiconset/Icon-83.5@2x.png',
    iosIdiom: 'ipad',
    iosScale: '2x',
    iosSize: '83.5x83.5',
    size: 167
  }
] satisfies IconTarget[];

export type IconGenerationOptions = {
  backgroundScopeMode?: IconStyleScopeMode;
  borderScopeMode?: IconStyleScopeMode;
  platformStyles?: Partial<Record<IconStylePlatform, IconStyleOverride>>;
  platforms: IconPlatform[];
  shapeScopeMode?: IconStyleScopeMode;
  sourceScopeMode?: IconStyleScopeMode;
  targetStyles?: Record<string, IconStyleOverride>;
} & IconStyleOptions;

export type IconSourceOverrides = {
  platformSources?: Partial<Record<IconStylePlatform, string>>;
  targetSources?: Record<string, string>;
};

export type GeneratedIcon = IconTarget & {
  dataUrl: string;
};
