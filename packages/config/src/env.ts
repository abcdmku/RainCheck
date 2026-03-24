import { providerSchema } from '@raincheck/contracts'
import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  RAINCHECK_APP_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  WEATHER_SERVICE_URL: z.string().url(),
  DB_URL: z.string().min(1),
  ARTIFACTS_DIR: z.string().min(1),
  APP_ENCRYPTION_KEY: z.string().min(16),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  DEFAULT_CHAT_PROVIDER: providerSchema.default('openai'),
  DEFAULT_CHAT_MODEL: z.string().default('gpt-4.1-mini'),
  DEFAULT_RESEARCH_PROVIDER: providerSchema.default('openai'),
  DEFAULT_RESEARCH_MODEL: z.string().default('gpt-4.1'),
  DEFAULT_VISION_PROVIDER: providerSchema.default('openai'),
  DEFAULT_VISION_MODEL: z.string().default('gpt-4.1-mini'),
  NWS_USER_AGENT: z.string().min(1),
  GEONAMES_USERNAME: z.string().optional(),
  ECMWF_DATASTORE_PAT: z.string().optional(),
  NCEI_CDO_TOKEN: z.string().optional(),
  RAINCHECK_PYTHON_BIN: z.string().optional(),
})

export type RainCheckEnv = z.infer<typeof envSchema>

export function parseEnv(source: Record<string, string | undefined>) {
  return envSchema.parse(source)
}
