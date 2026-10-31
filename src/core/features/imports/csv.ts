import { ImportError } from "./errors";
import type { ImportedBlock, ImportedField } from "./types";

/** The same strict CSV grammar accepts incremental decoded windows. Each
 * completed row can be consumed immediately, without retaining a whole table
 * string or an intermediate array of all cell arrays. */
export function* parseCsvRows(chunks:Iterable<string>):Generator<string[]> {
  let row:string[]=[],parts:string[]=[];
  let state:'unquoted'|'quoted'|'afterQuote'='unquoted',skipLf=false;
  const append=(text:string,start:number,end:number)=>{if(end>start)parts.push(text.slice(start,end));};
  const finish=()=>{row.push(parts.length===1?parts[0]!:parts.join(''));parts=[];state='unquoted';};
  for(const text of chunks){
    let start=0;
    for(let index=0;index<text.length;index++){
      const char=text[index]!;
      if(skipLf){skipLf=false;if(char==='\n'){start=index+1;continue;}}
      if(state==='quoted'){
        if(char==='"'){append(text,start,index);state='afterQuote';start=index+1;}
        continue;
      }
      if(state==='afterQuote'){
        if(char==='"'){parts.push('"');state='quoted';start=index+1;continue;}
        if(char!==','&&char!=='\n'&&char!=='\r')throw new ImportError('IMPORT_FORMAT_INVALID','A CSV quoted field has unexpected trailing content.');
      }else if(char==='"'){
        if(index!==start||parts.length)throw new ImportError('IMPORT_FORMAT_INVALID','A CSV quote must begin a field.');
        state='quoted';start=index+1;continue;
      }
      if(char===','||char==='\n'||char==='\r'){
        if(state!=='afterQuote')append(text,start,index);
        finish();start=index+1;
        if(char!==','){
          if(row.some(cell=>cell.length>0))yield row;
          row=[];skipLf=char==='\r';
        }
      }
    }
    if(state!=='afterQuote')append(text,start,text.length);
  }
  if(state==='quoted')throw new ImportError('IMPORT_FORMAT_INVALID','A CSV field is not terminated.');
  if(parts.length||row.length||(state as string)==='afterQuote')finish();
  if(row.some(cell=>cell.length>0))yield row;
}
export function parseCsv(text: string): string[][] { return [...parseCsvRows([text])]; }

export function validateCsvTable(rows: string[][]): { header: string[]; records: string[][] } {
  const [header, ...records] = rows;
  if (!header?.length || header.some((column) => !column.trim())) throw new ImportError("IMPORT_FORMAT_INVALID", "A CSV table needs non-empty column names.");
  if (new Set(header).size !== header.length) throw new ImportError("IMPORT_FORMAT_INVALID", "A CSV table has duplicate column names.");
  if (records.some((record) => record.length !== header.length)) throw new ImportError("IMPORT_FORMAT_INVALID", "A CSV row has a different number of fields than its header.");
  return { header, records };
}

function inferFieldType(values: string[]): string {
  const present = values.filter(Boolean);
  if (!present.length) return "text";
  if (present.every((value) => /^(true|false)$/i.test(value))) return "checkbox";
  if (present.every((value) => /^-?(?:\d+|\d*\.\d+)$/.test(value) && !/^-?0\d/.test(value) && Number.isFinite(Number(value)) && (!/^-?\d+$/.test(value) || Number.isSafeInteger(Number(value))))) return "number";
  if (present.every((value) => /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(value))) return "date";
  return "text";
}

export function inferCsvFields(header: string[], records: string[][], sourceId: string): ImportedField[] {
  return header.map((name, index) => ({
    sourceId: `${sourceId}:field:${index}`,
    sourceIdentityKind: "path-derived",
    name,
    type: inferFieldType(records.map((record) => record[index] ?? "")),
  }));
}

export function csvTableBlock(rows: string[][], sourceId: string): ImportedBlock {
  return {
    sourceId: `${sourceId}#table`,
    sourceIdentityKind: "path-derived",
    kind: "table",
    rows,
    links: [],
    children: [],
  };
}
