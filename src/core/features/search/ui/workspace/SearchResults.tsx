import {Folder} from 'lucide-react';
import {HighlightedText} from './SearchHighlight';
import {formatSearchSnippet} from './formatSearchSnippet';
import {TrustBadge} from '../TrustBadge';
import type {PageTrust} from '../../trust-types';
import {displayDate} from '../../../../app/ui/displayDate';
import {personInitials} from '../../../../shared/person-identity';

export interface SearchResultView {
  id:string;title:string;snippet:string;kind:string;href:string;highlights:string[];updatedAt:string;
  containerId?:string|null;status?:string|null;
  trust?:PageTrust;
  similarPages?:{id:string;title:string;href:string;trust?:PageTrust}[];
}
const kinds:Record<string,string>={page:'Page',record:'Record',container:'Space',template:'Template','comment-thread':'Comment'};
const states:Record<PageTrust['state'],string>={verified:'Verified',lapsed:'Lapsed',unverified:'Unverified'};
function highlightedHref(href:string,terms:string[]) {
  return href+(href.includes('?')?'&':'?')+new URLSearchParams(terms.map(term=>['highlight',term]));
}
/** Who, when and where: the owner and last update, then the space and the page's verification state (SEARCH-011). */
function ResultMeta({result,space}:{result:SearchResultView;space?:string}) {
  const {trust}=result,owner=trust?.owner?.displayName,updated=trust?.updatedAt??result.updatedAt;
  return <div className="result-meta meta">
    <p>{owner?<span className="result-person"><span className="meta-avatar" aria-hidden="true">{personInitials(owner)}</span>{owner}</span>:null}<span>{owner?' · ':''}Updated <time dateTime={updated}>{displayDate(updated)}</time></span></p>
    {space||trust?<p>{space?<span className="result-space"><Folder aria-hidden="true"/>{space}</span>:null}{trust?<span>{space?' · ':''}<span className={`trust-state trust-state--${trust.state}`}>{states[trust.state]}</span>{trust.expiresAt?<> · Expires <time dateTime={trust.expiresAt}>{displayDate(trust.expiresAt)}</time></>:null}</span>:null}</p>:null}
  </div>;
}
/**
 * Open result rows: what it is, the title with the match marked, one line of context; the meta in a right column at
 * desktop width, folded under the line at phone width. A record leads its line with its status.
 */
export function SearchResults({items,spaceName,statusLabel}:{items:SearchResultView[];spaceName:(id:string)=>string|undefined;statusLabel:(key:string)=>string|undefined}) {
  return <ul className="search-results row-list">{items.map(result=>{
    const space=result.containerId&&result.kind!=='container'?spaceName(result.containerId):undefined;
    const status=result.kind==='record'&&result.status?statusLabel(result.status):undefined;
    const snippet=formatSearchSnippet(result.snippet).trim();
    return <li key={`${result.kind}:${result.id}`}>
      <div className="result-body">
        <a href={highlightedHref(result.href,result.highlights)}>
          <span className="eyebrow">{kinds[result.kind]??result.kind}</span>
          <h2>{result.kind==='comment-thread'?'Comment on ':''}<HighlightedText text={result.title} terms={result.highlights}/></h2>
          {status||snippet?<p>{status?<span className="status-tag">{status}</span>:null}<HighlightedText text={snippet} terms={result.highlights}/></p>:null}
        </a>
        {result.similarPages?.length?<details className="similar-pages">
          <summary>{result.similarPages.length} similar {result.similarPages.length===1?'page':'pages'}</summary>
          <ul>{result.similarPages.map(item=><li key={item.id}>
            <a href={highlightedHref(item.href,result.highlights)}>{item.title}</a>
            {item.trust?<TrustBadge trust={item.trust}/>:null}
          </li>)}</ul>
        </details>:null}
      </div>
      <ResultMeta result={result} space={space}/>
    </li>;
  })}</ul>;
}
