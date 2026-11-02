/** A native page address; other origins keep their own link presentation. */
export function pageReference(value:string,origin?:string) {
  try {
    const relative=value.startsWith('/')&&!value.startsWith('//');
    if(!relative&&!origin)return null;
    const url=new URL(value,origin??'https://slate.invalid');
    if(!relative&&url.origin!==origin)return null;
    const match=/^\/app\/pages\/([^/]+)\/?$/.exec(url.pathname);
    return match?{id:decodeURIComponent(match[1]!),revision:url.searchParams.get('revision')}:null;
  }catch{return null;}
}
