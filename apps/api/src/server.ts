import 'dotenv/config'
import { parseEnv } from '@raincheck/config'

import { buildApp } from './app'

const env = parseEnv(process.env)
const app = buildApp({ env })

app
  .listen({
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 3001),
  })
  .catch((error) => {
    app.log.error(error)
    process.exit(1)
  })
