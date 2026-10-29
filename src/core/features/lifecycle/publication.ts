import type { FeatureContext } from '../../app/feature-context';
import { commitOperation, mutationGuard, requestHash } from '../../app/operations';
import { ApiProblem } from '../../app/problems';
import { createUlid } from '../../shared/ulid';
import { requirePageLevel } from '../sharing/current-access';
import { pageRow, snapshot, revisionStatement, contentEvent, writable } from '../pages/repository';
import { contentPolicy } from '../pages/policy';
import { notificationStatements } from '../notifications/events';
import { publicationSchema, type PublicationInput, type PublicationSchedule, type ScheduledChoices, type RetainedGeneralGrant } from './publication-input';
import { publicationReview, releaseReview, previewConflict } from './publication-preview';
import { publicationLocation, publicationMoveStatements } from './publication-location';

export function publishPage(ctx: FeatureContext, id: string, raw: PublicationInput) {
  return commitPublication(ctx, id, publicationSchema.parse(raw));
}
/** Only the scheduler supplies the durable row; the public API cannot forge a firing state. */
export async function publishScheduledPage(ctx: FeatureContext, schedule: PublicationSchedule) {
  const choices: ScheduledChoices = schedule.publication_json ? JSON.parse(schedule.publication_json) : {};
  const { retainedGeneralGrants: _, retainedGeneralGrantsUpdatedAt: __, review: ___, ...publicChoices } = choices;
  const input = publicationSchema.parse({ ...publicChoices, operationKey: `schedule:${await requestHash({operationKey:schedule.operation_key})}`, expectedRevisionId: schedule.expected_revision_id, ...(schedule.label !== null ? { label: schedule.label } : {}) });
  return commitPublication(ctx, schedule.page_id, input, schedule, choices);
}
function commitPublication(ctx: FeatureContext, id: string, input: PublicationInput, firing?: PublicationSchedule, saved?: ScheduledChoices) {
  return commitOperation(ctx, {
    operationKey: input.operationKey, action: 'pages.publish', request: { id, ...input },
    authorize: async () => {
      await requirePageLevel(ctx, id, input.generalAccess ? 'full' : 'edit');
      // Replays also require current destination and access-setting authority.
      const p = await pageRow(ctx, id); writable(p);
      await publicationLocation(ctx, p, input);
    },
    prepare: async ({ revisionId }) => {
      const p = await pageRow(ctx, id); writable(p);
      const location = await publicationLocation(ctx, p, input);
      if(p.revision_id!==input.expectedRevisionId)throw new ApiProblem(409,'REVISION_CONFLICT','The page changed. Reload before publishing.');
      const scheduled = !!input.publishAt;
      let reviewed: Awaited<ReturnType<typeof publicationReview>>|undefined;
      if (firing && saved?.review) {
        reviewed=await publicationReview(ctx,id,{...input,publishAt:saved.review.options.publishAt??undefined},saved);
        if(await requestHash(releaseReview(reviewed))!==await requestHash(saved.review))previewConflict();
      } else if (!firing && (input.destination || input.generalAccess || input.previewFingerprint)) {
        reviewed=await publicationReview(ctx,id,input);
        if(!input.previewFingerprint || input.previewFingerprint!==await requestHash({review:reviewed,epoch:ctx.authorizationEpoch,actorId:ctx.actor.id}))previewConflict();
      }
      if (scheduled && Date.parse(input.publishAt!) <= Date.parse(ctx.now)) throw new ApiProblem(400, 'INVALID_SCHEDULE', 'Schedule must be in the future.');
      const s = await snapshot(ctx, p);
      if (input.publishAsMemberId) {
        const attribution = await ctx.db.prepare("SELECT display_name FROM members WHERE id=? AND workspace_id=? AND status='active'").bind(input.publishAsMemberId, ctx.actor.workspaceId).first<{display_name:string}>();
        if (!attribution) throw new ApiProblem(400, 'INVALID_ATTRIBUTION', 'Choose an active member.');
        s.properties.byline = attribution.display_name;
      }
      const general = (await ctx.db.prepare("SELECT g.id,g.principal_kind,g.principal_id,g.level,g.expires_at,(SELECT r.id FROM core_entity_revisions r WHERE r.entity_kind='page-grant' AND r.entity_id=g.id ORDER BY r.id DESC LIMIT 1) AS revision_id FROM page_grants g WHERE page_id=? AND principal_kind IN ('workspace','container') AND revoked_at IS NULL").bind(id).all<RetainedGeneralGrant>()).results;
      if (scheduled && (general.length || !['draft','scheduled'].includes(p.lifecycle))) await requirePageLevel(ctx, id, 'full');
      const policy = await contentPolicy(ctx);
      const ordinal = !scheduled && policy['page.version.v1'] === 'labelled' ? (await ctx.db.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS n FROM page_revisions WHERE page_id=?').bind(id).first<{n:number}>())!.n : null;
      const statements = [...location.guards];
      if(reviewed) {
        for(const child of reviewed.descendants)statements.push(mutationGuard(ctx.db,'SELECT revision_id=? AND deleted_at IS NULL FROM pages WHERE id=?',[child.revisionId,child.pageId]));
        statements.push(mutationGuard(ctx.db,'SELECT (WITH RECURSIVE tree(id) AS (SELECT id FROM pages WHERE id=? UNION SELECT p.id FROM pages p JOIN tree t ON p.parent_page_id=t.id WHERE p.deleted_at IS NULL) SELECT COUNT(*)=? FROM tree)',[id,reviewed.descendants.length+1]));
      }
      if (input.publishAsMemberId) statements.push(mutationGuard(ctx.db, "SELECT status='active' FROM members WHERE id=? AND workspace_id=?", [input.publishAsMemberId, ctx.actor.workspaceId]));
      if (firing) statements.push(mutationGuard(ctx.db, "SELECT state='scheduled' AND operation_key=? AND expected_revision_id=? AND publish_at<=? AND publication_json IS ? FROM content_schedules WHERE page_id=?", [firing.operation_key, firing.expected_revision_id, ctx.now, firing.publication_json, id]));
      if (scheduled || input.generalAccess) statements.push(ctx.db.prepare("UPDATE page_grants SET revoked_at=?,updated_at=? WHERE page_id=? AND principal_kind IN ('workspace','container') AND revoked_at IS NULL").bind(ctx.now, ctx.now, id));
      if (!scheduled) statements.push(ctx.db.prepare("UPDATE pages SET lifecycle='live' WHERE id=?").bind(id), ...await publicationMoveStatements(ctx, location, id, revisionId));
      if (!scheduled && input.generalAccess) {
        statements.push(ctx.db.prepare("UPDATE pages SET access_inheritance='restricted' WHERE id=?").bind(id));
        if (input.generalAccess.kind !== 'restricted') statements.push(ctx.db.prepare('INSERT INTO page_grants(id,page_id,principal_kind,principal_id,level,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(createUlid(), id, input.generalAccess.kind, input.generalAccess.kind === 'workspace' ? ctx.actor.workspaceId : location.target.containerId, input.generalAccess.level, ctx.now, ctx.now));
      }
      if (!scheduled && !input.generalAccess && saved?.retainedGeneralGrants?.length) {
        await requirePageLevel(ctx, id, 'full');
        if(location.personal) throw new ApiProblem(403, 'PERSONAL_PRIVATE', 'A personal container cannot have general access.');
        for(const grant of saved.retainedGeneralGrants) statements.unshift(mutationGuard(ctx.db, "SELECT revoked_at=? AND updated_at=? AND (SELECT r.id FROM core_entity_revisions r WHERE r.entity_kind='page-grant' AND r.entity_id=page_grants.id ORDER BY r.id DESC LIMIT 1) IS ? FROM page_grants WHERE id=? AND page_id=?",[saved.retainedGeneralGrantsUpdatedAt!,saved.retainedGeneralGrantsUpdatedAt!,grant.revision_id,grant.id,id]));
        for (const grant of saved.retainedGeneralGrants) statements.push(ctx.db.prepare('UPDATE page_grants SET revoked_at=NULL,principal_id=?,updated_at=? WHERE id=? AND page_id=?').bind(grant.principal_kind === 'container' ? location.target.containerId : grant.principal_id, ctx.now, grant.id, id));
      }
      // Scheduling a previously live page preserves its authorized scheduler's ability to fire it privately.
      if(scheduled && !['draft','scheduled'].includes(p.lifecycle)) statements.push(ctx.db.prepare("INSERT INTO page_grants(id,page_id,principal_kind,principal_id,level,created_at,updated_at) SELECT ?,?,'member',?,'full',?,? WHERE NOT EXISTS(SELECT 1 FROM page_grants WHERE page_id=? AND principal_kind='member' AND principal_id=? AND level='full' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?))").bind(createUlid(),id,ctx.actor.id,ctx.now,ctx.now,id,ctx.actor.id,ctx.now));
      // A draft author's implicit full grant must survive becoming a restricted live page.
      if (!scheduled && ['draft', 'scheduled'].includes(p.lifecycle)) statements.push(ctx.db.prepare("INSERT INTO page_grants(id,page_id,principal_kind,principal_id,level,created_at,updated_at) SELECT ?,?,'member',?,'full',?,? WHERE NOT EXISTS(SELECT 1 FROM page_grants WHERE page_id=? AND principal_kind='member' AND principal_id=? AND level='full' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?))").bind(createUlid(), id, p.author_member_id, ctx.now, ctx.now, id, p.author_member_id, ctx.now));
      statements.push(await revisionStatement(ctx, id, revisionId, s, scheduled ? 'autosave' : 'publish', ordinal, input.label ?? null), ctx.db.prepare('UPDATE pages SET lifecycle=?,working_revision_id=?,published_revision_id=?,revision_id=?,updated_at=? WHERE id=?').bind(scheduled ? 'scheduled' : 'live', revisionId, revisionId, revisionId, ctx.now, id), ...contentEvent(ctx, id, revisionId, scheduled ? 'scheduled' : 'published', { destination: location.target, generalAccess: input.generalAccess ?? null }));
      if (scheduled) {
        const previous=await ctx.db.prepare("SELECT publication_json FROM content_schedules WHERE page_id=? AND state IN ('scheduled','failed')").bind(id).first<{publication_json:string|null}>();
        const prior:ScheduledChoices=previous?.publication_json?JSON.parse(previous.publication_json):{};
        const retained=general.length?{retainedGeneralGrants:general,retainedGeneralGrantsUpdatedAt:ctx.now}:prior.retainedGeneralGrants?{retainedGeneralGrants:prior.retainedGeneralGrants,retainedGeneralGrantsUpdatedAt:prior.retainedGeneralGrantsUpdatedAt}:{};
        const choices: ScheduledChoices = { destination: input.destination, generalAccess: input.generalAccess, publishAsMemberId: input.publishAsMemberId, ...retained, ...(reviewed?{review:releaseReview(reviewed)}:{}) };
        statements.push(ctx.db.prepare("INSERT INTO content_schedules(page_id,publish_at,actor_member_id,expected_revision_id,operation_key,label,state,publication_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'scheduled',?,?,?) ON CONFLICT(page_id) DO UPDATE SET publish_at=excluded.publish_at,actor_member_id=excluded.actor_member_id,expected_revision_id=excluded.expected_revision_id,operation_key=excluded.operation_key,label=excluded.label,state='scheduled',publication_json=excluded.publication_json,failure=NULL,updated_at=excluded.updated_at").bind(id, input.publishAt!, ctx.actor.id, revisionId, input.operationKey, input.label ?? null, JSON.stringify(choices), ctx.now, ctx.now));
      } else {
        // CONT-012: container watchers hear of a page once, when publication first makes it readable, and a
        // draft post arrives as its post (CONT-010). Re-publishing a live page reaches its page watchers only (PAGE-009).
        const first = ['draft', 'scheduled'].includes(p.lifecycle);
        const post = first && !!await ctx.db.prepare('SELECT 1 FROM blog_posts WHERE page_id=?').bind(id).first();
        statements.push(ctx.db.prepare("UPDATE content_schedules SET state='published',failure=NULL,updated_at=? WHERE page_id=? AND state IN ('scheduled','failed')").bind(ctx.now, id), ...notificationStatements(ctx, { id: `${revisionId}:published`, event: post ? 'post-published' : 'published', pageId: id }, { containerWatchers: first }));
      }
      return { statements, entity: { id, kind: 'page', revisionId }, value: { pageId: id, revisionId, scheduled }, ...(firing ? { feature: 'lifecycle', detail: { scheduleOperationKey: firing.operation_key } } : {}) };
    },
  });
}
