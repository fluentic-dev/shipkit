import { defineBuild, defineVariant, env } from '@fluentic/shipkit';

const myapp = defineBuild({
  fileName: 'myapp',
  envs: {
    MORE: env('MORE')
  },
  credentials: {
    android: {
      keystore: {
        path: './credentials/android/demo.jks',
        keyAlias: env('ANDROID_KEY_ALIAS'),
        keyPassword: env('ANDROID_KEY_PASSWORD'),
        storePassword: env('ANDROID_STORE_PASSWORD')
      }
    },
    ios: {
      teamId: 'TEAMID1234',
      certificate: {
        path: './credentials/ios/demo.p12',
        password: env('IOS_CERT_PASSWORD')
      },
      profile: {
        path: './credentials/ios/demo.mobileprovision'
      },
      profiles: [
        {
          path: './credentials/ios/demo.mobileprovision'
        },
        {
          target: 'OneSignalNotificationServiceExtension',
          path: './ios/[env]-onesignal.mobileprovision'
        }
      ]
    }
  }
});

const myapp2 = defineBuild({
  fileName: 'myapp2-[env]',
  credentials: {
    android: {
      keystore: {
        path: './credentials/android/demo.jks',
        keyAlias: env('ANDROID_KEY_ALIAS'),
        keyPassword: env('ANDROID_KEY_PASSWORD'),
        storePassword: env('ANDROID_STORE_PASSWORD')
      }
    },
    ios: {
      teamId: 'TEAMID1234',
      certificate: {
        path: './credentials/ios/demo.p12',
        password: env('IOS_CERT_PASSWORD')
      },
      profile: {
        path: './credentials/ios/demo.mobileprovision'
      },
      profiles: [
        {
          path: './credentials/ios/demo.mobileprovision'
        },
        {
          target: 'OneSignalNotificationServiceExtension',
          path: './ios/[env]-onesignal.mobileprovision'
        }
      ]
    }
  }
});

export default [
  defineVariant(myapp, {
    name: 'myapp_staging',
    env: 'staging',
    aab: false,
    envs: {
      ANOTHER: env('ANOTHER_FIELD_IN_FILE')
    }
  }),
  defineVariant(myapp, { name: 'myapp_production', env: 'production', aab: false }),
  defineVariant(myapp2, { name: 'myapp2_staging', env: 'staging', aab: false }),
  defineVariant(myapp2, { name: 'myapp2_production', env: 'production', aab: false })
];
