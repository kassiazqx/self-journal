import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REQUIRED_ENV_KEYS = [
  'E2E_SUPABASE_URL',
  'E2E_SUPABASE_ANON_KEY',
  'E2E_SUPABASE_SERVICE_ROLE_KEY',
  'E2E_EXISTING_USER_EMAIL',
  'E2E_EXISTING_USER_PASSWORD',
  'E2E_BOOTSTRAP_USER_EMAIL',
  'E2E_BOOTSTRAP_USER_PASSWORD',
  'E2E_EXISTING_USER_ID',
  'E2E_BOOTSTRAP_USER_ID',
]

export function getRequiredEnv(env = process.env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim())
  if (missing.length > 0) {
    throw new Error(`缺少 E2E 环境变量：${missing.join(', ')}`)
  }

  return {
    supabaseUrl: env.E2E_SUPABASE_URL,
    supabaseAnonKey: env.E2E_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: env.E2E_SUPABASE_SERVICE_ROLE_KEY,
    existingUser: {
      id: env.E2E_EXISTING_USER_ID,
      email: env.E2E_EXISTING_USER_EMAIL,
      password: env.E2E_EXISTING_USER_PASSWORD,
    },
    bootstrapUser: {
      id: env.E2E_BOOTSTRAP_USER_ID,
      email: env.E2E_BOOTSTRAP_USER_EMAIL,
      password: env.E2E_BOOTSTRAP_USER_PASSWORD,
    },
  }
}

export function loadLocalE2EEnv(env = process.env) {
  const localPath = path.resolve('.env.e2e.local')
  if (!existsSync(localPath)) return env

  const raw = readFileSync(localPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!env[key]) {
      env[key] = value
    }
  }

  return env
}

export function assertAllowedUserId(userId, envConfig) {
  const allowed = new Set([
    envConfig.existingUser.id,
    envConfig.bootstrapUser.id,
  ])

  if (!allowed.has(userId)) {
    throw new Error(`拒绝操作非白名单 E2E user_id: ${userId}`)
  }
}

export function createServiceRoleClient(envConfig) {
  return createClient(envConfig.supabaseUrl, envConfig.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createAnonClient(envConfig) {
  return createClient(envConfig.supabaseUrl, envConfig.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
