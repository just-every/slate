import {RequestState} from '../../../../app/ui/RequestState';
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { useResource } from "../../../../client/useResource";
import type {EmbeddedSearchQuery} from '../../../../shared/knowledge/search-definition';
import type {
  ContentQueryBlockData,
  ContentQueryDefinition,
} from "../../../editor/ui/types";
export function ContentQueryDialog({
  block,
  onSave,
  onClose,
}: {
  block: ContentQueryBlockData;
  onSave: (definition: ContentQueryDefinition) => Promise<void>;
  onClose: () => void;
}) {
  const spaces = useResource<{ items: { id: string; name: string }[] }>(
      "/api/containers",
    ),
    pages = useResource<{ items: { id: string; title: string }[] }>(
      "/api/pages",
    ),
    members = useResource<{ items: { id: string; displayName: string }[] }>(
      "/api/members",
    ),
    statuses = useResource<{ items: { key: string; label: string }[] }>(
      "/api/status",
    ),
    saved=useResource<{items:{id:string;name:string;query:EmbeddedSearchQuery}[]}>('/api/search/saved');
  const resources = [spaces, pages, members, statuses, saved];
  const loading = resources.some(resource => resource.loading);
  const unavailableChoices = [spaces, pages, members, statuses].some(resource => resource.error);
  return (
    <ActionDialog
      title="Edit content query"
      action="Save query"
      submitDisabled={loading}
      onClose={onClose}
      onSubmit={async (data) => {
        const definition: ContentQueryDefinition = {};
        const savedId=String(data.get('savedSearch')??'');
        if(savedId==='embedded') {
          definition.search=block.definition.search;
          definition.searchName=block.definition.searchName;
        } else if(savedId) {
          const choice=saved.data?.items.find(item=>item.id===savedId);
          if(!choice)throw new Error('This saved search is unavailable. Choose it again.');
          definition.search=choice.query;
          definition.searchName=choice.name;
        }
        for (const key of [
          "container",
          "ancestor",
          "pageType",
          "status",
          "contributor",
          "orderBy",
          "label",
        ] as const) {
          const value = String(data.get(key) ?? "");
          if (value) definition[key] = value;
        }
        const from = String(data.get("from") ?? ""),
          to = String(data.get("to") ?? "");
        if (from || to) {
          if (!from || !to || from > to)
            throw new Error("Choose a complete, ordered date range.");
          definition.dateRange = `${from}/${to}`;
        }
        definition.limit = Number(data.get("limit"));
        await onSave(definition);
      }}
    >
      <RequestState loading={loading}>
      {unavailableChoices ? <p role="status">Some query choices are unavailable. Saved criteria are retained.</p> : null}
      <RequestState loading={saved.loading} error={saved.error} retry={saved.reload}><label>Saved search<select aria-label="Saved search" name="savedSearch" defaultValue={block.definition.search?'embedded':''}>
        <option value="">Use the filters below</option>
        {block.definition.search?<option value="embedded">{block.definition.searchName??'Embedded search'} (current criteria)</option>:null}
        {saved.data?.items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label></RequestState>
      <p>This embeds a copy of the search criteria. Each reader sees only pages they can read.</p>
      <label>Label<input name="label" defaultValue={block.definition.label??''}/></label>
      <label>
        Space
        <select
          aria-label="Space"
          name="container"
          defaultValue={block.definition.container ?? ""}
        >
          <option value="">All readable spaces</option>
          {block.definition.container && !spaces.data?.items.some(item => item.id === block.definition.container) ? <option value={block.definition.container}>Unavailable space</option> : null}
          {spaces.data?.items.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Under page
        <select
          aria-label="Under page"
          name="ancestor"
          defaultValue={block.definition.ancestor ?? ""}
        >
          <option value="">Any parent</option>
          {block.definition.ancestor && !pages.data?.items.some(item => item.id === block.definition.ancestor) ? <option value={block.definition.ancestor}>Unavailable page</option> : null}
          {pages.data?.items.map((p) => (
            <option value={p.id} key={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Page type
        <select
          aria-label="Page type"
          name="pageType"
          defaultValue={block.definition.pageType ?? ""}
        >
          <option value="">All types</option>
          <option value="page">Page</option>
          <option value="record">Database record</option>
        </select>
      </label>
      <label>
        Status
        <select
          aria-label="Status"
          name="status"
          defaultValue={block.definition.status ?? ""}
        >
          <option value="">Any status</option>
          {block.definition.status && !statuses.data?.items.some(item => item.key === block.definition.status) ? <option value={block.definition.status}>Unavailable status</option> : null}
          {statuses.data?.items.map((p) => (
            <option value={p.key} key={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Contributor
        <select
          aria-label="Contributor"
          name="contributor"
          defaultValue={block.definition.contributor ?? ""}
        >
          <option value="">Any contributor</option>
          {block.definition.contributor && !members.data?.items.some(item => item.id === block.definition.contributor) ? <option value={block.definition.contributor}>Unavailable contributor</option> : null}
          {members.data?.items.map((p) => (
            <option value={p.id} key={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Updated from
        <input
          type="date"
          name="from"
          defaultValue={block.definition.dateRange?.split("/")[0]}
        />
      </label>
      <label>
        Updated through
        <input
          type="date"
          name="to"
          defaultValue={block.definition.dateRange?.split("/")[1]}
        />
      </label>
      <label>
        Order
        <select
          aria-label="Order"
          name="orderBy"
          defaultValue={block.definition.orderBy ?? "search"}
        >
          <option value="search">Saved search order, or recently updated</option>
          <option value="updated">Recently updated</option>
          <option value="title">Title</option>
        </select>
      </label>
      <label>
        Maximum results
        <input
          type="number"
          min={1}
          max={100}
          name="limit"
          defaultValue={block.definition.limit ?? 20}
          required
        />
      </label>
      </RequestState>
    </ActionDialog>
  );
}
