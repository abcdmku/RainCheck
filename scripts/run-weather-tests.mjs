import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePythonBin } from './python-bin.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceDir = path.join(rootDir, 'services', 'weather')

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  })
}

function runDockerPytest() {
  const image = process.env.RAINCHECK_WEATHER_TEST_IMAGE ?? 'python:3.12-slim'

  return run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${rootDir}:/workspace`,
      '-w',
      '/workspace/services/weather',
      image,
      'sh',
      '-lc',
      "python -m pip install --upgrade pip && python -m pip install -e '.[dev]' && pytest",
    ],
    rootDir,
  )
}

const preferDocker = process.env.RAINCHECK_WEATHER_TEST_RUNTIME === 'docker'

if (!preferDocker) {
  try {
    const pythonBin = await resolvePythonBin()
    const localResult = run(pythonBin, ['-m', 'pytest'], serviceDir)

    if (localResult.status === 0) {
      process.exit(0)
    }

    console.warn(
      `[raincheck] Local weather tests failed with exit code ${localResult.status ?? 1}. Falling back to Docker.`,
    )
  } catch (error) {
    console.warn(
      `[raincheck] Local weather test runner unavailable: ${error instanceof Error ? error.message : String(error)}. Falling back to Docker.`,
    )
  }
}

const dockerResult = runDockerPytest()
process.exit(dockerResult.status ?? 1)
