/** A native page address; other origins keep their own link presentation. */
export function pageReference(value:string,origin?:string,unscoped=false) {
  try {
    const relative=value.startsWith('/')&&!value.startsWith('//');
    if(!relative&&!origin&&!unscoped)return null;
    const url=new URL(value,origin??'https://slate.invalid');
    if(!relative&&origin&&url.origin!==origin)return null;
    const match=/^\/app\/pages\/([^/]+)\/?$/.exec(url.pathname);
    return match?{id:decodeURIComponent(match[1]!),revision:url.searchParams.get('revision')}:null;
  }catch{return null;}
}
