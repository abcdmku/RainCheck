import { runtimeInfoResponseSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

export async function registerRuntimeRoutes(app: FastifyInstance) {
  app.get('/api/runtime', async () =>
    runtimeInfoResponseSchema.parse({
      runtime: app.raincheckRuntime,
    }),
  )
}
