import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createAnonClient, getRequiredEnv, loadLocalE2EEnv } from './e2e-contract.mjs'

const AUTH_DIR = path.resolve('playwright/.auth')

async function signInAndSave(client, targetPath, email, password, projectUrl) {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.session) throw new Error(`未拿到 session: ${email}`)

  const projectRef = new URL(projectUrl).hostname.split('.')[0]
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173',
        localStorage: [
          {
            name: `sb-${projectRef}-auth-token`,
            value: JSON.stringify(data.session),
          },
        ],
      },
    ],
  }

  await writeFile(targetPath, JSON.stringify(storageState, null, 2), 'utf8')
}

export async function createAuthStates(env = process.env) {
  loadLocalE2EEnv(env)
  const envConfig = getRequiredEnv(env)

  await mkdir(AUTH_DIR, { recursive: true })

  const existingPath = path.join(AUTH_DIR, 'existing-user.json')
  const bootstrapPath = path.join(AUTH_DIR, 'bootstrap-user.json')

  await signInAndSave(
    createAnonClient(envConfig),
    existingPath,
    envConfig.existingUser.email,
    envConfig.existingUser.password,
    envConfig.supabaseUrl,
  )

  await signInAndSave(
    createAnonClient(envConfig),
    bootstrapPath,
    envConfig.bootstrapUser.email,
    envConfig.bootstrapUser.password,
    envConfig.supabaseUrl,
  )

  return {
    status: 'ok',
    existingPath,
    bootstrapPath,
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false

if (isDirectRun) {
  createAuthStates()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error('[create-auth-state] failed:', error.message)
      process.exitCode = 1
    })
}
