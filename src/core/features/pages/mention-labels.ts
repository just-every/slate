import {pageReference} from '../../shared/page-reference';
type ReferenceLabel = string | {label:string;state:string;available:boolean};
/** Stored reference claims are replaced with the current reader's projection. */
export function labelPageMentions<T>(value:T,label:(id:string)=>ReferenceLabel,origin?:string):T {
    if(Array.isArray(value))return value.map(item=>labelPageMentions(item,label,origin)) as T;
    if(!value||typeof value!=='object')return value;
    const record=value as Record<string,any>;
    const projection=(id:string)=>{const resolved=label(id);return typeof resolved==='string'?{label:resolved}:resolved;};
    if(record.mention?.kind==='page'&&typeof record.mention.id==='string'){
        const shown=projection(record.mention.id);
        return {...record,text:shown.label,mention:{...record.mention,...shown}} as T;
    }
    // Shared indexes and snapshots with no origin retain no page-shaped caption.
    const target=pageReference(record.link?.href??record.url??'',origin,!origin);
    if(target) {
        const shown=projection(target.id);
        if(record.link) {
            // Revision captions remain exact while current authority permits disclosure.
            const readable='state' in shown?!['restricted','unavailable','deleted'].includes(shown.state):shown.label!==''&&!['Restricted page','Unavailable page','Deleted page'].includes(shown.label);
            const text=target.revision!==null&&readable?record.text:shown.label;
            const {state:_state,available:_available,...link}=record.link;
            return {...record,text,link:{...link,...('state' in shown?{state:shown.state,available:shown.available}:{})}} as T;
        }
        // Native card metadata comes only from its current-authority endpoint.
        const {preview:_preview,previewMessage:_message,...rest}=record;
        return {...rest,preview:{title:shown.label}} as T;
    }
    return Object.fromEntries(Object.entries(record).map(([key,item])=>[key,labelPageMentions(item,label,origin)])) as T;
}
