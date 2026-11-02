import { Checkbox, cn } from "../../../../ui";
import { richTextToPlain, type BlockRenderProps, type TaskBlockData } from "../types";
import { Editable } from "./Editable";
import { useState } from 'react';
import { sliceRichText } from '../sliceRichText';
import { useTaskAssignment } from './TaskAssignment';
import { displayDate } from "../../../../app/ui/displayDate";
import { ReminderDialog } from './ReminderDialog';

/**
 * `BLOCK-007` — a checkable item in the body. Anyone with edit access may toggle
 * it, and the row shows who completed it and when.
 */
export function TaskBlock({ block, canEdit, onChange }: BlockRenderProps<TaskBlockData>) {
  const plain = richTextToPlain(block.text);
  const {page,assign,prompt,update}=useTaskAssignment(block,onChange);
  const [dateOpen,setDateOpen]=useState(false);
  const [remind,setRemind]=useState(false);
  const due=block.dueDate ? new Date(`${block.dueDate}T00:00:00`) : null;
  const today=new Date();today.setHours(0,0,0,0);
  const overdue=!block.done&&due&&due<today;
  const assignee=page?.people.find(person=>person.id===block.assigneeMemberId);
  const completedBy = page?.people.find(person => person.id === block.completedByMemberId);

  return (
    <div className="flex items-start gap-2 py-0.5" data-task-item data-task-overdue={overdue||undefined}>
      <Checkbox
        aria-label={plain.length > 0 ? `Mark complete: ${plain}` : "Mark this to-do complete"}
        checked={block.done}
        className="mt-1"
        disabled={!canEdit}
        onCheckedChange={(checked) => onChange({ ...block, done: checked === true })}
      />
      <div className="flex-1">
        <Editable
          canEdit={canEdit}
          className={cn("text-body leading-relaxed", block.done ? "text-ink-muted line-through" : "text-ink")}
          label="To-do item"
          onChange={(text) => {
            const value=richTextToPlain(text);
            if(value.endsWith('//')){update({text:sliceRichText(text,0,value.length-2)});setDateOpen(true);return;}
            const person=text.find(span=>span.mention?.kind==='person'&&!block.text.some(old=>old.mention?.kind==='person'&&old.mention.id===span.mention?.id));
            if(person?.mention?.id){assign(person.mention.id,text);return;}
            const date=text.find(span=>span.mention?.kind==='date'&&!block.text.some(old=>old.mention?.kind==='date'&&old.mention.id===span.mention?.id));
            update({ text, ...(date?.mention?.id?{dueDate:date.mention.id}:{}) });
          }}
          placeholder="To-do"
          value={block.text}
        />
        <div className="task-metadata">
          {canEdit&&page?<label><span className="sr-only">Task assignee</span><select aria-label="Task assignee" value={block.assigneeMemberId??''} onChange={event=>assign(event.target.value||null)}><option value="">Unassigned</option>{page.people.map(person=><option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>:assignee?<span>{assignee.displayName}</span>:null}
          {due?<time dateTime={block.dueDate!} className={overdue?'task-overdue':undefined}>{overdue?'Overdue · ':''}{due.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</time>:null}
          {canEdit?<button type="button" onClick={()=>setDateOpen(!dateOpen)}>{due?'Change due date':'Add due date'}</button>:null}
          {page?<button type="button" onClick={()=>setRemind(true)}>Remind me</button>:null}
        </div>
        {dateOpen&&canEdit?<label className="task-date-picker">Due date<input autoFocus aria-label="Task due date" type="date" value={block.dueDate??''} onChange={event=>{onChange({...block,dueDate:event.target.value||null});setDateOpen(false);}}/><button type="button" onClick={()=>{onChange({...block,dueDate:null});setDateOpen(false);}}>Clear date</button><button type="button" onClick={()=>setDateOpen(false)}>Close date picker</button></label>:null}
        {block.done && block.completedAt ? <p className="text-[13px] text-ink-muted" data-task-completion>
          Completed by {completedBy?.displayName ?? 'Former member'} · <time dateTime={block.completedAt}>{displayDate(block.completedAt, true)}</time>
        </p> : null}
        {prompt}
        {remind&&page?<ReminderDialog pageId={page.pageId} blockId={block.id} onClose={()=>setRemind(false)}/>:null}
      </div>
    </div>
  );
}
