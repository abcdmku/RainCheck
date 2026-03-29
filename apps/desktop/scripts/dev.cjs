const path = require('node:path')
const { spawn } = require('node:child_process')

const waitOn = require('wait-on')
const electronBinary = require('electron')

const appDir = path.resolve(__dirname, '..')

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appDir,
      stdio: 'pipe',
      ...options,
    })

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk)
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk)
      })
    }

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`))
        return
      }

      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
        return
      }

      resolve()
    })
  })
}

async function main() {
  if (process.platform === 'win32') {
    await runCommand('pnpm build', [], { shell: true })
  } else {
    await runCommand('pnpm', ['build'])
  }

  await waitOn({ resources: ['tcp:3000'] })

  const electronEnv = { ...process.env }
  delete electronEnv.ELECTRON_RUN_AS_NODE

  await runCommand(electronBinary, ['./dist/main.js'], {
    env: electronEnv,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
