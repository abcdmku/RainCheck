import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
)

export function resolveWorkspacePath(target: string) {
  return path.isAbsolute(target) ? target : path.resolve(workspaceRoot, target)
}
