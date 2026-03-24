import 'dotenv/config'

import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'RainCheck',
  slug: 'raincheck',
  scheme: 'raincheck',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  splash: {
    backgroundColor: '#0b1216',
  },
  extra: {
    appUrl: process.env.RAINCHECK_APP_URL ?? 'http://localhost:3000',
  },
}

export default config
