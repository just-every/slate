import type { KnowledgePolicyProfile } from '../knowledge/policies';
export type Theme = 'light' | 'dark' | 'system';
export interface MemberView { id: string; displayName: string; email: string; role: 'owner' | 'member'; memberKind: 'member' | 'guest'; theme: Theme; isSetupOwner: boolean }
export interface WorkspaceView { id: string; name: string; mark: string; description: string; revisionId: string; policies: KnowledgePolicyProfile; guestAccess: 'allowed' | 'forbidden'; publicLinkAccess: 'allowed' | 'forbidden'; anonymousAccess: 'allowed' | 'forbidden' }
export interface GroupView { id: string; name: string; revisionId: string; memberIds: string[] }
