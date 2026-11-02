import { zipSync, strToU8 } from 'fflate';

/** Synthetic supplemental source fixture; no genuine incumbent archive is modified.
 * Confluence CSV export format with an explicit space-wide content restriction.
 */
export function accessProfileArchive() {
  const files = {
    'exportDescriptor.properties': 'type=space\nsource=synthetic-slate-127\n',
    'spaces.csv': 'spaceid,spacename,spacekey,spacetype\n127,Supplemental access source,SYNTHETIC,global\n',
    'content.csv': 'contentid,contenttype,title,version,prevver,content_status,spaceid,parentid,child_position,lastmoddate\n128,PAGE,Supplemental container grant,1,,current,127,,0,2026-01-01 12:00:00\n',
    'bodycontent.csv': 'contentid,bodytype,body\n128,2,<p>Retain this bounded audience.</p>\n',
    'content_permissions.csv': 'content_id,permission_type,principal_type,principal_id\n128,VIEW,ACCESS_CLASS,everyone\n',
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])));
}
