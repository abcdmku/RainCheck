import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePythonBin } from './python-bin.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceDir = path.join(rootDir, 'services', 'weather')

const pythonBin = await resolvePythonBin()
const result = spawnSync(
  pythonBin,
  ['-m', 'pip', 'install', '-e', '.[dev]'],
  {
    cwd: serviceDir,
    stdio: 'inherit',
    shell: false,
  },
)

process.exit(result.status ?? 1)
