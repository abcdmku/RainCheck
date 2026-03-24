import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePythonBin } from './python-bin.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceDir = path.join(rootDir, 'services', 'weather')

try {
  const pythonBin = await resolvePythonBin()
  const child = spawn(
    pythonBin,
    [
      '-m',
      'uvicorn',
      'raincheck_weather.app:app',
      '--reload',
      '--app-dir',
      path.join(serviceDir, 'src'),
      '--host',
      '127.0.0.1',
      '--port',
      '8000',
    ],
    {
      cwd: serviceDir,
      stdio: 'inherit',
      shell: false,
    },
  )

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
} catch (error) {
  console.error(
    `[raincheck] Weather service not started: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(0)
}
