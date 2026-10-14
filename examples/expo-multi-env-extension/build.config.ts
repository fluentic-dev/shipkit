import { defineBuild, defineVariant, env } from '@fluentic/shipkit';

const app = defineBuild({
  fileName: 'shipkit-extension-[env]',
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
      profiles: [
        {
          path: './credentials/ios/[env].mobileprovision'
        },
        {
          target: 'NotificationService',
          path: './credentials/ios/[env]-notification-service.mobileprovision'
        }
      ]
    }
  }
});

export default [
  defineVariant(app, {
    name: 'staging',
    env: 'staging',
    envs: {
      API_URL: env('STAGING_API_URL', 'https://staging-api.example.local')
    }
  }),
  defineVariant(app, {
    name: 'production',
    env: 'production',
    envs: {
      API_URL: env('PRODUCTION_API_URL', 'https://api.example.local')
    }
  })
];
