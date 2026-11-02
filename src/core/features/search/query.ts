import { publishedImportContainerSql } from '../imports/publication';
import { latestVerificationSql } from '../page-status/state';
import type { FeatureContext } from '../../app/feature-context';
import type { MemberSubject } from '../../shared/knowledge/model';
import type { SearchInput } from './service';
import { recordScope } from './record-index';
import { contentPolicy } from '../pages/policy';
import { accessSql, pageAccessLevelSql } from './access-sql';
import { searchHighlights, type AdvancedSearch } from './language';
import { advancedSearchSql, searchCandidateExpression, searchCandidateSql } from './language-sql';

export async function searchQuery(ctx: FeatureContext, subject: MemberSubject, input: SearchInput, language: AdvancedSearch, snapshot?: string) {
 // A single JSON binding keeps long operator expressions below D1's parameter
 // ceiling; user text never becomes SQL or FTS syntax.
 const parameters: (string | number | null)[] = [];
 const bind = (value: string | number | null) => { parameters.push(value); return `json_extract(?1,'$[${parameters.length - 1}]')`; };
 const termList = bind(JSON.stringify(searchHighlights(language)));
 const expression = searchCandidateExpression(language), fts = expression ? bind(expression) : null;
 // Page searches include record pages only while the workspace presents them as pages.
 // Keep the record kind and the same live permission checks for every candidate.
 const pageRecords = input.kind === 'page' && (await contentPolicy(ctx))['record.page-parity.v1'] === 'record-is-page';
 const workspace = bind(ctx.actor.workspaceId), kind = pageRecords ? "AND t.kind IN ('page','record')" : input.kind ? `AND t.kind=${bind(input.kind)}` : '';
 const possible = searchCandidateSql(language, 't', bind);
 const generation = !input.kind || input.kind === 'record' || pageRecords ? await recordScope(ctx, !!input.includeTrashed) : null;
 const recordProjection = bind(JSON.stringify([ctx.actor.workspaceId, ctx.actor.id, !!input.includeTrashed]));
 const recordGeneration = bind(generation), nowParameter = bind(ctx.now);
 const acl = accessSql(subject, ctx.now, !!input.includeTrashed); let aclIndex = 0;
 const aclSql = acl.sql.replace(/\?/g, () => bind(acl.parameters[aclIndex++]!));
 const filters = [advancedSearchSql(language, bind)];
 if (input.containerId) filters.push(`v.container_id=${bind(input.containerId)}`);
 if (input.contributorId) filters.push(`(v.author_id=${bind(input.contributorId)} OR ${bind(input.contributorId)} IN (SELECT value FROM json_each(v.contributors_json)))`);
 if (input.label) filters.push(`EXISTS(SELECT 1 FROM json_each(v.labels_json) label WHERE lower(label.value)=${bind(input.label.normalize('NFC').toLocaleLowerCase())})`);
 if (input.status) filters.push(`v.current_status=${bind(input.status)}`);
 if (input.updatedFrom) filters.push(`v.selected_updated_at>=${bind(input.updatedFrom)}`);
 if (input.updatedTo) filters.push(`v.selected_updated_at<=${bind(input.updatedTo)}`);
 if (!input.includeArchived) filters.push(`v.archived_at IS NULL AND COALESCE(v.lifecycle,'')<>'archived'`);
 if (!input.includeTrashed) filters.push(`v.trashed_at IS NULL`);
 const score = `COALESCE((SELECT SUM(CASE WHEN v.title_fold=q.value THEN 20 WHEN instr(v.title_fold,q.value)>0 THEN 10 WHEN instr(v.text_fold,q.value)>0 THEN 1 ELSE 0 END) FROM json_each(${termList}) q),0)`;
 const snapshotFilter = snapshot ? `AND v.key IN (SELECT j.value FROM discovery_snapshots snap,json_each(snap.ids_json) j WHERE snap.id=${bind(snapshot)})` : '';
 const ready = generation ? `EXISTS(SELECT 1 FROM search_record_cache WHERE scope=${recordProjection} AND workspace_id=${workspace} AND generation=${recordGeneration} AND epoch=(SELECT epoch FROM search_record_epoch WHERE id=1) AND acl=(SELECT epoch FROM core_acl_epoch WHERE id=1) AND (expires_at IS NULL OR expires_at>${nowParameter}) AND as_of<=${nowParameter})` : '1';
 const published = `(v.access_level<3 AND v.published_revision_id IS NOT NULL AND v.published_revision_id<>v.working_revision_id)`;
 // Text candidates precede live ACL resolution; metadata operators are evaluated
 // only after selecting the reader's authorized working/published variant.
 return { values: [JSON.stringify(parameters)], ready, sql: `WITH RECURSIVE candidates AS NOT MATERIALIZED (
 SELECT t.key,t.variant,t.kind,t.id,t.page_id,t.title_fold,t.text_fold,NULL AS document_json,t.container_id,t.status,t.lifecycle,t.archived_at,t.trashed_at,t.author_id,t.updated_at,t.contributors_json
 FROM ${fts ? 'search_fts f CROSS JOIN search_text t ON t.rowid=f.rowid' : 'search_text t'}
 WHERE ${fts ? `search_fts MATCH ${fts} AND ` : ''}t.workspace_id=${workspace} AND (t.kind<>'container' OR ${publishedImportContainerSql('t.id')}) ${kind} AND (t.kind<>'record' OR t.record_shared=1) AND (${possible})
 AND (t.variant='working' OR EXISTS(SELECT 1 FROM pages vp WHERE vp.id=t.page_id AND vp.published_revision_id IS NOT NULL AND vp.published_revision_id<>vp.working_revision_id)) AND NOT EXISTS(SELECT 1 FROM search_dirty d WHERE d.key=t.key)
 UNION ALL SELECT t.key,'dynamic','record',json_extract(t.document_json,'$.id'),json_extract(t.document_json,'$.pageId'),t.title_fold,t.text_fold,t.document_json,json_extract(t.document_json,'$.containerId'),json_extract(t.document_json,'$.status'),json_extract(t.document_json,'$.lifecycle'),json_extract(t.document_json,'$.archivedAt'),json_extract(t.document_json,'$.trashedAt'),json_extract(t.document_json,'$.authorId'),json_extract(t.document_json,'$.updatedAt'),json_extract(t.document_json,'$.contributors')
 FROM ${fts ? 'search_record_fts rf CROSS JOIN search_record_text t ON t.rowid=rf.rowid' : 'search_record_text t'}
 JOIN search_record_cache rc ON rc.scope=t.scope AND rc.generation=t.generation
 WHERE t.scope=${recordProjection} AND t.workspace_id=${workspace} AND rc.workspace_id=${workspace} AND t.generation=${recordGeneration} ${fts ? `AND search_record_fts MATCH ${fts}` : ''} AND (${possible})
 AND rc.epoch=(SELECT epoch FROM search_record_epoch WHERE id=1) AND rc.acl=(SELECT epoch FROM core_acl_epoch WHERE id=1) AND (rc.expires_at IS NULL OR rc.expires_at>${nowParameter}) AND rc.as_of<=${nowParameter}
 ),${aclSql}, permissions AS (
 SELECT t.*,p.published_revision_id,p.working_revision_id,p.status_key AS page_status,p.owner_member_id,p.updated_at AS page_updated,
 pv.id AS verification_id,pv.status_key AS verified_status,pv.revision_id AS verified_revision,pv.owner_member_id AS verification_owner,pv.expires_at AS verification_expiry,
 ${pageAccessLevelSql} AS access_level,c.id AS live_container,c.owned,c.visibility,s.guest,s.workspace,s.now,cl.level AS container_level
 FROM candidates t LEFT JOIN pages p ON p.id=t.page_id LEFT JOIN page_levels pl ON pl.id=t.page_id LEFT JOIN page_grants_live g ON g.page_id=t.page_id LEFT JOIN containers_live c ON c.id=t.container_id LEFT JOIN container_levels cl ON cl.id=c.id LEFT JOIN content_archive_locations l ON l.page_id=p.id
 LEFT JOIN page_verifications pv ON pv.id=${latestVerificationSql('p')},subject s
 ), variants AS (
 SELECT * FROM permissions t WHERE
 (t.page_id IS NOT NULL AND access_level>0 AND (t.variant='dynamic' AND json_extract(t.document_json,'$.revisionId')=CASE WHEN access_level<3 AND published_revision_id IS NOT NULL AND published_revision_id<>working_revision_id THEN published_revision_id ELSE (SELECT revision_id FROM pages WHERE id=t.page_id) END OR t.variant=CASE WHEN access_level<3 AND published_revision_id IS NOT NULL AND published_revision_id<>working_revision_id THEN 'published' ELSE 'working' END)
 OR t.page_id IS NULL AND t.variant='working' AND (t.kind='template' AND t.container_id IS NULL AND NOT guest OR live_container IS NOT NULL AND (owned OR visibility<>'personal' AND COALESCE(container_level,0)>0)))
 ), projections AS (
 SELECT v.*,
 CASE WHEN ${published} THEN json_extract(r.properties_json,'$.ownerMemberId') ELSE v.owner_member_id END AS owner_id,
 CASE WHEN ${published} THEN json_extract(r.properties_json,'$.labels') ELSE (SELECT json_group_array(label) FROM page_labels WHERE page_id=v.page_id) END AS labels_json,
 CASE WHEN ${published} THEN json_extract(r.properties_json,'$.statusKey') WHEN v.page_id IS NOT NULL THEN v.page_status ELSE v.status END AS projected_status,
 CASE WHEN ${published} THEN v.published_revision_id ELSE v.working_revision_id END AS selected_revision,
 CASE WHEN ${published} AND v.kind<>'comment-thread' THEN r.created_at ELSE v.updated_at END AS selected_updated_at,
 CASE WHEN ${published} THEN r.created_at ELSE v.page_updated END AS trust_updated_at
 FROM variants v LEFT JOIN page_revisions r ON r.id=v.published_revision_id AND r.page_id=v.page_id AND r.deleted_at IS NULL
 WHERE NOT ${published} OR r.id IS NOT NULL
 ), enriched AS (
 SELECT v.*,
 CASE WHEN v.verification_id IS NOT NULL AND v.verified_status IS v.projected_status AND (v.verification_expiry<=v.now OR v.verified_revision<>v.selected_revision) THEN 'lapsed' ELSE v.projected_status END AS current_status,
 CASE WHEN v.page_id IS NULL THEN NULL WHEN v.verification_id IS NULL OR v.verified_status IS NOT v.projected_status THEN 'unverified' WHEN v.verification_expiry<=v.now OR v.verified_revision<>v.selected_revision THEN 'lapsed' ELSE 'verified' END AS trust_state,
 CASE WHEN v.verification_id IS NOT NULL AND v.verified_status IS v.projected_status THEN v.verification_owner ELSE v.owner_id END AS trust_owner_id
 FROM projections v
 ), visible AS MATERIALIZED (
 SELECT v.key,v.variant,v.id,v.page_id,v.kind,v.document_json,v.current_status AS status,v.container_id AS containerId,${score} AS score,v.selected_updated_at AS updatedAt,
 v.trust_owner_id AS ownerId,m.display_name AS ownerName,v.trust_state AS trustState,CASE WHEN v.verified_status IS v.projected_status THEN v.verification_expiry END AS expiresAt,v.trust_updated_at AS trustUpdatedAt,
 CASE WHEN v.archived_at IS NOT NULL OR v.lifecycle='archived' OR v.trust_state='lapsed' THEN 2 WHEN v.trust_state='verified' THEN 0 ELSE 1 END AS trustRank,
 ${input.sort === 'views' ? '(SELECT COUNT(*) FROM page_views WHERE page_id=v.page_id)' : '0'} AS views
 FROM enriched v LEFT JOIN members m ON m.id=v.trust_owner_id AND m.workspace_id=v.workspace
 WHERE ${filters.join(' AND ')} ${snapshotFilter}
 )` };
}
