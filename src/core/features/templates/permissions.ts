import type { FeatureContext } from "../../app/feature-context";
import { ApiProblem } from "../../app/problems";
import { destination } from "../pages/service";
import { requireContainerLevel,currentSubject } from "../sharing/current-access";
export interface TemplateDestination {
  containerId: string;
  parentPageId: string | null;
  label: string;
}
async function permitted(check: () => Promise<unknown>) {
  try { await check(); return true; }
  catch (error) {
    if (error instanceof ApiProblem && [403,404].includes(error.status)) return false;
    if (error instanceof ApiProblem && ["DESTINATION_UNAVAILABLE","PAGE_READ_ONLY","PAGE_LOCKED","INVALID_PARENT"].includes(error.code)) return false;
    throw error;
  }
}
/** Choices contain only destinations the current actor can actually create under. */
export async function templateDestinations(ctx: FeatureContext): Promise<TemplateDestination[]> {
  const containers = await ctx.db.prepare("SELECT id,name FROM containers WHERE workspace_id=? AND archived_at IS NULL AND trashed_at IS NULL ORDER BY name,id").bind(ctx.actor.workspaceId).all<{id:string;name:string}>();
  const choices: TemplateDestination[] = [];
  for (const container of containers.results) {
    if (await permitted(()=>destination(ctx,container.id))) {
      choices.push({containerId:container.id,parentPageId:null,label:container.name});
    }
  }
  // A guest or page-specific editor can create inside a granted page without
  // gaining a container listing or permission to create at its root.
  const pages = await ctx.db.prepare("SELECT id,container_id,title FROM pages WHERE workspace_id=? AND deleted_at IS NULL AND trashed_at IS NULL AND archived_at IS NULL ORDER BY title,id").bind(ctx.actor.workspaceId).all<{id:string;container_id:string;title:string}>();
  for (const page of pages.results) {
    if (await permitted(()=>destination(ctx,page.container_id,page.id)))
      choices.push({containerId:page.container_id,parentPageId:page.id,label:`Inside ${page.title}`});
  }
  return choices;
}
export async function templatePermissions(ctx: FeatureContext, template: {containerId:string|null;isShipped:boolean;deleted:boolean}, destinations: TemplateDestination[]) {
  const subject=await currentSubject(ctx);
  return {
    canManage: !template.isShipped && (!template.containerId || await permitted(()=>requireContainerLevel(ctx,template.containerId!,"edit"))),
    ...(template.deleted ? {canErase: !template.isShipped && ((!template.containerId&&!subject.isGuest) || !!template.containerId&& await permitted(()=>requireContainerLevel(ctx,template.containerId!,"full")))} : {}),
    canApply: !template.deleted && destinations.length > 0,
    // Existing duplication permits a readable template to be copied to the workspace.
    canDuplicate: true,
  };
}
