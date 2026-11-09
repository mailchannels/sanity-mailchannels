import {createHash} from 'node:crypto'
import {defineBlueprint, defineDocumentFunction} from '@sanity/blueprints'
import {documentEventHandler} from '@sanity/functions'

export interface Configuration {
  projectId: string
  dataset: string
  documentTypes: string[]
  routingRevision: string
}
export interface Receipt {
  id: string
  projectId: string
  dataset: string
  documentId: string
  documentRevision: string
  documentType: string
  operation: 'published'|'review-requested'
  routingRevision: string
}
// Adapter MUST atomically insert/compare the receipt under its unique id, durably
// commit before resolving, and return duplicate without scheduling a second send.
export type Enqueue = (receipt: Readonly<Receipt>) => Promise<'stored' | 'duplicate'>

function bounded(value: unknown, pattern: RegExp, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && pattern.test(value)
}
function configuration(input: Configuration): Configuration {
  if (!bounded(input.projectId, /^[a-z0-9]+$/, 64) ||
      !bounded(input.dataset, /^[a-z0-9][a-z0-9_-]*$/, 64) ||
      !bounded(input.routingRevision, /^[A-Za-z0-9_-]+$/, 128) ||
      !Array.isArray(input.documentTypes) || !input.documentTypes.length ||
      input.documentTypes.length > 50 ||
      input.documentTypes.some(t => !bounded(t, /^[A-Za-z][A-Za-z0-9_]*$/, 128))) {
    throw new Error('Invalid editorial workflow configuration')
  }
  return {...input, documentTypes: [...new Set(input.documentTypes)]}
}

export function blueprint(input: Configuration) {
  const config = configuration(input)
  return defineBlueprint({resources: [defineDocumentFunction({
    name: 'mailchannels-published',
    event: {
      on: ['publish'],
      resource: {type: 'dataset', id: `${config.projectId}.${config.dataset}`},
      includeDrafts: false,
      includeAllVersions: false,
      filter: `_type in ${JSON.stringify(config.documentTypes)} && !(_id in path("drafts.**")) && !(_id in path("versions.**"))`,
      projection: '{_id, _rev, _type}',
    },
  })]})
}

// Factory deliberately has no default exported deployment handler: a real durable
// enqueue adapter must be supplied before this can become a deployed integration.
export function createPublishedHandler(input: Configuration, enqueue: Enqueue) {
  return createHandler(input, enqueue, 'published')
}

export function createReviewHandler(input: Configuration, enqueue: Enqueue) {
  return createHandler(input, enqueue, 'review-requested')
}

function createHandler(input: Configuration, enqueue: Enqueue, operation: Receipt['operation']) {
  const config = configuration(input)
  if (typeof enqueue !== 'function') throw new Error('Durable enqueue adapter required')
  return documentEventHandler<unknown>(async ({context, event}) => {
    if (context.eventResourceType !== 'dataset' ||
        context.eventResourceId !== `${config.projectId}.${config.dataset}` ||
        context.clientOptions?.projectId !== config.projectId ||
        context.clientOptions?.dataset !== config.dataset) {
      throw new Error('Editorial event scope mismatch')
    }
    const data = event?.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid document event')
    const {_id, _rev, _type} = data as Record<string, unknown>
    if (!bounded(_id, /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/, 128) ||
        !bounded(_rev, /^[A-Za-z0-9_-]+$/, 128) ||
        typeof _type !== 'string' || !config.documentTypes.includes(_type)) {
      throw new Error('Invalid document identity')
    }
    if (operation==='published' && (_id.startsWith('drafts.') || _id.startsWith('versions.'))) throw new Error('Unpublished document excluded')
    if (operation==='review-requested' && (!_id.startsWith('drafts.') || _id.startsWith('drafts.versions.') || (data as Record<string,unknown>)._reviewRequested!==true)) throw new Error('Review transition not verified')
    // JSON tuple avoids delimiter collisions. Resource ID alone is not an event ID.
    const identity = [config.projectId, config.dataset, _id, _rev, _type, operation, config.routingRevision]
    const receipt: Receipt = {
      id: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
      projectId: config.projectId, dataset: config.dataset,
      documentId: _id, documentRevision: _rev, documentType: _type,
      operation, routingRevision: config.routingRevision,
    }
    const result = await enqueue(Object.freeze(receipt))
    if (result !== 'stored' && result !== 'duplicate') throw new Error('Receipt persistence unconfirmed')
  })
}


export interface ReviewConfiguration extends Configuration {
  statusField: string
  readyValue: string
}
export function reviewBlueprint(input: ReviewConfiguration) {
  const config=configuration(input)
  if(!bounded(input.statusField,/^[A-Za-z][A-Za-z0-9_]*$/,128) || input.statusField.startsWith('_') ||
     !bounded(input.readyValue,/^[A-Za-z0-9_-]+$/,128)) throw new Error('Invalid review status configuration')
  const field=input.statusField, ready=JSON.stringify(input.readyValue)
  const transition=`${field} == ${ready} && coalesce(before().${field}, "") != ${ready}`
  return defineBlueprint({resources:[defineDocumentFunction({
    name:'mailchannels-review-requested',
    event:{
      on:['create','update'],resource:{type:'dataset',id:`${config.projectId}.${config.dataset}`},
      includeDrafts:true,includeAllVersions:false,
      filter:`_type in ${JSON.stringify(config.documentTypes)} && _id in path("drafts.**") && !(_id in path("drafts.versions.**")) && (${transition})`,
      projection:`{_id, _rev, _type, "_reviewRequested": (${transition})}`,
    },
  })]})
}
