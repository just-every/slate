import {PageComments} from "../../../pages/ui/workspace/PageComments";
import {PageHistory} from "../../../pages/ui/workspace/PageHistory";
import { useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useRecordReferences } from "../../../../client/useRecordReferences";
import { useResource } from "../../../../client/useResource";
import { ApiError, mutate, operationKey } from "../../../../client/transport";
import type { FieldDto } from "../../../../client/records";
import type { DocumentView } from "../../../../client/content";
import { draftKeys } from "../../../../client/draftRecovery";
import { RequestState } from "../../../../app/ui/RequestState";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
import { RecordFields } from "./RecordFields";
import { RecordMoreMenu, RecordPrintItem } from "./RecordPrint";
import { TopBar, type Crumb } from "../../../../app/ui/header/TopBar";
import { PageTitle } from "../../../../app/ui/header/PageTitle";
import { RecordValueDialog } from "./RecordValueDialog";
import { ReferenceValueDialog } from "./ReferenceValueDialog";
import { PageAccessNeeded, PageWorkspace } from "../../../pages/ui/workspace/PageWorkspace";
import { recordAddress } from "../../../../shared/knowledge/addresses";
interface RecordDocument {
  page: DocumentView;
  fields: FieldDto[];
  values: Record<string, unknown>;
  revisionId: string;
  parity: string;
}
/**
 * A record at its one address (SL1): its fields with their Edit, then its body, under the one top bar acting on the record.
 * `trail` is its database's trail; `lead` sits above the title (the way back to the list and the layout control).
 */
export function RecordWorkspace({
  databaseId,
  id,
  trail,
  lead,
  onSaved,
}: {
  databaseId: string;
  id: string;
  trail: Crumb[];
  lead: ReactNode;
  onSaved: () => void;
}) {
  const {member}=useWorkspace();
  const router = useRouter();
  const resource = useResource<RecordDocument>(
    `/api/databases/${encodeURIComponent(databaseId)}/records/${encodeURIComponent(id)}`,
  );
  const [edit, setEdit] = useState<FieldDto>();
  const data = resource.data;
  const references = useRecordReferences(
    data?.fields ?? [],
    data
      ? [
          {
            pageId: id,
            revisionId: data.revisionId,
            title: data.page.page.title,
            values: data.values,
          },
        ]
      : [],
  );
  async function save(value: unknown) {
    if (!data || !edit) return;
    await mutate(
      `/api/databases/${encodeURIComponent(databaseId)}/records/${encodeURIComponent(id)}`,
      {
        operationKey: operationKey(),
        expectedRevisionId: data.revisionId,
        values: { [edit.id]: value },
      },
      "PATCH",
    );
    await resource.reload();
    // The value is part of the record's page revision: its page rereads it, so a title typed next saves against it.
    window.dispatchEvent(new CustomEvent("slate:page-mutated", { detail: { pageId: id } }));
    onSaved();
  }
  // A relation chip opens the related record at its one address.
  const openLink = (pageId: string) => void router.navigate({ href: references.get(pageId)?.url ?? `/app/pages/${encodeURIComponent(pageId)}` });
  const fields = data ? (
    <RecordFields fields={data.fields} values={data.values} references={references} canEdit={data.page.permissions.canEdit} onEdit={setEdit} onOpenLink={openLink} />
  ) : null;
  // LINK-004: a reader who may open the list but not this record sees it acknowledged with no title.
  if (resource.error instanceof ApiError && [403, 404].includes(resource.error.status)) {
    return <><TopBar className="page-topbar record-topbar" trail={[...trail, { label: "Access needed" }]} /><PageAccessNeeded pageId={id} changed={false} keys={draftKeys(member.workspaceId, member.id, id)} /></>;
  }
  return (
    <>
      <RequestState
        loading={resource.loading}
        error={resource.error}
        retry={resource.reload}
      >
        {data ? (
          <>
            {data.parity === "record-is-page" ? (
              <PageWorkspace pageId={id} host={{ trail, moreItems: <RecordPrintItem />, properties: fields, lead, topBarClassName: "record-topbar", address: recordAddress(databaseId, id) }} />
            ) : (
              <>
                <TopBar className="page-topbar record-topbar" trail={[...trail, { label: data.page.page.title }]}><RecordMoreMenu /></TopBar>
                <div className="content-frame">
                  <section className="main record-fields">
                    {lead}
                    <PageTitle>{data.page.page.title}</PageTitle>
                    {fields}
                  </section>
                  <section className="main"><details><summary>Record comments</summary><PageComments document={data.page}/></details><details><summary>Record history</summary><PageHistory document={data.page} revision={data.page.page.revisionId} reload={resource.reload}/></details></section>
                </div>
              </>
            )}
            {edit ? (
              ["relation", "person", "file"].includes(edit.type) ? (
                <ReferenceValueDialog
                  databaseId={databaseId}
                  field={edit}
                  value={data.values[edit.id]}
                  onSave={save}
                  onClose={() => setEdit(undefined)}
                />
              ) : (
                <RecordValueDialog
                  field={edit}
                  value={data.values[edit.id]}
                  onSave={save}
                  onClose={() => setEdit(undefined)}
                />
              )
            ) : null}
          </>
        ) : null}
      </RequestState>
    </>
  );
}
