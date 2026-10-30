import {Following} from './Following';
import {CompanyHub} from '../../../hub/ui/CompanyHub';
import {FollowedPosts} from '../../../blog/ui/FollowedPosts';
import { dateGroup } from "../../../../app/ui/displayDate";
import {ScheduledPublication} from '../../../../app/ui/ScheduledPublication';
import {useWorkspace} from '../../../../app/ui/WorkspaceContext';
import {RequestState} from '../../../../app/ui/RequestState';
import {SectionLabel} from '../../../../app/ui/SectionLabel';
export function PersonalHome(){
 const {navigation:resource}=useWorkspace();
 return <><CompanyHub/><RequestState loading={resource.loading} error={resource.error} retry={resource.reload}><p className="home-tasks"><a href="/app/tasks">My tasks →</a></p><Following/><FollowedPosts/><div className="personal-home"><section><SectionLabel>Recent pages</SectionLabel>{[...new Set(resource.data?.recents.map(r=>r.day))].map(day=><section key={day}><h3>{dateGroup(day, resource.data!.preferences.value.timezone)}</h3><ul>{resource.data?.recents.filter(r=>r.day===day).map(r=><li key={r.id}><a href={`/app/pages/${r.id}`}>{r.title}<ScheduledPublication page={r}/></a></li>)}</ul></section>)}{resource.data?.recents.length===0?<p>No recently opened pages.</p>:null}</section><section><SectionLabel>Your favourites</SectionLabel><ul>{resource.data?.favourites.map(r=><li key={r.id}><a href={r.href}>{r.title}<ScheduledPublication page={r}/></a></li>)}</ul>{resource.data?.favourites.length===0?<p>No favourites yet.</p>:null}</section><section><SectionLabel>Your spaces</SectionLabel><ul>{resource.data?.containers.map(r=><li key={r.id}><a href={`/app/containers/${r.id}`}>{r.name}</a></li>)}</ul></section></div></RequestState></>;
}
