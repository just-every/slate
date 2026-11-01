import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import { resolveCurrentAccessMany } from '../sharing/current-access';

/** Erasure retains only kind and time, behind the same current ACL as retained activity. */
export async function rejectErasedPage(ctx: FeatureContext, pageId: string) {
  const row = await ctx.db.prepare('SELECT p.page_kind AS kind,t.deleted_at AS deletedAt FROM content_tombstones t JOIN pages p ON p.id=t.page_id WHERE t.page_id=? AND t.workspace_id=?')
    .bind(pageId, ctx.actor.workspaceId).first<{kind:string;deletedAt:string}>();
  if (!row) return;
  const access = (await resolveCurrentAccessMany(ctx, [pageId], {includeDeleted:true,includeTrashed:true})).get(pageId);
  if (!access?.decision.allowed) throw new ApiProblem(404, 'NOT_FOUND', 'Not found.');
  throw new ApiProblem(404, 'PAGE_ERASED', 'This record was permanently deleted.', {kind:row.kind,deletedAt:row.deletedAt});
}
