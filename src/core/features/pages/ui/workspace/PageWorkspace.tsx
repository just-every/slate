import { InitialResourcesContext } from "../../../../client/InitialResources";
import { useFlagshipEnabled } from "../../../../app/ui/LaunchProfile";
import { useNavigate } from "@tanstack/react-router";
import {PageReactions} from './ReactionControls';
import {PublicPageBanner} from './PublicPageBanner';
import { PageStatusBadge } from "./PageStatusBadge";
import { PageReadMetadata } from "./PageReadMetadata";
import { SaveStatus } from "../../../editor/ui/SaveStatus";
import {PageAppearance} from "./PageAppearance";
import {useWorkspace} from "../../../../app/ui/WorkspaceContext";
import type {PageSelection} from "./selection";
import { PageOutline } from "../PageOutline";
import { richTextToPlain } from "../../../editor/ui/types";
import { PagePresentation } from "./PagePresentation";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { validatePageRead } from "../../../../client/pageReadBoundary";
import { ApiError, TransportError } from "../../../../client/transport";
import { draftKeys } from "../../../../client/draftRecovery";
import { UnsavedDraft } from "./UnsavedDraft";
import { useResource, type Resource } from "../../../../client/useResource";
import { contentApi, type DocumentView } from "../../../../client/content";
import {
  mutate,
  request,
  operationKey,
  errorMessage,
} from "../../../../client/transport";
import { useCollaboration } from "../../../../client/useCollaboration";
import { usePageEditor } from "../../../../client/usePageEditor";
import { RequestState } from "../../../../app/ui/RequestState";
import { PageEditorBody } from "./PageEditorBody";
import { PageDetails, panelTitles } from "./PageDetails";
import { PageMoreMenu } from "./PageMoreMenu";
import { PageTopBar } from "./PageTopBar";
import { useNewPageArrival,newPageArrivalScript } from "./useNewPageArrival";
import { usePageTrail } from "./usePageTrail";
import type { Crumb } from "../../../../app/ui/header/TopBar";

/** What a host adds around a page: its own location, extra More-menu items, and properties shown beneath the byline. */
export interface PageHost {
  /** The crumbs before the page's own title; defaults to "Pages". */
  trail?: Crumb[];
  /** Extra items for the top bar's More menu, listed after Export page. */
  moreItems?: ReactNode;
  properties?: ReactNode;
}
export function PageWorkspace({ pageId, host }: { pageId: string; host?: PageHost }) {
  const {member, workspace}=useWorkspace();
  return <RequestState loading={workspace.loading} error={workspace.error} retry={workspace.reload}>
    <PageBoundary key={`${member.workspaceId}:${member.id}:${workspace.data?.id ?? ''}:${pageId}`} pageId={pageId} host={host}/>
  </RequestState>;
}
function PageBoundary({pageId,host}:{pageId:string;host?:PageHost}) {
  const {member}=useWorkspace();
  const resource = useResource<DocumentView>(`/api/pages/${encodeURIComponent(pageId)}`, {
    retainOnTransportFailure:true,
    validate: value=>validatePageRead(value,pageId),
  });
  const retained=resource.data !== undefined && resource.error instanceof TransportError;
  const opened=useRef(false);
  if(resource.data)opened.current=true;
  const denied=resource.error instanceof ApiError && (resource.error.status===403 || resource.error.status===404);
  // SHARE-007: losing access while the page is open also drops it from the tree.
  useEffect(()=>{if(denied&&opened.current)window.dispatchEvent(new Event("slate:navigation-changed"));},[denied]);
  if(denied)return <PageAccessNeeded pageId={pageId} changed={opened.current} keys={draftKeys(member.workspaceId,member.id,pageId)}/>;
  return <>
    {retained?<div role="alert">Refresh failed. Current server state is unconfirmed. Your unsaved edits remain here. <button onClick={()=>void resource.reload()}>Retry page refresh</button></div>:null}
    <RequestState loading={resource.loading} error={retained?undefined:resource.error} retry={resource.reload}>
      {resource.data?<LoadedPage key={`${pageId}:${resource.data.permissions.canEdit}:${resource.data.permissions.canShare}`} document={resource.data} reload={resource.reload} read={resource.read} invalidateRead={resource.invalidate} host={host}/>:null}
    </RequestState>
  </>;
}
/** LINK-004: the page's existence is acknowledged with no title, snippet or author. */
function PageAccessNeeded({pageId,changed,keys}:{pageId:string;changed:boolean;keys:ReturnType<typeof draftKeys>}) {
  return <div className="content-frame"><article className="main page-document">
    <div className="request-notice" role="alert">
      <h2>Access needed</h2>
      <p>{changed?"Your access to this page changed while it was open. ":""}This page isn’t available. It may not exist, or you may need access.</p>
      <button type="button" data-request-page-access={pageId}>Request access</button>
    </div>
    <UnsavedDraft keys={keys} reason="Your access to this page changed before this text was saved."/>
  </article></div>;
}
function LoadedPage({
  document,
  reload,
  read,
  invalidateRead,
  host,
}: {
  document: DocumentView;
  reload: () => Promise<boolean>;
  read: Resource<DocumentView>["read"];
  invalidateRead: () => void;
  host?: PageHost;
}) {
  const {member}=useWorkspace();
  const initial=useContext(InitialResourcesContext);
  const openedRevision=useRef<string | undefined>(initial[`/api/pages/${document.page.id}/opened`]?.revisionId);
  const navigate = useNavigate();
  const flagship = useFlagshipEnabled();
  const trail = usePageTrail(document, host?.trail);
  const titleWrite = useRef<Promise<void> | null>(null);
  const editor = usePageEditor(document, invalidateRead, () => titleWrite.current);
  const collaboration = useCollaboration(document.page.id, read);
  const keys=draftKeys(member.workspaceId,member.id,document.page.id),titleKey=keys.title;
  const recovered=useRef<{title:string;revision:string;key:string}|null>(null);
  const [title, setTitle] = useState(()=>{try{const value=localStorage.getItem(titleKey);if(value && document.permissions.canEdit)recovered.current=JSON.parse(value);}catch{}return recovered.current?.title??document.page.title;});
  const [savedTitle, setSavedTitle] = useState(document.page.title);
  const [selection,setSelection] = useState<PageSelection>();
  const [present, setPresent] = useState(false);
  const [reactionsOpen,setReactionsOpen]=useState(false);
  const [detail, setDetailState] = useState<string | null>(() => typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("detail") ?? (new URLSearchParams(window.location.search).has("thread")||new URLSearchParams(window.location.search).has("comment")?"comments":null)) : null);
  function setDetail(value: string | null) {
    setDetailState(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("detail", value);
    else {
      url.searchParams.delete("detail");
      url.searchParams.delete("thread");
      url.searchParams.delete("comment");
    }
    // A panel updates the current page URL without restoring an earlier page
    // scroll position after its own focus has already settled.
    void navigate({ href: `${url.pathname}${url.search}${url.hash}`, state: previous => ({ ...previous, slatePanelNavigation: true }), replace: true, resetScroll: false, hashScrollIntoView: false }).catch(setError);
  }
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !window.document.querySelector("dialog[open], [role=dialog]")) setDetail(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const detailPanel=useRef<HTMLElement>(null);
  const detailReturnFocus=useRef<HTMLElement|null>(null);
  // A panel opened from the More menu returns focus to the menu's button, which the menu names here.
  const requestedReturn=useRef<HTMLElement|null>(null);
  const detailReturnBlock=useRef<string|undefined>(undefined);
  useEffect(()=>{
    if(detail){
      detailReturnBlock.current=selection?.blockId;
      const active=window.document.activeElement;
      if(requestedReturn.current)detailReturnFocus.current=requestedReturn.current;
      else if(active instanceof HTMLElement && active!==window.document.body && !detailPanel.current?.contains(active))detailReturnFocus.current=active;
      requestedReturn.current=null;
      const params=new URLSearchParams(window.location.search);
      const linkedComment=detail==="comments" && (params.has("comment") || params.has("thread"));
      // PageComments scrolls to the referenced discussion. Panel focus must
      // preserve that position when its data was already present at mount.
      detailPanel.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:linkedComment});
      if (!linkedComment && window.matchMedia("(max-width: 1200px)").matches) detailPanel.current?.scrollIntoView({block:"start"});
    }else if(detailReturnFocus.current || detailReturnBlock.current){
      if(detailReturnFocus.current?.isConnected)detailReturnFocus.current.focus();
      else if(detailReturnBlock.current){
        const block=[...window.document.querySelectorAll<HTMLElement>('[data-block-id]')].find(element=>element.dataset.blockId===detailReturnBlock.current);
        block?.querySelector<HTMLElement>('[data-slate-editable]')?.focus();
      }
      detailReturnFocus.current=null;
      detailReturnBlock.current=undefined;
    }
  },[detail]);
  const [error, setError] = useState<unknown>();
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const [titleSaving, setTitleSaving] = useState(false);

  const [titleFailure, setTitleFailure] = useState<string>();
  const titleAttempt = useRef<{title:string; revision:string; key:string} | undefined>(recovered.current??undefined);
  const titleDirty=useRef(false);
  function changeTitle(value:string){
    titleDirty.current=true;recovered.current=null;
    setTitle(value);
    const attempt={title:value,revision:titleAttempt.current?.revision??editor.revision,key:operationKey()};
    titleAttempt.current=attempt;localStorage.setItem(titleKey,JSON.stringify(attempt));
    const input=titleInput.current;if(input){input.style.height="auto";input.style.height=`${input.scrollHeight}px`;}
  }
  const newPage=useNewPageArrival(titleInput,document.permissions.canEdit,title,changeTitle);
  useEffect(()=>{setDetailState(new URLSearchParams(window.location.search).get("detail") ?? (new URLSearchParams(window.location.search).has("thread")||new URLSearchParams(window.location.search).has("comment")?"comments":null));},[]);
  // A title committed elsewhere replaces the shown title unless this tab is editing it.
  useEffect(() => {
    if (title === savedTitle && document.page.title !== savedTitle && !titleSaving) {
      setTitle(document.page.title);
      setSavedTitle(document.page.title);
    }
  }, [document.page.title]);
  const receiveRef = useRef(editor.receive);
  receiveRef.current = editor.receive;
  useEffect(() => {
    receiveRef.current(document);
  }, [document]);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<{pageId:string}>).detail?.pageId === document.page.id) void reload();
    };
    window.addEventListener("slate:page-mutated", changed);
    return () => {
      window.removeEventListener("slate:page-mutated", changed);
    };
  }, [document.page.id, reload]);

  useEffect(() => {
    // A local write can already have superseded this loaded read. Wait for a
    // current document before attesting it; a save receipt alone is not a read.
    if (title !== savedTitle || titleSaving || editor.hasUnsavedChanges || editor.workingRevisionId !== document.workingRevisionId) return;
    const revisionId = ["edit", "full"].includes(document.permissions.level)
      ? document.workingRevisionId
      : (document.publishedRevisionId ?? document.workingRevisionId);
    if (openedRevision.current === revisionId) return;
    let current = true;
    // A loaded document can change without navigating. Record that exact read,
    // never a save receipt that could also include unseen concurrent edits.
    void mutate(`/api/pages/${document.page.id}/open`, {
      operationKey: operationKey(),
      revisionId,
    }).then(() => {
      if (current) {
        openedRevision.current = revisionId;
        window.dispatchEvent(new Event("slate:page-opened"));
      }
    }).catch(cause => {
      if (!current) return;
      if (cause instanceof ApiError && cause.status === 409) void reload();
      else setError(cause);
    });
    return () => { current = false; };
  }, [document.page.id, document.workingRevisionId, document.publishedRevisionId, document.permissions.level, title, savedTitle, titleSaving, editor.hasUnsavedChanges, editor.workingRevisionId, reload]);
  // SAVE-003: a title saved against a superseded page revision is refused; keeping
  // it is an explicit overwrite against the revision the server holds now.
  const [titleConflict,setTitleConflict]=useState(false);
  async function overwriteTitle() {
    try {
      const fresh=await contentApi.document(document.page.id);
      editor.receive(fresh);
      titleAttempt.current={title,revision:fresh.page.revisionId,key:operationKey()};
      localStorage.setItem(titleKey,JSON.stringify(titleAttempt.current));
      await saveTitle();
    } catch (cause) { setError(cause); }
  }
  async function saveTitle() {
    if (titleWrite.current) return titleWrite.current;
    const task = commitTitle();
    titleWrite.current = task;
    try { await task; } finally { titleWrite.current = null; }
  }
  async function commitTitle() {
    if (!document.permissions.canEdit || title === savedTitle || titleSaving) return;
    setTitleSaving(true);
    setTitleFailure(undefined);
    setError(undefined);
    try {
      const attempt = titleAttempt.current?.title === title ? titleAttempt.current : {title, revision: editor.revision, key: operationKey()};
      titleAttempt.current = attempt;
      const result = await request<{value:{revisionId:string};document:DocumentView}>(`/api/pages/${document.page.id}`, {method:"PATCH",keepalive:true,body:JSON.stringify({operationKey:attempt.key, expectedRevisionId:attempt.revision, properties:{title:attempt.title}})});
      editor.setRevision(result.value.revisionId);
      await read(async () => result.document);
      setSavedTitle(attempt.title);
      window.dispatchEvent(new Event("slate:navigation-changed"));
      if(titleAttempt.current?.key===attempt.key){localStorage.removeItem(titleKey);titleAttempt.current=undefined;titleDirty.current=false;recovered.current=null;}
      else if(titleAttempt.current?.revision===attempt.revision){
        // Later typing follows this tab's confirmed title write, while a remote
        // revision still keeps the ordinary conflict check.
        titleAttempt.current={...titleAttempt.current,revision:result.value.revisionId};
        localStorage.setItem(titleKey,JSON.stringify(titleAttempt.current));
      }
      setTitleConflict(false);
    } catch (cause) {
      const conflict = cause instanceof ApiError && cause.status === 409;
      if (conflict) setError(cause);
      else setTitleFailure(errorMessage(cause));
      setTitleConflict(conflict);
    } finally {
      setTitleSaving(false);
    }
  }
  const saveTitleRef=useRef(saveTitle);saveTitleRef.current=saveTitle;
  const titleCanLeave=useRef(false);
  titleCanLeave.current=document.permissions.canEdit && !titleFailure && !titleConflict && !recovered.current;
  useEffect(()=>{
    if(!titleDirty.current || title===savedTitle || titleSaving || titleFailure || titleConflict || !document.permissions.canEdit)return;
    const timer=setTimeout(()=>void saveTitleRef.current(),500);
    return()=>clearTimeout(timer);
  },[title,savedTitle,titleSaving,titleFailure,titleConflict,document.permissions.canEdit]);
  useEffect(()=>{
    const leaving=()=>{if(titleDirty.current && titleCanLeave.current)void saveTitleRef.current();};
    window.addEventListener('pagehide',leaving);
    return()=>window.removeEventListener('pagehide',leaving);
  },[]);
  return (
    <>
      <PageTopBar
        trail={[...trail, { label: document.page.title || "Untitled", suffix: document.policyProfile["page.status.v1"] === "verification-only" ? <PageStatusBadge document={document}/> : null }]}
        flagship={flagship}
        detail={detail}
        onToggle={value => {setSelection(undefined);setDetail(detail === value ? null : value);}}
        more={<PageMoreMenu
          document={{ ...document, page: {...document.page, revisionId: editor.revision}, workingRevisionId: editor.workingRevisionId }}
          unsaved={editor.hasUnsavedChanges || titleSaving || title !== savedTitle}
          revision={editor.revision}
          flagship={flagship}
          extraItems={host?.moreItems}
          reload={reload}
          onPresent={() => {setPresent(true);setDetail(null);}}
          onOpenPanel={(kind, returnTo) => {setSelection(undefined);requestedReturn.current=returnTo;setDetail(kind);}}
        />}
      />
      {present ? (
        <PagePresentation
          title={title}
          blocks={editor.blocks}
          onClose={() => setPresent(false)}
        />
      ) : null}
      <div className="content-frame">
        <article
          className={`main page-document ${document.properties?.smallText ? "page-small-text" : ""} ${document.properties?.fullWidth ? "page-full-width" : ""}`}
          data-typeface={document.properties?.typeface ?? "default"}
        >
          {document.page.lifecycle === "draft" ? <p className="draft-label">Private draft</p> : null}
          <h1 className="sr-only">{title || "Untitled page"}</h1>
          {document.lock ? <p role="status" className="request-notice" data-page-lock>Locked by {document.lock.lockedByDisplayName}. This page is read-only; comments stay open.</p> : null}
          <PublicPageBanner document={document} onManage={()=>setDetail("publication")}/>
          {document.permissions.canEdit && document.policyProfile["page.lifecycle.v1"] === "draft-then-publish" && document.publishedRevisionId && document.publishedRevisionId !== editor.workingRevisionId ? <p role="status" className="draft-label">Unpublished changes. Readers see the last published revision until you publish again.</p> : null}
          {(document as DocumentView&{schedule?:{state:string;publishAt:string;failure?:string}}).schedule?.state==='scheduled'?<p role="status">Scheduled for {new Date((document as DocumentView&{schedule:{publishAt:string}}).schedule.publishAt).toLocaleString()}</p>:null}
          {(document as DocumentView&{schedule?:{state:string;publishAt:string;failure?:string}}).schedule?.state==='failed'?<p role="alert">Scheduled publication needs attention: {(document as DocumentView&{schedule:{failure?:string}}).schedule.failure??'Open publication options to review and reschedule.'}</p>:null}
          <PageAppearance document={document}/>
          <textarea
            ref={titleInput}
            rows={1}
            className="page-title page-title-input"
            aria-label="Page title"
            readOnly={!document.permissions.canEdit}
            value={title}
            onChange={event=>changeTitle(event.target.value)}
            onBlur={() => { if (!titleFailure) void saveTitle(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!titleFailure) void saveTitle();
                event.currentTarget.closest('article')?.querySelector<HTMLElement>('[data-page-editor] [data-slate-editable]')?.focus();
              }
            }}
          />
          {newPage && document.permissions.canEdit ? <script dangerouslySetInnerHTML={{__html:newPageArrivalScript}}/> : null}
          <PageReadMetadata document={document} />
          {recovered.current && title!==savedTitle ? <SaveStatus state="unsaved" recoveredDraft onRetry={()=>void saveTitle()}/> : null}
          {titleFailure ? <SaveStatus state="failed" failureMessage={titleFailure} onRetry={() => void saveTitle()} /> : null}
          {host?.properties}
          {collaboration.presence.length > 1 ? (
            <p className="muted">
              Here now:{" "}
              {collaboration.presence
                .map((person) => person.displayName)
                .join(", ")}
            </p>
          ) : null}
          {error ? <div role="alert">{errorMessage(error)}{title !== savedTitle ? <>{titleConflict ? <button onClick={() => void overwriteTitle()}>Keep my title</button> : <button onClick={() => void saveTitle()}>Retry title save</button>}<button onClick={async () => {const fresh = await contentApi.document(document.page.id); setError(new Error(`Saved title: ${fresh.page.title}. Your unsaved title: ${title}`)); editor.receive(fresh);}}>Compare saved title</button><button onClick={async () => {const fresh=await contentApi.document(document.page.id);setTitle(fresh.page.title);setSavedTitle(fresh.page.title);editor.receive(fresh);titleAttempt.current=undefined;localStorage.removeItem(titleKey);setTitleConflict(false);setError(undefined);}}>Reload saved title</button></> : null}</div> : null}
          {editor.blocks.some(block => block.type === "heading") ? <details className="page-outline">
            <summary>On this page</summary>
            <PageOutline
              headings={editor.blocks.flatMap((block) =>
                block.type === "heading"
                  ? [
                      {
                        id: block.id,
                        level: block.level,
                        text: richTextToPlain(block.text),
                      },
                    ]
                  : [],
              )}
              onSelectHeading={(id) =>
                window.document
                  .querySelector(`[data-block-id="${CSS.escape(id)}"]`)
                  ?.scrollIntoView({
                    behavior: matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                      ? "instant"
                      : "smooth",
                    block: "center",
                  })
              }
            />
          </details> : null}
          {!document.permissions.canEdit?<>{!document.lock ? <p role="status">This page is read-only with your current access.</p> : null}<UnsavedDraft keys={keys} reason={document.lock ? "This page was locked before this text was saved." : "Your access to this page changed to view only before this text was saved."}/></>:null}
          <PageEditorBody
            editor={editor}
            titleState={titleFailure || titleConflict || recovered.current ? "failed" : titleSaving || title!==savedTitle ? "saving" : undefined}
            document={document}
            onAsk={selection=>{if(flagship){setSelection(selection);setDetail("ask");}}}
            onComment={selection=>{setSelection(selection);setDetail("comments");if(selection)reload();}}
            footer={<details className="page-reactions" onToggle={event=>setReactionsOpen(event.currentTarget.open)}><summary>👍 Reactions</summary>{reactionsOpen?<PageReactions pageId={document.page.id}/>:null}</details>}
          />
        </article>
        {detail && Object.hasOwn(panelTitles, detail) && (flagship || detail !== "ask") ? (
          <aside className="right" ref={detailPanel} role="region" aria-label={panelTitles[detail]}>
            <PageDetails
              kind={detail}
              selection={selection}
              document={{ ...document, page: {...document.page, revisionId: editor.revision}, workingRevisionId: editor.workingRevisionId }}
              revision={editor.revision}
              onClose={() => setDetail(null)}
              onCommentSent={() => setSelection(undefined)}
              reload={reload}
            />
          </aside>
        ) : null}
      </div>
    </>
  );
}
