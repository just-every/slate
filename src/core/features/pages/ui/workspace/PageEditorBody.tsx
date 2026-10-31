import {ConnectedFilePicker} from './ConnectedFilePicker';
import {DocumentHeadings} from '../../../editor/ui/blocks/DocumentHeadings';
import {StatusLabelDialog} from '../../../editor/ui/blocks/StatusLabelDialog';
import {insertStatusLabel} from '../../../editor/ui/insertStatusLabel';
import {useContentQueries} from './useContentQueries';
import {TaskPageProvider} from '../../../editor/ui/blocks/TaskPageContext';
import {ReminderDialog} from '../../../editor/ui/blocks/ReminderDialog';
import {ContentQueryDialog} from './ContentQueryDialog';
import {usePageInsertion} from "./usePageInsertion";
import {sliceRichText} from "../../../editor/ui/sliceRichText";
import type {PageSelection} from "./selection";
import {formatSelection} from "../../../editor/ui/formatSelection";
import {richTextToPlain} from "../../../editor/ui/types";
import {typedBlock} from "../../../editor/ui/typedFormatting";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {readEditableSelection, restoreEditableSelection, type EditableSelection} from '../../../editor/ui/blocks/editableSelection';
import { EditorMediaDialog } from "./EditorMediaDialog";
import { BlockEditor } from "../../../editor/ui/BlockEditor";
import { BlockView } from "../../../editor/ui/blocks/BlockView";
import { InsertMenu } from "../../../editor/ui/InsertMenu";
import { newBlock } from "../../../editor/ui/newBlock";
import type { InsertKind } from "../../../editor/ui/blockCatalog";
import type { BlockMove, EditorBlock, InlineSpan } from "../../../editor/ui/types";
import type { usePageEditor } from "../../../../client/usePageEditor";
import type { DocumentView } from "../../../../client/content";
import { contentApi, editorBlocks } from "../../../../client/content";
import { mutate,operationKey,errorMessage } from "../../../../client/transport";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { useInsertedBlockFocus } from "./useInsertedBlockFocus";

export function PageEditorBody({
  editor,
  document,
  onAsk,
  onComment,
  footer,
  titleState,
}: {
  editor: ReturnType<typeof usePageEditor>;
  document: DocumentView;
  onAsk: (selection?:PageSelection) => void;
  onComment: (selection?:PageSelection) => void;
  /** Quiet controls that share the row below the body with Add block. */
  footer?: ReactNode;
  titleState?: "saving" | "failed";
}) {
  const insertion = usePageInsertion(document.page.id, editor);
  const [dateReminder,setDateReminder]=useState<{date:string;blockId?:string}|null>(null);
  const visibleBlocks = insertion.blocks;
  const liveQueries=useContentQueries(document.page.id,visibleBlocks);
  const [queryEditor,setQueryEditor]=useState<string|null>(null);
  const editedQuery=editor.blocks.find(block=>block.id===queryEditor);
  const undoConversion = useRef<{block:EditorBlock;removed:number} | null>(null);
  const conversionFocus = useRef<{id:string;selection:EditableSelection|null}|null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  function changeKind(block:EditorBlock, removed=0) {
    if (!document.permissions.canEdit) return;
    const root = [...(wrapper.current?.querySelectorAll<HTMLElement>('[data-block-id]')??[])].find(element=>element.dataset.blockId===block.id)?.querySelector<HTMLElement>('[data-slate-editable]');
    const selection = root ? readEditableSelection(root) : null;
    conversionFocus.current = {id:block.id,selection:selection ? {anchor:Math.max(0,selection.anchor-removed),focus:Math.max(0,selection.focus-removed)} : null};
    insertion.change(block.id,{...block,layoutParentId:visibleBlocks.find(item=>item.id===block.id)?.layoutParentId});
  }
  useLayoutEffect(()=>{
    const intent = conversionFocus.current;
    if (!intent) return;
    conversionFocus.current = null;
    const root = [...(wrapper.current?.querySelectorAll<HTMLElement>('[data-block-id]')??[])].find(element=>element.dataset.blockId===intent.id)?.querySelector<HTMLElement>('[data-slate-editable]');
    if (root) {root.focus();if(intent.selection)restoreEditableSelection(root,intent.selection);}
  },[visibleBlocks]);
  const requestInsertFocus = useInsertedBlockFocus(wrapper, document.page.id, visibleBlocks, document.permissions.canEdit && (insertion.pending || editor.structureState !== "saving"));
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const insertAt = (event:Event) => {
      if (!document.permissions.canEdit) return;
      const target=event.target as HTMLElement;
      const selection=window.getSelection();
      const caret=selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const caretRect=caret?.getBoundingClientRect();
      // Empty editables can have a 0×0 Range at the viewport origin. Keep
      // real line carets (zero width, positive height) anchored to the Range.
      const anchor=caret && caretRect && (caretRect.width>0 || caretRect.height>0) ? caret : target;
      const detail=(event as CustomEvent<{anchor:number;focus:number;inlineLabels?:boolean;onInlineInsert?:(span:InlineSpan)=>void}>).detail;
      setInsert({after:target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null,range:detail,inlineLabels:detail.inlineLabels,onInlineInsert:detail.onInlineInsert,anchor});
    };
    const split = (event: Event) => {
      if (!document.permissions.canEdit) return;
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[data-block-id]');
      if (target !== row?.querySelector('[data-slate-editable]')) return;
      const id = row.dataset.blockId;
      const block = visibleBlocks.find(item => item.id === id);
      const range = (event as CustomEvent<EditableSelection>).detail;
      if (!block || !('text' in block) || !range) return;
      event.preventDefault();
      if (block.type === 'task' && richTextToPlain(block.text).trim() === '') {
        changeKind({id: block.id, type: 'paragraph', text: [], indent: block.indent});
        return;
      }
      const start = Math.min(range.anchor, range.focus), end = Math.max(range.anchor, range.focus);
      const inserted = newBlock(block.type === 'task' ? 'task' : 'text');
      if (!('text' in inserted)) return;
      inserted.text = sliceRichText(block.text, end);
      inserted.indent = block.indent;
      inserted.layoutParentId = block.layoutParentId;
      const next = [...visibleBlocks], index = next.findIndex(item => item.id === id);
      next.splice(index, 1, {...block, text: sliceRichText(block.text, 0, start)}, inserted);
      insertion.insert(next);
      requestInsertFocus(inserted.id)(true);
    };
    element.addEventListener('slate-split-block', split);
    const undo=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&undoConversion.current&&visibleBlocks.some(block=>block.id===undoConversion.current?.block.id)){event.preventDefault();const previous=undoConversion.current;undoConversion.current=null;changeKind(previous.block,-previous.removed);}};
    element.addEventListener('slate-insert-at-cursor',insertAt);
    element.addEventListener('keydown',undo);
    const selected = async (event:Event, comment:boolean) => {
      const target=event.target as HTMLElement,blockId=target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
      const range=(event as CustomEvent<{anchor:number;focus:number}>).detail;
      const block=editor.blocks.find(b=>b.id===blockId);
      if(!block || !('text' in block) || !range)return;
      const start=Math.min(range.anchor,range.focus),end=Math.max(range.anchor,range.focus),anchorId=crypto.randomUUID();
      const value:PageSelection={blockId:block.id,blockRevisionId:document.blocks.find(b=>b.id===block.id)?.revisionId??'',revisionId:editor.workingRevisionId,anchorId,start,end,quote:richTextToPlain(block.text).slice(start,end)};
      if(comment && !document.permissions.canEdit){onComment(value);return;}
      if(comment){setError(undefined);try{await editor.structure(editor.blocks.map(b=>b.id===block.id?{...block,text:formatSelection(block.text,start,end,span=>({...span,commentAnchorId:anchorId}))}:b));const fresh=await contentApi.document(document.page.id);value.revisionId=fresh.workingRevisionId;onComment(value);}catch(cause){setError(cause);}}
      else onAsk(value);
    };
    const comment=(event:Event)=>{void selected(event,true);};const ask=(event:Event)=>{void selected(event,false);};
    element.addEventListener("slate-comment-selection", comment);
    element.addEventListener("slate-ask-selection", ask);
    return () => {
      element.removeEventListener('slate-insert-at-cursor',insertAt);
      element.removeEventListener('slate-split-block', split);
      element.removeEventListener('keydown',undo);
      element.removeEventListener("slate-comment-selection", comment);
      element.removeEventListener("slate-ask-selection", ask);
    };
  }, [onAsk, onComment,editor, insertion, visibleBlocks]);
  const [insert, setInsert] = useState<{ after: string | null; range?:{anchor:number;focus:number}; inlineLabels?:boolean; onInlineInsert?:(span:InlineSpan)=>void; anchor: HTMLElement | Range } | null>(null);
  const [syncedInsert,setSyncedInsert]=useState<{after:string|null}|null>(null);
  const [fileInsert,setFileInsert]=useState<{after:string|null}|null>(null);
  const [statusInsert,setStatusInsert]=useState<typeof insert>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState<{
    id: string;
    saved: EditorBlock;
  } | null>(null);
  const [media, setMedia] = useState<{ id: string; mode: "upload" | "link" }>();
  const [selected, setSelected] = useState<string[]>([]);

  async function apply(next: EditorBlock[]) {
    if (!document.permissions.canEdit) return false;
    setError(undefined);
    try {
      await editor.structure(next);
      return true;
    } catch (cause) {
      setError(cause);
      return false;
    }
  }
  function add(kind: InsertKind) {
    if(kind==='synced-reference'){setSyncedInsert({after:insert?.after??null});setInsert(null);setQuery('');return;}
    if(kind==='file-card'){setFileInsert({after:insert?.after??null});setInsert(null);setQuery('');return;}
    if(kind==='status'){if(insert?.inlineLabels===false)setError(new Error('This field accepts plain text. Add a text block to insert a status label.'));else setStatusInsert(insert);setInsert(null);setQuery('');return;}
    const existing = editor.blocks.length || insertion.pending ? visibleBlocks : [];
    const index = insert?.after
      ? existing.findIndex((block) => block.id === insert.after) + 1
      : existing.length;
    const next = [...existing];
    const block=next[index-1];
    const inserted=newBlock(kind);
    if(kind!=="columns") inserted.layoutParentId=block?.type==="column"?block.id:block?.layoutParentId;
    if(kind==="columns" && (block?.type==="column" || block?.layoutParentId)){setError(new Error("Columns cannot be nested inside a column."));return;}
    if(insert?.range && block?.type==='paragraph'){
      const start=Math.min(insert.range.anchor,insert.range.focus),end=Math.max(insert.range.anchor,insert.range.focus);
      const before=sliceRichText(block.text,0,start),after=sliceRichText(block.text,end);
      next.splice(index-1,1,...(before.length?[{...block,text:before}]:[]),inserted,...(after.length?[{id:crypto.randomUUID(),type:'paragraph' as const,text:after}]:[]));
    }else next.splice(index, 0, inserted);
    if(inserted.type==="columns"){
      const at=next.indexOf(inserted);
      next.splice(at+1,0,...Array.from({length:inserted.count},()=>({id:crypto.randomUUID(),type:"column" as const,layoutParentId:inserted.id})));
    }
    setInsert(null);
    setQuery("");
    insertion.insert(next);
    requestInsertFocus(inserted.id)(true);
  }
  function move(id: string, movement: BlockMove) {
    const next = [...editor.blocks];
    const index = next.findIndex((block) => block.id === id);
    if (index < 0) return;
    if (movement.kind === "into-column") {
      if(next[index].type==="columns" || next[index].type==="column")return;
      next[index]={...next[index],layoutParentId:movement.columnId,indent:0};
    } else if (movement.kind === "indent" || movement.kind === "outdent")
      next[index] = {
        ...next[index],
        indent: Math.max(
          0,
          (next[index].indent ?? 0) + (movement.kind === "indent" ? 1 : -1),
        ),
      };
    else {
      const [original] = next.splice(index, 1);
      const targetBlock=movement.kind!=="step"?next.find(item=>item.id===movement.blockId):undefined;
      const block={...original,layoutParentId:targetBlock?.layoutParentId};
      const target =
        movement.kind === "step"
          ? index + (movement.direction === "up" ? -1 : 1)
          : next.findIndex((item) => item.id === movement.blockId) +
            (movement.kind === "after" ? 1 : 0);
      next.splice(Math.max(0, Math.min(next.length, target)), 0, block);
    }
    void apply(next);
  }
  async function compare(id: string) {
    try {
      const fresh = await contentApi.document(document.page.id);
      const saved = editorBlocks(fresh.blocks).find((block) => block.id === id);
      if (!saved)
        throw new Error(
          "The saved block was removed. Your local text remains in the editor.",
        );
      setConflict({ id, saved });
    } catch (cause) {
      setError(cause);
    }
  }
  return (
    <TaskPageProvider pageId={document.page.id} revisionId={insertion.pending?'':editor.workingRevisionId} canShare={document.permissions.canShare}><DocumentHeadings blocks={visibleBlocks}><div ref={wrapper} data-page-editor tabIndex={-1} onClick={event=>{const target=(event.target as HTMLElement).closest<HTMLElement>('[data-reminder-date]');if(target?.dataset.reminderDate){setDateReminder({date:target.dataset.reminderDate,blockId:target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId});}}}>
      {dateReminder?<ReminderDialog pageId={document.page.id} {...dateReminder} onClose={()=>setDateReminder(null)}/>:null}
      {insert ? (
        <InsertMenu
          open
          anchor={insert.anchor}
          query={query}
          onQueryChange={setQuery}
          onInsert={add}
          onClose={() => setInsert(null)}
        />
      ) : null}
      {syncedInsert?<ActionDialog title="Insert synced block" action="Insert synced copy" onClose={()=>setSyncedInsert(null)} onSubmit={async data=>{
        const url=new URL(String(data.get('source'))),match=/^\/app\/pages\/([^/]+)$/.exec(url.pathname),hash=/^#synced-block=(.+)$/.exec(url.hash);
        if(url.origin!==location.origin||!match||!hash)throw new Error('Paste a synced block link from this workspace.');
        const response=await fetch(`/api/pages/${encodeURIComponent(match[1])}/synced/${encodeURIComponent(hash[1])}`);if(!response.ok)throw new Error('The synced source is unavailable or needs access.');
        const next=[...visibleBlocks],index=syncedInsert.after?next.findIndex(b=>b.id===syncedInsert.after)+1:next.length,previous=next[index-1];
        next.splice(index,0,{id:crypto.randomUUID(),type:'synced-reference',sourcePageId:match[1],sourceBlockId:hash[1],layoutParentId:previous?.type==='column'?previous.id:previous?.layoutParentId});
        await editor.structure(next);editor.receive(await contentApi.document(document.page.id));
      }}><label>Source block link<input type="url" name="source" required autoFocus/></label><p>Each reader needs access to the source. Editing a copy requires edit access to its source.</p></ActionDialog>:null}
      {fileInsert?<ConnectedFilePicker onClose={()=>setFileInsert(null)} onPick={reference=>{
        const next=[...visibleBlocks],index=fileInsert.after?next.findIndex(block=>block.id===fileInsert.after)+1:next.length;
        const block:EditorBlock={id:crypto.randomUUID(),type:'file-card',...reference};next.splice(index,0,block);insertion.insert(next);setFileInsert(null);
      }}/>:null}
      {statusInsert?<StatusLabelDialog onClose={()=>setStatusInsert(null)} onSave={(text,colour)=>{
        if(statusInsert.onInlineInsert){setStatusInsert(null);statusInsert.onInlineInsert({text,status:{colour}});return;}
        const result=insertStatusLabel(visibleBlocks,statusInsert.after,statusInsert.range,{text,status:{colour}});
        conversionFocus.current={id:result.blockId,selection:result.selection};setStatusInsert(null);insertion.insert(result.blocks);
      }}/>:null}
      {editedQuery?.type==='content-query'?<ContentQueryDialog block={editedQuery} onClose={()=>setQueryEditor(null)} onSave={async definition=>{await editor.structure(editor.blocks.map(block=>block.id===editedQuery.id?{...editedQuery,definition,results:[],lastRanLabel:"Not run yet"}:block));}}/>:null}
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
      {editor.structureConflict ? <section aria-label="Unsaved structure change">
        <p role="alert">The saved page changed. Your structure choices are kept below; nothing was overwritten.</p>
        <details open><summary>Your pending blocks in order</summary><ol>{editor.structureConflict.map(block => <li key={block.id} data-pending-block-id={block.id} data-pending-indent={block.indent ?? 0}>
          {block.indent ? <p>Nested {block.indent} level{block.indent === 1 ? "" : "s"}</p> : null}
          <BlockView block={block} canEdit={false} onChange={() => {}}/>
        </li>)}</ol></details>
        <button type="button" onClick={() => void editor.reloadStructure().then(() => setError(undefined)).catch(setError)}>Reload saved blocks</button>
      </section> : null}
      {insertion.conflicts.length ? <section aria-label="Recovered block conflict">
        <p role="alert">Recovered blocks conflict with saved changes. The page shows the saved content. Copy any recovered content you need before using the saved blocks.</p>
        <details><summary>Your recovered blocks</summary>{insertion.conflicts.map(block => <BlockView key={block.id} block={block} canEdit={false} onChange={() => {}}/>)}</details>
        <button onClick={insertion.discard}>Use saved blocks</button>
      </section> : insertion.error ? <p role="alert">{insertion.error} <button onClick={() => void insertion.retry()}>Try saving inserted blocks again</button></p> : null}
      {document.permissions.canEdit && !insertion.conflicts.length && !editor.structureConflict && titleState!=="failed" && !Object.values(editor.saveState).some(state=>["saving","failed","offline","unsaved","conflict"].includes(state.status)) ? <p className="editor-save-status" role="status" suppressHydrationWarning>{insertion.error ? "Unsaved inserted blocks" : insertion.pending || editor.hasUnsavedChanges || titleState==="saving" ? "Saving…" : "Saved"}</p> : null}
      <BlockEditor
        emptyBlockId={!editor.blocks.length ? visibleBlocks[0]?.id : undefined}
        blocks={liveQueries.blocks.map(block=>{
          const mentions=(document as DocumentView&{mentions?:Record<string,{label:string;available:boolean;state:string}>}).mentions;
          const hydrate=(value:unknown):unknown=>Array.isArray(value)?value.map(hydrate):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='mention'&&item&&typeof item==='object'&&'id'in item&&mentions?.[String(item.id)]?{...item,...mentions[String(item.id)]}:hydrate(item)])):value;
          return hydrate(block) as EditorBlock;
        })}
        canEdit={document.permissions.canEdit && !insertion.conflicts.length && (insertion.pending || editor.structureState!=="saving")}
        saveState={editor.saveState}
        selectedBlockIds={selected}
        onSelectionChange={setSelected}
        actions={{
          layoutBusy: insertion.pending || editor.structureState === "saving",
          onMakeSynced:id=>{void apply(editor.blocks.map(b=>b.id===id&&b.type==='paragraph'?{...b,type:'synced-source' as const}:b));},
          onSyncedSaved:async()=>{editor.receive(await contentApi.document(document.page.id));},
          onConvertTable: id=>{void (async()=>{await editor.flush();const fresh=await contentApi.document(document.page.id);const converted=await mutate<{value:{databaseId:string}}>('/api/databases/from-table',{operationKey:operationKey(),pageId:document.page.id,blockId:id,expectedRevisionId:fresh.page.revisionId});window.location.assign(`/app/databases/${converted.value.databaseId}`);})().catch(setError);},
          onChooseFile: (id) => setMedia({ id, mode: "upload" }),
          onAddFileLink: (id) => setMedia({ id, mode: "link" }),
          onDownloadFile: (id) => {
            const block = editor.blocks.find((item) => item.id === id);
            if (block?.type === "media" && block.source)
              window.open(block.source.url, "_blank", "noopener");
          },
          onCopyCode: (id) => {
            const block = editor.blocks.find((item) => item.id === id);
            if (block?.type === "code")
              void navigator.clipboard.writeText(block.code).catch(setError);
          },
          onEditQueryDefinition: id=>setQueryEditor(id),
          onRerunQuery: liveQueries.rerun,
          onOpenQueryResult: (id) => window.location.assign(`/app/pages/${id}`),
        }}
        onChange={(id,rendered)=>{
          const clean=(value:unknown):unknown=>Array.isArray(value)?value.map(clean):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==="mention"&&item&&typeof item==="object"?Object.fromEntries(Object.entries(item).filter(([field])=>field!=="state"&&field!=="available"&&field!=="deletedAt")):clean(item)])):value;
          const next=clean(rendered) as EditorBlock;
          if(next.type==="columns"){
            const columns=editor.blocks.filter(block=>block.layoutParentId===id && block.type==="column");
            const removed=new Set(columns.slice(next.count).map(block=>block.id));
            const kept=columns.slice(0,next.count);
            const last=kept.at(-1)!;
            const changed=editor.blocks.filter(block=>!removed.has(block.id)).map(block=>block.id===id?next:removed.has(block.layoutParentId??"")?{...block,layoutParentId:last.id}:block);
            const added=Array.from({length:Math.max(0,next.count-columns.length)},()=>({id:crypto.randomUUID(),type:"column" as const,layoutParentId:id}));
            changed.push(...added);
            void apply(changed);return;
          }
          const conversion=typedBlock(next);
          if(conversion){
            const removed=next.type==='paragraph' ? richTextToPlain(next.text).length-('text' in conversion ? richTextToPlain(conversion.text).length : 0) : 0;
            undoConversion.current={block:next,removed};
            changeKind(conversion,removed);
          }else{undoConversion.current=null;insertion.change(id,next);}
        }}
        onInsert={(after, anchor) => setInsert({ after, anchor })}
        onDelete={(id) =>
          void apply(editor.blocks.filter((block) => block.id !== id && block.layoutParentId !== id && !editor.blocks.some(parent=>parent.id===block.layoutParentId && parent.layoutParentId===id)))
        }
        onMove={move}
        onDuplicate={(id) => {
          const at = editor.blocks.findIndex((block) => block.id === id);
          const next = [...editor.blocks];
          const source=editor.blocks[at];
          const children=source.type==="columns"?editor.blocks.filter(block=>block.layoutParentId===id || editor.blocks.some(parent=>parent.id===block.layoutParentId && parent.layoutParentId===id)):[];
          const ids=new Map([source,...children].map(block=>[block.id,crypto.randomUUID()]));
          next.splice(at+1,0,...[source,...children].map(block=>{
            const base={id:ids.get(block.id)!,indent:block.indent,layoutParentId:ids.get(block.layoutParentId??"")??block.layoutParentId};
            if(block.type==='synced-source')return {...base,type:'paragraph' as const,text:[...block.text,{text:`\nSource: ${document.page.title}`}]};
            if(block.type==='synced-reference')return {...base,type:'paragraph' as const,text:block.synced?.state==='ready'?[...(block.synced.text as import('../../../editor/ui/types').RichText),{text:`\nSource: ${block.synced.sourceTitle}`}]:[{text:'Access needed'}]};
            return {...structuredClone(block),...base};
          }));
          void apply(next);
        }}
        onRetrySave={(id) => {
          const block=[...(wrapper.current?.querySelectorAll<HTMLElement>('[data-block-id]')??[])].find(element=>element.dataset.blockId===id);
          block?.querySelector<HTMLElement>('[data-slate-editable]')?.focus();
          void editor.retry(id);
        }}
        onResolveConflict={(id, choice) => {
          if (choice !== "compare") setError(undefined);
          if (choice === "compare") void compare(id);
          else void editor.resolve(id, choice === "overwrite").catch(setError);
        }}
        placeholder="Write something, or press / for blocks"
      />
      <div className="page-footer">
        {document.permissions.canEdit && !insertion.conflicts.length ? <div className="editor-actions"><button type="button" onClick={(event) => setInsert({ after: null, anchor: event.currentTarget })}>＋ Add block</button></div> : null}
        {footer}
      </div>
      {media && editor.blocks.some((block) => block.id === media.id) ? (
        <EditorMediaDialog
          pageId={document.page.id}
          block={editor.blocks.find((block) => block.id === media.id)!}
          mode={media.mode}
          onChange={(block) => editor.change(block.id, block)}
          onClose={() => setMedia(undefined)}
        />
      ) : null}
      {conflict ? (
        <ActionDialog
          title="Resolve this block’s changes"
          action="Keep my version"
          onClose={() => setConflict(null)}
          onSubmit={async () => {
            await editor.resolve(conflict.id, true);
          }}
        >
          <p>
            Keeping your version replaces the currently saved block. Both page
            revisions remain in history.
          </p>
          <div className="conflict-columns">
            <section>
              <h3>Your unsaved text</h3>
              {editor.blocks
                .filter((block) => block.id === conflict.id)
                .map((block) => (
                  <BlockView
                    key={block.id}
                    block={block}
                    canEdit={false}
                    onChange={() => {}}
                  />
                ))}
            </section>
            <section>
              <h3>Saved block</h3>
              <BlockView
                block={conflict.saved}
                canEdit={false}
                onChange={() => {}}
              />
            </section>
          </div>
          <button
            type="button"
            onClick={() => {
              void editor
                .resolve(conflict.id, false)
                .then(() => setConflict(null))
                .catch(setError);
            }}
          >
            Discard my changes and load saved block
          </button>
        </ActionDialog>
      ) : null}
    </div></DocumentHeadings></TaskPageProvider>
  );
}
