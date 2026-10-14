import { defineBuild, defineVariant, env } from '@fluentic/shipkit';

const app = defineBuild({
  fileName: 'shipkit-example',
  envs: {
    API_URL: env('API_URL', 'https://api.example.local'),
    IOS_TEAM_ID: env('IOS_TEAM_ID', '')
  },
  aab: false,
  credentials: {
    android: {
      keystore: {
        path: './credentials/android/release.keystore',
        keyAlias: env('ANDROID_KEY_ALIAS', ''),
        keyPassword: env('ANDROID_KEY_PASSWORD', ''),
        storePassword: env('ANDROID_STORE_PASSWORD', '')
      }
    },
    ios: {
      teamId: env('IOS_TEAM_ID', ''),
      certificate: {
        path: './credentials/ios/cert.p12',
        password: env('IOS_CERT_PASSWORD', '')
      },
      profile: {
        path: './credentials/ios/app.mobileprovision'
      }
    }
  }
});

export default defineVariant(app, {
  name: 'app',
  env: 'production'
});
