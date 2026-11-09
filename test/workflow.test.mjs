import {test} from 'node:test'
import assert from 'node:assert/strict'
import {blueprint, createPublishedHandler} from '../workflow.ts'
const config = {projectId:'test1234',dataset:'sandbox',documentTypes:['post'],routingRevision:'route1'}
const envelope = () => ({context:{eventResourceType:'dataset',eventResourceId:'test1234.sandbox',clientOptions:{projectId:'test1234',dataset:'sandbox'}},event:{data:{_id:'post1',_rev:'rev1',_type:'post',title:'Private title',recipient:'visitor@example.com'}}})
test('native blueprint binds one dataset and publish lifecycle with minimal projection', () => {
 const value=blueprint(config)().resources[0]
 assert.deepEqual(value.event.resource,{type:'dataset',id:'test1234.sandbox'})
 assert.deepEqual(value.event.on,['publish'])
 assert.equal(value.event.includeDrafts,false)
 assert.equal(value.event.includeAllVersions,false)
 assert.equal(value.event.projection,'{_id, _rev, _type}')
 assert.match(value.event.filter,/_type in \["post"\]/)
})
test('only bounded document identity reaches persistence, not content or destinations',async()=>{
 let receipt
 await createPublishedHandler(config,async r=>{receipt=r;return 'stored'})(envelope())
 assert.equal(receipt.operation,'published');assert.equal(receipt.id.length,64)
 assert.ok(!JSON.stringify(receipt).includes('Private'));assert.ok(!('recipient' in receipt))
 assert.ok(Object.isFrozen(receipt))
})
test('replays have identical identity; revision and routing changes separate requests',async()=>{
 const ids=[];const save=async r=>{ids.push(r.id);return 'duplicate'}
 const handler=createPublishedHandler(config,save)
 await handler(envelope());await handler(envelope())
 const changed=envelope();changed.event.data._rev='rev2';await handler(changed)
 await createPublishedHandler({...config,routingRevision:'route2'},save)(envelope())
 assert.equal(ids[0],ids[1]);assert.equal(new Set(ids).size,3)
})
test('foreign or missing context never reaches persistence',async()=>{
 for(const mutate of [e=>e.context.clientOptions.dataset='other',e=>e.context.clientOptions.projectId='other',e=>e.context.eventResourceId='foreign.sandbox',e=>e.context.eventResourceType='media-library',e=>delete e.context.clientOptions]){
  let calls=0;const e=envelope();mutate(e)
  await assert.rejects(createPublishedHandler(config,async()=>{calls++;return 'stored'})(e),/scope mismatch/)
  assert.equal(calls,0)
 }
})
test('drafts, versions, wrong types and malformed payloads are rejected before enqueue',async()=>{
 for(const data of [null,[],{_id:'drafts.post1',_rev:'rev1',_type:'post'},{_id:'versions.release.post1',_rev:'rev1',_type:'post'},{_id:'post1',_rev:'rev1',_type:'receipt'},{_id:'post1',_rev:'',_type:'post'},{_id:'a'.repeat(129),_rev:'r',_type:'post'}]){
  let calls=0;const e=envelope();e.event.data=data
  await assert.rejects(createPublishedHandler(config,async()=>{calls++;return 'stored'})(e))
  assert.equal(calls,0)
 }
})
test('invalid wildcard/injected configuration rejected',()=>{
 for(const value of [{...config,dataset:'*'},{...config,documentTypes:['post" || true']},{...config,documentTypes:[]},{...config,routingRevision:''}]) assert.throws(()=>blueprint(value))
})
test('configuration mutations after handler creation cannot broaden scope',async()=>{
 const mutable={...config,documentTypes:['post']};let calls=0
 const handler=createPublishedHandler(mutable,async()=>{calls++;return 'stored'})
 mutable.documentTypes.push('receipt');mutable.dataset='other'
 await handler(envelope());const e=envelope();e.event.data._type='receipt';await assert.rejects(handler(e));assert.equal(calls,1)
})
test('persistence failures and unconfirmed responses reject without retrying',async()=>{
 for(const save of [async()=>{throw new Error('offline')},async()=>undefined]){
  let calls=0;const handler=createPublishedHandler(config,async r=>{calls++;return save(r)})
  await assert.rejects(handler(envelope()));assert.equal(calls,1)
 }
})

test('review receipt requires draft and verified transition; no status or private content persists',async()=>{
 const {createReviewHandler,reviewBlueprint}=await import('../workflow.ts')
 let stored
 const handler=createReviewHandler(config,async r=>{stored=r;return 'stored'})
 const e=envelope();e.event.data={...e.event.data,_id:'drafts.post1',_reviewRequested:true}
 await handler(e);assert.equal(stored.operation,'review-requested');assert.ok(!('_reviewRequested' in stored));assert.ok(!('title' in stored))
 for(const data of [{...e.event.data,_id:'post1'},{...e.event.data,_reviewRequested:false},{...e.event.data,_id:'drafts.versions.rel.post1'}])await assert.rejects(handler({...e,event:{data}}),/Review transition/)
 assert.throws(()=>reviewBlueprint({...config,statusField:'status || true',readyValue:'ready'}))
 assert.throws(()=>reviewBlueprint({...config,statusField:'status',readyValue:'ready"'}))
})
