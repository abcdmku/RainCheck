import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: vi.fn(),
}))

describe('local-cli diagnostics', () => {
  let getDesktopProviderConnections: typeof import('./local-cli').getDesktopProviderConnections
  let getLocalCliDiagnostics: typeof import('./local-cli').getLocalCliDiagnostics
  let platformSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(async () => {
    vi.resetModules()
    execFileMock.mockReset()
    platformSpy?.mockRestore()
    platformSpy = null
    ;({ getDesktopProviderConnections, getLocalCliDiagnostics } = await import(
      './local-cli'
    ))
  })

  it('parses Codex login status output from stderr', async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '', 'Logged in using ChatGPT')
      },
    )

    await expect(getLocalCliDiagnostics('openai')).resolves.toMatchObject({
      command: 'codex',
      detected: true,
      authReady: true,
      authMethod: 'ChatGPT',
      statusLabel: 'Ready via ChatGPT',
    })
  })

  it('marks a desktop local CLI connection as connected when auth is ready', async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '', 'Logged in using ChatGPT')
      },
    )

    await expect(getDesktopProviderConnections()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'openai',
          connected: true,
          configured: true,
          model: null,
          localCli: expect.objectContaining({
            authReady: true,
          }),
        }),
      ]),
    })
  })

  it('prefers a native Codex executable on Windows when one is available', async () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.resetModules()
    ;({ getLocalCliDiagnostics } = await import('./local-cli'))

    execFileMock.mockImplementation(
      (
        file: string,
        args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        if (file === 'where.exe' && args[0] === 'codex') {
          callback(
            null,
            [
              'C:\\nvm4w\\nodejs\\codex',
              'C:\\nvm4w\\nodejs\\codex.cmd',
              'C:\\Users\\Borg\\.vscode\\extensions\\openai.chatgpt\\bin\\codex.exe',
            ].join('\r\n'),
            '',
          )
          return
        }

        if (
          file ===
            'C:\\Users\\Borg\\.vscode\\extensions\\openai.chatgpt\\bin\\codex.exe' &&
          args[0] === 'login' &&
          args[1] === 'status'
        ) {
          callback(null, '', 'Logged in using ChatGPT')
          return
        }

        throw new Error(`Unexpected execFile call: ${file} ${args.join(' ')}`)
      },
    )

    await expect(getLocalCliDiagnostics('openai')).resolves.toMatchObject({
      command: 'codex',
      detected: true,
      authReady: true,
      authMethod: 'ChatGPT',
      statusLabel: 'Ready via ChatGPT',
    })

    expect(execFileMock).toHaveBeenCalledWith(
      'C:\\Users\\Borg\\.vscode\\extensions\\openai.chatgpt\\bin\\codex.exe',
      ['login', 'status'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('wraps codex.cmd through PowerShell on Windows when no native exe is available', async () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.resetModules()
    ;({ getLocalCliDiagnostics } = await import('./local-cli'))

    execFileMock.mockImplementation(
      (
        file: string,
        args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        if (file === 'where.exe' && args[0] === 'codex') {
          callback(
            null,
            ['C:\\nvm4w\\nodejs\\codex', 'C:\\nvm4w\\nodejs\\codex.cmd'].join(
              '\r\n',
            ),
            '',
          )
          return
        }

        if (
          file === 'powershell.exe' &&
          args.includes('C:\\nvm4w\\nodejs\\codex.cmd')
        ) {
          callback(null, '', 'Logged in using ChatGPT')
          return
        }

        throw new Error(`Unexpected execFile call: ${file} ${args.join(' ')}`)
      },
    )

    await expect(getLocalCliDiagnostics('openai')).resolves.toMatchObject({
      command: 'codex',
      detected: true,
      authReady: true,
      authMethod: 'ChatGPT',
      statusLabel: 'Ready via ChatGPT',
    })

    expect(execFileMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'C:\\nvm4w\\nodejs\\codex.cmd',
        'login',
        'status',
      ]),
      expect.any(Object),
      expect.any(Function),
    )
  })
})
