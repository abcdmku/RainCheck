import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveWorkspacePath } from '../lib/paths'
import { createDb } from './client'

const cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
    })
  }
})

describe('createDb', () => {
  it('creates parent directories for workspace-relative database paths', () => {
    const relativeDir = `artifacts/test-db-${Date.now()}`
    const dbFileName = 'raincheck.db'
    const absoluteDir = resolveWorkspacePath(relativeDir)

    cleanupDirs.push(absoluteDir)
    fs.rmSync(absoluteDir, {
      recursive: true,
      force: true,
    })

    const { sqlite } = createDb(path.join(relativeDir, dbFileName))
    sqlite.close()

    expect(fs.existsSync(path.join(absoluteDir, dbFileName))).toBe(true)
  })
})
