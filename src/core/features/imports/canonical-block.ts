import type {JsonValue} from '../../shared/api/common';
import type {ImportedBlock} from './types';

/** Rewrite only typed, known identities; arbitrary strings remain author content. */
export function canonicalContent(block: ImportedBlock, idFor: (kind: string, id: string) => string): JsonValue {
  const rewrite = (value: JsonValue): JsonValue => {
    if (typeof value === 'string') {
      if (value.startsWith('/api/media/')) return '/api/media/' + idFor('file', value.slice(11));
      if (value.startsWith('/app/pages/')) return '/app/pages/' + idFor('page', value.slice(11));
      return value;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === 'mention' && item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') {
        const kind = item.kind === 'person' ? 'member' : item.kind === 'page' ? 'page' : item.kind === 'group' ? 'group' : undefined;
        return [key, kind ? {...item, id: idFor(kind, item.id)} : item];
      }
      return [key, key === 'commentAnchorId' && typeof item === 'string' ? idFor('comment-anchor', item) : key === 'fileId' && typeof item === 'string' ? idFor('file', item) : rewrite(item)];
    }));
    return value;
  };
  const content = rewrite(block.canonicalBlock!.content);
  const ancestor = block.canonicalReferences?.ancestorPageSourceId;
  if (ancestor && content && typeof content === 'object' && !Array.isArray(content)) {
    const definition = content.definition;
    if (definition && typeof definition === 'object' && !Array.isArray(definition)) definition.ancestorPageId = idFor('page', ancestor);
  }
  return content;
}
