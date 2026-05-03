import { pathToFileURL } from 'node:url'

import { createServiceRoleClient, getRequiredEnv, loadLocalE2EEnv } from './e2e-contract.mjs'

export async function readBootstrapDbState(env = process.env) {
  loadLocalE2EEnv(env)
  const envConfig = getRequiredEnv(env)
  const client = createServiceRoleClient(envConfig)
  const userId = envConfig.bootstrapUser.id

  const [
    categoryResult,
    coreNeedResult,
    contactResult,
    entryResult,
  ] = await Promise.all([
    client.from('user_options').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('field_name', 'content_category'),
    client.from('user_options').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('field_name', 'core_need'),
    client.from('user_contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    client.from('journal_entries').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  return {
    categoryCount: categoryResult.count ?? 0,
    coreNeedCount: coreNeedResult.count ?? 0,
    contactCount: contactResult.count ?? 0,
    entryCount: entryResult.count ?? 0,
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false

if (isDirectRun) {
  readBootstrapDbState()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error('[bootstrap-state] failed:', error.message)
      process.exitCode = 1
    })
}
