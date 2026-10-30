import { useEffect, useState } from 'react';
import { ChevronDown, ListFilter } from 'lucide-react';
import { TopBar } from '../../../app/ui/header/TopBar';
import { PageTitle } from '../../../app/ui/header/PageTitle';
import { SectionLabel } from '../../../app/ui/SectionLabel';
import { FilterChips, type FilterChip } from '../../../app/ui/FilterMenu';
import { RequestState } from '../../../app/ui/RequestState';
import { useResource } from '../../../client/useResource';
import { recordDate } from '../../../client/recordDates';
import { useWorkspace } from '../../../app/ui/WorkspaceContext';
import { mutate, operationKey, errorMessage } from '../../../client/transport';
import { TaskRows } from './TaskRows';
import { useSettled } from '../../../app/ui/useSettled';
import { PersonalReminders } from './PersonalReminders';
import type { TaskItem, TaskList } from './taskTypes';

const states: Record<string, string> = { open: 'Open', completed: 'Completed', overdue: 'Overdue', '': 'All' };
const sorts: Record<string, string> = { due: 'Due date', page: 'Page', container: 'Space' };
const narrowWidth = '(max-width: 700px)';

/** The band opens at rest on wide screens and folds to its Filter control on phones until the member chooses. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(narrowWidth);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** My tasks (tasks-9): title, lede, the ownership switch, the sunk filter band, then the tasks and the reminders. */
export function MyTasks() {
  const {navigation}=useWorkspace();
  const [tab,setTab]=useState('assigned'),[state,setState]=useState('open'),[container,setContainer]=useState(''),[sort,setSort]=useState('due');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[cursor,setCursor]=useState<string>();
  const [pending,setPending]=useState<string|null>(null),[error,setError]=useState<unknown>();
  const narrow=useNarrow(),[bandChoice,setBandChoice]=useState<boolean|null>(null),bandOpen=bandChoice??!narrow;
  const query=new URLSearchParams({tab,state,sort});
  if(container)query.set('containerId',container);if(from)query.set('dueFrom',from);if(to)query.set('dueTo',to);if(cursor)query.set('cursor',cursor);
  const resource=useResource<TaskList>(`/api/tasks?${query}`);
  function change(set:(value:string)=>void,value:string){set(value);setCursor(undefined);}
  async function complete(task:TaskItem){setPending(task.blockId);setError(undefined);try{await mutate(`/api/tasks/${task.pageId}/${task.blockId}`,{operationKey:operationKey(),expectedRevisionId:task.blockRevisionId,done:!task.done},'PATCH');await resource.reload();}catch(cause){setError(cause);}finally{setPending(null);}}
  const spaceName=navigation.data?.containers.find(item=>item.id===container)?.name;
  const applied:FilterChip[]=[
    ...(state!=='open'?[{key:'state',label:`State: ${states[state]}`,remove:'Remove state filter',onRemove:()=>change(setState,'open')}]:[]),
    ...(container?[{key:'space',label:`In: ${spaceName??'unavailable'}`,remove:'Remove space filter',onRemove:()=>change(setContainer,'')}]:[]),
    ...(from?[{key:'from',label:`Due from ${recordDate(from)}`,remove:'Remove from date',onRemove:()=>change(setFrom,'')}]:[]),
    ...(to?[{key:'to',label:`Due through ${recordDate(to)}`,remove:'Remove through date',onRemove:()=>change(setTo,'')}]:[]),
    ...(sort!=='due'?[{key:'sort',label:`Sort: ${sorts[sort]}`,remove:'Remove sort',onRemove:()=>change(setSort,'due')}]:[]),
  ];
  const list=useSettled(resource.data),items=list?.items;
  return <><TopBar trail={[{label:'My tasks'}]}/><section className="main tasks-workspace"><PageTitle>My tasks</PageTitle><p className="page-lede">Follow through on the work in your pages.</p>
    <div className="tabs" role="tablist" aria-label="Task ownership">{[['assigned','Assigned to me'],['created','Created by me']].map(([value,label])=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>change(setTab,value)}>{label}</button>)}</div>
    <div className="filter-band" data-open={bandOpen} data-choice={bandChoice===null?'default':'set'}>
      <button type="button" className="band-toggle" aria-expanded={bandOpen} aria-controls="task-filters" aria-label="Filter tasks" data-tooltip="Filter tasks" onClick={()=>setBandChoice(!bandOpen)}><span className="band-tile"><ListFilter aria-hidden="true"/></span><span>Filter</span><ChevronDown aria-hidden="true"/></button>
      {bandOpen?null:<FilterChips items={applied}/>}
      <div className="band-fields task-filters" id="task-filters">
        <label>State<select value={state} onChange={event=>change(setState,event.target.value)}>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{value?label:'All tasks'}</option>)}</select></label>
        <label>Space<select value={container} onChange={event=>change(setContainer,event.target.value)}><option value="">Every space</option>{navigation.data?.containers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Due from<input type="date" value={from} onChange={event=>change(setFrom,event.target.value)}/></label><label>Due through<input type="date" value={to} onChange={event=>change(setTo,event.target.value)}/></label>
        <label>Sort<select value={sort} onChange={event=>change(setSort,event.target.value)}>{Object.entries(sorts).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      </div>
    </div>
    <SectionLabel count={items?`${items.length}${list?.nextCursor?'+':''}`:undefined}>{states[state]} tasks</SectionLabel>
    {error?<p role="alert">{errorMessage(error)}</p>:null}<RequestState loading={resource.loading&&!list} error={resource.error} retry={resource.reload}>
      {items?.length?<TaskRows items={items} pending={pending} onComplete={task=>void complete(task)}/>:<div className="list-empty"><p>No tasks in this view</p><p className="meta">Assign a to-do on a page, or change your filters.</p></div>}
      {cursor||list?.nextCursor?<div className="list-paging">{cursor?<button type="button" className="text-button" onClick={()=>setCursor(undefined)}>First page</button>:null}{list?.nextCursor?<button type="button" className="text-button" onClick={()=>setCursor(list.nextCursor)}>More tasks →</button>:null}</div>:null}
    </RequestState><PersonalReminders/>
  </section></>;
}
