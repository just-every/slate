import { FileText, LayoutTemplate, Plus } from 'lucide-react';
import { errorMessage } from '../../client/transport';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ui';
import { DEFAULT_PAGE_TITLE, templateCreationHref } from './pageDestination';
import { useCreatePage } from './useCreatePage';

/** Both creation choices retain the tree's named root or parent. */
export function TreeCreatePage({ containerId, name, parentPageId, disabled = false }: {
  containerId: string; name: string; parentPageId?: string; disabled?: boolean;
}) {
  const creation = useCreatePage();
  const label = parentPageId ? `Create child of ${name}` : `Create page in ${name}`;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={parentPageId ? "iconbutton tree-action" : "navlink tree-create-page"}
          aria-label={label} disabled={disabled || creation.pending} aria-busy={creation.pending || undefined}
          data-tooltip={parentPageId ? "Add child" : undefined} data-tooltip-align="end">
          <Plus aria-hidden="true" />{parentPageId ? null : <span>{label}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label}>
        <DropdownMenuItem onSelect={() => void creation.create(async () => ({ containerId, parentPageId, title: DEFAULT_PAGE_TITLE }))}>
          <FileText aria-hidden="true" />Blank page
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.location.assign(templateCreationHref(containerId, parentPageId))}>
          <LayoutTemplate aria-hidden="true" />Page from template
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {creation.error ? <p role="alert">{errorMessage(creation.error)}</p> : null}
  </>;
}
