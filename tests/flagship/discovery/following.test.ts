import {env} from 'cloudflare:test';
import {beforeEach,expect,test} from 'vitest';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {seedPage,seedPageGrant} from '../../e2e/setup/fixtures';
import {followingFixture} from './following-support';
import {meaningfulNotifications} from './meaningful-notifications';
beforeEach(resetDeployment);

test('PAGE-016 — authoring watches respect durable unwatch, personal overrides and workspace defaults',async()=>{
 const f=await followingFixture();
 const creator=(await f.create('Created page')).value.pageId,edited=(await f.create('Edited page')).value.pageId;
 await f.edit(edited,'Editor saved this',f.editor);
 expect((await f.ok(f.owner,'GET','/api/navigation')).watches).toContain(creator);
 expect((await f.ok(f.editor,'GET','/api/navigation')).watches).toContain(edited);
 await f.comment(creator);const discussion=await f.comment(edited);
 expect((await f.inbox(f.owner)).filter(n=>n.pageId===creator&&n.event==='comment')).toHaveLength(1);
 expect((await f.inbox(f.editor)).filter(n=>n.event==='comment')).toHaveLength(1);
 expect(await f.inbox(f.commenter)).toEqual([]);
 // PAGE-009: commenting implicitly watches; later replies and publication reach it once.
 expect((await f.ok(f.commenter,'GET','/api/navigation')).watches).toEqual(expect.arrayContaining([creator,edited]));
 await f.comment(edited,f.owner,{threadId:discussion.value.threadId,parentCommentId:discussion.value.id});
 let doc=await f.ok(f.owner,'GET',`/api/pages/${edited}`);
 await f.ok(f.owner,'POST',`/api/pages/${edited}/publish`,{operationKey:f.key(),expectedRevisionId:doc.page.revisionId});
 expect((await f.inbox(f.commenter)).map(n=>n.event).sort()).toEqual(['published','reply']);
 await f.watch(f.editor,edited,false);await f.edit(edited,'Edit after unwatch',f.editor);await f.comment(edited);
 expect((await f.ok(f.editor,'GET','/api/navigation')).watches).not.toContain(edited);
 expect((await f.inbox(f.editor)).filter(n=>n.event==='comment')).toHaveLength(1);
 await f.watch(f.commenter,edited,false);await f.comment(edited); // A later comment cannot undo the explicit stop.
 expect((await f.ok(f.commenter,'GET','/api/navigation')).watches).not.toContain(edited);
 await f.watch(f.editor,edited,true);await f.comment(edited);
 expect((await f.inbox(f.editor)).filter(n=>n.event==='comment')).toHaveLength(2);
 await f.preferences(f.editor,false);
 const unwatched=(await f.create('Personal autowatch off',f.editor)).value.pageId;
 expect((await f.ok(f.editor,'GET','/api/navigation')).watches).not.toContain(unwatched);
 expect((await f.request(f.editor,'PUT','/api/navigation/watch-configuration',{operationKey:f.key(),expectedRevisionId:null,autowatch:false})).status).toBe(403);
 const config=await f.ok(f.owner,'GET','/api/navigation/watch-configuration');
 await f.ok(f.owner,'PUT','/api/navigation/watch-configuration',{operationKey:f.key(),expectedRevisionId:config.revisionId,autowatch:false});
 const inherited=(await f.create('Workspace autowatch off',f.commenter)).value.pageId;
 expect((await f.ok(f.commenter,'GET','/api/navigation')).watches).not.toContain(inherited);
 await f.preferences(f.editor,true);
 const overridden=(await f.create('Personal autowatch on',f.editor)).value.pageId;
 expect((await f.ok(f.editor,'GET','/api/navigation')).watches).toContain(overridden);
 await meaningfulNotifications(f);
});

test('CONT-012 — a watched container delivers creation, two edit sessions and a comment once each, nothing for restricted or draft pages, one item when the page is also watched, and rechecks moves, lifecycle and access',async()=>{
 const f=await followingFixture({defaultProfile:true});await f.watchContainer(f.editor,f.containerId,true);
 expect((await f.ok(f.owner,'GET','/api/profile'))).toEqual({profile:'core-wiki'});
 expect((await f.ok(f.owner,'GET',`/api/navigation/container-watches/${f.containerId}`)).items.map((m:any)=>m.id)).toEqual([f.editor]);
 expect((await f.request(f.commenter,'GET',`/api/navigation/container-watches/${f.containerId}`)).status).toBe(403);
 const created=await f.create('Followed page'),pageId=created.value.pageId;
 await f.edit(pageId,'First edit');await f.edit(pageId,'Same editing session');
 // Elapsed idle time is fixture clock state, rather than a delay or a second product path.
 await env.DB.prepare('UPDATE watch_edit_sessions SET last_edit_at=? WHERE page_id=?').bind(new Date(Date.now()-86400000).toISOString(),pageId).run();
 await f.edit(pageId,'New editing session');await f.watch(f.editor,pageId,true);await f.comment(pageId);
 const expected=['comment','page-created','page-edited','page-edited'];
 expect((await f.inbox(f.editor)).map(n=>n.event).sort()).toEqual(expected);
 expect((await f.ok(f.editor,'GET','/api/navigation/following')).items.map((n:any)=>n.event).sort()).toEqual(expected);
 expect((await f.ok(f.commenter,'GET','/api/navigation/following')).items).toEqual([]);
 // A blog post in the watched container arrives the same way: one item, not also a created page (CONT-010).
 const post=(await f.ok(f.owner,'POST',`/api/blog/containers/${f.containerId}/posts`,{operationKey:f.key(),title:'Container news',body:'Shipped.'})).value.pageId;
 expect((await f.inbox(f.editor)).filter(n=>n.pageId===post).map(n=>n.event)).toEqual(['post-published']);
 expect((await f.ok(f.editor,'GET','/api/navigation/following')).items.filter((n:any)=>n.pageId===post).map((n:any)=>n.event)).toEqual(['post-published']);
 const parent=await seedPage(f.containerId,{title:'Restricted parent',authorMemberId:f.owner,accessInheritance:'restricted'});
 await seedPageGrant(parent.pageId,{principalKind:'member',principalId:f.owner,level:'full'});
 await f.create('Unseen restricted page',f.owner,{parentPageId:parent.pageId});
 await env.DB.prepare('INSERT INTO workspace_policies VALUES(?,?,?)').bind(f.workspaceId,JSON.stringify({'page.lifecycle.v1':'draft-then-publish'}),new Date().toISOString()).run();
 const draft=(await f.create('Unseen draft')).value.pageId;
 await seedPageGrant(draft,{principalKind:'member',principalId:f.editor,level:'edit'});await f.watch(f.editor,draft,true);await f.edit(draft,'Still a draft');
 expect((await f.inbox(f.editor)).map(n=>n.event).sort()).toEqual([...expected,'post-published'].sort());
 expect((await env.DB.prepare("SELECT id FROM notification_outbox WHERE page_id=? AND event IN ('page-created','page-edited')").bind(draft).all()).results).toEqual([]);
 // A post created by API as a draft arrives once, as a post, when published: nothing at creation or for draft edits,
 // nothing more for re-publishing it, and a later edit is one editing session (CONT-010).
 const draftPost=(await f.ok(f.owner,'POST',`/api/blog/containers/${f.containerId}/posts`,{operationKey:f.key(),title:'Draft news',body:'Soon.'})).value.pageId;
 await f.edit(draftPost,'Draft news, revised');
 const postEvents=async()=>(await f.inbox(f.editor)).filter(n=>n.pageId===draftPost).map(n=>n.event).sort();
 const publish=async()=>{const doc=await f.ok(f.owner,'GET',`/api/pages/${draftPost}`);await f.ok(f.owner,'POST',`/api/pages/${draftPost}/publish`,{operationKey:f.key(),expectedRevisionId:doc.page.revisionId});};
 expect(await postEvents()).toEqual([]);
 await publish();expect(await postEvents()).toEqual(['post-published']);
 await publish();await f.edit(draftPost,'Live news');await publish();
 expect(await postEvents()).toEqual(['page-edited','post-published']);
 expect((await f.ok(f.editor,'GET','/api/navigation/following')).items.filter((n:any)=>n.pageId===draftPost).map((n:any)=>n.event).sort()).toEqual(['page-edited','post-published']);
 // Both the previous and the destination container are watched; the move remains one event.
 const target=(await f.ok(f.owner,'POST','/api/containers',{operationKey:f.key(),name:'Another space'})).value.id;
 await f.watch(f.editor,pageId,false);
 const move=async(containerId:string)=>{const doc=await f.ok(f.owner,'GET',`/api/pages/${pageId}`),destination={containerId,parentPageId:null};const preview=await f.ok(f.owner,'POST',`/api/pages/${pageId}/move-preview`,destination);return f.ok(f.owner,'POST',`/api/pages/${pageId}/move`,{operationKey:f.key(),expectedRevisionId:doc.page.revisionId,...destination,treePosition:'a',accessPreviewHash:preview.accessPreviewHash});};
 await move(target);expect((await f.inbox(f.editor)).filter(n=>n.event==='page-moved')).toHaveLength(1);
 await f.watchContainer(f.editor,target,true);await move(f.containerId);
 expect((await f.inbox(f.editor)).filter(n=>n.event==='page-moved')).toHaveLength(2);
 const lifecycle=async(action:string)=>{const row=await env.DB.prepare('SELECT revision_id FROM pages WHERE id=?').bind(pageId).first<{revision_id:string}>();return f.ok(f.owner,'POST',`/api/archive/${pageId}`,{operationKey:f.key(),expectedRevisionId:row!.revision_id,action});};
 await lifecycle('archive');expect((await f.inbox(f.editor)).filter(n=>n.event==='page-archived')).toHaveLength(1);
 await lifecycle('restore');await lifecycle('trash');
 const trash=(await f.inbox(f.editor)).filter(n=>n.event==='page-trashed');expect(trash).toHaveLength(1);expect(trash[0]!.href).toBe('/app/archive');
 await env.DB.prepare('UPDATE container_grants SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),f.grants[1]!.grantId).run();
 expect((await f.inbox(f.editor)).filter(n=>n.pageId===pageId)).toEqual([]);
 expect((await f.ok(f.editor,'GET','/api/navigation/following')).items).toEqual([]);
 // Erasure removes the durable opt-out and edit-session state alongside the content.
 await f.ok(f.owner,'POST',`/api/archive/${pageId}/permanent-delete`,{operationKey:f.key(),confirmedPageIds:[pageId]});
 expect((await env.DB.prepare('SELECT page_id FROM watch_edit_sessions WHERE page_id=? UNION SELECT page_id FROM page_watches WHERE page_id=?').bind(pageId,pageId).all()).results).toEqual([]);
 await inboxJourney(f);
});

/** The same public inbox door covers personal state and authority over retained history. */
async function inboxJourney(f:Awaited<ReturnType<typeof followingFixture>>){
 await f.ok(f.editor,'POST','/api/notifications/actions',{operationKey:f.key(),action:'read-all'});
 await f.ok(f.editor,'POST','/api/notifications/actions',{operationKey:f.key(),action:'archive-read'});
 const pageId=(await f.create('Inbox handover notes')).value.pageId;
 const draft=await f.ok(f.owner,'GET',`/api/pages/${pageId}`);
 await f.ok(f.owner,'POST',`/api/pages/${pageId}/publish`,{operationKey:f.key(),expectedRevisionId:draft.page.revisionId});
 await f.ok(f.owner,'POST','/api/sharing',{operationKey:f.key(),targetKind:'page',targetId:pageId,principalKind:'member',principalId:f.owner,level:'full'});
 const doc=await f.ok(f.owner,'GET',`/api/pages/${pageId}`);
 await f.ok(f.owner,'PUT',`/api/sharing/pages/${pageId}/inheritance`,{operationKey:f.key(),expectedRevisionId:doc.page.revisionId,restricted:true});
 await f.ok(f.owner,'POST','/api/sharing',{operationKey:f.key(),targetKind:'page',targetId:pageId,principalKind:'member',principalId:f.editor,level:'comment'});
 await f.watch(f.editor,pageId,true);
 const plain=(await f.comment(pageId,f.owner)).value.id;
 const mentioned=(await f.comment(pageId,f.owner,{body:[{text:'Confirm this shift, '},{text:'editor',mention:{kind:'person',id:f.editor,label:'editor'}}]})).value.id;
 const notices=await f.ok(f.editor,'GET','/api/notifications');
 const direct=notices.items.find((n:any)=>n.event==='mention'&&n.commentId===mentioned);
 const recent=notices.items.find((n:any)=>n.event==='comment'&&n.commentId===mentioned);
 const older=notices.items.find((n:any)=>n.event==='comment'&&n.commentId===plain);
 const access=notices.items.find((n:any)=>n.event==='access-granted'&&n.pageId===pageId);
 expect([direct,recent,older,access].every(Boolean)).toBe(true);
 const ordered=[direct,recent,older,access],times=['2020-04-03T10:00:00.000Z','2020-04-03T09:00:00.000Z','2020-04-02T13:00:00.000Z','2020-04-01T12:00:00.000Z'];
 await env.DB.batch(ordered.map((n,index)=>env.DB.prepare('UPDATE notifications SET created_at=? WHERE id=?').bind(times[index],n.id)));
 const inbox=await f.ok(f.editor,'GET','/api/notifications');
 expect(inbox.items.filter((n:any)=>n.pageId===pageId).map((n:any)=>n.id)).toEqual(ordered.map(n=>n.id));
 expect(inbox.items.map((n:any)=>n.period)).toEqual(['2020-04-03','2020-04-03','2020-04-02','2020-04-01']);
 expect(inbox.unreadCount).toBe(4);
 const directView=await f.ok(f.editor,'GET','/api/notifications?audience=direct');
 expect(directView.items.map((n:any)=>n.id)).toEqual([direct.id,access.id]);expect(directView.unreadCount).toBe(4);
 const watchedView=await f.ok(f.editor,'GET','/api/notifications?audience=watched');
 expect(watchedView.items.map((n:any)=>n.id)).toEqual([recent.id,older.id]);expect(watchedView.unreadCount).toBe(4);
 const capture={operationKey:f.key(),action:'read',id:direct.id};
 const read=await f.ok(f.editor,'POST','/api/notifications/actions',capture);
 expect(read.value.href).toBe(`/app/pages/${pageId}?comment=${mentioned}`);
 expect((await f.ok(f.editor,'GET',`/api/comments/page/${pageId}`)).comments.find((c:any)=>c.id===mentioned).body[0].text).toBe('Confirm this shift, ');
 const afterRead=await f.ok(f.editor,'GET','/api/notifications');
 expect(afterRead.items.find((n:any)=>n.id===direct.id).readAt).toBeTruthy();expect(afterRead.unreadCount).toBe(3);
 await f.ok(f.editor,'POST','/api/notifications/actions',{operationKey:f.key(),action:'archive-read'});
 expect((await f.ok(f.editor,'GET','/api/notifications')).items.map((n:any)=>n.id)).toEqual(ordered.slice(1).map(n=>n.id));
 expect((await f.ok(f.editor,'GET','/api/notifications?archived=true')).items.filter((n:any)=>n.pageId===pageId).map((n:any)=>n.id)).toEqual([direct.id]);
 await f.ok(f.editor,'POST','/api/notifications/actions',{operationKey:f.key(),action:'read-all'});
 const allRead=await f.ok(f.editor,'GET','/api/notifications');
 expect(allRead.items.map((n:any)=>n.id)).toEqual(ordered.slice(1).map(n=>n.id));
 expect(allRead.unreadCount).toBe(0);expect(allRead.items.every((n:any)=>n.readAt)).toBe(true);
 await f.ok(f.editor,'POST','/api/notifications/actions',{operationKey:f.key(),action:'archive-read'});
 expect((await f.ok(f.editor,'GET','/api/notifications')).items).toEqual([]);
 expect((await f.ok(f.editor,'GET','/api/notifications?archived=true')).items.filter((n:any)=>n.pageId===pageId).map((n:any)=>n.id)).toEqual(ordered.map(n=>n.id));
 const freshComment=(await f.comment(pageId,f.owner)).value.id;
 const unreadComment=(await f.comment(pageId,f.owner)).value.id;
 const fresh=(await f.ok(f.editor,'GET','/api/notifications')).items;
 const latestCapture={operationKey:f.key(),action:'read',id:fresh.find((n:any)=>n.commentId===freshComment).id};
 await f.ok(f.editor,'POST','/api/notifications/actions',latestCapture);
 expect((await f.ok(f.editor,'GET','/api/notifications')).unreadCount).toBe(1);
 const retainedBefore=(await env.DB.prepare('SELECT id,read_at,archived_at FROM notifications WHERE source_page_id=? ORDER BY id').bind(pageId).all()).results;
 const grants=await f.ok(f.owner,'GET',`/api/sharing/pages/${pageId}`);
 await f.ok(f.owner,'POST','/api/sharing',{operationKey:f.key(),id:grants.items.find((g:any)=>g.principalId===f.editor).id,targetKind:'page',targetId:pageId,principalKind:'member',principalId:f.editor,level:'comment',revoke:true});
 expect((await f.ok(f.editor,'GET','/api/notifications?archived=true')).items.filter((n:any)=>n.pageId===pageId)).toEqual([]);
 expect((await f.request(f.editor,'POST','/api/notifications/actions',latestCapture)).status).toBe(404);
 expect((await f.ok(f.editor,'GET','/api/notifications')).unreadCount).toBe(0);
 expect((await f.request(f.editor,'POST','/api/notifications/actions',{operationKey:f.key(),action:'read',id:fresh.find((n:any)=>n.commentId===unreadComment).id})).status).toBe(404);
 expect((await f.request(f.commenter,'POST','/api/notifications/actions',{operationKey:f.key(),action:'read',id:direct.id})).status).toBe(404);
 expect((await env.DB.prepare('SELECT id,read_at,archived_at FROM notifications WHERE source_page_id=? ORDER BY id').bind(pageId).all()).results).toEqual(retainedBefore);
 // Refused reads and replay leave the retained personal state intact.
 expect((await env.DB.prepare('SELECT id FROM notifications WHERE source_page_id=? AND read_at IS NOT NULL AND archived_at IS NOT NULL').bind(pageId).all()).results.map((n:any)=>n.id).sort()).toEqual(ordered.map(n=>n.id).sort());
 const current=await f.ok(f.owner,'GET',`/api/pages/${pageId}`);
 await f.ok(f.owner,'POST',`/api/archive/${pageId}`,{operationKey:f.key(),expectedRevisionId:current.page.revisionId,action:'trash'});
 await f.ok(f.owner,'POST',`/api/archive/${pageId}/permanent-delete`,{operationKey:f.key(),confirmedPageIds:[pageId]});
 expect((await f.request(f.editor,'POST','/api/notifications/actions',capture)).status).toBe(404);
 expect((await f.ok(f.editor,'GET','/api/notifications?archived=true')).items.filter((n:any)=>n.pageId===pageId)).toEqual([]);
 expect((await env.DB.prepare('SELECT id FROM notifications WHERE source_page_id=?').bind(pageId).all()).results).toEqual([]);
}
