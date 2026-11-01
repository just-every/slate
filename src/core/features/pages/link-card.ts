import { rejectErasedPage } from '../pages/erased';
import type {FeatureContext} from '../../app/feature-context';
import {ApiProblem} from '../../app/problems';
import {pageRow} from './repository';
import {requirePageLevel} from '../sharing/current-access';
import {loadPageTrust} from '../search/trust';
import {readRevision} from '../versions/service';

export async function pageLinkCard(ctx:FeatureContext,pageId:string,revisionId?:string) {
  await rejectErasedPage(ctx,pageId);
  if(revisionId==='')throw new ApiProblem(400,'INVALID_REVISION','Choose an exact page revision.');
  const access=await requirePageLevel(ctx,pageId,'view');
  const page=await pageRow(ctx,pageId);
  if(page.trashed_at)throw new ApiProblem(404,'NOT_FOUND','Not found.');
  const revision=revisionId??((access.decision.level==='view'||access.decision.level==='comment')&&page.published_revision_id?page.published_revision_id:page.working_revision_id);
  // Page access alone does not authorize unpublished history for view/comment readers.
  const exact=await readRevision(ctx,pageId,revision);
  if(exact.deleted)throw new ApiProblem(404,'DELETED_REVISION','The referenced page revision has been deleted.');
  if(typeof exact.properties?.title!=='string')throw new ApiProblem(404,'NOT_FOUND','The referenced page revision is unavailable.');
  const trust=(await loadPageTrust(ctx,[pageId],new Map([[pageId,revision]]))).get(pageId);
  if(!trust)throw new ApiProblem(409,'PAGE_CHANGED','The page changed. Load its details again.');
  return {title:exact.properties.title,href:`/app/pages/${encodeURIComponent(pageId)}${revisionId!==undefined?`?revision=${encodeURIComponent(revision)}`:''}`,trust};
}
