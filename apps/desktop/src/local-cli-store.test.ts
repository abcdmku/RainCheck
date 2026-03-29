import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electronAppMock = vi.hoisted(() => ({
  getPath: vi.fn(),
}))

vi.mock('electron/main', () => ({
  app: electronAppMock,
}))

describe('local-cli-store', () => {
  let tempDir: string
  let clearStoredDesktopConnection: typeof import('./local-cli-store').clearStoredDesktopConnection
  let getStoredDesktopConnections: typeof import('./local-cli-store').getStoredDesktopConnections
  let saveStoredDesktopConnection: typeof import('./local-cli-store').saveStoredDesktopConnection

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'raincheck-desktop-store-'))
    electronAppMock.getPath.mockReturnValue(tempDir)
    ;({
      clearStoredDesktopConnection,
      getStoredDesktopConnections,
      saveStoredDesktopConnection,
    } = await import('./local-cli-store'))
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('saves and clears per-provider desktop local CLI models', async () => {
    await saveStoredDesktopConnection({
      providerId: 'openai',
      model: 'gpt-5',
    })

    const storedConnections = await getStoredDesktopConnections()

    expect(storedConnections.openai).toMatchObject({
      providerId: 'openai',
      model: 'gpt-5',
    })

    const rawStore = JSON.parse(
      await readFile(
        path.join(tempDir, 'local-provider-connections.json'),
        'utf8',
      ),
    ) as {
      connections: Array<{ providerId: string; model: string }>
    }

    expect(rawStore.connections).toContainEqual(
      expect.objectContaining({
        providerId: 'openai',
        model: 'gpt-5',
      }),
    )

    await clearStoredDesktopConnection('openai')

    expect((await getStoredDesktopConnections()).openai).toBeUndefined()
  })
})
