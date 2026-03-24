import { access } from 'node:fs/promises'
import path from 'node:path'

const candidates = [
  process.env.RAINCHECK_PYTHON_BIN,
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'Programs',
    'Python',
    'Python312',
    'python.exe',
  ),
  'python3',
  'python',
]

export async function resolvePythonBin() {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    if (candidate === 'python' || candidate === 'python3') {
      return candidate
    }

    try {
      await access(candidate)
      return candidate
    } catch {
      continue
    }
  }

  throw new Error(
    'No Python interpreter found. Set RAINCHECK_PYTHON_BIN or install Python 3.12+.',
  )
}
