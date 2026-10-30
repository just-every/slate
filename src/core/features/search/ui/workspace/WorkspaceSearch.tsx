import {SearchResults,type SearchResultView} from "./SearchResults";
import {TopBar} from "../../../../app/ui/header/TopBar";
import {PageTitle} from "../../../../app/ui/header/PageTitle";
import {FilterChips,FilterMenu} from "../../../../app/ui/FilterMenu";
import {RetainedSearchAnswer} from "./RetainedSearchAnswer";
import {useCreatePage} from "../../../../app/ui/useCreatePage";
import {useInferredSpace} from "../../../../app/ui/useInferredSpace";
import {DEFAULT_PAGE_TITLE,type SpaceChoice} from "../../../../app/ui/pageDestination";
import {SearchFilterFields,searchFilterChips,useSearchOptions,emptyRefinements,type Refinements,type SearchScope} from "./SearchRefinements";
import {SearchField} from "./SearchField";
import {SavedSearches} from "./SavedSearches";
import {SaveSearchDialog} from "./SaveSearchDialog";
import { useEffect, useRef, useState } from "react";
import {searchLocation,submittedSearch} from "./searchLocation";
import { useResource } from "../../../../client/useResource";
import { RequestState } from "../../../../app/ui/RequestState";
import { useSettled } from "../../../../app/ui/useSettled";
import {
  errorMessage,
} from "../../../../client/transport";
interface Results {
  items: SearchResultView[];
  total: number;
  nextCursor?: string;
  facets: { kind: Record<string, number> };
}
/**
 * Search (search-9): the title, the field row, one control row (Filter with every option and the saved searches in its
 * menu, applied filters as chips, the count) closed by the page rule, then the results.
 */
export function WorkspaceSearch() {
  const [initial]=useState(()=>searchLocation(""));
  const [ready,setReady]=useState(false);
  const queryInput=useRef<HTMLInputElement>(null);
  const [refinements,setRefinements]=useState(initial.refinements);
  const searchOptions=useSearchOptions();
  const [savedVersion,setSavedVersion]=useState(0);
  const [saving,setSaving]=useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const extra=new URLSearchParams(Object.entries(refinements).filter(([,value])=>value!==""&&value!==false).map(([key,value])=>[key,String(value)])).toString();
  const creation=useCreatePage();
  const spaces=useResource<{items:SpaceChoice[]}>("/api/containers");
  const destination=useInferredSpace(refinements.containerId||null,spaces);
  const [query, setQuery] = useState(initial.query);
  const [kind, setKind] = useState(initial.kind);
  const [archived, setArchived] = useState(initial.archived);
  const [cursor, setCursor] = useState<string>();
  const [submitted, setSubmitted] = useState<string|undefined>(initial.submitted);
  useEffect(()=>{
    const value=searchLocation(window.location.search);
    setQuery(value.query);setSubmitted(value.submitted);setKind(value.kind);
    setArchived(value.archived);setRefinements(value.refinements);
    // SSR controls must not accept edits before their handlers and URL state exist.
    setReady(true);
  },[]);
  useEffect(()=>{if(ready)queryInput.current?.focus();},[ready]);
  useEffect(()=>{if(submitted===undefined)return;const url=new URL(window.location.href);url.search=submittedSearch(submitted,kind,archived,refinements);window.history.replaceState(window.history.state,"",url);},[submitted,kind,archived,refinements]);
  const [error, setError] = useState<unknown>();
  const resource = useResource<Results>(
    submitted === undefined
      ? null
      : `/api/search?q=${encodeURIComponent(submitted)}&kind=${encodeURIComponent(kind)}&includeArchived=${archived}&${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const change=(next:Partial<SearchScope>&{value?:Refinements})=>{
    if(next.kind!==undefined)setKind(next.kind);
    if(next.archived!==undefined)setArchived(next.archived);
    if(next.value)setRefinements(next.value);
    setCursor(undefined);
  };
  const clearAll=()=>change({kind:"",archived:false,value:emptyRefinements});
  const chips=searchFilterChips({kind,archived,value:refinements},searchOptions,change);
  const filterDescription = [kind,archived?"Including archive":"",...Object.entries(refinements).filter(([,value])=>value!==""&&value!==false).map(([key,value])=>`${key}: ${value}`)].filter(Boolean).join(" · ") || "None";
  const results=useSettled(resource.data);
  return (
    <>
      <TopBar trail={[{ label: "Search" }]} />
      <section className="main search-workspace">
        <PageTitle>Search your workspace</PageTitle>
        <form
          className="search-form"
          aria-busy={!ready}
          onSubmit={(event) => {
            event.preventDefault();
            setCursor(undefined);
            setSubmitted(query);
          }}
        >
          <label className="sr-only" htmlFor="workspace-query">
            Search your workspace
          </label>
          <SearchField inputRef={queryInput} value={query} disabled={!ready} onChange={setQuery}/>
          <button className="primary-button" type="submit" disabled={!ready}>
            Search
          </button>
        </form>
        <div className={submitted===undefined?"control-row search-controls":"control-row search-controls page-rule"}>
          <FilterMenu open={filtersOpen} onOpenChange={setFiltersOpen} label="Filter results" disabled={!ready} foot={<>
            <div className="filter-menu-actions">
              {submitted!==undefined?<button type="button" className="secondary-button" onClick={()=>{setFiltersOpen(false);setSaving(true);}}>Save this search</button>:null}
              {chips.length?<button type="button" className="text-button" onClick={clearAll}>Clear filters</button>:null}
            </div>
            <SavedSearches version={savedVersion} onChoose={value=>{setQuery(value.query??"");setSubmitted(value.query??"");setKind(value.kind??"");setArchived(value.includeArchived??false);setRefinements({...emptyRefinements,...value});setCursor(undefined);setFiltersOpen(false);}}/>
          </>}>
            <SearchFilterFields scope={{kind,archived,value:refinements}} options={searchOptions} disabled={!ready} onChange={change}/>
          </FilterMenu>
          <FilterChips className="search-filter-summary" items={chips}/>
          {results?<p className="control-count meta" role="status">{results.total} result{results.total===1?"":"s"}</p>:null}
        </div>
        <RequestState
          loading={resource.loading && !results}
          error={resource.error}
          retry={resource.reload}
        >
          {results ? (
            <>
              {results.total>0 && submitted ? <RetainedSearchAnswer query={submitted}/>:null}
              {results.items.length === 0 ? (
                <section className="search-empty"><p>No matches for “{submitted}”.</p><p>Filters: {filterDescription}</p>{chips.length ? <button className="secondary-button" onClick={clearAll}>Clear all filters</button> : null}<button className="primary-button" aria-busy={creation.pending||undefined} onClick={()=>{const title=submitted||DEFAULT_PAGE_TITLE;void creation.create(async()=>({containerId:(await destination.resolve())?.id??null,title}));}}>Create a page titled “{submitted}”</button></section>
              ) : (
                <SearchResults items={results.items} spaceName={id=>searchOptions.spaces.data?.items.find(item=>item.id===id)?.name} statusLabel={key=>searchOptions.statuses.data?.items.find(item=>item.key===key)?.label}/>
              )}
              {results.nextCursor ? (
                <div className="list-paging">
                  <button
                    className="text-button search-next-results"
                    type="button"
                    onClick={() => setCursor(results.nextCursor)}
                  >
                    Next results →
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </RequestState>
        {saving?<SaveSearchDialog query={{...Object.fromEntries(Object.entries(refinements).filter(([,value])=>value!=="")),query:submitted??"",...(kind?{kind}:{}),includeArchived:archived}} onClose={()=>setSaving(false)} onSaved={()=>setSavedVersion(value=>value+1)}/>:null}
        {creation.prompt}
        {creation.error ? <p role="alert">{errorMessage(creation.error)}</p> : null}
        {error ? <p role="alert">{errorMessage(error)}</p> : null}
      </section>
    </>
  );
}
