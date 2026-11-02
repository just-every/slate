import type { AccessLevel, PageLifecycle } from '../knowledge/model';
import type { KnowledgePolicyProfile } from '../knowledge/policies';
import type { JsonValue } from './common';
export interface PageRef { id: string; containerId: string; title: string; revisionId: string; lifecycle: PageLifecycle; publishAt?: string; scheduleState?: 'scheduled'|'failed'; scheduleFailure?: string|null }
export interface SyncedResolution {state:'ready'|'access-needed'|'trashed'|'deleted';static?:boolean;text?:unknown[];sourceTitle?:string;sourcePageId?:string;sourceBlockId?:string;sourceRevisionId?:string;canEdit?:boolean}
export interface BlockView { synced?: SyncedResolution; id: string; pageId: string; parentBlockId: string | null; blockType: string; content: JsonValue; treePosition: string; revisionId: string }
export interface PageLock { lockedAt: string; lockedByMemberId: string | null; lockedByDisplayName: string }
export interface PageDocument { lock?: PageLock | null; page: PageRef; blocks: BlockView[]; workingRevisionId: string; publishedRevisionId: string | null; permissions: { level: AccessLevel; canEdit: boolean; canComment?: boolean; canUnlock?: boolean; canShare: boolean }; policyProfile: KnowledgePolicyProfile; verification?: JsonValue; decision?: JsonValue }
