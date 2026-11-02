import {StatusLabelDialog} from './StatusLabelDialog';
import {typedInline} from "../typedFormatting";
import {MentionPicker,type MentionPickerHandle} from "./MentionPicker";
import {useTaskPage} from './TaskPageContext';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type FormEvent,
} from "react";
import { EditableToolbar } from "./EditableToolbar";
import { cn } from "../../../../ui";
import type { EditableProps } from "./Editable";
import {richTextToPlain, type RichText} from '../types';
import {sliceRichText} from '../sliceRichText';
import { readRichText } from "./readRichText";
import {
  readEditableSelection,
  restoreEditableSelection,
  type EditableSelection,
} from "./editableSelection";
import { insertEditableLineBreak } from "./insertEditableLineBreak";

/** Own the browser-mutated subtree as one escaped markup boundary. */
export function EditableElement({
  value,
  html,
  placeholder,
  canEdit,
  onChange,
  label,
  className,
  multiline = true,
  inlineLabels = true,
  mentionPageId,
  previousMentions,
  as,
}: EditableProps & { html: string }) {
  // A fresh object on an unrelated render would reset an in-progress IME edit.
  const markup = useMemo(() => ({ __html: html }), [html]);
  const root = useRef<HTMLElement>(null);
  const taskPage=useTaskPage();
  const [mention,setMention] = useState<{start:number;before:RichText;after:RichText;query:string;anchor:{left:number;bottom:number}}|null>(null);
  const mentionPicker=useRef<MentionPickerHandle>(null);
  function caretAnchor(element:HTMLElement){
    const selected=window.getSelection(),range=selected?.rangeCount?selected.getRangeAt(0).cloneRange():null;range?.collapse(false);
    let rect=range?.getClientRects()[0]??element.getBoundingClientRect();
    if(rect.bottom>window.innerHeight-100){element.scrollIntoView({block:"center"});rect=range?.getClientRects()[0]??element.getBoundingClientRect();}
    return {left:rect.left,bottom:rect.bottom};
  }
  const [statusIndex,setStatusIndex]=useState<number|null>(null);
  function editStatus(target:HTMLElement) {
    const element=target.closest<HTMLElement>('[data-slate-status]');
    if(!canEdit || !element || !root.current?.contains(element))return false;
    const index=Number(element.dataset.inlineSpan);
    if(!value[index]?.status)return false;
    setStatusIndex(index);return true;
  }
  const inlineUndo = useRef<typeof value | null>(null);
  const pendingFocus = useRef(false);
  const pendingSelection = useRef<EditableSelection | null>(null);
  const publish = (element: HTMLElement) => {
    pendingSelection.current = readEditableSelection(element);
    const next = readRichText(element, value);
    if(mention){
      const caret=pendingSelection.current?.focus,plain=richTextToPlain(next);
      if(caret===undefined || caret<mention.start+1 || plain[mention.start]!=="@" || plain.slice(mention.start+1,caret).includes("\n"))setMention(null);
      else setMention({...mention,query:plain.slice(mention.start+1,caret),before:sliceRichText(next,0,mention.start),after:sliceRichText(next,caret),anchor:caretAnchor(element)});
    }
    const formatted = typedInline(next);
    inlineUndo.current = formatted ? next : null;
    if(formatted) pendingSelection.current = {anchor: formatted.map(s=>s.text).join("").length,focus:formatted.map(s=>s.text).join("").length};
    onChange(formatted ?? next);
  };
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (mention && (!canEdit || value.length === 0)) setMention(null);
    if(pendingFocus.current){pendingFocus.current=false;element.focus();}
    if (pendingSelection.current)
      restoreEditableSelection(element, pendingSelection.current);
    pendingSelection.current = null;
    const beforeInput = (event: InputEvent) => {
      if (
        !canEdit ||
        event.isComposing ||
        !["insertParagraph", "insertLineBreak"].includes(event.inputType)
      )
        return;
      event.preventDefault();
      if (event.inputType === "insertParagraph" && element.closest('[data-page-editor]')) {
        const selection = readEditableSelection(element);
        if (selection && !element.dispatchEvent(new CustomEvent('slate-split-block', {bubbles: true, cancelable: true, detail: selection}))) return;
      }
      if (!multiline && !element.closest('[data-page-editor]')) return;
      insertEditableLineBreak(element);
      publish(element);
    };
    element.addEventListener("beforeinput", beforeInput);
    return () => element.removeEventListener("beforeinput", beforeInput);
  });
  // The server-rendered editable accepts typing before React attaches. Words typed
  // then are in the DOM but not in state, so they would never be saved.
  useLayoutEffect(() => {
    const element = root.current;
    if (element && canEdit && richTextToPlain(readRichText(element, value)) !== richTextToPlain(value)) publish(element);
  }, []);
  const Tag = (as ?? "div") as ElementType;
  return (
    <>
      <EditableToolbar
        root={root}
        value={value}
        onChange={onChange}
        canEdit={canEdit}
      />
      {mention && canEdit && root.current ? <MentionPicker ref={mentionPicker} query={mention.query} anchor={mention.anchor} host={root.current.closest<HTMLElement>('dialog[open]')??root.current.closest<HTMLElement>('.slate-app')??root.current.parentElement!} pageId={mentionPageId??taskPage?.pageId} value={value} previous={previousMentions??[mention.before,mention.after]} onClose={()=>setMention(null)} onSelect={span=>{
        pendingSelection.current={anchor:mention.start+span.text.length,focus:mention.start+span.text.length};pendingFocus.current=true;
        onChange([...mention.before,span,...mention.after]);setMention(null);
      }}/> : null}
      {statusIndex!==null && value[statusIndex]?.status?<StatusLabelDialog text={value[statusIndex].text} colour={value[statusIndex].status.colour} onClose={()=>setStatusIndex(null)} onSave={(text,colour)=>{
        const next=value.map((span,index)=>index===statusIndex?{...span,text,status:{colour}}:span);
        const offset=next.slice(0,statusIndex+1).reduce((sum,span)=>sum+span.text.length,0);
        pendingSelection.current={anchor:offset,focus:offset};pendingFocus.current=true;setStatusIndex(null);onChange(next);
      }}/>:null}
      <Tag
        ref={root}
        aria-label={label}
        aria-multiline={multiline}
        aria-readonly={canEdit ? undefined : true}
        className={cn(
          "min-h-[1.5em] w-full rounded-control break-words whitespace-pre-wrap outline-none",
          className,
        )}
        contentEditable={canEdit}
        dangerouslySetInnerHTML={markup}
        data-placeholder={placeholder}
        data-slate-editable=""
        onClick={(event:React.MouseEvent<HTMLElement>)=>{if(editStatus(event.target as HTMLElement))event.preventDefault();}}
        onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
          if(!canEdit || event.nativeEvent.isComposing) return;
          if(mention && mentionPicker.current?.keyDown(event.key)){event.preventDefault();event.stopPropagation();return;}
          if((event.key==='Enter'||event.key===' ') && editStatus(event.target as HTMLElement)){event.preventDefault();return;}
          if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&inlineUndo.current){event.preventDefault();onChange(inlineUndo.current);inlineUndo.current=null;return;}
          if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&(event.key==='@' || (event.key==='/'&&event.currentTarget.closest('[data-page-editor]')&&!event.currentTarget.closest('[data-task-item]')))){
            const selected=readEditableSelection(event.currentTarget);if(!selected)return;
            event.preventDefault();
            if(event.key==='@'){
              const start=Math.min(selected.anchor,selected.focus),end=Math.max(selected.anchor,selected.focus);
              const before=sliceRichText(value,0,start),after=sliceRichText(value,end);
              onChange([...before,{text:'@'},...after]);
              pendingSelection.current={anchor:start+1,focus:start+1};
              setMention({start,before,after,query:'',anchor:caretAnchor(event.currentTarget)});
            }
            else event.currentTarget.dispatchEvent(new CustomEvent('slate-insert-at-cursor',{bubbles:true,detail:{...selected,inlineLabels,onInlineInsert:inlineLabels?(span:RichText[number])=>{
              const start=Math.min(selected.anchor,selected.focus),end=Math.max(selected.anchor,selected.focus);
              pendingSelection.current={anchor:start+span.text.length+1,focus:start+span.text.length+1};pendingFocus.current=true;
              onChange([...sliceRichText(value,0,start),span,{text:' '},...sliceRichText(value,end)]);
            }:undefined}}));
          }
        }}
        onPaste={(event: React.ClipboardEvent<HTMLElement>) => {
          if (!canEdit || !inlineLabels || !event.currentTarget.closest('[data-page-editor]')) return;
          const url = event.clipboardData.getData('text/plain');
          // Leave ordinary text, multiline and rich clipboard pastes to the browser.
          if (!/^https?:\/\/\S+$/i.test(url)) return;
          try { const parsed = new URL(url); if (parsed.username || parsed.password) return; } catch { return; }
          const range = readEditableSelection(event.currentTarget);
          if (!range) return;
          const handled = !event.currentTarget.dispatchEvent(new CustomEvent('slate-paste-url', {
            bubbles: true, cancelable: true, detail: {url, range, text: readRichText(event.currentTarget, value)},
          }));
          if (handled) event.preventDefault();
        }}
        onInput={(event: FormEvent<HTMLElement>) => {
          if (!(event.nativeEvent as InputEvent).isComposing)
            publish(event.currentTarget);
        }}
        onCompositionEnd={(event: FormEvent<HTMLElement>) =>
          publish(event.currentTarget)
        }
        role="textbox"
        suppressContentEditableWarning
        tabIndex={0}
      />
    </>
  );
}
