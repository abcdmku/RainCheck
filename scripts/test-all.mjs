import { spawn } from 'node:child_process'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32' && command === 'pnpm'
        ? spawn('cmd.exe', ['/c', 'pnpm', ...args], {
            stdio: 'inherit',
            shell: false,
          })
        : spawn(command, args, {
            stdio: 'inherit',
            shell: false,
          })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
    })
  })
}

await run('pnpm', ['-r', '--if-present', 'test'])
await run('node', ['scripts/run-weather-tests.mjs'])
