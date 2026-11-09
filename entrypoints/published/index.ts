import {documentEventHandler} from '@sanity/functions'
import {runtime} from '../../runtime.ts'
export const handler=documentEventHandler<unknown>(async envelope=>{
  try{await runtime().published(envelope)}catch{throw new Error('Sanity published notification intake failed')}
})
