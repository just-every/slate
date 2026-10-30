import type {DocumentView} from '../../../../client/content';
import {useResource} from '../../../../client/useResource';
import {displayDate} from '../../../../app/ui/displayDate';
interface Verification {state:'current'|'changed'|'lapsed'|null;ownerDisplayName:string;expiresAt:string|null;revisionId:string;verifiedAt:string}
/** STAT-003: the chip names the verifier and the expiry; its panel shows the revision. Not current never reads as verified. */
export function PageStatusBadge({document}:{document:DocumentView}){
 const key=(document.properties as {statusKey?:string})?.statusKey;
 const statuses=useResource<{items:{key:string;label:string;color:string;requiresVerification:boolean}[]}>(key?'/api/status':null);
 const status=statuses.data?.items.find(s=>s.key===key);
 const verificationOnly=document.policyProfile['page.status.v1']==='verification-only';
 const verification=document.verification as Verification|undefined;
 if(!status||(verificationOnly&&!status.requiresVerification))return null;
 const swatch=!verificationOnly?<span className="status-colour" aria-hidden="true" style={{backgroundColor:status.color}}/>:null;
 if(!status.requiresVerification)return <span className="page-status-chip">{swatch}{status.label}</span>;
 if(!verification?.state)return null;
 const expiry=verification.expiresAt?`until ${displayDate(verification.expiresAt)}`:'no expiry';
 const label=verification.state==='current'?`${status.label} · ${verification.ownerDisplayName} · ${expiry}`:verification.state==='lapsed'?'Verification lapsed':'Changed since verification';
 const detail=`${verification.ownerDisplayName} verified the revision ${verification.revisionId} on ${displayDate(verification.verifiedAt)}; ${verification.expiresAt?`${verification.state==='lapsed'?'lapsed':'expires'} ${displayDate(verification.expiresAt)}`:'no expiry'}.`;
 return <a className="page-status-chip" data-state={verification.state} href={`/app/pages/${encodeURIComponent(document.page.id)}?detail=status`} title={detail}>{swatch}{label}</a>;
}
