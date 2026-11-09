import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadSettings,createRuntime} from '../runtime.ts'
const config=await readFile(new URL('../config.example.json',import.meta.url),'utf8')
const env={SANITY_EMAIL_CONFIG:config,SANITY_EMAIL_INTAKE_URL:`https://integrations.mailchannels.net/sanity/conn_${'a'.repeat(32)}/events`,SANITY_EMAIL_INTAKE_TOKEN:'st_'+'b'.repeat(43)}
test('example settings build both handlers without network access',()=>{
 const instance=createRuntime(env)
 assert.equal(typeof instance.published,'function');assert.equal(typeof instance.review,'function')
})
test('settings must share one dataset and use distinct route revisions',()=>{
 for(const modify of [s=>s.review.dataset='other',s=>s.review.routingRevision=s.published.routingRevision,s=>s.published.documentTypes=[]]){
  const value=JSON.parse(config);modify(value)
  assert.throws(()=>loadSettings({SANITY_EMAIL_CONFIG:JSON.stringify(value)}),/^Error: Invalid SANITY_EMAIL_CONFIG$/)
 }
 assert.throws(()=>loadSettings({SANITY_EMAIL_CONFIG:'{secret'}),/^Error: Invalid SANITY_EMAIL_CONFIG$/)
})
test('bad intake settings fail without echoing the token',()=>{
 for(const extra of [{SANITY_EMAIL_INTAKE_TOKEN:'st_secret-value'},{SANITY_EMAIL_INTAKE_URL:'http://integrations.mailchannels.net/x'},{SANITY_EMAIL_INTAKE_URL:undefined}]){
  assert.throws(()=>createRuntime({...env,...extra}),e=>e.message==='Invalid intake configuration' && !e.message.includes('secret-value'))
 }
})
