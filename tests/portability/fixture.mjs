import {createHash} from 'node:crypto';

const quote=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
const insert=(table,row)=>`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(quote).join(',')});`;
export function inlineSpans(personId, pageId) {
  return [
    ...['bold','italic','underline','strikethrough','code'].map(mark => ({text:`${mark} words`,marks:[mark]})),
    {text:'combined marks',marks:['bold','italic','underline','strikethrough','code'],colour:'blue'},
    ...['yellow','blue','green','red','purple'].map(colour=>({text:`${colour} highlight`,colour})),
    {text:'External reference',link:{href:'https://example.invalid/document?part=1&next=2'}},
    {text:'Child link',link:{href:`/app/pages/${pageId}`}},
    {text:'Research member',mention:{kind:'person',id:personId,label:'Research member'}},
    {text:'Linked child',mention:{kind:'page',id:pageId,label:'Linked child'}},
    {text:'2030-06-15',mention:{kind:'date',id:'2030-06-15',label:'2030-06-15'}},
    {text:'Ready for review',status:{colour:'green'}},
    {text:'Literal <img src=x onerror=alert(1)> & <script>unsafe()</script>'},
  ];
}
export const pageIds=['archive-root','archive-child','archive-sibling'];

/** Labelled test-only records. Native bootstrap/sign-in and R2 upload stay real. */
export function populatedFixture(owner){
  const now='2026-09-08T12:00:00.000Z',workspace=owner.workspaceId;
  const statements=[`UPDATE workspaces SET name='Portable knowledge',description='Unicode notes — preserved',first_run_completed_at=${quote(now)} WHERE id=${quote(workspace)};`];
  statements.push(`UPDATE status_entries SET label='Accepted review Ω',color='#334455' WHERE workspace_id=${quote(workspace)} AND key='verified';`);
  const add=(table,row)=>statements.push(insert(table,row));
  for(const [id,kind,name]of [['archive-member','member','Research member'],['archive-guest','guest','Scoped guest']])add('members',{id,workspace_id:workspace,email:`${id}@example.invalid`,display_name:name,initials:kind==='guest'?'SG':'RM',role:'member',member_kind:kind,status:'active',theme:'dark',created_at:now,updated_at:now});
  add('groups',{id:'archive-group',workspace_id:workspace,name:'Researchers',created_at:now,updated_at:now,revision_id:'group-revision'});
  add('group_members',{group_id:'archive-group',member_id:'archive-member',created_at:now});
  for(const [id,key,name]of [['archive-container','DOCS','Documentation'],['archive-private','PRIVATE','Private notes']]){
    add('containers',{id,workspace_id:workspace,key,name,description:`${name} description`,visibility:'closed',created_at:now,updated_at:now,revision_id:`${id}-revision`});
    add('container_owners',{container_id:id,member_id:owner.id,created_at:now});
    add('container_grants',{id:`${id}-owner-grant`,container_id:id,principal_kind:'member',principal_id:owner.id,level:'full',created_at:now,updated_at:now});
  }
  add('container_grants',{id:'group-container-grant',container_id:'archive-container',principal_kind:'group',principal_id:'archive-group',level:'edit',created_at:now,updated_at:now});
  for(const [index,id]of pageIds.entries()){
    const title=['Restorable research Ω','Linked child','Private sibling'][index];
    const block={id:`${id}-block`,pageId:id,parentBlockId:null,blockType:'paragraph',content:{text:[{text:`${title}: durable body`},...inlineSpans('archive-member','archive-child')]},treePosition:'0010',revisionId:`${id}-block-revision`};
    const props={title,icon:'📚',coverFileId:null,ownerMemberId:owner.id,statusKey:null,labels:['portable','research'],typeface:'serif',smallText:true,fullWidth:true};
    add('pages',{id,workspace_id:workspace,container_id:index===2?'archive-private':'archive-container',parent_page_id:index===1?'archive-root':null,title,icon:'📚',author_member_id:owner.id,owner_member_id:owner.id,lifecycle:'live',working_revision_id:`${id}-current`,published_revision_id:`${id}-current`,tree_position:index===1?'0005':'0020',typeface:'serif',small_text:1,full_width:1,created_at:now,updated_at:now,revision_id:`${id}-current`});
    add('page_blocks',{id:block.id,page_id:id,parent_block_id:null,block_type:block.blockType,content_json:JSON.stringify(block.content),tree_position:block.treePosition,revision_id:block.revisionId,created_at:now,updated_at:now});
    for(const [suffix,body]of [['previous',[{...block,content:{text:[{text:'Previous accepted body'}]}}]],['current',[block]]])add('page_revisions',{id:`${id}-${suffix}`,page_id:id,author_member_id:owner.id,origin:suffix==='current'?'publish':'autosave',content_hash:createHash('sha256').update(JSON.stringify(body)).digest('hex'),body_json:JSON.stringify(body),properties_json:JSON.stringify(props),ordinal:suffix==='current'?2:1,label:suffix,created_at:now});
    for(const label of props.labels)add('page_labels',{page_id:id,label,created_at:now});
    add('page_contributors',{page_id:id,member_id:'archive-member',created_at:now});
  }
  add('page_grants',{id:'guest-page-grant',page_id:'archive-child',principal_kind:'member',principal_id:'archive-guest',level:'comment',created_at:now,updated_at:now});
  add('page_grants',{id:'group-page-grant',page_id:'archive-root',principal_kind:'group',principal_id:'archive-group',level:'edit',expires_at:'2030-01-01T00:00:00.000Z',created_at:now,updated_at:now});
  add('comment_threads',{id:'archive-thread',workspace_id:workspace,page_id:'archive-root',kind:'inline',block_id:'archive-root-block',anchor_json:JSON.stringify({start:0,end:10,quote:'Restorable'}),anchor_revision_id:'archive-root-current',state:'open',created_at:now,updated_at:now,revision_id:'thread-revision'});
  add('comments',{id:'archive-comment',thread_id:'archive-thread',author_member_id:'archive-member',body_json:JSON.stringify([{text:'Keep the exact inline anchor.'}]),created_at:now,updated_at:now,revision_id:'comment-revision'});
  add('comments',{id:'archive-reply',thread_id:'archive-thread',parent_comment_id:'archive-comment',author_member_id:'archive-guest',body_json:JSON.stringify([{text:'Scoped reply — retain author.'}]),created_at:now,updated_at:now,revision_id:'reply-revision'});
  return statements.join('\n');
}

export const attachments=[
  {name:'research-notes.txt',type:'text/plain',bytes:Buffer.from('Portable original Ω\n'+Array.from({length:513},(_,i)=>`Evidence ${i}: ${i*i}`).join('\n'))},
  {name:'binary-evidence.pdf',type:'application/pdf',bytes:Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.from(Array.from({length:8193},(_,i)=>(i*73+19)%256)),Buffer.from('\n%%EOF')])},
];
