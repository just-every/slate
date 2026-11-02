import {useMentionPreview,MentionPreview} from '../../../editor/ui/blocks/MentionPreview';
import { displayDate } from "../../../../app/ui/displayDate";
import {DiscussionFilters} from "./DiscussionFilters";
import {ReactionControls} from './ReactionControls';
import type {PageSelection} from "./selection";
import {Editable} from "../../../editor/ui/blocks/Editable";
import { useEffect,useRef,useState } from "react";
import { useResource } from "../../../../client/useResource";
import {
  mutate,
  operationKey,
  errorMessage,
} from "../../../../client/transport";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
import { RequestState } from "../../../../app/ui/RequestState";
import type { DocumentView } from "../../../../client/content";
import type { RichText } from "../../../editor/ui/types";
import { InlineText } from "../../../editor/ui/blocks/InlineText";
import { ActionDialog } from "../../../../app/ui/ActionDialog";

interface Comment {
  id: string;
  threadId: string;
  authorMemberId: string;
  authorDisplayName?: string;
  body: RichText | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revisionId: string;
}
interface Thread {
  id: string;
  state: string;
  revision_id: string;
  kind: string;
  anchor_json: string | null;
  block_id: string | null;
  anchor_revision_id: string | null;
}
export function PageComments({ document, selection, onSent, title = "Discussion" }: { document: DocumentView; selection?:PageSelection; onSent?: () => void; title?: string }) {
  const { member } = useWorkspace();
  const resource = useResource<{ threads: Thread[]; comments: Comment[]; reactions:{id:string;commentId:string;emoji:string;memberId:string;displayName:string}[] }>(
    `/api/comments/page/${document.page.id}`,
  );
  const commentKey=useRef<{signature:string;key:string}|null>(null);
  const [body, setBody] = useState<RichText>([]);
  const [filter,setFilter]=useState("all");
  const [kind,setKind]=useState("all");
  const [person,setPerson]=useState("all");
  const [editBody,setEditBody]=useState<RichText>([]);
  const [reply, setReply] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [sendFailed, setSendFailed] = useState(false);
  const [edit, setEdit] = useState<Comment>();
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const thread=params.get("thread"),comment=params.get("comment");if(thread||comment)window.document.getElementById(`${thread?"thread":"comment"}-${thread??comment}`)?.scrollIntoView({block:"center"});},[resource.data]);
  const mentionPreview=useMentionPreview(document.page.id,body);
  const editMentionPreview=useMentionPreview(document.page.id,editBody,edit?.body??[]);
  const allowed = document.permissions.level !== "view" && document.permissions.canComment !== false;
  async function action(path: string, value: unknown, method = "POST") {
    setError(undefined);
    setSendFailed(false);
    try {
      await mutate(path, value, method);
      await resource.reload();
    } catch (cause) {
      setError(cause);
      throw cause;
    }
  }
  const people = new Map<string, string>();
  for (const comment of resource.data?.comments ?? []) {
    people.set(comment.authorMemberId, comment.authorDisplayName ?? (comment.authorMemberId === member.id ? member.displayName : "Workspace member"));
  }
  const threads = resource.data?.threads.filter(thread =>
    (filter === "all" || thread.state === filter) &&
    (kind === "all" || thread.kind === kind) &&
    (person === "all" || resource.data?.comments.some(comment => comment.threadId === thread.id && comment.authorMemberId === person)),
  ) ?? [];
  return (
    <section className="comments-panel">
      <h2>{title}</h2>
      <DiscussionFilters status={filter} kind={kind} person={person} people={[...people]} onStatus={setFilter} onKind={setKind} onPerson={setPerson}/>
      {allowed && resource.data?.threads.some(t=>t.state==='open') ? <button className="secondary-button" onClick={()=>void action(`/api/comments/page/${document.page.id}/resolve-all`,{operationKey:operationKey()}).catch(()=>{})}>Resolve all open threads</button>:null}
      <RequestState
        loading={resource.loading}
        error={resource.error}
        retry={resource.reload}
      >
        {resource.data?.threads.length === 0 ? (
          <p className="muted">Start a conversation about this page.</p>
        ) : null}
        {!resource.loading && resource.data && resource.data.threads.length > 0 && threads.length === 0 ? <p className="muted" role="status">No threads match these filters.</p> : null}
        {threads.map((thread) => (
          <section className="comment-thread" id={`thread-${thread.id}`} key={thread.id}>
            <div className="thread-heading">
              <span>{thread.state === "resolved" ? "Resolved" : "Open"}</span>
              {allowed ? (
                <button
                  type="button"
                  onClick={() =>
                    void action(`/api/comments/thread/${thread.id}/resolve`, {
                      operationKey: operationKey(),
                      expectedRevisionId: thread.revision_id,
                      resolved: thread.state !== "resolved",
                    }).catch(() => {})
                  }
                >
                  {thread.state === "resolved" ? "Reopen" : "Resolve"}
                </button>
              ) : null}
            </div>
            {thread.anchor_json ? (
              <div><blockquote>{(JSON.parse(thread.anchor_json) as {quote?:string}).quote}</blockquote>
              {document.blocks.some(b=>b.id===thread.block_id && JSON.stringify(b.content).includes((JSON.parse(thread.anchor_json!) as {anchorId:string}).anchorId)) ? <button onClick={()=>window.document.querySelector(`[data-block-id="${CSS.escape(thread.block_id!)}"]`)?.scrollIntoView({block:"center"})}>Jump to selected text</button> : <p>Original text is no longer on the page. <a href={`/app/pages/${document.page.id}?detail=history&revision=${thread.anchor_revision_id}`}>Open original revision {thread.anchor_revision_id}</a></p>}</div>
            ) : null}
            {resource.data?.comments
              .filter((comment) => comment.threadId === thread.id)
              .map((comment) => (
                <article key={comment.id} id={`comment-${comment.id}`} className="comment">
                  <header>
                    <strong>
                      {comment.authorDisplayName ??
                        (comment.authorMemberId === member.id
                          ? member.displayName
                          : "Workspace member")}
                    </strong>
                    <time dateTime={comment.createdAt}>
                      {displayDate(comment.createdAt, true)}
                    </time>
                  </header>
                  {comment.deletedAt ? (
                    <p className="muted">Comment deleted</p>
                  ) : (
                    <>
                      <p><InlineText value={comment.body ?? []} /></p>
                      <ReactionControls pageId={document.page.id} commentId={comment.id} reactions={resource.data?.reactions??[]} onChanged={resource.reload}/>
                      {comment.updatedAt !== comment.createdAt ? (
                        <small>Edited <time dateTime={comment.updatedAt}>{displayDate(comment.updatedAt, true)}</time></small>
                      ) : null}
                      {allowed ? (
                        <div className="comment-actions">
                          <button
                            type="button"
                            onClick={() => setReply(thread.id)}
                          >
                            Reply
                          </button>
                          {comment.authorMemberId === member.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {setEdit(comment);setEditBody(comment.body??[]);}}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void action(
                                    `/api/comments/${comment.id}`,
                                    {
                                      operationKey: operationKey(),
                                      expectedRevisionId: comment.revisionId,
                                      delete: true,
                                    },
                                    "PATCH",
                                  ).catch(() => {})
                                }
                              >
                                Delete
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
              ))}
          </section>
        ))}
      </RequestState>
      {allowed ? (
        <form
          className="comment-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            try {
              const signature=JSON.stringify({body,reply,selection});if(commentKey.current?.signature!==signature)commentKey.current={signature,key:operationKey()};
              await action(`/api/comments/page/${document.page.id}`, {
                operationKey: commentKey.current.key,
                threadId: reply,
                body,
                ...(selection && !reply ? {kind:"inline",blockId:selection.blockId,anchor:{anchorId:selection.anchorId,quote:selection.quote},anchorRevisionId:selection.revisionId} : {}),
              });
              commentKey.current=null;setBody([]);
              setReply(undefined);
              onSent?.();
            } catch {
              setSendFailed(true);
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            {reply ? "Reply to thread" : "New comment"}
            {selection && !reply ? <blockquote>{selection.quote}</blockquote>:null}
            <Editable mentionPageId={document.page.id} previousMentions={[]} value={body} onChange={setBody} canEdit={!pending} label={reply?"Reply text":"Comment text"} placeholder="Write a comment; type @ to mention"/>
          </label>
          <MentionPreview preview={mentionPreview}/>
          {error ? <p className="comment-error" role="alert">{errorMessage(error)}{sendFailed ? " Your draft is kept. Choose Send comment to retry." : null}</p> : null}
          {/* The initial thread read moves this form when its loading notice disappears. */}
          <button className="primary-button" type="submit" disabled={resource.loading || pending || mentionPreview.loading || !!mentionPreview.error || !body.some(span=>span.text.trim())}>
            {pending ? "Sending…" : "Send comment"}
          </button>
          {reply ? (
            <button type="button" onClick={() => setReply(undefined)}>
              Start a new thread instead
            </button>
          ) : null}
        </form>
      ) : (
        <p className="muted">Read-only discussion.</p>
      )}
      {!allowed && error ? <p role="alert">{errorMessage(error)}</p> : null}
      {edit ? (
        <ActionDialog
          title="Edit comment"
          action="Save comment"
          onClose={() => setEdit(undefined)}
          onSubmit={async (data) => {
            if(editMentionPreview.loading || editMentionPreview.error)throw new Error("Wait for a successful recipient preview before saving.");
            await action(
              `/api/comments/${edit.id}`,
              {
                operationKey: operationKey(),
                expectedRevisionId: edit.revisionId,
                body: editBody,
              },
              "PATCH",
            );
          }}
        >
          <label>
            Comment
            <Editable mentionPageId={document.page.id} previousMentions={edit.body} value={editBody} onChange={setEditBody} canEdit label="Edit comment text" placeholder="Write a comment"/>
          </label>
          <MentionPreview preview={editMentionPreview}/>
        </ActionDialog>
      ) : null}
    </section>
  );
}
