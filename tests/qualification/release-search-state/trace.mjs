/** Read-only browser diagnostics: no event, response or product state is replaced. */
export async function traceSearch(context, directory) {
 const {appendFile} = await import('node:fs/promises');
 let writes = Promise.resolve();
 await context.exposeBinding('__recordSearchTrace', (_, event) => {
  writes = writes.then(() => appendFile(directory + '/search-trace.jsonl', JSON.stringify(event) + '\n'));
 });
 await context.addInitScript(() => {
  const read = () => {
   const input = document.querySelector('#workspace-query');
   const kind = document.querySelector('.filter-menu select');
   const props = input && Object.keys(input).find(key => key.startsWith('__reactProps$'));
   return {url:location.pathname + location.search, query:input?.value, kind:kind?.value,
    disabled:input?.disabled, react:!!props, reactQuery:props ? input[props].value : undefined};
  };
  const record = (type, extra={}) => window.__recordSearchTrace({time:performance.now(),type,...read(),...extra});
  for(const type of ['input','change','submit']) document.addEventListener(type,event=>{
   if(event.target.closest('.search-form,.filter-menu')) void record(type,{target:event.target.tagName});
  },true);
  let previous='';
  const sample=()=>{const value=JSON.stringify(read());if(value!==previous){previous=value;void record('state');}requestAnimationFrame(sample);};
  requestAnimationFrame(sample);
 });
 context.on('page', page => page.on('request', request => {
  const url=new URL(request.url());
  if(url.pathname==='/api/search') writes=writes.then(()=>appendFile(directory+'/search-trace.jsonl',JSON.stringify({type:'request',url:url.pathname+url.search})+'\n'));
 }));
 return async () => {await writes;};
}
