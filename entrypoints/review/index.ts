import {documentEventHandler} from '@sanity/functions'
import {runtime} from '../../runtime.ts'
export const handler=documentEventHandler<unknown>(async envelope=>{
  try{await runtime().review(envelope)}catch{throw new Error('Sanity review notification intake failed')}
})
