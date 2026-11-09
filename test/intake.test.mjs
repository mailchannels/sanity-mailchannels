import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {MockAgent,setGlobalDispatcher,getGlobalDispatcher} from 'undici'
import {createHttpsEnqueue} from '../intake.ts'
import {createPublishedHandler} from '../workflow.ts'
const previous=getGlobalDispatcher(),agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent)
after(async()=>{setGlobalDispatcher(previous);await agent.close()})
const ref='conn_'+'a'.repeat(32),url=`https://integrations.example.com/sanity/${ref}/events`,token='st_'+'b'.repeat(43)
const config={projectId:'test1234',dataset:'sandbox',documentTypes:['post'],routingRevision:'route1'}
const envelope=()=>({context:{eventResourceType:'dataset',eventResourceId:'test1234.sandbox',clientOptions:{projectId:'test1234',dataset:'sandbox'}},event:{data:{_id:'post1',_rev:'rev1',_type:'post',title:'Private title',recipient:'visitor@example.com'}}})
// Same identity as the Go service's known-answer test (internal/platform/sanity).
const receiptId='4b75272734b0d77f1382ead6dd637232fc0a6dbf677303a8cd078b48f65b1f3b'
const intercept=()=>agent.get('https://integrations.example.com').intercept({method:'POST',path:`/sanity/${ref}/events`})
const handler=()=>createPublishedHandler(config,createHttpsEnqueue({url,token}))
test('stored and duplicate answers confirm persistence; only identity and the bearer token are sent',async()=>{
 let captured
 intercept().reply(options=>{captured=options;return {statusCode:202,data:JSON.stringify({result:'stored',receipt_id:receiptId})}})
 await handler()(envelope())
 assert.equal(captured.headers.authorization??captured.headers.Authorization,`Bearer ${token}`)
 let raw=captured.body
 if(typeof raw!=='string'){const chunks=[];for await (const chunk of raw)chunks.push(Buffer.from(chunk));raw=Buffer.concat(chunks).toString()}
 assert.deepEqual(JSON.parse(raw),{project_id:'test1234',dataset:'sandbox',document_id:'post1',document_revision:'rev1',document_type:'post',operation:'published',routing_revision:'route1'})
 intercept().reply(200,JSON.stringify({result:'duplicate',receipt_id:receiptId}))
 await handler()(envelope())
})
test('unconfirmed, mismatched or failed answers reject the invocation',async()=>{
 for(const [status,body] of [[202,JSON.stringify({result:'stored',receipt_id:'f'.repeat(64)})],[202,JSON.stringify({result:'duplicate',receipt_id:receiptId})],
   [200,'not json'],[201,JSON.stringify({result:'stored',receipt_id:receiptId})],[401,'{}'],[400,'{}'],[503,'{}'],[302,'']]){
  intercept().reply(status,body,{headers:{location:'https://foreign.example/'}})
  await assert.rejects(handler()(envelope()),/Sanity|Receipt persistence unconfirmed/,`${status} ${body}`)
 }
 intercept().replyWithError(new Error('connection reset'))
 await assert.rejects(handler()(envelope()))
 agent.assertNoPendingInterceptors()
})
test('intake configuration must be the service URL over HTTPS with a well-formed token',()=>{
 for(const options of [{url:url.replace('https:','http:'),token},{url:url+'?token='+token,token},{url:'https://user:pw@integrations.example.com/sanity/'+ref+'/events',token},
   {url:'https://integrations.example.com/other',token},{url,token:token+'\n'},{url,token:'st_short'},{url,token:undefined},{url:undefined,token},{url,token,timeoutMs:0}])
  assert.throws(()=>createHttpsEnqueue(options),/^Error: Invalid intake configuration$/)
})
