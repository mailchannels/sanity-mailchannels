import {defineBlueprint} from '@sanity/blueprints'
import {blueprint,reviewBlueprint} from './workflow.ts'
import {loadSettings} from './runtime.ts'
// Requires non-secret SANITY_EMAIL_CONFIG locally when planning a deployment.
// Provision server-side secrets separately; never embed them in this Blueprint.
const settings=loadSettings(process.env)
export default defineBlueprint({resources:[
  ...(blueprint(settings.published)().resources ?? []).map(r=>({...r,src:'entrypoints/published'})),
  ...(reviewBlueprint(settings.review)().resources ?? []).map(r=>({...r,src:'entrypoints/review'})),
]})
