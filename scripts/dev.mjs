import concurrently from 'concurrently'

const result = concurrently(
  [
    {
      command: 'pnpm --filter @raincheck/api dev',
      name: 'api',
      prefixColor: 'cyan',
    },
    {
      command: 'pnpm --filter @raincheck/web dev',
      name: 'web',
      prefixColor: 'blue',
    },
    {
      command: 'node --env-file=.env ./scripts/run-weather-dev.mjs',
      name: 'weather',
      prefixColor: 'green',
    },
  ],
  {
    prefix: '[{name}]',
    killOthers: ['failure'],
  },
)

result.result.catch((error) => {
  console.error(error)
  process.exit(1)
})
