import { defineBuild, defineVariant, env } from '@fluentic/shipkit';

const shared = defineBuild({
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
      }
    }
  }
});

const consumerApp = defineBuild(shared, {
  fileName: 'shipkit-consumer-[env]',
  credentials: {
    ios: {
      profiles: [
        {
          path: './credentials/ios/consumer-[env].mobileprovision'
        },
        {
          target: 'NotificationService',
          path: './credentials/ios/consumer-[env]-notification-service.mobileprovision'
        }
      ]
    }
  }
});

const partnerApp = defineBuild(shared, {
  fileName: 'shipkit-partner-[env]',
  credentials: {
    ios: {
      profiles: [
        {
          path: './credentials/ios/partner-[env].mobileprovision'
        },
        {
          target: 'NotificationService',
          path: './credentials/ios/partner-[env]-notification-service.mobileprovision'
        }
      ]
    }
  }
});

export default [
  defineVariant(consumerApp, {
    name: 'consumer_staging',
    env: 'staging',
    envs: {
      API_URL: env('CONSUMER_STAGING_API_URL', 'https://consumer-staging-api.example.local')
    }
  }),
  defineVariant(consumerApp, {
    name: 'consumer_production',
    env: 'production',
    envs: {
      API_URL: env('CONSUMER_PRODUCTION_API_URL', 'https://consumer-api.example.local')
    }
  }),
  defineVariant(partnerApp, {
    name: 'partner_staging',
    env: 'staging',
    envs: {
      API_URL: env('PARTNER_STAGING_API_URL', 'https://partner-staging-api.example.local')
    }
  }),
  defineVariant(partnerApp, {
    name: 'partner_production',
    env: 'production',
    envs: {
      API_URL: env('PARTNER_PRODUCTION_API_URL', 'https://partner-api.example.local')
    }
  })
];
