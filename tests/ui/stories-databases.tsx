import type { Story } from './stories';
import { Button, DeniedState, EmptyState, ErrorState, LoadingState } from '../../src/core/ui';
import { TableView } from '../../src/core/features/databases/ui/views/TableView';
import { BoardView } from '../../src/core/features/databases/ui/views/BoardView';
import { ListView } from '../../src/core/features/databases/ui/views/ListView';
import { GalleryView } from '../../src/core/features/databases/ui/views/GalleryView';
import { CalendarView } from '../../src/core/features/databases/ui/views/CalendarView';
import { TimelineView } from '../../src/core/features/databases/ui/views/TimelineView';
import type { DatabaseField, DatabaseRecord, DatabaseLayout } from '../../src/core/features/databases/ui/types';
import type { SurfaceState } from '../../src/core/ui';
const action = () => { document.documentElement.dataset.lastAction = 'database-action'; };
const fields: DatabaseField[] = [
  { id: 'status', name: 'Status', type: 'status', editable: true, options: [{ id: 'ready', label: 'Ready', colour: 'green' }, { id: 'review', label: 'In review', colour: 'yellow' }] },
  { id: 'owner', name: 'Owner', type: 'person', editable: true },
  { id: 'reviewDate', name: 'Review date', type: 'date', editable: true },
];
const records: DatabaseRecord[] = [
  { id: 'record-1', title: 'Escalation guide', icon: { kind: 'emoji', emoji: '📘' }, hasBody: true, values: { status: { kind: 'options', optionIds: ['ready'] }, owner: { kind: 'people', people: [{ id: 'ada', name: 'Ada Chen' }] }, reviewDate: { kind: 'date', display: '12 September 2026' } } },
  { id: 'record-2', title: 'New colleague checklist', icon: { kind: 'emoji', emoji: '✅' }, hasBody: true, values: { status: { kind: 'options', optionIds: ['review'] }, owner: { kind: 'people', people: [{ id: 'sam', name: 'Sam Patel' }] }, reviewDate: { kind: 'date', display: '18 September 2026' } } },
];
const layouts: DatabaseLayout[] = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'];
const recordLink = (id: string) => ({ href: `#${id}`, 'data-record-id': id, onClick: (event: { preventDefault: () => void }) => { event.preventDefault(); action(); } });
const shared = { fields, records, showRecordIcon: true, canEditRecords: true, recordLink, onValueChange: action, onEditValue: action, onOpenLink: action, onNewRecord: action };
function Layout({ layout }: { layout: DatabaseLayout }) {
  if (layout === 'table') return <TableView {...shared} titleColumnLabel="Document" calculations={{}} onCalculationChange={action} />;
  if (layout === 'list') return <ListView {...shared} />;
  if (layout === 'gallery') return <GalleryView {...shared} />;
  if (layout === 'board') return <BoardView groups={[{ id: 'ready', label: 'Ready', colour: 'green', count: 1, records: [records[0]] }, { id: 'review', label: 'In review', colour: 'yellow', count: 1, records: [records[1]] }, { id: 'draft', label: 'Draft', colour: 'neutral', count: 0, records: [] }]} groupFieldName="Status" cardFields={fields.slice(1)} showRecordIcon canEditRecords canMoveBetweenGroups hideEmptyGroups={false} onHideEmptyGroupsChange={action} recordLink={recordLink} onMoveRecord={action} onOpenLink={action} onNewRecordInGroup={action} />;
  if (layout === 'calendar') return <CalendarView monthLabel="September 2026" weekdayLabels={['Mon','Tue','Wed','Thu','Fri','Sat','Sun']} days={Array.from({ length: 35 }, (_, index) => ({ id: `day-${index}`, label: String(index === 0 ? 31 : index <= 30 ? index : index - 30), inCurrentMonth: index > 0 && index <= 30, isToday: index === 12, records: index === 12 ? [records[0]] : index === 18 ? [records[1]] : [] }))} dateFieldName="Review date" showRecordIcon recordLink={recordLink} onPreviousMonth={action} onNextMonth={action} onToday={action} />;
  return <TimelineView bars={records.map((record, index) => ({ record, startPercent: 15 + index * 25, widthPercent: 30, rangeLabel: index ? '18–25 Sep' : '12–19 Sep' }))} columnLabels={['7 Sep','14 Sep','21 Sep','28 Sep']} dateFieldName="Review date" showRecordIcon recordLink={recordLink} />;
}
function DatabaseStory({ layout = 'table', state = 'ready' }: { layout?: DatabaseLayout; state?: SurfaceState }) {
  // Only test scaffolding surrounds the live layouts and shared state components.
  return <section className="flex min-w-0 flex-col gap-4 p-4 sm:p-8"><h1 className="text-h1 font-semibold">Knowledge register</h1>
    {state === 'ready' ? <Layout layout={layout} /> : null}
    {state === 'denied' ? <DeniedState onRequestAccess={action} /> : null}
    {state === 'loading' ? <LoadingState rows={6} /> : null}
    {state === 'error' ? <ErrorState title="This database could not be loaded" detail="No record is shown rather than a partial list." onRetry={action} /> : null}
    {state === 'empty' ? <EmptyState title="No records yet" description="Records added here appear in every view of this database." action={<Button onClick={action}>New record</Button>} /> : null}
  </section>;
}
export const databaseStories: Story[] = [
  ...layouts.map(layout => ({ id: `database-${layout}`, title: `Database · ${layout}`, clauses: ['DB-001','DB-003','DB-004'], render: () => <DatabaseStory layout={layout} /> })),
  ...(['empty','denied','loading','error'] as SurfaceState[]).map(state => ({ id: `database-${state}`, title: `Database · ${state}`, clauses: ['DB-001','DB-012'], render: () => <DatabaseStory state={state} /> })),
];
