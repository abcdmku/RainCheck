import fs from 'node:fs'
import path from 'node:path'

import type { FastifyInstance } from 'fastify'

import { resolveWorkspacePath } from '../lib/paths'

function resolveArtifactsDir(app: FastifyInstance) {
  return resolveWorkspacePath(app.raincheckEnv.ARTIFACTS_DIR)
}

export async function registerArtifactRoutes(app: FastifyInstance) {
  app.get('/api/artifacts/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const filePath = path.join(resolveArtifactsDir(app), params.id)

    if (!fs.existsSync(filePath)) {
      reply.status(404)
      return { error: 'Artifact not found' }
    }

    const extension = path.extname(filePath)
    reply.type(
      extension === '.svg'
        ? 'image/svg+xml'
        : extension === '.html'
          ? 'text/html'
          : 'application/octet-stream',
    )

    return reply.send(fs.createReadStream(filePath))
  })
}
