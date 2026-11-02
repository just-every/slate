import { useState } from 'react';
import { useResource } from '../../../../client/useResource';
import { mutate, operationKey, errorMessage } from '../../../../client/transport';
import { RequestState } from '../../../../app/ui/RequestState';

const labels = { full: 'Manage access', edit: 'Edit', comment: 'Comment', view: 'View' };
export function SharingLevels() {
  const resource = useResource<{ levels: string[]; revisionId: string | null }>('/api/sharing/configuration');
  const [pending, setPending] = useState(false), [error, setError] = useState<unknown>();
  return <section aria-label="Sharing levels"><h3>Sharing levels</h3>
    <p>Choose the access levels available when sharing. Stored grants keep their access; removing Comment hides comment actions.</p>
    <RequestState loading={resource.loading} error={resource.error} retry={resource.reload}>
      {resource.data ? <form key={resource.data.revisionId ?? 'default'} onSubmit={async event => {
        event.preventDefault();
        const levels = new FormData(event.currentTarget).getAll('level');
        setPending(true); setError(undefined);
        try { await mutate('/api/sharing/configuration', { operationKey: operationKey(), expectedRevisionId: resource.data!.revisionId, levels }, 'PUT'); await resource.reload(); }
        catch (cause) { setError(cause); } finally { setPending(false); }
      }}>
        <fieldset disabled={pending}><legend>Available access levels</legend>
          {Object.entries(labels).map(([value, label]) => <label key={value}><input type="checkbox" name="level" value={value} defaultChecked={resource.data!.levels.includes(value)}/>{label}</label>)}
        </fieldset>
        <button className="secondary-button" disabled={pending}>Save sharing levels</button>
      </form> : null}
    </RequestState>{error ? <p role="alert">{errorMessage(error)}</p> : null}
  </section>;
}
