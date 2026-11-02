import {pageReference} from '../../shared/page-reference';
/**
 * LINK-004: a page mention stores the target's title as it was when written. Every
 * door that hands content to a reader replaces that text with the label this
 * reader may see, so stored titles never leave the server.
 */
export function labelPageMentions<T>(value:T,label:(id:string)=>string,origin?:string):T {
    if(Array.isArray(value))return value.map(item=>labelPageMentions(item,label,origin)) as T;
    if(!value||typeof value!=='object')return value;
    const record=value as Record<string,any>;
    if(record.mention?.kind==='page'&&typeof record.mention.id==='string'){const text=label(record.mention.id);return {...record,text,mention:{...record.mention,label:text}} as T;}
    const link=pageReference(record.link?.href??record.url??'',origin);
    if(link) {
        const text=label(link.id);
        // Exact citations retain their chosen caption only while the target is readable.
        const caption=link.revision!==null&&text!==''&&!['Restricted page','Unavailable page','Deleted page'].includes(text)?record.text:text;
        if(record.link)return {...record,text:caption} as T;
        // Stored preview metadata never supplies a native reference's title, icon or snippet.
        const {preview:_preview,previewMessage:_message,...rest}=record;
        return rest as T;
    }
    return Object.fromEntries(Object.entries(record).map(([key,item])=>[key,labelPageMentions(item,label,origin)])) as T;
}
