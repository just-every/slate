import { useState } from "react";
import { displayDate } from "../../../../app/ui/displayDate";
import { recordDate, recordDateTime } from "../../../../client/recordDates";
import { TableView } from "../views/TableView";
import { ListView } from "../views/ListView";
import { GalleryView } from "../views/GalleryView";
import { BoardView } from "../views/BoardView";
import { CalendarView } from "../views/CalendarView";
import { TimelineView } from "../views/TimelineView";
import type { RecordViewProps } from "../views/shared";
import type { ColumnCalculation, CalculationKind } from "../types";
import type {
  QueryDto,
  RecordDto,
  ViewDto,
  FieldDto,
} from "../../../../client/records";
export function RecordLayouts({
  view,
  canEditStructure,
  query,
  rawFields,
  rawRecords,
  props,
  onGroupMove,
  onHideEmpty,
  onCalculation,
  onConfigureRequiredField,
}: {
  view: ViewDto;
  canEditStructure: boolean;
  query: QueryDto;
  rawFields: FieldDto[];
  rawRecords: RecordDto[];
  props: RecordViewProps;
  onGroupMove: (recordId: string, value: unknown) => void;
  onHideEmpty: (hide: boolean) => void;
  onConfigureRequiredField:()=>void;
  onCalculation: (fieldId: string, kind: CalculationKind) => void;
}) {
  const [month, setMonth] = useState(() => new Date());
  if (view.layout === "list") return <ListView {...props} />;
  if (view.layout === "gallery") return <GalleryView {...props} />;
  if (view.layout === "board") {
    const fieldId = view.groups[0]?.field;
    const groupField = rawFields.find((field) => field.id === fieldId);
    const grouped = query.groups.find((group) => group.field === fieldId);
    if (!grouped)
      return (
        <section><p>Choose a grouping field in View settings to arrange this board.</p>{canEditStructure?<button onClick={onConfigureRequiredField}>Choose or create a grouping field</button>:null}</section>
      );
    return (
      <BoardView
        groups={grouped.groups.map((group, index) => ({
          id: String(index),
          label: group.value == null ? "No value"
            : groupField?.type === "date" ? recordDate(String(group.value))
            : groupField && ["created-at", "updated-at"].includes(groupField.type)
              ? displayDate(String(group.value), true) : String(group.value),
          colour: "neutral",
          count: group.count,
          records: props.records.filter((record) =>
            group.pageIds.includes(record.id),
          ),
        }))}
        groupFieldName={
          rawFields.find((field) => field.id === fieldId)?.name ?? "Group"
        }
        cardFields={props.fields}
        showRecordIcon={props.showRecordIcon}
        canEditRecords={props.canEditRecords}
        canEditStructure={canEditStructure}
        canMoveBetweenGroups={
          props.canEditRecords &&
          !!fieldId &&
          !rawFields.find((field) => field.id === fieldId)?.readOnly
        }
        hideEmptyGroups={view.groups[0]?.hideEmpty ?? false}
        onHideEmptyGroupsChange={onHideEmpty}
        onOpenRecord={props.onOpenRecord}
        onOpenLink={props.onOpenLink}
        onMoveRecord={(id, index) =>
          onGroupMove(id, grouped.groups[Number(index)].value)
        }
        onNewRecordInGroup={() => props.onNewRecord()}
      />
    );
  }
  if (view.layout === "calendar" || view.layout === "timeline") {
    const fieldId = String(view.display.dateField ?? "");
    const field = rawFields.find((field) => field.id === fieldId);
    if (!field)
      return (
        <section><p>Choose a date field in View settings to place records in time.</p>{canEditStructure?<button onClick={onConfigureRequiredField}>Choose or create a date field</button>:null}</section>
      );
    const dates = rawRecords.flatMap((record) => {
      const value = record.values[fieldId];
      const time = typeof value === "string" ? recordDateTime(value).getTime() : NaN;
      const shown = props.records.find((item) => item.id === record.pageId);
      return Number.isFinite(time) && shown ? [{ time, record: shown }] : [];
    });
    if (view.layout === "timeline") {
      const min = dates.length
          ? Math.min(...dates.map((item) => item.time))
          : Date.now(),
        max = dates.length ? Math.max(...dates.map((item) => item.time)) : min;
      const span = Math.max(86400000, max - min);
      return (
        <TimelineView
          bars={dates.map((item) => ({
            record: item.record,
            startPercent: ((item.time - min) / span) * 90,
            widthPercent: 2,
            rangeLabel: recordDate(new Date(item.time).toISOString()),
          }))}
          columnLabels={[
            recordDate(new Date(min).toISOString()),
            recordDate(new Date(min + span / 2).toISOString()),
            recordDate(new Date(min + span).toISOString()),
          ]}
          dateFieldName={field.name}
          showRecordIcon={props.showRecordIcon}
          onOpenRecord={props.onOpenRecord}
        />
      );
    }
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(start.getDate() - start.getDay());
    const key = (date: Date) =>
      `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const days = Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      return {
        id: key(day),
        label: String(day.getDate()),
        inCurrentMonth: day.getMonth() === month.getMonth(),
        isToday: key(day) === key(new Date()),
        records: dates
          .filter((item) => key(new Date(item.time)) === key(day))
          .map((item) => item.record),
      };
    });
    return (
      <CalendarView
        monthLabel={month.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        })}
        weekdayLabels={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}
        days={days}
        dateFieldName={field.name}
        showRecordIcon={props.showRecordIcon}
        onOpenRecord={props.onOpenRecord}
        onPreviousMonth={() =>
          setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
        }
        onNextMonth={() =>
          setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
        }
        onToday={() => setMonth(new Date())}
      />
    );
  }
  const names: Record<string, CalculationKind> = {
    min: "minimum",
    max: "maximum",
    avg: "average",
  };
  const calculations = Object.fromEntries(
    Object.entries(view.calculations).map(([id, kind]) => [
      id,
      {
        kind: names[kind] ?? (kind as CalculationKind),
        display:
          query.calculations[id] == null ? "—" : String(query.calculations[id]),
      },
    ]),
  ) as Record<string, ColumnCalculation>;
  return (
    <TableView
      {...props}
      canEditStructure={canEditStructure}
      calculations={calculations}
      titleColumnLabel="Name"
      onCalculationChange={onCalculation}
    />
  );
}
