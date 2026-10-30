import { ChevronRight } from 'lucide-react';
import { richTextToPlain } from '../../editor/ui/types';
import { IconLink } from '../../../app/ui/header/IconAction';
import { displayDate } from '../../../app/ui/displayDate';
import type { TaskItem } from './taskTypes';

/** My tasks' open rows: complete, the task, one meta line (page · space · due), and a chevron that opens it. */
export function TaskRows({items,pending,onComplete}:{items:TaskItem[];pending:string|null;onComplete:(task:TaskItem)=>void}) {
  const today=new Date();today.setHours(0,0,0,0);
  return <ul className="task-list task-rows row-list">{items.map(task=>{
    const text=richTextToPlain(task.text)||'Untitled task',href=`/app/pages/${task.pageId}#block-${task.blockId}`;
    const due=task.dueDate?new Date(`${task.dueDate}T00:00:00`):null,overdue=Boolean(due&&!task.done&&due<today);
    return <li key={`${task.pageId}:${task.blockId}`}>
      <input type="checkbox" aria-label={`Complete: ${text}`} checked={task.done} disabled={!task.canEdit||pending===task.blockId} onChange={()=>onComplete(task)}/>
      <div>
        <a className={task.done?'task-title task-completed':'task-title'} href={href}>{text}</a>
        <p className="meta"><a href={`/app/pages/${task.pageId}`}>{task.pageTitle}</a><span> · {task.containerName}</span>{due?<span> · <time dateTime={task.dueDate!} className={overdue?'task-overdue':undefined}>{overdue?'Overdue':'Due'} {displayDate(`${task.dueDate}T12:00:00`)}</time></span>:null}</p>
      </div>
      <IconLink className="row-open" label="Open task" tooltipAlign="end" href={href}><ChevronRight aria-hidden="true"/></IconLink>
    </li>;
  })}</ul>;
}
