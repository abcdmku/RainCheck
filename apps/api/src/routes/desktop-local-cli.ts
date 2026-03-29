import type { FastifyInstance } from 'fastify'

import {
  completeDesktopLocalCliSession,
  executeDesktopLocalCliTools,
  prepareDesktopLocalCliSession,
} from '../ai/desktop-local-cli-service'

export async function registerDesktopLocalCliRoutes(app: FastifyInstance) {
  app.post('/api/desktop/local-cli/prepare', async (request) => {
    return prepareDesktopLocalCliSession(app, request.body)
  })

  app.post('/api/desktop/local-cli/execute-tools', async (request) => {
    return executeDesktopLocalCliTools(app, request.body)
  })

  app.post('/api/desktop/local-cli/complete', async (request) => {
    return completeDesktopLocalCliSession(app, request.body)
  })
}
