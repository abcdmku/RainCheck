import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron/main'
import type {
  DesktopLocalCliConnectionInput,
  DesktopLocalCliProviderId,
} from './protocol'

type StoredDesktopConnection = {
  providerId: DesktopLocalCliProviderId
  model: string
  createdAt: string
  updatedAt: string
}

type StoredDesktopConnectionFile = {
  version: 1
  connections: Array<StoredDesktopConnection>
}

function nowIso() {
  return new Date().toISOString()
}

function storePath() {
  return path.join(app.getPath('userData'), 'local-provider-connections.json')
}

async function readStoreFile(): Promise<StoredDesktopConnectionFile> {
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredDesktopConnectionFile>
    const connections = Array.isArray(parsed.connections)
      ? parsed.connections.filter((entry): entry is StoredDesktopConnection =>
          Boolean(
            entry &&
              typeof entry.providerId === 'string' &&
              typeof entry.model === 'string' &&
              typeof entry.createdAt === 'string' &&
              typeof entry.updatedAt === 'string',
          ),
        )
      : []

    return {
      version: 1,
      connections,
    }
  } catch {
    return {
      version: 1,
      connections: [],
    }
  }
}

async function writeStoreFile(payload: StoredDesktopConnectionFile) {
  await mkdir(path.dirname(storePath()), {
    recursive: true,
  })
  await writeFile(storePath(), JSON.stringify(payload, null, 2), 'utf8')
}

export async function getStoredDesktopConnections() {
  const payload = await readStoreFile()

  return Object.fromEntries(
    payload.connections.map((connection) => [
      connection.providerId,
      connection,
    ]),
  ) as Partial<Record<DesktopLocalCliProviderId, StoredDesktopConnection>>
}

export async function saveStoredDesktopConnection(
  input: DesktopLocalCliConnectionInput,
) {
  const payload = await readStoreFile()
  const existing = payload.connections.find(
    (connection) => connection.providerId === input.providerId,
  )
  const timestamp = nowIso()
  const nextConnection: StoredDesktopConnection = {
    providerId: input.providerId,
    model: input.model,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  const nextConnections = payload.connections.filter(
    (connection) => connection.providerId !== input.providerId,
  )

  nextConnections.push(nextConnection)
  await writeStoreFile({
    version: 1,
    connections: nextConnections,
  })

  return nextConnection
}

export async function clearStoredDesktopConnection(
  providerId: DesktopLocalCliProviderId,
) {
  const payload = await readStoreFile()
  const nextConnections = payload.connections.filter(
    (connection) => connection.providerId !== providerId,
  )

  await writeStoreFile({
    version: 1,
    connections: nextConnections,
  })
}
