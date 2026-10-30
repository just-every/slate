import * as PopoverPrimitive from "@radix-ui/react-popover";
import {CircleHelp, Search, X} from "lucide-react";
import type {RefObject} from "react";

/** The query language, folded into the field it serves: a quiet "?" opens it. */
function SearchTips() {
  return <PopoverPrimitive.Root>
    <PopoverPrimitive.Trigger type="button" className="search-field-action" aria-label="Search tips" data-tooltip="Search tips" data-tooltip-align="end"><CircleHelp aria-hidden="true"/></PopoverPrimitive.Trigger>
    <PopoverPrimitive.Content className="search-tips" aria-label="Search tips" align="end" sideOffset={10} collisionPadding={16}>
      <p>Use a quoted phrase or combine terms with AND, OR and a minus sign to exclude a term.</p>
      <p><code>label:launch AND verified:current</code></p>
      <p>Fields: title, label, in (space), by (contributor), owner, status, verified, before, after and type. Use a colon after the field, such as <code>title:"release checklist"</code>.</p>
      <p className="meta">Search only includes content you can currently read.</p>
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Root>;
}

/** One bordered field: the search icon, the query, its clear button and its tips, with focus shown on the field's border. */
export function SearchField({inputRef,value,disabled,onChange}:{inputRef:RefObject<HTMLInputElement|null>;value:string;disabled:boolean;onChange:(value:string)=>void}) {
  return <div className="search-field">
    <Search className="search-field-icon" aria-hidden="true"/>
    <input ref={inputRef} disabled={disabled} id="workspace-query" type="search" value={value} onChange={event=>onChange(event.target.value)} placeholder="Search pages, records and conversations…"/>
    {value?<button type="button" className="search-field-action" aria-label="Clear search" data-tooltip="Clear search" data-tooltip-align="end" onClick={()=>{onChange("");inputRef.current?.focus();}}><X aria-hidden="true"/></button>:null}
    <SearchTips/>
  </div>;
}
