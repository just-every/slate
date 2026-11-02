import {expect} from 'vitest';
import {env} from 'cloudflare:test';
import {fixture} from './journeys';
import {createUlid} from '../../../src/core/shared/ulid';
import {createSharingRoutes} from '../../../src/core/features/sharing/routes';
import {createWorkspaceRoutes} from '../../../src/core/features/workspace/routes';

/** The native container editor exposes selection labels, never workspace group administration. */
export async function containerGrantPrincipalsCase() {
  const f=await fixture(app=>{app.route('/api/sharing',createSharingRoutes());app.route('/',createWorkspaceRoutes());});
  const other=await fixture(app=>{app.route('/',createWorkspaceRoutes());});
  await env.DB.prepare("UPDATE members SET role='member' WHERE id=?").bind(f.b).run();
  const group=await f.request('POST','/api/groups',{operationKey:createUlid(),name:'Container reviewers',memberIds:[f.a]});
  expect(group.status).toBe(200);
  const foreign=await other.request('POST','/api/groups',{operationKey:createUlid(),name:'Other workspace group',memberIds:[other.a]});
  expect(foreign.status).toBe(200);
  const grant={targetKind:'container',targetId:f.containerId,principalKind:'member',principalId:f.b,level:'full'};
  const created=await f.request('POST','/api/sharing',{...grant,operationKey:createUlid()});
  expect(created.status).toBe(200);
  const read=()=>f.request('GET',`/api/sharing/containers/${f.containerId}`);
  const projected=await f.request('GET',`/api/sharing/containers/${f.containerId}`,undefined,f.b);
  expect(projected.status).toBe(200);
  expect(projected.data.principals).toEqual([
    ...[f.a,f.b].sort().map(id=>({kind:'member',id,label:id,memberKind:'member'})),
    {kind:'group',id:group.data.value.id,label:'Container reviewers'},
  ]);
  await env.DB.prepare("UPDATE members SET member_kind='guest' WHERE id=?").bind(f.b).run();
  const guest=await f.request('GET',`/api/sharing/containers/${f.containerId}`,undefined,f.b);
  expect(guest.status).toBe(200);
  expect(guest.data.principals).toEqual([]);
  await env.DB.prepare("UPDATE members SET member_kind='member' WHERE id=?").bind(f.b).run();
  const groups=await f.request('GET','/api/groups');
  expect((await f.request('GET','/api/groups',undefined,f.b)).status).toBe(403);
  expect((await f.request('POST','/api/groups',{operationKey:createUlid(),id:group.data.value.id,expectedRevisionId:group.data.value.revisionId,name:'Changed',memberIds:[]},f.b)).status).toBe(403);
  expect(await f.request('GET','/api/groups')).toEqual(groups);
  for(const level of ['edit','view']) {
    expect((await f.request('POST','/api/sharing',{...grant,level,id:created.data.value.id,operationKey:createUlid()})).status).toBe(200);
    const before=await read();
    const counts=async()=>env.DB.prepare('SELECT (SELECT COUNT(*) FROM activity_entries) AS activity,(SELECT COUNT(*) FROM operation_receipts) AS receipts,(SELECT COUNT(*) FROM record_revisions) AS revisions').first();
    const unchanged=await counts();
    expect((await f.request('GET',`/api/sharing/containers/${f.containerId}`,undefined,f.b)).status).toBe(403);
    expect((await f.request('POST','/api/sharing',{...grant,level:'full',id:created.data.value.id,operationKey:createUlid()},f.b)).status).toBe(403);
    expect(await read()).toEqual(before);
    expect(await counts()).toEqual(unchanged);
  }
  await env.DB.prepare("UPDATE members SET status='removed' WHERE id=?").bind(f.b).run();
  expect((await read()).data.principals.some((principal:{id:string})=>principal.id===f.b)).toBe(false);
  expect((await f.request('GET',`/api/sharing/containers/${f.containerId}`,undefined,f.b)).status).toBe(401);
}
