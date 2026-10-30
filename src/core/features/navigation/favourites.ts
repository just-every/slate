import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import { requireContainerLevel,requirePageLevel } from '../sharing/current-access';
import { requiredId } from './request';
import { personalMutation } from './mutations';
import { navigation } from './service';
export async function setFavourite(ctx:FeatureContext,input:{operationKey:string;kind:'page'|'container'|'database';id:string;enabled:boolean;position?:number}) {
  requiredId(input.id);
  if(!['page','container','database'].includes(input.kind)||typeof input.enabled!=='boolean'||input.position!==undefined&&(!Number.isInteger(input.position)||input.position<0||input.position>999999))throw new ApiProblem(400,'INVALID_FAVOURITE','Invalid favourite.');
  let targetId=input.id;
  if(input.kind==='database') {
    const row=await ctx.db.prepare('SELECT page_id FROM databases WHERE id=? AND workspace_id=?').bind(input.id,ctx.actor.workspaceId).first<{page_id:string}>();
    if(!row)throw new ApiProblem(404,'NOT_FOUND','Not found.');
    targetId=row.page_id;
  }
  const table=input.kind==='container'?'container_favourites':'page_favourites',column=input.kind==='container'?'container_id':'page_id';
  return personalMutation(ctx,{
    operationKey:input.operationKey,action:'favourite.set',request:input,
    authorize:async()=>{if(input.enabled)await(input.kind==='container'?requireContainerLevel(ctx,targetId,'view'):requirePageLevel(ctx,targetId,'view'));},
    build:async()=>{
      const statements = [input.enabled
        ? ctx.db.prepare(`INSERT INTO ${table}(member_id,${column},position,created_at) VALUES(?,?,?,?) ON CONFLICT(member_id,${column}) DO UPDATE SET position=excluded.position`).bind(ctx.actor.id,targetId,String(input.position??999999).padStart(6,'0'),ctx.now)
        : ctx.db.prepare(`DELETE FROM ${table} WHERE member_id=? AND ${column}=?`).bind(ctx.actor.id,targetId)];
      if (input.enabled && input.position !== undefined) {
        // Position is an index in this member's currently readable navigation.
        // Normalize every neighbour in the same commit: swapping only two rows
        // would move both ahead of untouched favourites still at default positions.
        const current = (await navigation(ctx)).favourites;
        const ordered: Array<{kind:string;id:string;pageId:string|null}> = current.filter(item => input.kind === 'container'
          ? item.kind !== 'container' || item.id !== targetId : item.pageId !== targetId);
        ordered.splice(Math.min(input.position, ordered.length), 0, {kind:input.kind,id:input.id,pageId:input.kind === 'container' ? null : targetId});
        for (const [position,item] of ordered.entries()) {
          const container = item.kind === 'container';
          statements.push(ctx.db.prepare(`UPDATE ${container ? 'container_favourites' : 'page_favourites'} SET position=? WHERE member_id=? AND ${container ? 'container_id' : 'page_id'}=?`)
            .bind(String(position).padStart(6,'0'),ctx.actor.id,container ? item.id : item.pageId));
        }
      }
      return {statements,value:{id:input.id,enabled:input.enabled}};
    }
  });
}
