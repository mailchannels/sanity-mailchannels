import {blueprint,reviewBlueprint,createPublishedHandler,createReviewHandler} from './workflow.ts'
import type {Configuration,ReviewConfiguration} from './workflow.ts'
import {createHttpsEnqueue} from './intake.ts'
export interface Settings {published:Configuration;review:ReviewConfiguration}
type Environment=Record<string,string|undefined>
// Non-secret settings: which dataset, document types and route revisions the Functions use.
// Sender, recipients, subject and Studio link live in the MailChannels connection, not here.
export function loadSettings(env:Environment):Settings {
  try{
    const raw=env.SANITY_EMAIL_CONFIG
    if(!raw || Buffer.byteLength(raw)>65536)throw new Error()
    const settings=JSON.parse(raw) as Settings
    blueprint(settings.published);reviewBlueprint(settings.review)
    if(settings.published.projectId!==settings.review.projectId || settings.published.dataset!==settings.review.dataset ||
       settings.published.routingRevision===settings.review.routingRevision)throw new Error()
    return settings
  }catch{throw new Error('Invalid SANITY_EMAIL_CONFIG')}
}
export function createRuntime(env:Environment) {
  const settings=loadSettings(env)
  const enqueue=createHttpsEnqueue({url:env.SANITY_EMAIL_INTAKE_URL,token:env.SANITY_EMAIL_INTAKE_TOKEN})
  return {published:createPublishedHandler(settings.published,enqueue),review:createReviewHandler(settings.review,enqueue)}
}
let current:ReturnType<typeof createRuntime>|undefined
export function runtime(){return current ??=createRuntime(process.env)}
