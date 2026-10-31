/** Reload is explicit: a refused property write keeps all current form choices. */
export function PagePropertyConflict() {
  return <p role="alert">This page changed while these choices were open. Your choices are kept here and nothing was overwritten. <button type="button" onClick={() => window.location.reload()}>Reload saved page</button></p>;
}
