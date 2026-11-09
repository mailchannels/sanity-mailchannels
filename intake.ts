import type {Enqueue} from './workflow.ts'
interface Options {url: string|undefined; token: string|undefined; timeoutMs?: number}
// Durable enqueue through the shared MailChannels integration service: one HTTPS POST of the bounded
// identity with the connection's bearer token. The service commits the receipt before it answers
// 202 stored or 200 duplicate, and returns the receipt ID it computed; anything else fails the
// invocation so Sanity can retry the same identity.
export function createHttpsEnqueue({url, token, timeoutMs = 10000}: Options): Enqueue {
  let target: URL|undefined
  try { target = new URL(url ?? '') } catch { /* rejected below */ }
  if (!target || target.protocol !== 'https:' || target.username || target.password || target.search || target.hash ||
      !/^\/sanity\/conn_[A-Za-z0-9_-]{32}\/events$/.test(target.pathname) ||
      typeof token !== 'string' || !/^st_[A-Za-z0-9_-]{43}$/.test(token) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 15000) throw new Error('Invalid intake configuration')
  const endpoint = target.href
  return async receipt => {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({project_id: receipt.projectId, dataset: receipt.dataset, document_id: receipt.documentId,
        document_revision: receipt.documentRevision, document_type: receipt.documentType, operation: receipt.operation,
        routing_revision: receipt.routingRevision}),
    })
    const expected = response.status === 202 ? 'stored' : response.status === 200 ? 'duplicate' : null
    let body: {result?: unknown; receipt_id?: unknown}|null = null
    if (expected) { try { body = await response.json() } catch { /* unconfirmed below */ } }
    else void response.body?.cancel().catch(() => {})
    if (!expected || body?.result !== expected || body?.receipt_id !== receipt.id) throw new Error('Receipt persistence unconfirmed')
    return expected
  }
}
