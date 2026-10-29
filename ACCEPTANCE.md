<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Accept a Slate installation

The primary journey: Import the team's existing knowledge, invite its members, write and organize together, find and ask with exact citations, review and maintain current knowledge, and export or restore the whole wiki.

## Progress

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 49 | 248 | 34 | 331 |
| Agent surface | 0 | 0 | 6 | 6 |
| Later | 0 | 0 | 0 | 0 |
| Full target | 49 | 248 | 40 | 337 |

Judged from the code and tests at commit `65d6c569c06f0150648800f3eaecce4bc77e6612` (29 October 2026); SEARCH-001 native source proof. Exact candidate and landing receipts are recorded by its branch Verify and the guarded lander. Field proof register: 16 rows; 0 passed, 0 failed, 16 not run.

## Core

### Public landing

#### HOME-001 — Installed workspace lobby

Core · published · **partial** · From HOME-001 · Cites BASE-ACCESS-003, BASE-PUBLIC-001

**Requirement.** An installed Slate answers its public root with the shared Lobby: Slate's card mark and name, one line naming the owner's deployment, and one action, Finish setup (to setup screen) until the owner has finished first-run setup (`WORK-013`) and Sign in (to sign-in screen) after, over Slate's floor art; The setup-state door reports exactly unclaimed or claimed from the same reading. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. The Lobby and setup-state door reveal only that state: they read no other workspace record, member identity or session, answer another origin or Host with the ordinary `404`, are rendered per request and send `no-store`.

**Evidence.** `tests/e2e/landing-styles.test.mjs` — "landing styles preserve the light palette, same-origin resources and reduced-motion access"
**Gap.** Missing a journey through the installed Lobby that reads both setup states, privacy and foreign-origin refusals; the cited stylesheet check reads CSS only.

#### HOME-002 — Run-site product landing

Core · published · **partial** · From HOME-001 · Cites BASE-ACCESS-003, BASE-PUBLIC-001

**Requirement.** The product's static landing page is the run site's homepage (`run-slate.com/`), written by `rer build --site` from the edition's own source and configuration with no installation data. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. Its header and footer carry the configured owner name beside Slate's card logo, the same card mark the sign-in page and the app show beside the owner's name and the deployment serves from its own origin as its favicon (an SVG with PNG fallbacks and an apple-touch icon), the name being the page's only top-level heading, and the footer shows the owner's one-line description.
2. The body is a fixed, owner-editable description of the product in one illustrated style: a hero that says what Slate is, then a section each for open source under the MIT license, pages, databases, search that respects who is asking, sharing and publishing, revision history, the other core-wiki capabilities (comments, templates, verification, inbox, containers, backup and restore) and moving in from another wiki, and a closing call to action.
3. "Run Slate" in the hero and in the closing call to action opens the run site's Run page at Run page (install rer, then clone the public source and start it with `rer dev`); a Docs link in its header and footer and a "Read the guide" link open documentation index, and "Read the setup guide" opens the documented public door (the run site carries the same first-party pages as `DOCS-001`); and it links to the source repository.
4. The landing links only to those targets, the source repository and, while the credit toggle is on, the credit, and never to an instance-only route (sign-in, setup, the app or its API).
5. It describes only capabilities the default `core-wiki` profile ships.
6. It may show a static “Powered by Slate · runeditrun.com” link when the buyer-configured credit toggle is on, which is its default.

**Evidence.** `tests/e2e/landing-styles.test.mjs` — "landing styles preserve the light palette, same-origin resources and reduced-motion access"
**Gap.** Missing a browser journey through the complete run-site landing, configuration, links and capability sections; the cited stylesheet check reads CSS only.

#### HOME-003 — Run-site privacy and readable presentation

Core · published · **partial** · From HOME-001 · Cites BASE-ACCESS-003, BASE-PUBLIC-001

**Requirement.** The landing exposes no workspace records or member identity and shows no metrics, testimonials, customer logos, plans or prices (it may say only that there is no per-seat pricing).

**Acceptance.**
1. It stays readable without scripts and with reduced motion, and keeps its own fixed light palette in a dark-themed browser.
2. Pages published to the anonymous web are served under the published-page prefix and are governed by `WEB-001` to `WEB-007`; the root never lists them.

**Evidence.** `tests/e2e/landing-styles.test.mjs` — "landing styles preserve the light palette, same-origin resources and reduced-motion access"
**Gap.** Missing a public landing journey that observes private-data absence, resource requests and script-free rendering; the cited stylesheet check checks palette and motion declarations only.

#### DOCS-001 — Public documentation

Core · published · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-DOCS-001, BASE-PUBLIC-001 · Register R-9

**Requirement.** The public paths documentation index and the documented public door serve Slate's first-party documentation: the Markdown files that `docs/site.json` lists as published, in the sections and order it gives, which is the only navigation. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. The documentation Markdown is rendered to HTML at build time: a Vite plugin renders each page to static HTML when Vite loads it, in a build and in development, and never in the Worker or the browser: the emitted Worker and client bundles contain no Markdown or syntax-highlighting code, and each page is its own lazily loaded chunk that the Worker renders per request inside the landing's own header, footer, paper, ink and typeface.
2. A page has its title as its one top-level heading (the landing's brand heading is not repeated), a section menu, an on-this-page list, previous and next links, tables in labeled scrollable regions and an Edit-on-GitHub link.
3. Every Markdown file at the repository root, under `docs/` and as a top-level `<directory>/README.md` is either published or listed in the manifest as GitHub-only with a reason, and an unlisted file, a broken link or anchor, raw HTML, an image outside `docs/media/` or an absolute build-machine path fails verification or the build.
4. Published pages describe only the default `core-wiki` profile, contain no maintainer-only material, and never advertise a flagship-only surface.
5. The documentation reads no workspace record, member identity or session, sets no cookie, runs no analytics or tracking and loads only same-origin resources.
6. An unknown, miscased or nested slug answers the branded `404`, a misconfigured deployment answers documentation index with the same `503` as the landing, and documentation index shares the landing's public-document rate limit.
7. GET the documented public door and each published slug render from `docs/site.json`; unknown slug answers the branded 404; the build fails on an unlisted Markdown file or a broken link.

**Evidence.** `tests/e2e/docs.test.ts` — "DOCS-001 public documentation supporting regressions public docs serve declared pages with accessible navigation and refuse unknown routes"
**Gap.** Missing a journey proving the complete published-document navigation, build-time bundle boundary, manifest refusals and both viewport accessibility; the cited HTTP regressions cover rendered pages and unknown slugs only.

### Workspace and members

#### WORK-001 — One workspace

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** A deployment holds exactly one workspace and every container, page, record and comment belongs to it.

**Acceptance.**
1. Its name and mark are editable in settings and shown in the app header.
2. No interface or endpoint creates a second workspace.
3. Setup creates one workspace; no route creates a second; renaming shows in the app header.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A deployment holds exactly one workspace and every container, page, record and comment belongs to it."<br>No validated CI-run proof for this acceptance point: "Its name and mark are editable in settings and shown in the app header."<br>No validated CI-run proof for this acceptance point: "No interface or endpoint creates a second workspace."

#### WORK-003 — Member management

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** Members are invited by email address and removed in settings.

**Acceptance.**
1. A workspace owner may invite any person and remove any member other than the setup member; a member may invite and may remove no one.
2. The member created at setup can be removed only by themselves, and `WORK-007` rejects removing the last workspace owner.
3. No policy value, extension, automation or AI action changes any of this.
4. Owner invites and removes a member; a member's removal attempt is refused; the setup member is removable only by themselves.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Members are invited by email address and removed in settings."<br>No validated CI-run proof for this acceptance point: "A workspace owner may invite any person and remove any member other than the setup member; a member may invite and may remove no one."<br>No validated CI-run proof for this acceptance point: "The member created at setup can be removed only by themselves, and `WORK-007` rejects removing the last workspace owner."<br>No validated CI-run proof for this acceptance point: "No policy value, extension, automation or AI action changes any of this."

#### WORK-006 — Invitations

Core · published · **done** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** An invitation is single-use, can be revoked before it is used, and can no longer be accepted 7 days after it was sent; an expired invitation is retained, not deleted.

**Acceptance.**
1. Requesting an invitation returns the same response whether or not the address already belongs to a member.
2. Invitation accepted once, revoked before use, refused after 7 days; the request response is identical for known and unknown addresses.

**Evidence.** `tests/e2e/local-outbox.node.test.mts` — "native local mail sign-in and invitations preserve identity, delivery and scoped authority": acceptance 1 and 2, complete HTTP admission comparison apart from generated operation identifiers, native single-use session acceptance, pre-use revocation and retained seven-day expiry. `tests/qualification/policies/invitations.test.ts` — "native member invitations preserve uniform admission, lifetime and current inviter authority": acceptance 1 and 2 through the native Workers HTTP doors, including expired GET and POST refusal with unchanged members, sessions and retained invitation.
**Gap.** None.

#### WORK-007 — Removal

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-DATA-003, BASE-ROLE-001

**Requirement.** Removing a member removes their personal grants from every page and container, archives their personal container and its pages (`CONT-005`) rather than exposing or deleting them, leaves each page they owned with no owner and offers reassignment in bulk (`CONT-006`), .

**Acceptance.**
1. Removing the only remaining workspace owner is rejected.
2. Removing a member revokes sessions, archives their personal container, leaves owned pages ownerless and refuses removing the last owner.

**Evidence.** `tests/qualification/core/identity.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/identity.mjs`.

#### WORK-008 — Roles

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** A member is a workspace owner or a member.

**Acceptance.**
1. Workspace owners administer the workspace: settings, members, groups, guests, containers they are not in, and the site-wide switches in `CONT-007`.
2. Every other permission comes from a grant on a page or a container (`SHARE-001`, `CONT-009`), never from the role.
3. Owner and member role matrix over settings, members, groups, guests and containers; every other right comes from grants.

**Evidence.** `tests/qualification/core/identity.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/identity.mjs`.

#### WORK-009 — Groups

Core · published · **done** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** A workspace owner can create a named group, add and remove members, and use it as a grant principal anywhere a person can be used.

**Acceptance.**
1. Changing a group's membership changes access at once and writes one activity entry, and deleting a group removes its grants without touching the grants of its members.
2. Owner creates a group, grants it, changes membership and access changes at once with one activity entry; deleting it removes only its grants.

**Evidence.** `tests/qualification/ui-convergence/workspace-authority-journey.mjs` — "workspaceAuthorityJourney", called by "space tree title filtering preserves ancestors, access and expansion at 390px" and "page outline follows headings and navigates long pages at 1440px" in `tests/qualification/ui-convergence/journeys.test.mjs`: named group creation and membership editing, page and container grants, immediate access changes, one activity entry with replay, and group deletion retaining individual grants.
**Gap.** None.

#### WORK-010 — Guests

Core · published · **done** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** A guest is a person invited to named pages or containers only.

**Acceptance.**
1. A guest is outside the member count and the member list, reaches nothing but what they were granted, and cannot see the container index, the workspace member list, or search results beyond their grants.
2. A container may forbid guests (`CONT-007`).
3. A guest reaches only granted pages and sees no container index, member list or search results beyond grants.

**Evidence.** `tests/qualification/ui-convergence/guest-scope-journey.mjs` — "guestScopeJourney", through "workspaceAuthorityJourney" in `tests/qualification/ui-convergence/workspace-authority-journey.mjs`, called by "space tree title filtering preserves ancestors, access and expansion at 390px" and "page outline follows headings and navigates long pages at 1440px" in `tests/qualification/ui-convergence/journeys.test.mjs`: guest admission preserves member list and count; named page and container grants bound reads and search while workspace indexes stay denied; the container veto immediately removes access; revocation survives grant and invitation replay.
**Gap.** None.

#### WORK-011 — Workspace settings

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** Settings are a shell with its own navigation, holding workspace identity, members, groups, guests, the status vocabulary, published-page and guest switches, connected services, AI, import and export.

**Acceptance.**
1. It is separate from a container's own settings shell (`CONT-004`), and a change in one never silently changes the other.
2. Settings shell reaches every listed area; a change in workspace settings never changes a container's settings.

**Evidence.** `tests/qualification/core/identity.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/identity.mjs`.

#### WORK-012 — Theme

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** Light, dark and follow-the-system are offered, apply to every operator surface including editors, and persist per member across sessions and devices.

**Acceptance.**
1. The anonymous read view uses the published page's own theme (`WEB-002`), never the reader's member setting.
2. Theme choice applies to every operator surface and persists across sessions and devices; the anonymous view uses the page theme.

**Evidence.** `tests/qualification/core/identity.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/identity.mjs`.

#### WORK-013 — First run

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** An owner claimed through RER’s verified bootstrap or signed claim receives the configured deployment name, a General space and a Welcome page atomically, with first run complete; the name, space and page remain editable. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. A local deployment runs a short wizard that names the workspace, creates the first container and its first page, and ends on an invitation step that can be skipped.
2. It runs once, is never shown to a member who joins later, and creates nothing beyond those three records.
3. Its native owner wizard lives at setup screen: unfinished owners are redirected there from operator app routes after sign-in; completed setup and later members proceed to workspace screen.
4. The same native session and owner authorization guard the route and completion API.
5. Claimed owner gets name, General space and Welcome page atomically; local wizard runs once at the documented public door and later members go to the documented public door.

**Evidence.** `tests/qualification/backend/emitted.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/backend/emitted.mjs`.

#### WORK-014 — Shortcut reference

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** One reference lists every keyboard shortcut and every typed formatting shortcut the editor accepts, is reachable from anywhere in the operator app by a single shortcut, and matches what the editor actually does.

**Acceptance.**
1. One reference lists every keyboard shortcut and every typed formatting shortcut the editor accepts, is reachable from anywhere in the operator app by a single shortcut, and matches what the editor actually does.
2. One shortcut opens a reference that matches every shortcut the editor accepts.

**Evidence.** `tests/qualification/core/shell.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/shell.mjs`.

#### WORK-015 — Identity provider

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001 · Register R-12

**Requirement.** A provider sign-in creates no member who was not invited or allow-listed, and an unconfigured or failing provider leaves magic-link sign-in working and says which is unavailable.

**Acceptance.**
1. A member who has lost their mailbox is re-invited at a new address (`WORK-003`), which is not a recovery flow and does not restore their old sessions.
2. SAML single sign-on and SCIM provisioning are `ADMIN-001` and `ADMIN-002`.
3. Configured OIDC provider signs in an invited member only; a failing provider leaves magic-link sign-in working and says which is unavailable.

**Evidence.** `tests/qualification/core/identity.mjs` Supporting candidate regressions: `tests/flagship/core/identity-upgrade.test.ts` — native invited OIDC, refused identities without writes, provider outages, mailbox replacement and email fallback; `tests/e2e/provider-fallback-flow.mjs` — emitted provider failure and email recovery.
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/identity.mjs`.

### Editing and saving

#### SAVE-001 — Durable save state

Core · published · **partial**

**Requirement.** An editor shows Saving until the write and its activity entry are committed, then shows Saved within 2 seconds of the commit.

**Acceptance.**
1. An editor shows Saving until the write and its activity entry are committed, then shows Saved within 2 seconds of the commit.
2. Editor shows Saving until the commit and Saved within 2 seconds after it.

**Evidence.** `tests/qualification/interface/routed.browser.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/interface/routed.browser.mjs`.

#### SAVE-002 — Failed writes

Core · published · **done**

**Requirement.** A failed write leaves the editor in a failed state, never Saved.

**Acceptance.**
1. It keeps the unsent value, names the failure, and offers an explicit retry.
2. A forced write failure shows a failed state with the unsent value and an explicit retry, never Saved.

**Evidence.** `tests/qualification/ui-convergence/failed-save-journey.mjs` — "failedSaveJourney"
**Gap.** None.

#### SAVE-003 — Revision conflicts

Core · published · **partial**

**Requirement.** Every edit is submitted with the revision it began from: the block's revision for a body edit, the page's for a title, property, structure or order change.

**Acceptance.**
1. An edit against a superseded revision is rejected with 409, keeps the local draft, and offers compare, reload, or explicit overwrite.
2. Slate never resolves a conflict by last write wins.
3. An edit against a superseded revision returns 409, keeps the draft and offers compare, reload or overwrite.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every edit is submitted with the revision it began from: the block's revision for a body edit, the page's for a title, property, structure or order change."<br>No validated CI-run proof for this acceptance point: "An edit against a superseded revision is rejected with 409, keeps the local draft, and offers compare, reload, or explicit overwrite."<br>No validated CI-run proof for this acceptance point: "Slate never resolves a conflict by last write wins."

#### SAVE-004 — Network loss

Core · published · **partial**

**Requirement.** While the server is unreachable the editor shows Offline and keeps the unsent draft in browser storage as recovery only.

**Acceptance.**
1. A recovered draft is labeled unsaved and never appears in the tree, in lists, in search, or in export as workspace data.
2. Offline editor shows Offline and keeps a labeled unsaved draft that never appears in tree, search or export.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "While the server is unreachable the editor shows Offline and keeps the unsent draft in browser storage as recovery only."<br>No validated CI-run proof for this acceptance point: "A recovered draft is labeled unsaved and never appears in the tree, in lists, in search, or in export as workspace data."

#### SAVE-005 — Operation keys

Core · published · **partial**

**Requirement.** Every mutation accepts an operation key.

**Acceptance.**
1. Repeating a key with the same body within 24 hours returns the first response and creates no second record, notification, AI run, publish, import, or activity entry; repeating it with a different body is rejected with 409.
2. A repeated operation key returns the first response and creates nothing twice; a different body is refused with 409.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every mutation accepts an operation key."<br>No validated CI-run proof for this acceptance point: "Repeating a key with the same body within 24 hours returns the first response and creates no second record, notification, AI run, publish, import, or activity entry; repeating it with a different body is rejected with 409."

#### SAVE-006 — Concurrent editing and optional co-editing

Core · published · **partial**

**Requirement.** Different blocks can be edited concurrently; revision conflicts retain SAVE-003 and unsent text.

**Acceptance.**
1. Committed blocks refresh within ten seconds without replacing a reader’s unsaved block.
2. A page shows who has it open.
3. Deployments may enable real live co-editing, shared cursors and presence with durable accepted operations, current ACL checks, revocation, reconnect recovery and attributable revision history.
4. Co-editing never silently loses an accepted edit or converts unconfirmed local text into Saved.
5. The full flagship acceptance exercises real co-editing; a deployment may keep it disabled. live co-editing becomes the default behavior, specified by `COLLAB-001` to `COLLAB-005`.
6. Two members edit different blocks concurrently; committed blocks refresh within 10 seconds without replacing unsaved text; presence shows who has the page open.

**Evidence.** `tests/qualification/ui-convergence/two-people-editing.mjs`
**Gap.** live co-editing only under the flagship opt-in; see COLLAB-001

### The page

#### PAGE-001 — What a page is

Core · published · **partial**

**Requirement.** A page has an identifier, a title, an optional icon, an optional cover, an owner, contributors, created and updated times, a container, a position in that container's tree, a body (`BLOCK-001`), a lifecycle state (`LIFE-001`), grants (`SHARE-001`), a revision (`REV-001`) and a set of labels.

**Acceptance.**
1. A label is a short text tag, unique on the page, added and removed by anyone with edit access, shown in the page's details (`PAGE-007`), carried through import (`IMP-003`) and through export and re-import (`PORT-001`, `PORT-002`, `PORT-007`), and never discarded; filtering and searching by label is target clause `SEARCH-010`.
2. A database record is a page (`DB-010`), and every comment thread, revision, decision record and public exposure record names exactly one page.
3. A page carries every listed attribute, and labels survive import, export and re-import.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a page creation, metadata editing and round-trip journey that reads the complete page identity and labels; the cited incumbent-archive test calls the parser and does not exercise the page door.

#### PAGE-002 — Creation

Core · published · **partial**

**Requirement.** A member with edit access on the destination can create a page blank or from a template (`TMPL-003`), from the tree, from the global create action, or as a child of an open page.

**Acceptance.**
1. It is created in exactly one container at one position, and its initial lifecycle state follows `LIFE-006`.
2. Pages are created blank and from a template from the tree, global create and as a child, each at one position.

**Evidence.** `tests/qualification/interface/content.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/interface/content.mjs`.

#### PAGE-003 — Identity survives everything

Core · published · **partial**

**Requirement.** A page keeps its identifier for its lifetime.

**Acceptance.**
1. Renaming it, editing it, moving it within or between containers, archiving, trashing, restoring, publishing and unpublishing never change it, and every link, mention, citation, content query and search result continues to resolve to it (`LINK-001`).
2. Rename, move, archive, restore, publish and unpublish keep the page identifier and every link resolving.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A page keeps its identifier for its lifetime."<br>No validated CI-run proof for this acceptance point: "Renaming it, editing it, moving it within or between containers, archiving, trashing, restoring, publishing and unpublishing never change it, and every link, mention, citation, content query and search result continues to resolve to it (`LINK-001`)."

#### PAGE-004 — Move

Core · published · **partial**

**Requirement.** A member with edit access on both places can move a page to another position, another parent, or another container, choosing the destination from a searchable picker.

**Acceptance.**
1. Children move with it, grants are re-resolved against the new parent and the change is shown before it is applied, and comments, versions and links are unchanged.
2. Moving a page with children to another container re-resolves grants, shows the change first and keeps comments, versions and links.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member with edit access on both places can move a page to another position, another parent, or another container, choosing the destination from a searchable picker."<br>No validated CI-run proof for this acceptance point: "Children move with it, grants are re-resolved against the new parent and the change is shown before it is applied, and comments, versions and links are unchanged."

#### PAGE-005 — Duplicate

Core · published · **partial**

**Requirement.** Duplicating a page copies its title, icon, cover, body and properties into a new page with a new identifier, optionally including its children.

**Acceptance.**
1. It copies no comment, version, watcher, analytics figure, grant beyond the destination's inheritance, or public link.
2. Duplicate copies title, icon, cover, body and properties with a new identifier and copies no comment, version, grant or public link.

**Evidence.** `tests/flagship/content/http.test.ts`
**Gap.** Missing a duplication journey that creates comments, versions, watchers, analytics, grants and publication before duplicating and reads their exclusion; the cited content flow checks some duplicate content and verification behavior only.

#### PAGE-006 — Icon and cover

Core · published · **partial**

**Requirement.** A page takes an icon from emoji, a supplied icon set or an upload, and a cover from a gallery, an upload or a link.

**Acceptance.**
1. Both are removable, both render in the tree and in search results where the surface has room, and neither is required.
2. Icon from emoji, icon set or upload and cover from gallery, upload or link render in tree and search and are removable.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A page takes an icon from emoji, a supplied icon set or an upload, and a cover from a gallery, an upload or a link."<br>No validated CI-run proof for this acceptance point: "Both are removable, both render in the tree and in search results where the surface has room, and neither is required."

#### PAGE-007 — Details

Core · published · **partial**

**Requirement.** A page's details show its owner, creator, contributors, created and updated times, length, status (`STAT-002`), labels (`PAGE-001`), views (`PAGE-013`) and the pages that link to it.

**Acceptance.**
1. A member with `full` access can reassign the owner, which changes no grant and writes one activity entry.
2. Details show owner, creator, contributors, times, status, labels, views and backlinks; reassigning the owner changes no grant.

**Evidence.** `tests/qualification/backend/emitted.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/backend/emitted.mjs`.

#### PAGE-008 — Favorite

Core · published · **partial**

**Requirement.** A member can favorite a page or a container and unfavorite it.

**Acceptance.**
1. Favorites are personal, are listed in the navigation (`NAV-003`), and are visible to no other member.
2. Favorites are listed in navigation for their member only.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member can favorite a page or a container and unfavorite it."<br>No validated CI-run proof for this acceptance point: "Favorites are personal, are listed in the navigation (`NAV-003`), and are visible to no other member."

#### PAGE-009 — Watch

Core · published · **done**

**Requirement.** A member can watch a page, and watches it implicitly after commenting on it until they stop.

**Acceptance.**
1. A watched page delivers its comments, replies and published changes to that member's inbox (`NOTIF-001`).
2. Watching is personal and a member's own action never notifies them.
3. `PAGE-016` also watches a page its creator or editor creates or edits, and `CONT-012` watches a whole container.
4. Watching delivers comments, replies and publishes to the watcher's inbox and never notifies the actor.

**Evidence.** `tests/flagship/discovery/following.test.ts` — "PAGE-016 — authoring watches respect durable unwatch, personal overrides and workspace defaults"
**Gap.** None.

#### PAGE-010 — Outline

Core · published · **done**

**Requirement.** A page shows an outline built from its headings that reflects the current body within 2 seconds of an edit, and selecting an entry scrolls to that heading.

**Acceptance.**
1. A page with no headings shows no outline rather than an empty one.
2. Outline reflects headings within 2 seconds and scrolls to the chosen heading; no headings shows no outline.

**Evidence.** `tests/qualification/ui-convergence/outline-journey.mjs` — "outlineJourney"
**Gap.** None.

#### PAGE-011 — Present

Core · published · **done**

**Requirement.** Present mode fills the screen, paginates the page by its top-level headings, and shows no navigation, comments or editing affordances.

**Acceptance.**
1. Leaving it returns to the same scroll position.
2. Present mode paginates by top-level headings without chrome and returns to the same scroll position.

**Evidence.** `tests/qualification/ui-convergence/presentation-journey.mjs` — "presentationJourney"
**Gap.** None.

#### PAGE-012 — Page display options

Core · published · **done**

**Requirement.** Each page carries its own typeface from a fixed set, small-text and full-width toggles, and these are stored on the page and are the same for every reader.

**Acceptance.**
1. They change no stored content and survive export and import.
2. Typeface, small text and full width are stored per page, identical for every reader and kept through export and import.

**Evidence.** `tests/qualification/ui-convergence/page-display-journey.mjs` — "pageDisplayJourney"
**Gap.** None.

#### PAGE-013 — Analytics

Core · published · **done**

**Requirement.** A page records total views and unique viewers over time with the members who viewed and edited it, and a container rolls the same figures up over its pages.

**Acceptance.**
1. Both scopes ship and neither is gated by a plan, a role beyond read access to the page, or a policy.
2. A member's own views of their own page are counted and labeled as such, and analytics never expose a viewer a member could not otherwise see.
3. Views and unique viewers over time per page and container, own views labeled, never exposing an unreadable viewer.

**Evidence.** `tests/qualification/ui-convergence/analytics-journey.mjs` — "analyticsJourney"
**Gap.** None.

#### PAGE-014 — Reactions

Core · published · **done**

**Requirement.** A member can add and remove an emoji reaction on a page and on a comment (`COMM-005`).

**Acceptance.**
1. Reactions show who reacted, are not notifications, and are not counted in analytics.
2. Page reactions show who reacted, notify no one and are not counted in analytics.

**Evidence.** `tests/qualification/ui-convergence/reactions-journey.mjs` — "reactionsJourney"
**Gap.** None.

### The page tree

#### TREE-001 — A nested tree in a container

Core · published · **partial**

**Requirement.** Every container holds one tree of pages of unlimited depth.

**Acceptance.**
1. A node shows its icon, title and whether it has children, expands and collapses, and remembers its expansion per member.
2. A page has exactly one parent — a page or the container root — and appears in exactly one place.
3. Unlimited-depth tree per container with per-member expansion and exactly one parent per page.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every container holds one tree of pages of unlimited depth."<br>No validated CI-run proof for this acceptance point: "A node shows its icon, title and whether it has children, expands and collapses, and remembers its expansion per member."<br>No validated CI-run proof for this acceptance point: "A page has exactly one parent — a page or the container root — and appears in exactly one place."

#### TREE-002 — Reordering and nesting

Core · published · **partial**

**Requirement.** A member with edit access can reorder a page among its siblings and re-parent it by dragging or through `PAGE-004`.

**Acceptance.**
1. Order is explicit and stored, is the same for every member, and never changes as a side effect of an edit, a rename or a publish.
2. Drag reorder and re-parent store one explicit order for every member, unchanged by edits or renames.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member with edit access can reorder a page among its siblings and re-parent it by dragging or through `PAGE-004`."<br>No validated CI-run proof for this acceptance point: "Order is explicit and stored, is the same for every member, and never changes as a side effect of an edit, a rename or a publish."

#### TREE-003 — Shared with me

Core · published · **done**

**Requirement.** A member's navigation lists pages granted to them individually that sit in containers they are not a member of, with their container named.

**Acceptance.**
1. Removing the grant removes the entry within the same load.
2. Pages granted individually in non-member containers are listed with their container and vanish when the grant is removed.

**Evidence.** `tests/qualification/ui-convergence/shared-navigation-journey.mjs` — "sharedNavigationJourney"
**Gap.** None.

#### TREE-004 — Filter the tree

Core · published · **done**

**Requirement.** Each container's tree carries a filter over page titles that narrows the visible nodes while keeping their ancestors, matches within 200ms of typing, and clears in one action without changing expansion state.

**Acceptance.**
1. Each container's tree carries a filter over page titles that narrows the visible nodes while keeping their ancestors, matches within 200ms of typing, and clears in one action without changing expansion state.
2. Tree filter narrows within 200ms, keeps ancestors and clears without changing expansion.

**Evidence.** `tests/qualification/ui-convergence/tree-filter-journey.mjs` — "treeFilterJourney"
**Gap.** None.

#### TREE-005 — Create in place

Core · published · **done**

**Requirement.** A page can be created at the foot of a tree, as a child from any node's own actions, and from one global create action available on every operator screen.

**Acceptance.**
1. Each names the destination before creating.
2. Create at the foot of a tree, from a node and from global create, each naming the destination first.

**Evidence.** `tests/qualification/ui-convergence/create-in-place-journey.mjs` — "createInPlaceJourney"
**Gap.** None.

### The page body

#### BLOCK-001 — A body of blocks

Core · published · **partial**

**Requirement.** A page body is an ordered tree of typed blocks, each with an identifier, a type, content, and optional children.

**Acceptance.**
1. Every block has a drag handle, can be reordered and nested, can be selected with its neighbors, and can be duplicated or deleted.
2. Block identifiers survive editing, moving and export, and an anchored comment (`COMM-001`) points at one.
3. Blocks reorder, nest, multi-select, duplicate and delete with identifiers surviving edits, moves and export.

**Evidence.** `tests/qualification/interface/routed.browser.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/interface/routed.browser.mjs`.

#### BLOCK-002 — Inline text

Core · published · **partial** · Cites BASE-INPUT-002

**Requirement.** Text in a block carries bold, italic, underline, strikethrough, inline code, color, links, and mentions, and nothing else.

**Acceptance.**
1. It is stored in one format, rendered under `BASE-INPUT-002`, and round-trips unchanged through page export, workspace export and import.
2. Inline marks render under `BASE-INPUT-002` and round-trip unchanged through page export, workspace export and import.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Text in a block carries bold, italic, underline, strikethrough, inline code, color, links, and mentions, and nothing else."<br>No validated CI-run proof for this acceptance point: "It is stored in one format, rendered under `BASE-INPUT-002`, and round-trips unchanged through page export, workspace export and import."

#### BLOCK-003 — The insert menu

Core · published · **partial**

**Requirement.** Typing public root at the cursor opens an insert menu grouped by kind, filtered by what is typed, navigable and selectable by keyboard alone, and it inserts at the cursor without leaving the editor. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. Every block type this contract names is reachable from it, and on a touch client the same list is reachable from a labeled control above the keyboard.
2. the documented public door menu filters, works by keyboard only, inserts at the cursor and reaches every block type; touch control above the keyboard at 390.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Typing `/` at the cursor opens an insert menu grouped by kind, filtered by what is typed, navigable and selectable by keyboard alone, and it inserts at the cursor without leaving the editor."<br>No validated CI-run proof for this acceptance point: "Every block type this contract names is reachable from it, and on a touch client the same list is reachable from a labeled control above the keyboard."

#### BLOCK-004 — Markdown shortcuts

Core · published · **partial**

**Requirement.** Typed Markdown converts as it is written — headings, lists, quotes, code fences, dividers, bold, italic and inline code — and each conversion is undone by one undo without losing the typed characters.

**Acceptance.**
1. The reference in `WORK-014` lists every shortcut the editor accepts.
2. Each Markdown shortcut converts as typed and one undo restores the typed characters.

**Evidence.** `tests/qualification/interface/content.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/interface/content.mjs`.

#### BLOCK-005 — Mentions

Core · published · **partial**

**Requirement.** Typing `@` offers people, pages and dates in one list.

**Acceptance.**
1. A person mention notifies them (`NOTIF-001`) and renders their name; a page mention renders the page's current title and follows renames and moves (`LINK-003`); a date mention renders in the reader's locale.
2. `BLOCK-020` adds group mentions.
3. `@` offers people, pages and dates; a person mention notifies; a page mention follows renames.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Typing `@` offers people, pages and dates in one list."<br>No validated CI-run proof for this acceptance point: "A person mention notifies them (`NOTIF-001`) and renders their name; a page mention renders the page's current title and follows renames and moves (`LINK-003`); a date mention renders in the reader's locale."

#### BLOCK-006 — Structured blocks

Core · published · **partial**

**Requirement.** The body carries headings, bulleted, numbered and toggle lists, quotes, dividers, callout panels, expandable sections, tables with header rows, and code blocks with a language and copy action.

**Acceptance.**
1. Each survives export and import and each has a Markdown or import equivalent named in `IMP-002` and `IMP-003`. a table-of-contents block (`BLOCK-017`), status labels (`BLOCK-018`) and diagrams.net diagrams (`BLOCK-019`) join them, and `IMP-010` names the Confluence macro each one replaces.
2. Each structured block type survives export and import with its named import equivalent.

**Evidence.** `tests/qualification/interface/blocks.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/interface/blocks.mjs`.

#### BLOCK-007 — Task items

Core · published · **partial**

**Requirement.** A checkable item in the body toggles for anyone with edit access, records who completed it and when, and is counted where the page shows a completion figure.

**Acceptance.**
1. It is a block, not a record in a database, and it never appears in a database view.
2. `BLOCK-015` adds an assignee and a due date, `NAV-007` a My tasks view and `BLOCK-016` task reports; a task item stays a block and still never appears in a database view.
3. Task item toggles for editors, records who and when, and never appears in a database view.

**Evidence.** `tests/flagship/content/repair.test.ts`
**Gap.** Missing a task journey through the body that checks the completion figure and database-view exclusion; the cited content flow checks completion attribution and undo only.

#### BLOCK-008 — Media blocks

Core · published · **partial** · Cites BASE-INPUT-002, BASE-INPUT-003

**Requirement.** Images, video, audio and file attachments are inserted by upload, by link, or from a configured stock source, each with an optional caption and an alt text field, and stored under `BASE-INPUT-003`.

**Acceptance.**
1. This clause supersedes `BASE-INPUT-003` on disposition alone.
2. A file requested for display — an image, video or audio block, a page icon or cover (`PAGE-006`), or either of those behind a published page (`WEB-003`) — is served inline with its declared content type; every other request for a stored file, including every file attachment and every direct request for a media file, is served with a download disposition.
3. Both dispositions send the declared content type and `X-Content-Type-Options: nosniff`, and an SVG is sanitized under `BASE-INPUT-002` before it is served inline.
4. Disposition changes nothing about access: a media file is readable only by a session that may read its page, or through that page's public link (`WEB-003`).
5. Media by upload and link with caption and alt text; inline versus download disposition, `nosniff` and sanitized SVG served per the clause.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Images, video, audio and file attachments are inserted by upload, by link, or from a configured stock source, each with an optional caption and an alt text field, and stored under `BASE-INPUT-003`."<br>No validated CI-run proof for this acceptance point: "A file requested for display — an image, video or audio block, a page icon or cover (`PAGE-006`), or either of those behind a published page (`WEB-003`) — is served inline with its declared content type; every other request for a stored file, including every file attachment and every direct request for a media file, is served with a download disposition."<br>No validated CI-run proof for this acceptance point: "Both dispositions send the declared content type and `X-Content-Type-Options: nosniff`, and an SVG is sanitized under `BASE-INPUT-002` before it is served inline."<br>No validated CI-run proof for this acceptance point: "Disposition changes nothing about access: a media file is readable only by a session that may read its page, or through that page's public link (`WEB-003`)."

#### BLOCK-009 — Link cards

Core · published · **partial**

**Requirement.** A pasted URL becomes a link card showing the target's title, description and icon, and can be switched between a plain link, an inline card and a block card without retyping it.

**Acceptance.**
1. Fetching a preview goes through `link.preview.v1` and issues a bodyless GET to public HTTPS origins only, sends no session, credential or member identity, rejects local, private, link-local and cloud-metadata addresses before the first request and before each redirect, and enforces the redirect, byte, time and media-type limits in `seed.json → limits`.
2. A refused or failed fetch leaves the plain link and says so; the URL is stored exactly as pasted either way.
3. Link preview fetches only public HTTPS with no credentials, refuses private addresses before each redirect, and leaves the plain link on refusal.

**Evidence.** `tests/flagship/content/preview.test.ts`
**Gap.** Missing a paste-and-switch link-card journey through the editor plus allowed and refused preview requests; the cited test invokes the preview helper directly.

#### BLOCK-010 — Content queries

Core · published · **partial**

**Requirement.** A body can hold a live list of pages defined by container, ancestor, type, status, contributor and date, ordered and limited by the author.

**Acceptance.**
1. It re-runs when the page is opened, shows when it last ran, shows each reader only the pages that reader may read, and never renders a draft (`LIFE-002`).
2. A query whose source is deleted shows that, not an empty list.
3. Content query shows each reader only readable pages, never drafts, shows last run and a deleted source.

**Evidence.** `tests/qualification/interface/blocks.mjs`; additional supporting browser coverage: `tests/qualification/ui-convergence/journeys.test.mjs` — "BLOCK-010 — native content queries retain criteria and current-reader results at 1440px" and "BLOCK-010 — native content queries retain criteria and current-reader results at 390px", through `tests/qualification/ui-convergence/content-query-journey.mjs` — contentQueryJourney: native criteria persistence, exact ordered current-reader results, both authors’ drafts excluded, response-correlated last run, committed source updates on reopen, revoked and deleted sources without stale rows, and retained missing-source criteria.
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/interface/blocks.mjs`.

### Page lifecycle

#### LIFE-001 — Lifecycle states

Core · published · **done**

**Requirement.** A page is `draft`, `scheduled`, `live`, `live-with-unpublished-changes` or `archived`.

**Acceptance.**
1. It always has a working revision and has a published revision in every state but `draft`; `live-with-unpublished-changes` means both exist and differ.
2. Every transition records the actor and the time, and every state exists in the stored model whichever value `LIFE-006` carries.
3. Every lifecycle state and transition is stored with actor and time under both lifecycle policy values.

**Evidence.** `tests/flagship/content/http.test.ts` — publication, human verification and media enforce current reader authority; `tests/qualification/ui-convergence/journeys.test.mjs` — page creation destinations and editor locks preserve readable content at 1440px (publication steps in `tests/qualification/interface/publication.mjs`).
**Gap.** None.

#### LIFE-002 — A draft is private

Core · published · **partial**

**Requirement.** While a page is `draft` it is absent from search, from content queries, from the inbox, from analytics, from AI grounding, from every administrative and export listing, and from the tree of every member it has not been shared with.

**Acceptance.**
1. Its body is readable only by its author and by the principals in its own grant list: sharing a draft, by link or by address, creates a grant under `SHARE-001` and `SHARE-006`, that grant requires a session like every other, it is shown in the draft's grant list, and revoking it ends access under `SHARE-007`.
2. There is no readable address for a draft that carries no grant, a draft has no general access grant under either value of `SHARE-005` (`SHARE-004`), and a draft cannot be published to the anonymous web (`WEB-001`).
3. No role, policy value, container setting, workspace owner action, automation or extension defeats this.
4. `LIFE-006` decides whether a draft state arises, never whether this clause holds.
5. Under the held company policy for standard changes, external exposure or commitment decisions, a draft is absent from search, queries, inbox, analytics, AI grounding, listings and other trees, and readable only by its author and grantees.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "While a page is `draft` it is absent from search, from content queries, from the inbox, from analytics, from AI grounding, from every administrative and export listing, and from the tree of every member it has not been shared with."<br>No validated CI-run proof for this acceptance point: "Its body is readable only by its author and by the principals in its own grant list: sharing a draft, by link or by address, creates a grant under `SHARE-001` and `SHARE-006`, that grant requires a session like every other, it is shown in the draft's grant list, and revoking it ends access under `SHARE-007`."<br>No validated CI-run proof for this acceptance point: "There is no readable address for a draft that carries no grant, a draft has no general access grant under either value of `SHARE-005` (`SHARE-004`), and a draft cannot be published to the anonymous web (`WEB-001`)."<br>No validated CI-run proof for this acceptance point: "No role, policy value, container setting, workspace owner action, automation or extension defeats this."<br>No validated CI-run proof for this acceptance point: "`LIFE-006` decides whether a draft state arises, never whether this clause holds."

#### LIFE-003 — Publish

Core · published · **done**

**Requirement.** Publishing takes a location, a general access setting (`SHARE-004`), an optional version comment, an optional schedule and an optional publish-as attribution, shows a preview of what readers will see, and on confirmation makes the page visible in its container's tree, in search and in content queries, and writes one version with origin `publish` (`REV-002`).

**Acceptance.**
1. Publishing takes a location, a general access setting (`SHARE-004`), an optional version comment, an optional schedule and an optional publish-as attribution, shows a preview of what readers will see, and on confirmation makes the page visible in its container's tree, in search and in content queries, and writes one version with origin `publish` (`REV-002`).
2. Publish with location, access, comment, schedule and attribution previews and writes one `publish` version.

**Evidence.** `tests/flagship/content/http.test.ts` — publication, human verification and media enforce current reader authority; `tests/qualification/ui-convergence/journeys.test.mjs` — page creation destinations and editor locks preserve readable content at 1440px (publication steps in `tests/qualification/interface/publication.mjs`).
**Gap.** None.

#### LIFE-004 — Scheduled publish

Core · published · **done** · Cites BASE-OPS-004

**Requirement.** A publish set for a future time leaves the page `scheduled`, shows that time wherever the page appears to its author, and publishes at that time without a further action.

**Acceptance.**
1. Canceling before it fires returns the page to `draft` and publishes nothing; a schedule that fails to fire leaves the page `scheduled` and reports the failure under `BASE-OPS-004`.
2. A scheduled publish fires at its time; cancel returns to draft; a failed schedule is reported.

**Evidence.** `tests/flagship/content/http.test.ts` — publication, human verification and media enforce current reader authority; `tests/qualification/ui-convergence/journeys.test.mjs` — page creation destinations and editor locks preserve readable content at 1440px (publication steps in `tests/qualification/interface/publication.mjs`).
**Gap.** None.

#### LIFE-005 — Unpublished changes

Core · published · **done**

**Requirement.** Editing a `live` page changes what readers see only when it is republished: every reader other than the editors sees the published revision, and the page shows that it has unpublished changes to anyone who may edit it.

**Acceptance.**
1. Discarding them restores the published revision as the working revision and deletes no version.
2. Readers see the published revision until republish; discard restores it without deleting a version.

**Evidence.** `tests/flagship/content/http.test.ts` — publication, human verification and media enforce current reader authority; `tests/qualification/ui-convergence/journeys.test.mjs` — page creation destinations and editor locks preserve readable content at 1440px (publication steps in `tests/qualification/interface/publication.mjs`).
**Gap.** None.

#### LIFE-006 — Lifecycle profile

Core · published · **partial**

**Requirement.** *Policy: `page.lifecycle.v1`; default: `always-live`, following Notion.

**Acceptance.**
1. Under `always-live` a new page is live from creation and the product hides the publish action and its modal, close and discard draft, the draft banner, the draft chip in the tree, the scheduled state, the unpublished-changes state, the version-comment field and the publish-as selector; the page's own share panel (`SHARE-001`) is how it becomes visible to others.
2. Under `draft-then-publish` a new page appears only in its author's tree with a draft chip, nothing is hidden, and `LIFE-003` to `LIFE-005` are the working path.
3. Both values store every state in `LIFE-001`, so a workspace can be switched either way without a migration and an imported draft is never published on arrival.*
4. Profile journeys for `always-live` and `draft-then-publish` show and hide exactly the listed surfaces.

**Evidence.** `tests/qualification/policies/emitted.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/policies/emitted.mjs`.

#### LIFE-007 — Discarding a draft

Core · published · **partial**

**Requirement.** The author of a `draft` page can discard it, which moves it to trash (`ARCH-005`) rather than deleting it, and can close it, which leaves it a draft.

**Acceptance.**
1. Neither action notifies anyone or leaves a trace in another member's tree.
2. Discarding a draft moves it to trash and closing keeps it a draft, notifying no one.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "The author of a `draft` page can discard it, which moves it to trash (`ARCH-005`) rather than deleting it, and can close it, which leaves it a draft."<br>No validated CI-run proof for this acceptance point: "Neither action notifies anyone or leaves a trace in another member's tree."

### Sharing and access

#### SHARE-001 — Grants

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** A page carries an ordered list of grants.

**Acceptance.**
1. Each grant names a principal — a person, a group, a container or the workspace — a level from `full`, `edit`, `comment` and `view`, and an optional expiry.
2. The panel that edits them shows every effective grant, whether it is inherited or set here, and where an inherited one comes from.
3. Grant panel lists every effective grant with inheritance source and optional expiry.

**Evidence.** `tests/qualification/backend/emitted.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/backend/emitted.mjs`.

#### SHARE-002 — What the levels mean

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** `full` may read, edit, comment, share and change access; `edit` may read, edit and comment; `comment` may read and comment; `view` may read only. no interface offers an action the level does not carry.

**Acceptance.**
1. `full` may read, edit, comment, share and change access; `edit` may read, edit and comment; `comment` may read and comment; `view` may read only. no interface offers an action the level does not carry.
2. Server-side level matrix for full, edit, comment and view on every operation; no interface offers an action beyond the level.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "`full` may read, edit, comment, share and change access; `edit` may read, edit and comment; `comment` may read and comment; `view` may read only."<br>No validated CI-run proof for this acceptance point: "Every server operation checks the level for the acting member (`BASE-ACCESS-004`), and no interface offers an action the level does not carry."

#### SHARE-003 — Inheritance

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** A page inherits its parent's grants, and a child added later inherits the parent's grants at that moment.

**Acceptance.**
1. A page may add grants or be restricted, and a restriction is shown on the page and on every descendant it affects.
2. Removing a restriction restores inheritance rather than copying the parent's grants.
3. Children inherit at creation; restriction shown on descendants; removing it restores inheritance.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A page inherits its parent's grants, and a child added later inherits the parent's grants at that moment."<br>No validated CI-run proof for this acceptance point: "A page may add grants or be restricted, and a restriction is shown on the page and on every descendant it affects."<br>No validated CI-run proof for this acceptance point: "Removing a restriction restores inheritance rather than copying the parent's grants."

#### SHARE-004 — General access

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** At most one grant on a page has the container or the workspace as its principal; that is the general access grant.

**Acceptance.**
1. A page that carries none is restricted to its named grants, and a page in a personal container (`CONT-005`) carries none under either value of `SHARE-005`.
2. Changing it is one action and is recorded in activity.
3. At most one general grant; personal-container pages carry none; changing it is one recorded action.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a populated general-access change journey that reads the changed grant and activity and tries the forbidden widening; the cited test parses archive records only.

#### SHARE-005 — Access profile

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** *Policy: `page.access.v1`; default: `workspace-general` with all four levels, following Notion.

**Acceptance.**
1. `workspace-general` makes the workspace the general principal and shows the four-level ladder on each grant.
2. `container-general` makes the container the general principal, labels that row with the container's name, and hides nothing else.
3. Removing a level from the list hides it everywhere, including the comment affordance when `comment` is removed.
4. A page imported with a container-wide general grant is created with a container principal under either value, never widened to the workspace.
5. Switching the value relabels the general access row and rewrites no grant: no value widens an existing page's general principal, and no page gains a general grant it did not already carry.*
6. Profile journeys for `workspace-general` and `container-general` relabel without rewriting grants.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a two-profile grant journey that changes policy and reads retained grants and hidden levels; the cited test parses an incumbent archive only.

#### SHARE-006 — Sharing with a person who is not a member

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** Granting access to an address that belongs to no member creates a guest invitation (`WORK-010`, `MAIL-001`) and the grant takes effect when it is accepted.

**Acceptance.**
1. Until then the page shows the pending grant, and revoking it cancels the invitation.
2. Sharing to a non-member creates a guest invitation, shows the pending grant and revocation cancels it.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Granting access to an address that belongs to no member creates a guest invitation (`WORK-010`, `MAIL-001`) and the grant takes effect when it is accepted."<br>No validated CI-run proof for this acceptance point: "Until then the page shows the pending grant, and revoking it cancels the invitation."

#### SHARE-007 — Access changes take effect at once

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** Removing or narrowing a grant closes an open editor with an explanation rather than silently discarding the writer's unsaved text, and removes the page from that member's search results, tree, inbox items and AI answers within 5 seconds.

**Acceptance.**
1. Removing or narrowing a grant closes an open editor with an explanation rather than silently discarding the writer's unsaved text, and removes the page from that member's search results, tree, inbox items and AI answers within 5 seconds.
2. Narrowing access applies on the next request, closes the editor with an explanation and removes the page from search, tree, inbox and answers within 5 seconds.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Removing or narrowing a grant applies to the next request from every existing session, closes an open editor with an explanation rather than silently discarding the writer's unsaved text, and removes the page from that member's search results, tree, inbox items and AI answers within 5 seconds."

#### SHARE-008 — Expiring grants

Core · published · **partial** · Cites BASE-ROLE-001

**Requirement.** A grant may carry an expiry time.

**Acceptance.**
1. When it passes, access ends under `SHARE-007`, the grant is shown as expired rather than deleted, and re-granting is one action.
2. An expired grant ends access, shows as expired and is re-granted in one action.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A grant may carry an expiry time."<br>No validated CI-run proof for this acceptance point: "When it passes, access ends under `SHARE-007`, the grant is shown as expired rather than deleted, and re-granting is one action."

### Public links

#### WEB-001 — Anonymous access takes two acts

Core · published · **partial** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** A page is readable without signing in only when a member with `full` access publishes it (`WEB-002`), directly or through an explicit bounded revocable owner grant for that exact page or named publication class under `AI-011` and only while its container allows it.

**Acceptance.**
1. Each of the container's three switches (`CONT-007`) vetoes its own act and no other.
2. While public links are forbidden, publishing a page in that container is rejected and every existing public link on its pages stops resolving at once.
3. While anonymous access is forbidden, a published page in that container resolves only for a signed-in member who may read it.
4. While guests are forbidden, a guest invitation to that container or to a page in it is rejected and existing guest access to it ends under `SHARE-007`.
5. Each veto is not gated by a plan or a role beyond container administration, is not a policy value, and no extension, automation or AI action may bypass it.
6. Each delegated publication rechecks the grant, current full access, exact source-audience disclosure rights and target; the company policy for the external class decides agent execution and supplies no audience or veto bypass.
7. Publishing needs full access and container permission; each of the three switches vetoes its own act at once.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** Missing a complete public-door journey for anonymous access takes two acts under the current authority, audience and company policy; prior quoted implementation and policy notes are retained in CHANGELOG.md.

#### WEB-002 — What a published page carries

Core · published · **partial** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** Publishing writes a public exposure record holding the host, a slug the publisher may edit, a search-engine indexing flag, a theme, the set of header controls the page shows, whether readers may duplicate it, and the time it was revoked if it was.

**Acceptance.**
1. The slug is stored, never derived, so an imported public address is preserved exactly; a slug already in use is rejected.
2. Publishing writes the exposure record with an editable stored slug; a used slug is refused.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Publishing writes a public exposure record holding the host, a slug the publisher may edit, a search-engine indexing flag, a theme, the set of header controls the page shows, whether readers may duplicate it, and the time it was revoked if it was."<br>No validated CI-run proof for this acceptance point: "The slug is stored, never derived, so an imported public address is preserved exactly; a slug already in use is rejected."

#### WEB-003 — The anonymous read view

Core · published · **partial** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** A published page renders its published revision and nothing else: no navigation, no editing, no comments, no member names beyond the byline the page itself shows, and no other page unless that page is itself published. it counts a view without identifying the viewer (`PAGE-013`).

**Acceptance.**
1. A published page renders its published revision and nothing else: no navigation, no editing, no comments, no member names beyond the byline the page itself shows, and no other page unless that page is itself published. it counts a view without identifying the viewer (`PAGE-013`).
2. Anonymous view renders only the published revision, sets no cookie and loads no third-party resource.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A published page renders its published revision and nothing else: no navigation, no editing, no comments, no member names beyond the byline the page itself shows, and no other page unless that page is itself published."<br>No validated CI-run proof for this acceptance point: "It sets no cookie, loads nothing from a third-party domain, and sends no visitor data before an interaction (`BASE-PUBLIC-001`), and it counts a view without identifying the viewer (`PAGE-013`)."

#### WEB-004 — Children are not published by inheritance

Core · published · **partial** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** Publishing one page publishes only that page unless the publisher explicitly includes its children, and a child added later is not published until someone publishes it.

**Acceptance.**
1. A link from a published page to an unpublished one is rendered as text, not as a link that would return a sign-in page.
2. Children are not published by inheritance; links to unpublished pages render as text.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Publishing one page publishes only that page unless the publisher explicitly includes its children, and a child added later is not published until someone publishes it."<br>No validated CI-run proof for this acceptance point: "A link from a published page to an unpublished one is rendered as text, not as a link that would return a sign-in page."

#### WEB-005 — Indexing is off until it is chosen

Core · published · **partial** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** Search-engine indexing is off for a newly published page: the response and the served document tell crawlers not to index it until a member turns indexing on, and turning it off again restores that state within one request.

**Acceptance.**
1. Search-engine indexing is off for a newly published page: the response and the served document tell crawlers not to index it until a member turns indexing on, and turning it off again restores that state within one request.
2. A new publication is noindex until indexing is turned on; turning it off restores noindex in one request.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Search-engine indexing is off for a newly published page: the response and the served document tell crawlers not to index it until a member turns indexing on, and turning it off again restores that state within one request."

#### WEB-006 — Unpublish

Core · published · **partial** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** Unpublishing stops the address resolving within 5 seconds, returns a content-free page saying the link is no longer available, and keeps the slug reserved for that page so republishing restores the same address.

**Acceptance.**
1. It deletes no version and changes no grant.
2. Unpublish stops the address within 5 seconds with a content-free page and keeps the slug reserved.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Unpublishing stops the address resolving within 5 seconds, returns a content-free page saying the link is no longer available, and keeps the slug reserved for that page so republishing restores the same address."<br>No validated CI-run proof for this acceptance point: "It deletes no version and changes no grant."

#### WEB-007 — Public-link profile

Core · published · **partial** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** *Policy: `page.public-access.v1`; default: `site`, following Notion.

**Acceptance.**
1. `site` shows the host and slug fields, the theme, the header controls, the duplicate-as-template switch, social preview settings and the live-site banner over the page.
2. `link` hides all of those and shows a single toggle, the resulting URL, the indexing switch and unpublish.
3. Both values store the whole record in `WEB-002`, so a workspace switched to `link` keeps the slug and theme an imported or previously published page already had.*
4. Profile journeys for `site` and `link` show and hide exactly the listed controls and keep the stored record.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "`site` shows the host and slug fields, the theme, the header controls, the duplicate-as-template switch, social preview settings and the live-site banner over the page."<br>No validated CI-run proof for this acceptance point: "`link` hides all of those and shows a single toggle, the resulting URL, the indexing switch and unpublish."<br>No validated CI-run proof for this acceptance point: "Both values store the whole record in `WEB-002`, so a workspace switched to `link` keeps the slug and theme an imported or previously published page already had."

### Versions

#### REV-001 — What a revision is

Core · published · **partial**

**Requirement.** Every page, record, container, comment, template and decision record (`DEC-001`) carries a revision identifier that changes on every committed edit and is never reused. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. A page revision is immutable: it holds the body and properties as committed, its author, its time, its origin of `autosave` or `publish`, and a content hash, being SHA-256 of the revision's extracted text after Unicode NFC normalization and whitespace collapse.
2. A retried write whose hash matches the latest revision commits nothing.
3. Wherever another clause names a revision, it means this identifier.
4. Every committed edit writes an immutable revision with author, time, origin and content hash; a matching-hash retry commits nothing.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every page, record, container, comment, template and decision record (`DEC-001`) carries a revision identifier that changes on every committed edit and is never reused."<br>No validated CI-run proof for this acceptance point: "A page revision is immutable: it holds the body and properties as committed, its author, its time, its origin of `autosave` or `publish`, and a content hash, being SHA-256 of the revision's extracted text after Unicode NFC normalization and whitespace collapse."<br>No validated CI-run proof for this acceptance point: "A retried write whose hash matches the latest revision commits nothing."<br>No validated CI-run proof for this acceptance point: "Wherever another clause names a revision, it means this identifier."

#### REV-002 — History

Core · published · **partial**

**Requirement.** Each of those records has a history listing its revisions newest first with the actor, the time, the origin, and, where `REV-007` assigns them, an ordinal and a label.

**Acceptance.**
1. History is readable by anyone who may read the record and is never editable.
2. History lists revisions newest first with actor, time and origin, readable by readers and never editable.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Each of those records has a history listing its revisions newest first with the actor, the time, the origin, and, where `REV-007` assigns them, an ordinal and a label."<br>No validated CI-run proof for this acceptance point: "History is readable by anyone who may read the record and is never editable."

#### REV-003 — Restore

Core · published · **partial**

**Requirement.** A member with edit access can restore a previous revision.

**Acceptance.**
1. Restoring writes a new revision holding the earlier content, records who restored which revision in activity, and changes no link, comment anchor, child page, grant or public link.
2. Restore writes a new revision and changes no link, anchor, child, grant or public link.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member with edit access can restore a previous revision."<br>No validated CI-run proof for this acceptance point: "Restoring writes a new revision holding the earlier content, records who restored which revision in activity, and changes no link, comment anchor, child page, grant or public link."

#### REV-004 — Compare

Core · published · **partial**

**Requirement.** Any two revisions of one page can be compared, showing added, removed and changed blocks in place.

**Acceptance.**
1. Compare is available under every value of `REV-007`.
2. Any two revisions compare with added, removed and changed blocks under both version policy values.

**Evidence.** `tests/e2e/review/verification-flow.test.ts`
**Gap.** Missing a block-diff journey showing added, removed and changed blocks under both version profiles; the cited verification flow compares page title properties only.

#### REV-005 — A citation resolves to its revision

Core · published · **partial**

**Requirement.** A link, mention or AI citation that names a revision opens that revision with its content as committed, even after the page has changed, and says that a newer revision exists.

**Acceptance.**
1. The reader's access is checked against the page as it is now: a member who may not read the page today gets `LINK-004` and no historical content, an anonymous reader gets nothing unless the page is published (`WEB-001`), and no grant that has since been removed or expired reopens a revision.
2. When the page has been erased it opens a content-free tombstone (`LINK-002`) carrying no body, quote or personal metadata.
3. A revision link opens that revision with a newer-revision notice, checked against current access, and a tombstone after erasure.

**Evidence.** `tests/e2e/review/verification-flow.test.ts`
**Gap.** Missing a citation journey that opens an exact old revision, revokes and expires access, then reads anonymous and erased states without disclosure; the cited verification flow reads an old revision and newer-version notice only.

#### REV-006 — Deleting a version

Core · published · **partial**

**Requirement.** A member with `full` access can delete one intermediate version, which removes its content and leaves a numbered tombstone in history naming who deleted it and when.

**Acceptance.**
1. The current revision and the published revision cannot be deleted, and deletion is offered only where `REV-007` says so.
2. Full-access member deletes an intermediate version leaving a numbered tombstone; current and published versions cannot be deleted.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member with `full` access can delete one intermediate version, which removes its content and leaves a numbered tombstone in history naming who deleted it and when."<br>No validated CI-run proof for this acceptance point: "The current revision and the published revision cannot be deleted, and deletion is offered only where `REV-007` says so."

#### REV-007 — Version profile

Core · published · **partial**

**Requirement.** *Policy: `page.version.v1`; default: `autosnapshot`, following Notion.

**Acceptance.**
1. `autosnapshot` writes a revision on save, assigns no ordinal or label, and hides the version and comment columns, the version-comment field and version deletion, keeping selection, compare, restore and difference summaries.
2. `labelled` numbers each published revision, carries the version comment taken at publish and the page's status at that moment, and hides nothing.
3. Ordinals come from publish events, so a workspace with `page.lifecycle.v1` at `always-live` and this policy at `labelled` numbers nothing until a page is published; the model stores the ordinal and label fields under both values, so an imported numbered history is never discarded.*
4. Profile journeys for `autosnapshot` and `labelled` show and hide exactly the listed columns and fields.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a save/publish/history journey under both version profiles, including preserved imported numbering; the cited test parses imported ordinals without exercising history controls.

### Page status and verification

#### STAT-001 — The status vocabulary

Core · published · **partial**

**Requirement.** The workspace holds a list of status entries, each with a key, a label, a color and an optional verification requirement.

**Acceptance.**
1. It ships seeded with Rough draft, In progress, Ready for review and Verified under every value of `STAT-005`, and a workspace owner can add, rename, recolor and retire entries.
2. Retiring an entry keeps it on the pages that carry it and offers a bulk change (`CONT-006`).
3. Seeded vocabulary present; owner adds, renames, recolors and retires entries without stripping pages.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "The workspace holds a list of status entries, each with a key, a label, a color and an optional verification requirement."<br>No validated CI-run proof for this acceptance point: "It ships seeded with Rough draft, In progress, Ready for review and Verified under every value of `STAT-005`, and a workspace owner can add, rename, recolor and retire entries."<br>No validated CI-run proof for this acceptance point: "Retiring an entry keeps it on the pages that carry it and offers a bulk change (`CONT-006`)."

#### STAT-002 — A page's status

Core · published · **partial**

**Requirement.** A page carries at most one status.

**Acceptance.**
1. Setting or clearing it is one action for anyone with edit access, writes one activity entry, and makes the page findable by that status in search (`SEARCH-003`) and in content queries (`BLOCK-010`).
2. Setting a status is one recorded action and makes the page findable by status.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A page carries at most one status."<br>No validated CI-run proof for this acceptance point: "Setting or clearing it is one action for anyone with edit access, writes one activity entry, and makes the page findable by that status in search (`SEARCH-003`) and in content queries (`BLOCK-010`)."

#### STAT-003 — Verification

Core · published · **done**

**Requirement.** Setting a status entry that requires verification records the verifying member as its owner and an expiry of 7, 30 or 90 days, a chosen date, or none, and can be set only by a member who has opened the exact revision they are attesting to.

**Acceptance.**
1. The badge shows the owner, the expiry and the revision verified, and editing the page after verification shows that the verified revision is not the current one.
2. Only a member who opened the exact revision can verify; the badge shows owner, expiry and revision, and later edits show it is not current.

**Evidence.** `tests/e2e/review/verification-flow.test.ts` — "Verifying offers 7, 30 or 90 days, a date or none, only on the opened revision, and an edit makes it not current"
**Gap.** None.

#### STAT-004 — Verification lapses

Core · published · **partial**

**Requirement.** When an expiry passes, the page shows the status as lapsed rather than verified, notifies the owner once (`NOTIF-001`), and keeps the original verification in history.

**Acceptance.**
1. No automatic timer renews a person’s attestation; an agent’s distinct verification carries commitment under the company policy (`AI-011`), and a lapsed verification never reads as current in search results, content queries, AI answers or exports.
2. Lapse shows lapsed, notifies the owner once and never reads as current in search, queries, answers or exports.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** Missing a complete public-door journey for verification lapses under the current authority, audience and company policy; prior quoted implementation and policy notes are retained in CHANGELOG.md.

#### STAT-005 — Status profile

Core · published · **partial**

**Requirement.** *Policy: `page.status.v1`; default: `verification-only`, following Notion.

**Acceptance.**
1. `verification-only` exposes only the entries that require verification, hides the color picker and the custom-status field, offers the control from the title's own hover row, and renders the chip beside the breadcrumb title.
2. `open-vocabulary` exposes every entry, shows the color picker and a custom label of at most twenty characters, and renders the chip on the byline between the author and the reading time.
3. Both values store the whole vocabulary, so switching exposes or hides entries and rewrites no page.*
4. Profile journeys for `verification-only` and `open-vocabulary` show and hide exactly the listed controls.

**Evidence.** `tests/qualification/policies/emitted.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/policies/emitted.mjs`.

### Comments

#### COMM-001 — Two kinds of thread

Core · published · **partial**

**Requirement.** A member with `comment` access or more can open an inline thread anchored to a selection in a block, and a page thread about the page as a whole.

**Acceptance.**
1. A thread is chronological, is Open or Resolved, and records each comment's author and time.
2. Both kinds are threads; only their anchor differs.
3. Inline and page threads by comment-level members, chronological, Open or Resolved.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member with `comment` access or more can open an inline thread anchored to a selection in a block, and a page thread about the page as a whole."<br>No validated CI-run proof for this acceptance point: "A thread is chronological, is Open or Resolved, and records each comment's author and time."<br>No validated CI-run proof for this acceptance point: "Both kinds are threads; only their anchor differs."

#### COMM-002 — Editing and deletion

Core · published · **partial**

**Requirement.** A member can edit or delete only their own comments.

**Acceptance.**
1. An edited comment shows the time it was last edited, a deleted comment leaves a tombstone in place, and both write an activity entry.
2. Members edit or delete only their own comments; edits are timestamped and deletions leave tombstones.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member can edit or delete only their own comments."<br>No validated CI-run proof for this acceptance point: "An edited comment shows the time it was last edited, a deleted comment leaves a tombstone in place, and both write an activity entry."

#### COMM-003 — Mentions

Core · published · **done**

**Requirement.** Mentioning a member in a comment creates one unread notification (`NOTIF-001`) linked to that comment, and mentions no one who cannot read the page.

**Acceptance.**
1. Editing the comment notifies only a member the comment did not already mention.
2. A mention notifies once and never a member who cannot read the page; editing notifies only new mentions.

**Evidence.** `tests/qualification/ui-convergence/journeys.test.mjs` — "group mentions preview readers and refuse oversized groups at 1440px", including `tests/qualification/ui-convergence/comment-mentions.mjs` — "commentMentionsJourney" (one unread comment-linked notice, unreadable recipients excluded, new mentions only on edit and replay-safe delivery).
**Gap.** None.

#### COMM-004 — Anchors survive editing

Core · published · **done**

**Requirement.** An inline thread follows its text through edits, splits and moves within the page.

**Acceptance.**
1. When its text is deleted the thread becomes orphaned rather than lost: it stays in the discussions panel, names the revision it was anchored in, and opens that revision (`REV-005`).
2. Inline threads follow text through edits and become orphaned, not lost, naming their revision.

**Evidence.** `tests/qualification/ui-convergence/journeys.test.mjs` — "page and comment reactions identify people without notifications or views at 1440px", including `tests/qualification/ui-convergence/comment-anchors.mjs` — "commentAnchorsJourney" (edits within selected text, splits, moves, retained orphaned discussion, named original revision and exact snapshot navigation).
**Gap.** None.

#### COMM-005 — Reactions

Core · published · **done**

**Requirement.** A member can add and remove an emoji reaction on any comment they can read.

**Acceptance.**
1. Reactions show who reacted and never notify.
2. Comment reactions show who reacted and never notify.

**Evidence.** `tests/qualification/ui-convergence/journeys.test.mjs` — "page and comment reactions identify people without notifications or views at 1440px", using `tests/qualification/ui-convergence/reactions-journey.mjs` — "reactionsJourney" (named reader, add and remove, unchanged inbox and keyboard tooltip); `tests/e2e/pages/reactions.test.ts` — "PAGE-014 page and comment reactions identify each member, toggle independently and never notify or count as views" (view-only reader and denied access).
**Gap.** None.

#### COMM-006 — Discussions panel

Core · published · **done**

**Requirement.** One panel lists every thread on the page, filtered by kind, status and person, with an action that resolves all open threads.

**Acceptance.**
1. It shows unresolved threads whose anchor is orphaned, and selecting a thread scrolls to its anchor.
2. Discussions panel filters by kind, status and person, shows orphaned threads and resolves all.

**Evidence.** `tests/qualification/ui-convergence/journeys.test.mjs` — "page and comment reactions identify people without notifications or views at 1440px", using `tests/qualification/ui-convergence/discussions-journey.mjs` — "discussionsJourney" (combined kind, status and participant filters, replies, visible orphan, resolve-all across hidden threads and persisted states) and `tests/qualification/ui-convergence/comment-anchors.mjs` — "commentAnchorsJourney" (selecting an offscreen anchor scrolls it into view).
**Gap.** None.

#### COMM-007 — Resolve

Core · published · **partial**

**Requirement.** Any member with `comment` access can resolve or reopen a thread.

**Acceptance.**
1. A resolved thread is hidden from the page body, stays readable in the panel and in search, and keeps its comments and reactions.
2. Resolve and reopen by comment-level members; resolved threads stay readable and searchable.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Any member with `comment` access can resolve or reopen a thread."<br>No validated CI-run proof for this acceptance point: "A resolved thread is hidden from the page body, stays readable in the panel and in search, and keeps its comments and reactions."

### Archive, trash and deletion

#### ARCH-001 — Archive

Core · published · **partial** · Cites BASE-DATA-002, BASE-DATA-003, BASE-DATA-006

**Requirement.** A page, a container or a database can be archived.

**Acceptance.**
1. Archiving records the actor, the time, the prior location and an optional reason, and archives the record's descendants with it.
2. Archiving records actor, time, prior location and reason and archives descendants.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A page, a container or a database can be archived."<br>No validated CI-run proof for this acceptance point: "Archiving records the actor, the time, the prior location and an optional reason, and archives the record's descendants with it."

#### ARCH-002 — What archived means

Core · published · **partial** · Cites BASE-DATA-002, BASE-DATA-003, BASE-DATA-006

**Requirement.** An archived record is read-only, is absent from the tree, from default search (`SEARCH-009`), from content queries and from AI grounding, and its existing links, mentions and citations still resolve.

**Acceptance.**
1. It is discoverable by the archived filter, and its comments, versions and grants are unchanged.
2. Archived records are read-only and absent from tree, default search, queries and grounding while links still resolve.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "An archived record is read-only, is absent from the tree, from default search (`SEARCH-009`), from content queries and from AI grounding, and its existing links, mentions and citations still resolve."<br>No validated CI-run proof for this acceptance point: "It is discoverable by the archived filter, and its comments, versions and grants are unchanged."

#### ARCH-003 — Restore from archive

Core · published · **partial** · Cites BASE-DATA-002, BASE-DATA-003, BASE-DATA-006

**Requirement.** Restoring returns a record to its prior parent and position with the same identifiers, revisions, comments, grants and status.

**Acceptance.**
1. Where the prior parent is gone, the member chooses a destination before the restore completes.
2. Restore returns to the prior parent with identifiers, revisions, comments, grants and status, or asks for a destination.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Restoring returns a record to its prior parent and position with the same identifiers, revisions, comments, grants and status."<br>No validated CI-run proof for this acceptance point: "Where the prior parent is gone, the member chooses a destination before the restore completes."

#### ARCH-004 — Archive is not deletion

Core · published · **partial** · Cites BASE-DATA-002, BASE-DATA-003, BASE-DATA-006

**Requirement.** Archiving deletes no data.

**Acceptance.**
1. Permanent deletion is a separate confirmed action governed by `BASE-DATA-002`, `BASE-DATA-003` and `ARCH-006`.
2. Archiving deletes no data; permanent deletion is separate.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Archiving deletes no data."<br>No validated CI-run proof for this acceptance point: "Permanent deletion is a separate confirmed action governed by `BASE-DATA-002`, `BASE-DATA-003` and `ARCH-006`."

#### ARCH-005 — Trash

Core · published · **partial** · Cites BASE-DATA-002, BASE-DATA-003, BASE-DATA-006

**Requirement.** Deleting a page moves it and its descendants to the trash, where they are listed with the deleting member, the time and the prior location, searchable and filterable within the trash, and restorable to their prior place.

**Acceptance.**
1. Nothing leaves the trash on a timer (`BASE-DATA-002`), and a page in the trash is absent from every surface but the trash itself.
2. Trash lists who, when and where, is searchable and restores to the prior place; nothing expires on a timer.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Deleting a page moves it and its descendants to the trash, where they are listed with the deleting member, the time and the prior location, searchable and filterable within the trash, and restorable to their prior place."<br>No validated CI-run proof for this acceptance point: "Nothing leaves the trash on a timer (`BASE-DATA-002`), and a page in the trash is absent from every surface but the trash itself."

#### ARCH-006 — Permanent deletion

Core · published · **partial** · Cites BASE-DATA-002, BASE-DATA-003, BASE-DATA-006

**Requirement.** Emptying the trash, or permanently deleting one record in it, is explicit and confirmed, names what will be destroyed, and removes the body, every revision, uploaded files, comments, analytics rows and AI grounding within the cascade deadline in `BASE-DATA-003`.

**Acceptance.**
1. Every link to it then resolves to a content-free tombstone (`LINK-002`), and activity entries survive with their references anonymized.
2. Confirmed permanent deletion removes body, revisions, files, comments, analytics and grounding within the cascade deadline, leaving tombstones.

**Evidence.** `tests/qualification/erasure-metadata/atomic-custody.test.ts` — "Erasure ARCH-006 BASE-DATA-003 PORT-001 PORT-002: atomic page and member custody erasure survives cleanup failure, restore and re-export"
**Gap.** Missing a public erasure journey executing allowed deletion and an unsafe refused deletion with readback of bodies, revisions, files, comments, analytics, grounding, tombstones and activity; the cited test exercises erasure services and import-custody recovery directly.

### Containers

#### CONT-001 — What a container is

Core · published · **partial**

**Requirement.** A container has an identifier, an optional key, an icon, a name, a description, owners, a visibility of `default`, `open`, `closed`, `private` or `personal`, a grant list shaped like a page's, and external-access switches (`CONT-007`).

**Acceptance.**
1. It holds one page tree (`TREE-001`) and the databases in that tree.
2. A container carries every listed attribute and holds one tree.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A container has an identifier, an optional key, an icon, a name, a description, owners, a visibility of `default`, `open`, `closed`, `private` or `personal`, a grant list shaped like a page's, and external-access switches (`CONT-007`)."<br>No validated CI-run proof for this acceptance point: "It holds one page tree (`TREE-001`) and the databases in that tree."

#### CONT-002 — Creating a container

Core · published · **partial**

**Requirement.** A workspace owner or, where the workspace allows it, any member can create a container from a form taking an icon, a name, a description, a visibility and an optional key, and a purpose that sets the form's defaults.

**Acceptance.**
1. A purpose supplies default values only; it creates no second kind of container and nothing about the container is unreachable afterwards.
2. Container creation form with purpose defaults that create no second kind of container.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A workspace owner or, where the workspace allows it, any member can create a container from a form taking an icon, a name, a description, a visibility and an optional key, and a purpose that sets the form's defaults."<br>No validated CI-run proof for this acceptance point: "A purpose supplies default values only; it creates no second kind of container and nothing about the container is unreachable afterwards."

#### CONT-003 — The container index

Core · published · **partial**

**Requirement.** One index lists every container the member may see with its name, description, access and member count, filtered by membership, visibility and whether it is personal, and opens each one.

**Acceptance.**
1. Containers a member cannot see are neither listed nor counted.
2. Index lists and counts only containers the member may see.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "One index lists every container the member may see with its name, description, access and member count, filtered by membership, visibility and whether it is personal, and opens each one."<br>No validated CI-run proof for this acceptance point: "Containers a member cannot see are neither listed nor counted."

#### CONT-004 — Container settings

Core · published · **partial**

**Requirement.** Each container has its own settings shell holding its identity, members and grants, external-access switches, templates, trash and bulk tools.

**Acceptance.**
1. It is separate from workspace settings (`WORK-011`) and a container administrator reaches only their own container's.
2. Container settings shell is separate from workspace settings and reachable only by its administrators.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Each container has its own settings shell holding its identity, members and grants, external-access switches, templates, trash and bulk tools."<br>No validated CI-run proof for this acceptance point: "It is separate from workspace settings (`WORK-011`) and a container administrator reaches only their own container's."

#### CONT-005 — Personal containers

Core · published · **partial**

**Requirement.** Every member has one personal container that no other member can be granted access to; its pages are theirs alone until they are moved or shared to another container.

**Acceptance.**
1. Deleting the member archives it under `WORK-007` rather than exposing it.
2. Personal container cannot be shared and is archived on member removal.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a personal-container journey that tries another member grant and reads the archived container after member removal; the cited test only parses personal-space metadata.

#### CONT-006 — Bulk actions

Core · published · **partial**

**Requirement.** A member can select several pages, in a tree or in a container's content list, and archive, trash, move, change owner or change status for all of them in one action.

**Acceptance.**
1. Each selected page records its own change with its own activity entry, each is checked against the acting member's access, and a partial failure names the pages that failed and applies the rest.
2. Bulk archive, trash, move, owner and status changes check each page and report partial failures by name.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A member can select several pages, in a tree or in a container's content list, and archive, trash, move, change owner or change status for all of them in one action."<br>No validated CI-run proof for this acceptance point: "Each selected page records its own change with its own activity entry, each is checked against the acting member's access, and a partial failure names the pages that failed and applies the rest."

#### CONT-007 — External-access switches

Core · published · **partial**

**Requirement.** A container carries three switches — guests, public links and anonymous access — each `allowed` or `forbidden`.

**Acceptance.**
1. A workspace owner sets a workspace-wide value and a container administrator may only narrow it.
2. Forbidding takes effect at once under `WEB-001` and `SHARE-007`.
3. These switches carry no plan, tier or upgrade gate.
4. Three switches per container; containers may only narrow the workspace value; forbidding applies at once.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A container carries three switches — guests, public links and anonymous access — each `allowed` or `forbidden`."<br>No validated CI-run proof for this acceptance point: "A workspace owner sets a workspace-wide value and a container administrator may only narrow it."<br>No validated CI-run proof for this acceptance point: "Forbidding takes effect at once under `WEB-001` and `SHARE-007`."<br>No validated CI-run proof for this acceptance point: "These switches carry no plan, tier or upgrade gate."

#### CONT-008 — Container access profile

Core · published · **partial**

**Requirement.** *Policy: `container.access.v1`; default: `class-led`, following Notion.

**Acceptance.**
1. `class-led` leads with the visibility values in `CONT-001`, each stating who may see and join, and folds the member, group and guest lists behind one manage-access view.
2. `grant-led` leads with tabbed lists of members, groups and guests and an external-access card, and hides the visibility dropdown.
3. Neither value hides the switches in `CONT-007`.
4. Both store visibility and the grant list, so switching relabels the surface and rewrites no grant.*
5. Profile journeys for `class-led` and `grant-led` relabel without rewriting grants.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "`class-led` leads with the visibility values in `CONT-001`, each stating who may see and join, and folds the member, group and guest lists behind one manage-access view."<br>No validated CI-run proof for this acceptance point: "`grant-led` leads with tabbed lists of members, groups and guests and an external-access card, and hides the visibility dropdown."<br>No validated CI-run proof for this acceptance point: "Neither value hides the switches in `CONT-007`."<br>No validated CI-run proof for this acceptance point: "Both store visibility and the grant list, so switching relabels the surface and rewrites no grant."

#### CONT-009 — Container grants

Core · published · **partial**

**Requirement.** A container's grants use the principals and levels of `SHARE-001` and `SHARE-002`, are the source of every page's inherited access, and are editable only by a container administrator or a workspace owner.

**Acceptance.**
1. Every change is recorded in activity and takes effect under `SHARE-007`.
2. Container grants are edited only by container administrators or owners and drive inherited access.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A container's grants use the principals and levels of `SHARE-001` and `SHARE-002`, are the source of every page's inherited access, and are editable only by a container administrator or a workspace owner."<br>No validated CI-run proof for this acceptance point: "Every change is recorded in activity and takes effect under `SHARE-007`."

### Structured records

#### DB-001 — A database

Core · published · **partial**

**Requirement.** A database is a node in the page tree with a name, an icon, typed fields and records.

**Acceptance.**
1. It is created, moved, archived and trashed like a page, and its access follows `SHARE-001`.
2. A database is created, moved, archived and trashed like a page and follows page access.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A database is a node in the page tree with a name, an icon, typed fields and records."<br>No validated CI-run proof for this acceptance point: "It is created, moved, archived and trashed like a page, and its access follows `SHARE-001`."

#### DB-002 — Field types and evaluation

Core · published · **partial**

**Requirement.** Fields support text, number, checkbox, date, select, multi-select, status, person, file, URL, email, phone, place, relation, rollup, formula, created/updated metadata and identifier.

**Acceptance.**
1. Each defines empty value, sort order and import/export representation.
2. Type changes convert every value or reject with the loss named.
3. Relations resolve actual records.
4. Bounded formulas and rollups evaluate typed expressions with explicit null/error semantics, dependency tracking, cycle rejection and resource limits; no arbitrary code or network execution.
5. Recompute affected dependencies after changes.
6. Evaluation and aggregation use current reader-authorized records and never leak restricted values or counts.
7. Preserve imported configuration and unsupported expressions with visible not-recomputed state, never fabricated current values; export and restore retain definitions and dependencies.
8. Every field type converts or names its loss; relations, rollups and formulas evaluate over reader-authorized records with cycles rejected.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Fields support text, number, checkbox, date, select, multi-select, status, person, file, URL, email, phone, place, relation, rollup, formula, created/updated metadata and identifier."<br>No validated CI-run proof for this acceptance point: "Each defines empty value, sort order and import/export representation."<br>No validated CI-run proof for this acceptance point: "Type changes convert every value or reject with the loss named."<br>No validated CI-run proof for this acceptance point: "Relations resolve actual records."<br>No validated CI-run proof for this acceptance point: "Bounded formulas and rollups evaluate typed expressions with explicit null/error semantics, dependency tracking, cycle rejection and resource limits; no arbitrary code or network execution."<br>No validated CI-run proof for this acceptance point: "Recompute affected dependencies after changes."<br>No validated CI-run proof for this acceptance point: "Evaluation and aggregation use current reader-authorized records and never leak restricted values or counts."<br>No validated CI-run proof for this acceptance point: "Preserve imported configuration and unsupported expressions with visible not-recomputed state, never fabricated current values; export and restore retain definitions and dependencies."

#### DB-003 — Views

Core · published · **partial**

**Requirement.** A database has several named views over one set of records.

**Acceptance.**
1. A view is saved for everyone who can see the database, is renamed, duplicated and deleted by anyone with edit access, and never changes the records it shows.
2. Named views are shared, renamed, duplicated and deleted without changing records.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A database has several named views over one set of records."<br>No validated CI-run proof for this acceptance point: "A view is saved for everyone who can see the database, is renamed, duplicated and deleted by anyone with edit access, and never changes the records it shows."

#### DB-004 — Layouts

Core · published · **partial**

**Requirement.** A view is a table, a board, a list, a gallery, a calendar or a timeline.

**Acceptance.**
1. A board or calendar requires the field it groups or dates by, and offers to create it rather than failing when it is missing.
2. Table, board, list, gallery, calendar and timeline layouts; a missing group or date field is offered for creation.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A view is a table, a board, a list, a gallery, a calendar or a timeline."<br>No validated CI-run proof for this acceptance point: "A board or calendar requires the field it groups or dates by, and offers to create it rather than failing when it is missing."

#### DB-005 — Filter and sort

Core · published · **partial**

**Requirement.** A view carries filter rules over any field, combined with and or or, and an ordered list of sorts.

**Acceptance.**
1. Both are stored on the view, are shown in force above the records, and are cleared in one action.
2. Filter rules with and/or and ordered sorts are stored on the view, shown and cleared in one action.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A view carries filter rules over any field, combined with and or or, and an ordered list of sorts."<br>No validated CI-run proof for this acceptance point: "Both are stored on the view, are shown in force above the records, and are cleared in one action."

#### DB-006 — Group

Core · published · **partial**

**Requirement.** A view groups its records by a select, status, person, checkbox or date field, shows the count in each group, allows a record to be moved between groups where the field permits it, and hides empty groups on request.

**Acceptance.**
1. A view groups its records by a select, status, person, checkbox or date field, shows the count in each group, allows a record to be moved between groups where the field permits it, and hides empty groups on request.
2. Grouping shows counts, moves records between groups and hides empty groups.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A view groups its records by a select, status, person, checkbox or date field, shows the count in each group, allows a record to be moved between groups where the field permits it, and hides empty groups on request."

#### DB-007 — Calculations

Core · published · **partial**

**Requirement.** Each column in a table view carries a calculation under it — count, filled, empty, sum, average, minimum, maximum, range or percent — computed over the view's filtered records and updated within 2 seconds of a change.

**Acceptance.**
1. Each column in a table view carries a calculation under it — count, filled, empty, sum, average, minimum, maximum, range or percent — computed over the view's filtered records and updated within 2 seconds of a change.
2. Column calculations over filtered records update within 2 seconds.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Each column in a table view carries a calculation under it — count, filled, empty, sum, average, minimum, maximum, range or percent — computed over the view's filtered records and updated within 2 seconds of a change."

#### DB-008 — Charts

Core · published · **partial**

**Requirement.** A chart is built over one view, showing counts or a numeric field aggregated by a grouping field, and can be embedded in a page (`DB-011`).

**Acceptance.**
1. It reads the same filtered records the view shows and states which view it reads.
2. A chart over one view states its view and embeds in a page.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A chart is built over one view, showing counts or a numeric field aggregated by a grouping field, and can be embedded in a page (`DB-011`)."<br>No validated CI-run proof for this acceptance point: "It reads the same filtered records the view shows and states which view it reads."

#### DB-009 — Lock structure

Core · published · **partial**

**Requirement.** A database's structure can be locked, which rejects field, view, filter, sort and layout changes while allowing record edits, names who locked it, and is unlocked by anyone with `full` access.

**Acceptance.**
1. A database's structure can be locked, which rejects field, view, filter, sort and layout changes while allowing record edits, names who locked it, and is unlocked by anyone with `full` access.
2. Locked structure rejects field and view changes while records stay editable.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A database's structure can be locked, which rejects field, view, filter, sort and layout changes while allowing record edits, names who locked it, and is unlocked by anyone with `full` access."

#### DB-010 — A record is a page

Core · published · **partial**

**Requirement.** Every record has an identifier that is also a page identifier, a field map, an optional body of blocks, an optional icon and an optional position in the tree.

**Acceptance.**
1. *Policy: `record.page-parity.v1`; default: `record-is-page`, following Notion.
2. `record-is-page` shows the per-record icon, opens a record as a side peek, a center peek or a full page, offers its body, and lists it in the tree and in page search.
3. `record-is-row` opens a record as a field list with a print action, and hides the icon, the body area, the tree position and the record from page search.
4. The body is stored under both values and is never dropped, so a workspace can be switched back and an imported record with a body keeps it.*
5. Profile journeys for `record-is-page` and `record-is-row` keep the body under both values.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every record has an identifier that is also a page identifier, a field map, an optional body of blocks, an optional icon and an optional position in the tree."<br>No validated CI-run proof for this acceptance point: "`record-is-page` shows the per-record icon, opens a record as a side peek, a center peek or a full page, offers its body, and lists it in the tree and in page search."<br>No validated CI-run proof for this acceptance point: "`record-is-row` opens a record as a field list with a print action, and hides the icon, the body area, the tree position and the record from page search."<br>No validated CI-run proof for this acceptance point: "The body is stored under both values and is never dropped, so a workspace can be switched back and an imported record with a body keeps it."

#### DB-011 — A view inside a page

Core · published · **partial**

**Requirement.** A view can be embedded in a page body and stays live: it shows each reader only the records that reader may read, reflects a change to the source within 5 seconds, and carries its own filters and sorts without changing the source view.

**Acceptance.**
1. A view can be embedded in a page body and stays live: it shows each reader only the records that reader may read, reflects a change to the source within 5 seconds, and carries its own filters and sorts without changing the source view.
2. An embedded view shows only readable records, reflects changes within 5 seconds and keeps its own filters.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A view can be embedded in a page body and stays live: it shows each reader only the records that reader may read, reflects a change to the source within 5 seconds, and carries its own filters and sorts without changing the source view."

#### DB-012 — Record detail

Core · published · **partial**

**Requirement.** Opening a record shows its fields in a defined order with inline editing, its comments and its history (`REV-002`), and, where `DB-010` exposes it, its body.

**Acceptance.**
1. A field a member may not edit is shown and not editable rather than hidden.
2. Record detail shows ordered fields, comments, history and body; uneditable fields are shown read-only.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Opening a record shows its fields in a defined order with inline editing, its comments and its history (`REV-002`), and, where `DB-010` exposes it, its body."<br>No validated CI-run proof for this acceptance point: "A field a member may not edit is shown and not editable rather than hidden."

### Automation

#### AUTO-001 — A rule

Core · published · **partial**

**Requirement.** A rule has a name, a scope, a trigger, ordered conditions, an optional branch over related records, ordered actions, and an actor.

**Acceptance.**
1. Triggers are record and page events and a schedule; actions edit fields, create pages and records, move and archive them, add comments, and send a notification through a configured adapter.
2. A rule with trigger, conditions, branch and actions runs on record events and schedules.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A rule has a name, a scope, a trigger, ordered conditions, an optional branch over related records, ordered actions, and an actor."<br>No validated CI-run proof for this acceptance point: "Triggers are record and page events and a schedule; actions edit fields, create pages and records, move and archive them, add comments, and send a notification through a configured adapter."

#### AUTO-002 — A rule acts as its actor

Core · published · **partial**

**Requirement.** A rule performs only what its actor could perform by hand: every action is checked against that member's access at the moment it runs, and an action that would exceed it is skipped and logged rather than performed.

**Acceptance.**
1. A rule cannot publish or unpublish a page, change grants or external-access switches, verify a page, permanently delete anything, or manage members.
2. Rule actions are checked against the actor at run time; forbidden actions are skipped and logged.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A rule performs only what its actor could perform by hand: every action is checked against that member's access at the moment it runs, and an action that would exceed it is skipped and logged rather than performed."<br>No validated CI-run proof for this acceptance point: "A rule cannot publish or unpublish a page, change grants or external-access switches, verify a page, permanently delete anything, or manage members."

#### AUTO-003 — Run log

Core · published · **partial** · Cites BASE-OPS-004

**Requirement.** Every rule keeps a per-run log with the trigger, the actor, the records touched, the time and one of the states configuration-changed, queued, running, success, no-action, condition-not-met, throttled, error, failure and disabled.

**Acceptance.**
1. A failed run is visible without a search (`BASE-OPS-004`), and a rule that fails repeatedly is disabled and says so.
2. Run log records every listed state; repeated failures disable the rule visibly.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every rule keeps a per-run log with the trigger, the actor, the records touched, the time and one of the states configuration-changed, queued, running, success, no-action, condition-not-met, throttled, error, failure and disabled."<br>No validated CI-run proof for this acceptance point: "A failed run is visible without a search (`BASE-OPS-004`), and a rule that fails repeatedly is disabled and says so."

#### AUTO-004 — Loops are bounded

Core · published · **partial**

**Requirement.** A rule never triggers itself, a chain of rules stops at the depth in `seed.json → limits`, and a run that would exceed the workspace's rate limit is throttled and logged rather than dropped silently.

**Acceptance.**
1. A rule never triggers itself, a chain of rules stops at the depth in `seed.json → limits`, and a run that would exceed the workspace's rate limit is throttled and logged rather than dropped silently.
2. Self-trigger is impossible, chains stop at the declared depth and throttling is logged.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A rule never triggers itself, a chain of rules stops at the depth in `seed.json → limits`, and a run that would exceed the workspace's rate limit is throttled and logged rather than dropped silently."

#### AUTO-005 — Automation profile

Core · published · **partial**

**Requirement.** *Policy: `automation.scope.v1`; default: `source`, following Notion.

**Acceptance.**
1. `source` creates rules from a database's own toolbar, scopes them to that database, shows one When-and-Do form, scopes the run log to that database, and hides the scope selector, the site option, the branch rail and the cross-container rule list.
2. `container` and `site` create rules from a rule list, expose the scope selector and the branch rail, and hide nothing from each other.
3. The scope field and the run log are stored under every value, so an imported container or site rule keeps its scope and its history.*
4. Profile journeys for `source`, `container` and `site` scopes show and hide exactly the listed controls.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "`source` creates rules from a database's own toolbar, scopes them to that database, shows one When-and-Do form, scopes the run log to that database, and hides the scope selector, the site option, the branch rail and the cross-container rule list."<br>No validated CI-run proof for this acceptance point: "`container` and `site` create rules from a rule list, expose the scope selector and the branch rail, and hide nothing from each other."<br>No validated CI-run proof for this acceptance point: "The scope field and the run log are stored under every value, so an imported container or site rule keeps its scope and its history."

### Search

#### SEARCH-001 — Global search

Core · published · **done**

**Requirement.** One search covers page titles and retained body text, record field values, container names and descriptions, comments and templates, and returns the first page of ranked results within 500ms with the total number of matches and an ordering stable across pages.

**Acceptance.**
1. One search covers page titles and retained body text, record field values, container names and descriptions, comments and templates, and returns the first page of ranked results within 500ms with the total number of matches and an ordering stable across pages.
2. One search over titles, bodies, fields, containers, comments and templates returns ranked results within 500ms with stable paging.

**Evidence.** `tests/e2e/search/fts-permissions.test.ts` — "Indexed search uses current native authority for literal matches, totals, facets and cursors", calling `tests/e2e/search/mixed-kinds-journey.ts` — "mixedKindsJourney" (all retained kinds, exact mixed ranking, totals and current-authority cursor traversal); `tests/qualification/ui-convergence/journeys.test.mjs` — "real core-wiki and touch-member journeys at 1440px" and "real core-wiki and touch-member journeys at 390px", calling `tests/qualification/ui-convergence/reading-journeys.mjs` — "searchJourney" and `tests/qualification/ui-convergence/mixed-search-journey.mjs` — "mixedSearchJourney"; `tests/qualification/search/capacity-journey.mjs` — native emitted-Worker HTTP capacity journey with raw first-page latency samples and canonical corpus manifest (exact candidate receipt supplied at handoff).
**Gap.** None.

#### SEARCH-002 — Results

Core · published · **done**

**Requirement.** Each result names its kind, shows the matched text in context, and opens the record with the match highlighted.

**Acceptance.**
1. A quoted query matches only records whose retained text contains that exact phrase.
2. Results name their kind with highlighted context; quoted phrases match exactly.

**Evidence.** `tests/e2e/search/fts-permissions.test.ts` — "Indexed search uses current native authority for literal matches, totals, facets and cursors"; `tests/qualification/ui-convergence/journeys.test.mjs` — "real core-wiki and touch-member journeys at 1440px"; `tests/qualification/ui-convergence/journeys.test.mjs` — "real core-wiki and touch-member journeys at 390px"; `tests/qualification/ui-convergence/reading-journeys.mjs` — "searchJourney"; `tests/qualification/ui-convergence/search-filters-journey.mjs` — "searchFiltersJourney"
**Gap.** None.

#### SEARCH-003 — Filters

Core · published · **done**

**Requirement.** Results are narrowed by kind, container, contributor, status, updated date, and whether archived or trashed records are included, without changing the query text, and the filters in force are shown with the results.

**Acceptance.**
1. Results are narrowed by kind, container, contributor, status, updated date, and whether archived or trashed records are included, without changing the query text, and the filters in force are shown with the results.
2. Filters by kind, container, contributor, status, date and archived or trashed narrow results without changing the query.

**Evidence.** `tests/e2e/search/fts-permissions.test.ts` — "Indexed search uses current native authority for literal matches, totals, facets and cursors"; `tests/qualification/ui-convergence/journeys.test.mjs` — "real core-wiki and touch-member journeys at 1440px"; `tests/qualification/ui-convergence/journeys.test.mjs` — "real core-wiki and touch-member journeys at 390px"; `tests/qualification/ui-convergence/search-filters-journey.mjs` — "searchFiltersJourney"
**Gap.** None.

#### SEARCH-004 — Freshness

Core · published · **done** · Cites BASE-DATA-003

**Requirement.** A committed create, edit, publish, move, archive, restore or delete is reflected in results within 5 seconds.

**Acceptance.**
1. An import is not complete until its records are searchable (`PORT-004`), and content removed under `ARCH-006` stops matching within the cascade deadline in `BASE-DATA-003`.
2. Committed changes are searchable within 5 seconds; erased content stops matching within the cascade deadline.

**Evidence.** `tests/e2e/search/fts-permissions.test.ts` — "Indexed search uses current native authority for literal matches, totals, facets and cursors"; `tests/e2e/search/freshness-journey.ts` — "freshnessJourney"
**Gap.** None.

#### SEARCH-005 — What search never shows

Core · published · **done**

**Requirement.** Search returns only what the searching member may read: no page they lack a grant for, no other member's draft (`LIFE-002`), nothing in another member's personal container (`CONT-005`), and no title, snippet, facet count or result total that would reveal the existence of any of them.

**Acceptance.**
1. Access is the only rule that removes a record from search outright; every other exclusion is a default the member can undo (`SEARCH-009`).
2. No title, snippet, facet or total reveals an unreadable page, another member's draft or a personal container.

**Evidence.** `tests/e2e/search/fts-permissions.test.ts` — "Indexed search uses current native authority for literal matches, totals, facets and cursors"; `tests/e2e/search/freshness-journey.ts` — "freshnessJourney"
**Gap.** None.

#### SEARCH-006 — Search in one container

Core · published · **partial**

**Requirement.** Search can be scoped to one container from that container's own surface, keeps every filter in `SEARCH-003`, and says which container it is scoped to.

**Acceptance.**
1. Search can be scoped to one container from that container's own surface, keeps every filter in `SEARCH-003`, and says which container it is scoped to.
2. Search scoped to one container keeps filters and names its scope.

**Evidence.** `tests/qualification/core/discovery-browser.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery-browser.mjs`.

#### SEARCH-007 — No results

Core · published · **partial**

**Requirement.** When nothing matches, search restates the query and every applied filter, offers one action that clears the filters and one that creates a page with that title, and shows no invented result or answer.

**Acceptance.**
1. When nothing matches, search restates the query and every applied filter, offers one action that clears the filters and one that creates a page with that title, and shows no invented result or answer.
2. No results restates query and filters with clear-filters and create-page actions and no invented answer.

**Evidence.** `tests/qualification/core/discovery-browser.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery-browser.mjs`.

#### SEARCH-008 — Search without AI

Core · published · **partial**

**Requirement.** With the AI provider unconfigured, disabled, failing or over budget, ranked search and every filter still return within 500ms with no error, and the generated answer (`AI-015`) is absent rather than empty.

**Acceptance.**
1. With the AI provider unconfigured, disabled, failing or over budget, ranked search and every filter still return within 500ms with no error, and the generated answer (`AI-015`) is absent rather than empty.
2. With AI unconfigured, disabled or failing, ranked search still answers within 500ms and no answer box appears.

**Evidence.** `tests/qualification/core/discovery.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery.mjs`.

#### SEARCH-009 — Default visibility

Core · published · **partial**

**Requirement.** Search without the archived or trashed filter (`SEARCH-003`) excludes archived and trashed records and nothing else.

**Acceptance.**
1. This is the only rule that hides a record the searching member may read, and every record it hides stays reachable by applying that filter and through every existing link, mention and citation (`LINK-001`, `LINK-003`).
2. Default search excludes only archived and trashed records, which the filter restores.

**Evidence.** `tests/qualification/core/discovery.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery.mjs`.

### Personal surfaces and navigation

#### NAV-001 — Home

Core · published · **done**

**Requirement.** A member's home shows their recent pages, their favorites and the containers they belong to, each entry opening the record.

**Acceptance.**
1. It shows nothing the member may not read and no workspace-wide activity feed.
2. Home shows recents, favorites and containers, only readable, with no workspace feed.

**Evidence.** `tests/qualification/ui-convergence/home-journey.mjs` — "homeJourney", called by "CONT-012 a watched space's create, edit sessions and comment appear once each in Home's Following at 1440px" in `tests/qualification/ui-convergence/journeys.test.mjs`: populated recents, page and container favourites, owned containers, opening every entry, personal visits and immediate removal of revoked entries.
**Gap.** None.

#### NAV-002 — Recents

Core · published · **partial**

**Requirement.** Recently opened pages are listed per member, newest first and grouped by day, and a page appears there for no one but the member who opened it.

**Acceptance.**
1. Recently opened pages are listed per member, newest first and grouped by day, and a page appears there for no one but the member who opened it.
2. Recents are per member, newest first, grouped by day.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Recently opened pages are listed per member, newest first and grouped by day, and a page appears there for no one but the member who opened it."

#### NAV-003 — Favorites

Core · published · **partial**

**Requirement.** Favorited pages and containers (`PAGE-008`) are listed in the navigation, reorderable by the member, and removed from the list in one action.

**Acceptance.**
1. Favorited pages and containers (`PAGE-008`) are listed in the navigation, reorderable by the member, and removed from the list in one action.
2. Favorites are listed, reorderable and removed in one action.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Favorited pages and containers (`PAGE-008`) are listed in the navigation, reorderable by the member, and removed from the list in one action."

#### NAV-004 — One navigation

Core · published · **partial**

**Requirement.** The operator app has one sidebar holding the global destinations, the personal sections and the container trees, collapsible to leave the page full width.

**Acceptance.**
1. Its order and which entries appear come from workspace configuration and from the navigation slot (`workspace.navigation.after.v1`); changing any policy value in this contract changes no entry in it and no entry's position.
2. A container's own navigation nests inside it rather than replacing it.
3. One sidebar whose order comes from configuration and the navigation slot, unchanged by policy values.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "The operator app has one sidebar holding the global destinations, the personal sections and the container trees, collapsible to leave the page full width."<br>No validated CI-run proof for this acceptance point: "Its order and which entries appear come from workspace configuration and from the navigation slot (`workspace.navigation.after.v1`); changing any policy value in this contract changes no entry in it and no entry's position."<br>No validated CI-run proof for this acceptance point: "A container's own navigation nests inside it rather than replacing it."

#### NAV-005 — Global create

Core · published · **done**

**Requirement.** One create action is available from every operator screen and creates a page, a database, a container or a page from a template, naming the destination before it creates.

**Acceptance.**
1. One create action is available from every operator screen and creates a page, a database, a container or a page from a template, naming the destination before it creates.
2. One create action on every operator screen names the destination before creating a page, database, container or template page.

**Evidence.** `tests/qualification/ui-convergence/global-create-journey.mjs` — "globalCreateJourney"
**Gap.** None.

#### NAV-006 — The touch client edits

Core · published · **partial** · Register R-9

**Requirement.** Every operator surface in this contract works at phone width on a touch device, and none of them is read-only there: a member can create and edit a page and its blocks, comment, resolve, publish, share, and use every database layout.

**Acceptance.**
1. Where a gesture cannot carry a desktop interaction, the touch form is named in the same clause — the insert menu from a labeled control above the keyboard (`BLOCK-003`), reordering by a drag handle rather than a hover target (`BLOCK-001`).
2. The responsive application is the baseline; native iOS, Android and desktop apps with offline pages and push notifications are target clauses `MOBILE-001` to `MOBILE-004`.
3. At 390 on touch, every operator surface edits, comments, publishes, shares and uses every database layout.

**Evidence.** `tests/qualification/ui-convergence/touch-page.mjs` — "touchWriteJourney", "touchCommentJourney" and "touchPublishShareJourney"; `tests/qualification/ui-convergence/touch-database.mjs` — "touchDatabaseJourney"; `tests/qualification/ui-convergence/columns-journey.mjs` — "columnsJourney"; `tests/qualification/ui-convergence/touch-operator-journey.mjs` — "touchOperatorJourney" (Search, Inbox, My tasks and requested/health review queues); `tests/qualification/ui-convergence/touch-management-journey.mjs` — "touchManagementJourney" (space settings, Templates, Archive, owner workspace settings); `tests/qualification/ui-convergence/touch-page-tools-journey.mjs` — "touchPageToolsJourney" (history/restore, labels, readable export and presentation); `tests/qualification/ui-convergence/touch-database-tools-journey.mjs` — "touchDatabaseToolsJourney" (charts, record templates, automations and run log). Core-wiki/touch-member launches at 1440px/390px and presentation and starter-template launches at 1440px in `tests/qualification/ui-convergence/journeys.test.mjs` drive touch contexts; controls assert visual-viewport reachability, no overflow, no serious/critical accessibility finding, no browser error and no failed request. `tests/qualification/ui-convergence/synced-journey.mjs` — "syncedJourney" adds touch paragraph conversion, synced-copy insertion/editing and permanent deletion at 1440px in the existing review-request launch. `tests/qualification/ui-convergence/people-journey.mjs` — "peopleJourney" adds directory search, profile edits, hidden expertise and scoped guest people by touch at 1440px.
**Gap.** Touch-only editing remains unproven for block types beyond text, columns and synced paragraphs.

### Notifications

#### NOTIF-001 — Meaningful notifications

Core · published · **partial**

**Requirement.** A member is notified in the app when they are mentioned, when someone comments or replies on a page they watch or authored, when a page they watch is published or republished, when a verification they own lapses (`STAT-004`), when they are granted access to a page or container, and when an AI run they started needs review or failed.

**Acceptance.**
1. Deliver these notices when the triggering event occurs; overdue decision notices go to the decision owner under `DEC-005`.
2. Route an unresolved policy/authority choice to its named owner when the choice blocks action, an actionable paused or failed run to its run owner when it pauses or fails, and a consequential experiment result to its accountable owner when the result is recorded and ready for action.
3. Coalesce related granted maintenance into one concise Today outcome with inspectable changes; routine success permitted by the company policy and unchanged checks stay quiet; policy decides whether an agent step needs a person.
4. Never coalesce away direct mentions, access changes, lapsed human attestations, meaningful failures or required decisions.
5. Own direct actions never notify their actor; delegated events retain the named recipient rules.
6. Recheck recipient access and the authorized output audience at creation, delivery and read; never notify about unreadable records or disclose sources beyond their authorized audience.
7. Preserve `NOTIF-002` inbox behavior, `NOTIF-003` optional link-only chat delivery and `MAIL-001` limited email use.
8. Each listed event notifies its recipient once, rechecks access, never notifies the actor and never discloses unreadable records.

**Evidence.** `tests/flagship/discovery/meaningful-notifications.ts` — "meaningfulNotifications", called by "PAGE-016 — authoring watches respect durable unwatch, personal overrides and workspace defaults" in `tests/flagship/discovery/following.test.ts`; `tests/flagship/intelligence/attention-journey.ts` — "attentionJourney" and run failure and quiet-success cases in `tests/flagship/intelligence/lifecycle.test.ts`; `tests/flagship/release-clauses/authority/impact-scope.test.ts` — "EFFECT-003 — scoped rehearsal and pinned maintenance require exact current authority"; `tests/flagship/release-clauses/trials/outcomes.test.ts` — "TRIAL-003 — persisted conclusions use collected fields and independently checked precision".
**Gap.** Company-policy integration and delegated actionable pauses remain unproven under both held and all-autonomous dispositions. BASE-AGENT-007 owns the shared policy chokepoint; BASELINE.md records its conformance journey as planned and the pinned Base has no agent-door module. Retained default: exact explicit grants permit bounded maintenance, other proposed changes require their named person; no new policy authority is inferred. No live provider result is claimed.

#### NOTIF-002 — Inbox

Core · published · **done**

**Requirement.** Notifications are listed newest first, grouped by period, with an unread count and separate views for those addressed to the member and those from watched pages.

**Acceptance.**
1. Opening one marks it read and opens the referenced record at the referenced comment; a member can mark all read and archive read notifications.
2. Inbox groups by period with unread count and two views; opening marks read and opens the referenced comment.

**Evidence.** `tests/qualification/ui-convergence/inbox-journey.mjs` — "inboxJourney", called by "CONT-012 a watched space's create, edit sessions and comment appear once each in Home's Following at 1440px" in `tests/qualification/ui-convergence/journeys.test.mjs`: populated periods and newest-first order, unread count, Direct and Watching views, opening the referenced comment marks read, mark all read and archive read. `tests/flagship/discovery/meaningful-notifications.ts` — "meaningfulNotifications" in `tests/flagship/discovery/following.test.ts` covers native actions and current access after revocation and erasure.
**Gap.** None.

#### NOTIF-003 — Chat notifications

Core · published · **done** · From NOTIF-003 · Cites BASE-SECRET-002 · Register R-14

**Requirement.** A workspace owner can connect one chat destination through `chat.notifier.v1` and choose which events reach it. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. A message carries the event, the actor, the page title and a link, never the page body, and the link still requires access.
2. The connection shows its last delivery and its last failure, retries only transient transport failures, and stops sending the moment it is disconnected; its credential is encrypted with connector credentials key, returned by no API response, and destroyed on disconnect.
3. An expired or revoked authorization marks the connection as needing attention, offers a reconnect action, and stops sending without deleting the connection, its event selection or its delivery history.
4. `CHAT-001` extends this to any number of Slack, Microsoft Teams and Nook destinations with the same guarantees.

**Evidence.** `tests/e2e/notifications/chat.test.ts` — "NOTIF-007 — chat admission requires fresh authority and keeps link-only delivery inside the current audience"; `tests/qualification/ui-convergence/chat-journey.mjs` — "chatJourney"
**Gap.** None.

#### NOTIF-007 — Slack destination audience admission

Core · published · **done** · From NOTIF-003 · Cites BASE-SECRET-002 · Register R-14

**Requirement.** The single Slack destination and every Slack destination in CHAT-001 admit only the private-channel audience described here. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. A Slack destination is one private channel that is not shared with another Slack workspace or organization.
2. Every person in it, apart from deactivated Slack accounts, must have a Slack email that matches an active member of the workspace, and no bot other than the one sending the messages may be in it.
3. Slate refuses to connect a channel that fails this, rechecks it before every send and sends nothing while it fails, and sends a message about an event only when every such person can read what the event links to immediately before sending.
4. In the default `core-wiki` profile the workspace owner can connect a Slack destination by supplying a Slack bot token, with no `CONNECT-001` source connection needed; a destination authorized any other way, such as through a connected Slack source identity, meets every rule in this clause.

**Evidence.** `tests/e2e/notifications/chat.test.ts` — "NOTIF-007 — chat admission requires fresh authority and keeps link-only delivery inside the current audience"; `tests/qualification/ui-convergence/chat-journey.mjs` — "chatJourney"
**Gap.** None.

### Mail

#### MAIL-001 — Outbound only, two kinds

Core · published · **partial** · Cites BASE-ACCESS-001, BASE-MAIL-001

**Requirement.** Slate sends mail only to deliver a sign-in link (`BASE-ACCESS-001`) and an invitation — a member invitation (`WORK-006`) or a guest invitation (`SHARE-006`) — from the configured sender address through `mail.sender.v1`.

**Acceptance.**
1. No product event sends mail, and Slate accepts no inbound mail: a reply to that address creates and changes nothing.
2. `NOTIF-005` adds notification email and digests that a member opts into, through the same sender; without that opt-in, sign-in and invitation mail remain the only mail Slate sends.
3. Only sign-in and invitation mail is sent; replies create nothing.

**Evidence.** `tests/flagship/core/mail.test.ts`
**Gap.** Missing a native sign-in/invitation mail journey that also attempts inbound reply handling and checks that unrelated wiki events send no mail; the cited mail suite tests adapters and dispatch custody.

#### MAIL-002 — Delivery failure

Core · published · **partial** · Cites BASE-MAIL-001

**Requirement.** A send that fails is retried up to 3 times over 5 minutes when the provider guarantees duplicate suppression for that exact request. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. With SendGrid, explicit rejection is shown for owner retry; ambiguous transport, expired dispatch ownership, or acceptance without a receipt is durably held for provider review with no automatic or explicit blind resend.
2. A send that still fails or remains uncertain is recorded with a safe provider error and shown to a person — on the sign-in screen for a sign-in link, in settings for an invitation — and is never reported as sent.
3. Managed hosting uses Base’s `rer` adapter with RER-assigned mail provider, mail from, mail relay url and private mail api key; no provider account is needed.
4. Relay HTTP 202 establishes acceptance without a provider message ID.
5. Explicit relay throttling is queued within the existing three-attempt budget, no earlier than Retry-After; other relay rejections are visible failures.
6. Ambiguous relay sends and expired dispatch ownership are held for review without blind resend.
7. Retry only with provider duplicate suppression; uncertain sends are held; failures are shown and never reported as sent.

**Evidence.** `tests/flagship/core/mail.node.test.mts`; `tests/flagship/core/mail.test.ts` ("identity mail preserves durable retry, recovery, authentication and provider custody")
**Gap.** Missing a browser sign-in and invitation failure journey that reads the safe failure or uncertain-send state and recovery; the cited mail suites establish provider and durable dispatch behavior below those screens.

### Activity

#### ACT-001 — Durable timeline

Core · published · **partial** · Cites BASE-AUDIT-001, BASE-OPS-005

**Requirement.** Wiki changes and their activity entries commit together. Slate activity identifies the wiki operation and its operation key, automation run or AI run.

**Acceptance.**
1. A page mutation and its activity entry are both present after commit, or neither is present after a failed commit.
2. An entry links to the exact page, revision, comment or grant and records the responsible feature when it is a scheduled wiki operation.

**Evidence.** `tests/qualification/core/discovery.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery.mjs`.

#### ACT-002 — Coverage

Core · published · **partial** · Cites BASE-AUDIT-001

**Requirement.** Activity records page creation, body and property changes, publish and unpublish, moves, archive, trash, restore and permanent deletion, version restores and deletions, status and verification changes, grant and external-access changes, comment activity, container and group changes, database structure changes, automation runs, AI runs and their acceptance or rejection, member invitation and removal, import and export.

**Acceptance.**
1. Activity records page creation, body and property changes, publish and unpublish, moves, archive, trash, restore and permanent deletion, version restores and deletions, status and verification changes, grant and external-access changes, comment activity, container and group changes, database structure changes, automation runs, AI runs and their acceptance or rejection, member invitation and removal, import and export.
2. Each listed action kind produces an activity entry.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Activity records page creation, body and property changes, publish and unpublish, moves, archive, trash, restore and permanent deletion, version restores and deletions, status and verification changes, grant and external-access changes, comment activity, container and group changes, database structure changes, automation runs, AI runs and their acceptance or rejection, member invitation and removal, import and export."

#### ACT-003 — Retrieval

Core · published · **partial** · Cites BASE-AUDIT-001, BASE-ROLE-001

**Requirement.** The activity view filters wiki events by actor, action, record kind, container and date range.

**Acceptance.**
1. Filtering a populated timeline yields only matching wiki events in newest-first order, with stable page boundaries while new events arrive.
2. Opening an entry retains the wiki record context and exposes no unreadable record.

**Evidence.** `tests/qualification/core/discovery.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery.mjs`.

#### ACT-004 — Context

Core · published · **partial** · Cites BASE-AUDIT-001

**Requirement.** Opening an activity entry opens the record it describes together with the comment thread, revision or grant it references, and changes no entry.

**Acceptance.**
1. Opening an activity entry opens the record it describes together with the comment thread, revision or grant it references, and changes no entry.
2. Opening an entry opens the record with its referenced thread, revision or grant.

**Evidence.** `tests/qualification/core/discovery-browser.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery-browser.mjs`.

#### ACT-005 — Retained explanation

Core · published · **partial** · Cites BASE-AUDIT-001, BASE-DATA-003

**Requirement.** Erased wiki records remain understandable in their activity context without retaining erased content.

**Acceptance.**
1. The activity view retains the wiki record’s kind and time and a content-free reference after erasure.

**Evidence.** `tests/qualification/core/discovery.mjs`
**Gap.** evidence tests are not loaded by any Verify job or named scheduled job: `tests/qualification/core/discovery.mjs`.

### Templates

#### TMPL-001 — Gallery

Core · published · **partial**

**Requirement.** Members can search templates by title and description and filter them by category.

**Acceptance.**
1. A search with no match shows "No templates match this search."
2. Template gallery search and category filter with the exact no-match text.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Members can search templates by title and description and filter them by category."<br>No validated CI-run proof for this acceptance point: "A search with no match shows "No templates match this search.""

#### TMPL-002 — Preview

Core · published · **partial**

**Requirement.** A template preview shows the page it produces, including its body, properties and any child pages, before it is used.

**Acceptance.**
1. A figure such as a team size or a duration appears only when the template's author wrote one; Slate never estimates, infers, or displays a placeholder for either.
2. Preview shows the resulting page and children with only author-written figures.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A template preview shows the page it produces, including its body, properties and any child pages, before it is used."<br>No validated CI-run proof for this acceptance point: "A figure such as a team size or a duration appears only when the template's author wrote one; Slate never estimates, infers, or displays a placeholder for either."

#### TMPL-003 — Snapshot on use

Core · published · **partial**

**Requirement.** Using a template creates a page holding a copy of its body, properties and children in the destination the member chose.

**Acceptance.**
1. Editing, archiving or deleting the template afterwards changes no page already created from it.
2. Using a template snapshots it; later template edits change no created page.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Using a template creates a page holding a copy of its body, properties and children in the destination the member chose."<br>No validated CI-run proof for this acceptance point: "Editing, archiving or deleting the template afterwards changes no page already created from it."

#### TMPL-004 — Custom templates

Core · published · **partial**

**Requirement.** Members can create, edit, archive, restore and delete templates.

**Acceptance.**
1. Templates shipped with Slate cannot be edited or deleted and can be duplicated into an editable copy.
2. Custom templates are created, edited, archived, restored and deleted; shipped templates are duplicate-only.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Members can create, edit, archive, restore and delete templates."<br>No validated CI-run proof for this acceptance point: "Templates shipped with Slate cannot be edited or deleted and can be duplicated into an editable copy."

#### TMPL-005 — Save a page as a template

Core · published · **partial**

**Requirement.** Saving a page as a template copies its body, its properties and, on request, its children.

**Acceptance.**
1. It copies no comment, version, grant, watcher, analytics figure, status or public link.
2. Saving a page as a template copies body and properties and none of the excluded records.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.; no validated CI-run proof. Supporting native capture/apply journey: `tests/qualification/ui-convergence/template-capture-journey.mjs` — "templateCaptureJourney", loaded by the existing responsive core-wiki (390px) and starter-template (1440px) journeys in `tests/qualification/ui-convergence/journeys.test.mjs`; exercises authored body and properties, optional children, exclusion of source comments, revisions, grants, watchers, readership, status and public exposure, fresh identifiers, receipt retry and destination-derived authority. This supporting registration retains the current partial judgment and acceptance gaps.
**Gap.** No validated CI-run proof for this acceptance point: "Saving a page as a template copies its body, its properties and, on request, its children."<br>No validated CI-run proof for this acceptance point: "It copies no comment, version, grant, watcher, analytics figure, status or public link."

#### TMPL-006 — Where a template lives

Core · published · **partial**

**Requirement.** A template belongs to the workspace or to one container.

**Acceptance.**
1. A container's templates are offered first inside that container and are not offered elsewhere, and moving a template between the two is one action.
2. Container templates are offered first in their container only; moving scope is one action.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof. Supporting regression: `tests/qualification/ui-convergence/template-scope-journey.mjs` — "templateScopeJourney", invoked by the existing "TMPL-007 starter templates are found by category; touch spaces, templates, archive and workspace settings work at 1440px" journey in `tests/qualification/ui-convergence/journeys.test.mjs`; populated workspace and two readable containers prove exact local-first lists after reload, and one Move collection submission each way retains identifier and snapshot and reconciles all three collections. Main's partial judgment is retained; this supporting proof does not promote acceptance.
**Gap.** No validated CI-run proof for this acceptance point: "A template belongs to the workspace or to one container."<br>No validated CI-run proof for this acceptance point: "A container's templates are offered first inside that container and are not offered elsewhere, and moving a template between the two is one action."

### Import

#### IMP-001 — Import jobs

Core · published · **partial** · From IMP-001 · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** An import is idempotent by operation key (`SAVE-005`), retains its exact supplied original, and names every physical page, database, record, file and version created and every construct it did not map. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. Notion workspace and Confluence space jobs first show a durable Preview with would-create counts, the complete paged loss report, reviewed principal mappings and measured canonical plan size; Preview creates no target tree.
2. Explicit Apply uses that exact review and commits bounded batches with durable journals.
3. Preparing, Running and Indexing progress survives reload and resumes from its committed checkpoint.
4. Incomplete trees stay inaccessible through all native reads and mutations; the whole native tree becomes visible atomically.
5. Completed requires `PORT-004`.
6. Preparation can be canceled without publishing a tree.
7. Failed document imports roll back; interrupted reviewed space imports retain an inaccessible, resumable checkpoint.

**Evidence.** `tests/e2e/imports/preview-undo.test.ts`
**Gap.** Missing a public preparation-cancellation and failed-document rollback journey; the cited reviewed-space journey covers preview, Apply, bounded resume and atomic tree visibility.

#### IMP-015 — Import original, Undo and erasure custody

Core · published · **partial** · From IMP-001 · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** An import retains its exact original and provides Undo after partial or complete Apply without destroying subsequent native work. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. Undo is available after partial or completed Apply: it removes independent unchanged creations, preserves native edits, additions and their required dependencies, and reports each retained conflict as native edit conflict.
2. The original remains downloadable until explicitly deleted or invalidated by privacy erasure.
3. Erasing any imported source under `ARCH-006` invalidates the indivisible retained original and all import recovery custody, makes retry, resume and Undo unavailable with a plain reason, and leaves unaffected native pages in place.

**Evidence.** `tests/e2e/imports/preview-undo.test.ts`
**Gap.** Missing a public page-erasure journey retiring the exact retained original and all retry/resume/Undo custody; the cited flow demonstrates Undo conflicts and member erasure but not erasure of any one imported source.

#### IMP-002 — Notion import

Core · published · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** Slate imports a Notion workspace export in its Markdown and CSV form: pages become pages with their tree and titles, icons and covers where the export carries them, page bodies become blocks of the equivalent types, links between exported pages resolve to the imported pages, CSV databases become databases with typed fields and records, and files become media blocks.

**Acceptance.**
1. Every page arrives live, and the report names what did not map.
2. Its test fixture is an export produced by Notion itself, committed with the test; a fixture written by hand does not satisfy this clause, because the construct-by-construct mapping is only tested against what the incumbent actually emits.
3. A real Notion Markdown and CSV export imports with tree, links, typed databases and files.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a public import journey that opens the resulting Notion tree, database records, media and loss report; the cited incumbent-export test calls the import parser directly.

#### IMP-003 — Confluence import

Core · published · **partial** · From IMP-003 · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** Slate imports a Confluence space export in whichever form the product emits — Confluence Cloud's CSV table export, where `content.csv` carries the tree and the version ledger and `bodycontent.csv` carries storage-format bodies, or the single `entities.xml` a Server or Data Center export writes — and single documents in the forms each editor exports: Word's `.docx`, and a Google Docs document downloaded as `.docx` or as zipped HTML, Google Docs having no file form of its own.

**Acceptance.**
1. Pages retain the tree, labels, version comments and ordinals, status and published state supplied by the export; page and attachment links resolve to the imported records.
2. The report names what did not map, including whiteboards, blogs, calendars and folders, and a folder is imported as a page with an empty body so its tree survives.
3. Its test fixtures are a space export produced by Confluence itself and one document downloaded from each of Word and Google Docs, committed with the test; a fixture written by hand does not satisfy this clause.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a public Confluence, Word and Google Docs import journey that opens the resulting tree, versions, links and loss report; the cited incumbent-export test calls parsers directly.

#### IMP-016 — Imported Confluence principal and restriction mapping

Core · published · **partial** · From IMP-003 · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** Confluence imports carry source restrictions through explicit reviewed source-principal mappings, with conservative recovery access for unresolved restrictions.

**Acceptance.**
1. Pages become pages with their tree, their labels (`PAGE-001`), their versions with their comments and ordinals where the export carries them, their status, and their published state; page and attachment links resolve to the imported records; and named user and group restrictions remain named grants only through explicit reviewed source-principal-ID mappings to existing active same-workspace members or groups.
2. Mapping authority and current membership are validated at Apply and every batch; names and email addresses never activate or implicitly match accounts.
3. Unmapped people remain inactive historical actors.
4. Empty, unknown or unmapped restriction sets preserve restricted inheritance and importing-member recovery access, with unresolved restrictions named in the report.
5. Source edit restrictions conservatively close native inheritance and disclose that conversion.
6. No import publishes an anonymous page.
7. A general grant is container-scoped, never workspace-wide (`SHARE-005`), and a personal container carries no general grant (`SHARE-004`).

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a public reviewed-mapping journey that applies active and unresolved restrictions and tries unsafe principal mapping without widening; the cited incumbent-export test reads parsed source restrictions only.

#### IMP-004 — Import safety

Core · published · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** An import fetches nothing from the network: media comes from the archive, and a link to a file the archive does not contain is imported as a link and named in the report.

**Acceptance.**
1. An import fetches nothing from the network: media comes from the archive, and a link to a file the archive does not contain is imported as a link and named in the report.
2. Imports sanitize every input and fetch nothing from the network.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a public import journey that records network requests for an archive with missing and hostile media and reads the retained links and losses; the cited parser checks do not go through the import door.

#### IMP-005 — Importing into a page

Core · published · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** A member can import a Markdown, HTML, Word, PDF, EPUB, plain text or CSV document into a page or as a set of pages, mapping its headings to blocks and its tables to tables.

**Acceptance.**
1. The same report and the same safety rules apply.
2. Markdown, HTML, Word, PDF, EPUB, text and CSV documents import into pages with headings and tables.

**Evidence.** `tests/flagship/federation/federation.test.ts`
**Gap.** Missing a public page-import journey covering Markdown, HTML, Word, PDF, EPUB, plain text and CSV with headings, tables and losses; the cited federation flow invokes import services directly for a narrower document set.

### Portability

#### PORT-001 — Export contents

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** An export contains workspace settings; members, groups and guests; every container, page, database, record, template, comment thread, notification, automation rule, AI run and activity entry as JSON, with each record's revision history and grants; and every uploaded file in its original form.

**Acceptance.**
1. An export contains workspace settings; members, groups and guests; every container, page, database, record, template, comment thread, notification, automation rule, AI run and activity entry as JSON, with each record's revision history and grants; and every uploaded file in its original form.
2. Workspace export contains every listed record kind with revisions and grants and original files.

**Evidence.** `tests/qualification/erasure-metadata/atomic-custody.test.ts` — "Erasure ARCH-006 BASE-DATA-003 PORT-001 PORT-002: atomic page and member custody erasure survives cleanup failure, restore and re-export"
**Gap.** Missing a public export journey that populates and opens every promised wiki record family, revisions, grants and original files; the cited erasure flow checks retained import custody through service-level export.

#### PORT-002 — Referential restore

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** Importing an archive into an empty deployment restores identifiers, revisions, tree order, grants, links, mentions, comment anchors, public-link slugs and files, so every link from the source deployment resolves to the same record.

**Acceptance.**
1. Importing an archive into an empty deployment restores identifiers, revisions, tree order, grants, links, mentions, comment anchors, public-link slugs and files, so every link from the source deployment resolves to the same record.
2. Restore into an empty deployment keeps identifiers, order, grants, links, anchors, slugs and files.

**Evidence.** `tests/qualification/erasure-metadata/atomic-custody.test.ts` — "Erasure ARCH-006 BASE-DATA-003 PORT-001 PORT-002: atomic page and member custody erasure survives cleanup failure, restore and re-export"
**Gap.** Missing a public empty-install restore journey that opens all restored permanent links, revisions, grants, comments, public slugs and files; the cited erasure flow restores and checks a limited custody fixture through services.

#### PORT-003 — Visible jobs

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** Export and import show Queued, Running, Completed or Failed with record counts and, on failure, a report naming what failed.

**Acceptance.**
1. A failed job is never shown as complete.
2. Export and import jobs show Queued, Running, Completed or Failed with counts and failure reports.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Export and import show Queued, Running, Completed or Failed with record counts and, on failure, a report naming what failed."<br>No validated CI-run proof for this acceptance point: "A failed job is never shown as complete."

#### PORT-004 — Search rebuild

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** An import is not Completed until every imported page and record has its canonical search projection, no imported page has a pending dirty generation, and the records satisfy `SEARCH-001` to `SEARCH-006`.

**Acceptance.**
1. Bounded index rebuilds retain an explicit, resumable Indexing state.
2. Completion is fenced by indexed-ID and dirty-generation readback before any first user search can trigger a lazy refresh.
3. Import completes only after every record has its search projection, fenced by readback.

**Evidence.** `tests/e2e/imports/preview-undo.test.ts`
**Gap.** Missing an import completion journey that reads canonical search and dirty-generation state and checks the promised search behavior before lazy refresh; the cited reviewed-import flow counts indexed pages but does not check the complete search bar.

#### PORT-005 — Access boundary

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** An export excludes sessions, sign-in links, pending invitations, stored operation-key responses and provider secrets. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. An import activates only the member named by setup owner email; every other imported member is an inactive historical actor until invited, and no imported page is published to the anonymous web until a member publishes it.
2. Exports exclude sessions, links, invitations and secrets; import activates only the setup owner and publishes nothing.

**Evidence.** `tests/e2e/imports/real-exports.test.ts`
**Gap.** Missing a public export/restore journey that checks all secret exclusions, sole active owner and unpublished restored pages, then tries an unsafe activation; the cited test parses historical actors only.

#### PORT-006 — Atomic import

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** An import stages records and files outside the live namespace, validates the whole archive, and publishes it in one step.

**Acceptance.**
1. A failed import leaves the deployment empty and can be retried.
2. Import stages, validates and publishes in one step; failure leaves the deployment empty and retryable.

**Evidence.** `tests/qualification/authority/atomic-recovery.test.ts`
**Gap.** Missing a public restore journey that completes and reads a valid restore and refuses a late-failing archive without changing the destination; the cited atomic-recovery test invokes restore services directly.

#### PORT-007 — Exporting a page or a container

Core · published · **partial** · Cites BASE-DATA-001

**Requirement.** A member can export one page, a page with its descendants, or a whole container as Markdown, HTML or PDF, with records as CSV, in one archive with its media.

**Acceptance.**
1. The export is readable without Slate, and re-importing it under `IMP-005` reproduces the tree.
2. `PORT-010` adds Word `.docx` export of a page or a page with its descendants.
3. Page, subtree and container export to Markdown, HTML or PDF with CSV records re-imports to the same tree.

**Evidence.** `tests/flagship/federation/federation.test.ts`
**Gap.** Missing a public page, subtree and container export journey opening Markdown, HTML, PDF and CSV media and re-importing the tree; the cited federation flow invokes readable-export services directly and re-imports a narrower case.

### References and links

#### LINK-001 — Permanent URLs

Core · published · **partial**

**Requirement.** Every page, page revision, container, database, record, comment thread and template has a permanent URL.

**Acceptance.**
1. Renaming a record, moving it, changing its container, archiving it or restoring it never changes that URL, and every existing link, mention, citation, content query and search result continues to resolve to it.
2. Every record kind keeps a permanent URL through rename, move, archive and restore.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every page, page revision, container, database, record, comment thread and template has a permanent URL."<br>No validated CI-run proof for this acceptance point: "Renaming a record, moving it, changing its container, archiving it or restoring it never changes that URL, and every existing link, mention, citation, content query and search result continues to resolve to it."

#### LINK-002 — Tombstones

Core · published · **partial**

**Requirement.** A link to a deleted or erased record resolves to a tombstone naming the record kind and the time it was deleted, not an error page or an empty view, and exposes no erased content or personal metadata.

**Acceptance.**
1. A link to a deleted or erased record resolves to a tombstone naming the record kind and the time it was deleted, not an error page or an empty view, and exposes no erased content or personal metadata.
2. Deleted or erased records resolve to content-free tombstones.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A link to a deleted or erased record resolves to a tombstone naming the record kind and the time it was deleted, not an error page or an empty view, and exposes no erased content or personal metadata."

#### LINK-003 — References follow their target

Core · published · **partial**

**Requirement.** A mention or link to another record renders that record's current title and state, follows renames and moves, and is labeled archived, trashed or deleted rather than removed when its target is.

**Acceptance.**
1. A mention or link to another record renders that record's current title and state, follows renames and moves, and is labeled archived, trashed or deleted rather than removed when its target is.
2. References show current title and state, follow moves and label archived, trashed or deleted targets.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A mention or link to another record renders that record's current title and state, follows renames and moves, and is labeled archived, trashed or deleted rather than removed when its target is."

#### LINK-004 — Links respect access

Core · published · **done**

**Requirement.** A mention or link to a record the reader may not open shows that a linked record exists and that access is needed, and shows no title, snippet, icon or author.

**Acceptance.**
1. Requesting access is one action that notifies a member who can grant it.
2. Links to unreadable records show only that access is needed; request access notifies a granter.

**Evidence.** `tests/qualification/ui-convergence/link-access-journey.mjs` — "linkAccessJourney", called by "shared page invitations name their space and disappear on revocation at 1440px" in `tests/qualification/ui-convergence/journeys.test.mjs`: readable mention and destination, content-free denied mention and page, one-action request, current granter, duplicate suppression and no implicit grant. `tests/flagship/content/mention-access.test.ts` — "LINK-004 — a mentioned page title reaches a reader through no door once their access is removed or expired" covers retained representations and expiry.
**Gap.** None.

### AI

#### AI-001 — Enablement

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** AI is off until an AI provider is configured (`ai.provider.v1`) and a workspace owner turns AI on in settings, which is recorded in activity.

**Acceptance.**
1. While AI is off no run can be started and no request reaches a provider.
2. With no provider or AI off, no run starts and no provider request is made.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-002 — Run lifecycle

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** A member can start selection edits, summaries, workspace answers, agent work and sustained inquiry.

**Acceptance.**
1. Runs move Queued → Running → Needs review or Paused → Running, then Completed, Failed or Canceled.
2. Each Running stage is bounded to ten minutes; exceeding it or encountering an error fails visibly.
3. Scheduled waits and pauses persist their reason and progress and release execution.
4. Any non-terminal run can be canceled.
5. Terminal runs never resume: continued work is a linked new run preserving earlier effects and reconciling ambiguity first.
6. Proposal work completes on explicit acceptance or discard, recording rejection; granted work completes only after every required effect and output check is confirmed.
7. A request created or uncertain effect is not completion.
8. Runs move through the listed states with 10-minute stage bounds, cancellation and no resumption after a terminal state.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-003 — Proposal or bounded delegation

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Runs prepare revision-specific proposals or carry out bounded work according to the company policy for each call’s classes; the source scope, target, audience and conditions remain explicit.

**Acceptance.**
1. Under the held company policy for standard or external edits, an edit is prepared as a proposal and has no product effect until the person named by that policy accepts its exact revision.
2. Under the all-autonomous company policy, a determinate change within the caller’s authority commits with its sources, checks and receipt.
3. Business decisions carry commitment; changes to publication carry external; the company policy decides their execution, and no output supplies its own authority.

**Evidence.** `src/core/features/ai/routes.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-004 — Answer provenance

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Every generated answer, summary and agent output names the pages and revisions it drew on, and each citation opens that revision (`REV-005`).

**Acceptance.**
1. A statement Slate cannot cite is labeled as unsourced and is never presented as drawn from the workspace.
2. Every answer cites exact revisions that open; uncited statements are labeled unsourced.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-005 — Acceptance and granted mutation

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Accepting a proposal applies only selected changes and records accepting member, changes, input revisions, provider and model.

**Acceptance.**
1. Delegated mutation records the exact grant and issuing owner instead of inventing an accepting person.
2. Local mutations, revisions, receipts and activity commit together or not at all.
3. Remote effects retain durable intent and confirmed receipts, never a claim of cross-provider atomicity.
4. Accepted business decisions stay explicit and immutable under DEC-003.
5. Accepting applies only selected changes with full attribution; granted mutation records the grant.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-006 — Current inputs before use

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Before acceptance, resume or effect, recheck source revisions, current source/requester/audience/destination access, applicability, authority and live operational state.

**Acceptance.**
1. Show material changes and the reason for proceeding.
2. A member may regenerate or explicitly accept against current revisions; an agent may regenerate and rebase a determinate step within its unchanged valid grant.
3. Changed business decisions, applicability, permissions or effect scope are reclassified from current facts; the company policy for commitment, access or the effect’s other classes decides agent execution.
4. Never silently commit stale content.
5. Changed revisions, access or authority before acceptance or effect are shown and stale content never commits silently.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-007 — Untrusted content

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Text inside pages, blocks, comments, imported documents, link cards and uploaded files is treated as content, never as instructions: it cannot change a run's scope, tools, destination records, agent permissions or the member's selections.

**Acceptance.**
1. Text inside pages, blocks, comments, imported documents, link cards and uploaded files is treated as content, never as instructions: it cannot change a run's scope, tools, destination records, agent permissions or the member's selections.
2. Instructions inside content cannot change a run's scope, tools, destinations or permissions.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-008 — Failure preserves confirmed work

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Provider, budget, schema or output failure leaves a Failed run; cancellation leaves Canceled, with readable reason and manual actions available.

**Acceptance.**
1. The failed or canceled local stage creates no partial proposal or product mutation.
2. Durable intent, audit and earlier completed stages and confirmed external receipts remain.
3. Cancel unsent future work, reconcile dispatched ambiguity, and display completed effects and unresolved state.
4. Compensation is a separate supported operation with its own valid grant; never assert an external rollback.
5. Provider, budget or schema failure leaves Failed with no partial mutation and preserved confirmed work.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-009 — Retry

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Only transient transport failures are retried, at most 3 attempts over 5 minutes; invalid or unusable output is never retried automatically.

**Acceptance.**
1. A provider response received twice for one run produces one proposal.
2. Only transient transport failures retry, at most 3 times in 5 minutes; duplicates produce one proposal.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-010 — Usage record

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Every run records the provider, model, tokens or provider units, calculated cost, duration, status, and the feature that started it.

**Acceptance.**
1. Totals are shown in settings by day and by feature.
2. Every run records provider, model, units, cost, duration and status, totaled by day and feature.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-011 — No self-granted authority

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Slate evaluates wiki changes against the authority and company policy of the named sponsoring person. Private drafts, container vetoes and source-audience rights remain product boundaries.

**Acceptance.**
1. A wiki page asking the caller to widen its own grant or sponsor’s role causes no authority change; a general goal or credential supplies no page grant.
2. Page publication and unpublication carry external; reversible archive and trash carry standard; permanent deletion carries destructive; membership and grant changes carry access; protective settings carry security.
3. A verification or accepted decision an agent records carries commitment and names the agent; it never becomes a person’s attestation.
4. Missing, expired, narrowed, changed-target or revoked resource authority refuses the effect; the company policy decides each otherwise-authorized class.

**Evidence.** `src/core/features/ai/routes.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-012 — Durable budgets

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** AI enablement asks the company for its workspace calendar-month provider-spend cap, including an explicit no-cap answer.

**Acceptance.**
1. Before queueing work, durably reserve its maximum estimated provider cost, including bounded input/output, retries and tool units at recorded rates, against that ceiling and all applicable skill, run and provider limits.
2. Count unfinished and paused reservations; persist accounting across restart and concurrent admissions.
3. Recheck changed prices and additional stages before dispatch.
4. Refuse before any provider side effect when any limit is exhausted; record actual units/cost and release unused reservations on settlement.
5. An agent does not change its own ceiling; people set provider-spend policy.
6. Owner monthly budget reserves maximum cost before queueing and refuses before any provider call when exhausted.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-013 — Requester and audience boundary

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** Every generated answer, summary, chat reply and agent output uses only sources currently authorized for the asking member, owner policy and task scope.

**Acceptance.**
1. This includes external sources and investigators using broader service credentials.
2. Background work declares an authorized output audience and destination before execution; every source must permit that audience and executing identity.
3. Recheck every contributor before fan-in, generation, write, delivery, resume and later read of persisted output.
4. Changed or uncertain ACLs, source/requester/audience/destination rights withhold or invalidate derived artifacts, including caches, embeddings, transcripts and proposals; no titles, counts, hints or citations disclose restricted facts.
5. Revoked, archived, trashed and another member’s draft content is excluded without reindexing.
6. A provider credential that can read more pages than the asker contributes only passages permitted for every member of the declared output audience.
7. LIFE-002 and source deletion rules remain absolute under every policy.
8. Answers and outputs use only sources authorized for the asker and audience, rechecked at every boundary.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-014 — Scoped agents

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** An agent is an auditable named record with instructions, owner, represented identity, exact source and effect scopes, audiences and destinations.

**Acceptance.**
1. Interactive access never exceeds current invoking-member access; background work follows AI-013.
2. Writes follow AI-003 and AI-011.
3. Owner policy bounds providers/models, skill/run/provider budgets and permitted effects; Slate routes automatically by measured task fit within it.
4. Runs name actor, audience, agent, exact skill revision, provider/model and cost.
5. No model selector or agent-management chore is required for ordinary work.
6. Under the held company policy for standard changes, external exposure or commitment decisions, agents are named auditable records whose access never exceeds the invoking member's.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-015 — Workspace answers

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** A chat panel answers questions over the workspace, keeps the conversation, cites its sources (`AI-004`), and places the same generated answer above search results with the same citations and the same caveat.

**Acceptance.**
1. It answers "I could not find that in what you can read" rather than answering from the model alone.
2. Chat panel and search answer cite sources and say "I could not find that in what you can read" when they cannot.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-016 — Summaries

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** A member can summarize a page, its comments or a difference between two revisions.

**Acceptance.**
1. The result names exact revisions and may be copied, proposed for insertion, or inserted directly when the member’s request explicitly authorizes that exact insertion or a valid bounded grant covers it.
2. Current access, destination rights, revisions and atomic receipts still apply; an ordinary request to summarize does not authorize unrelated edits.
3. Summaries of a page, comments or a diff name exact revisions and insert only when authorized.

**Evidence.** `src/core/features/ai/routes.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AI-017 — Writing with AI

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-007 · Rules D-1

**Requirement.** With text selected, a member can run a named action — improve, shorten, lengthen, proofread, explain, translate, change tone — or a free-form instruction.

**Acceptance.**
1. The result is shown against the selection with insert below, replace, refine and discard, and nothing changes until one is chosen.
2. Selection actions show insert, replace, refine and discard and change nothing until chosen.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

### Decisions

#### DEC-001 — A decision is a layer over a page

Core · published · **partial**

**Requirement.** A page can carry one decision record: a question, the options considered, an outcome, a rationale, an owner, a decided date, an optional review date, and citations to page revisions (`REV-005`).

**Acceptance.**
1. The page stays a page: its body, comments, grants, versions and links are unchanged, and removing the decision record leaves the page intact.
2. A decision record layers over a page and removing it leaves the page intact.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A page can carry one decision record: a question, the options considered, an outcome, a rationale, an owner, a decided date, an optional review date, and citations to page revisions (`REV-005`)."<br>No validated CI-run proof for this acceptance point: "The page stays a page: its body, comments, grants, versions and links are unchanged, and removing the decision record leaves the page intact."

#### DEC-002 — States

Core · published · **partial**

**Requirement.** A decision is Proposed, Accepted or Superseded.

**Acceptance.**
1. Proposed becomes Accepted, an Accepted decision is superseded by another decision, and Superseded is terminal.
2. Every transition records the actor and the time and appears in activity.
3. Proposed, Accepted and Superseded transitions are recorded with actor and time.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A decision is Proposed, Accepted or Superseded."<br>No validated CI-run proof for this acceptance point: "Proposed becomes Accepted, an Accepted decision is superseded by another decision, and Superseded is terminal."<br>No validated CI-run proof for this acceptance point: "Every transition records the actor and the time and appears in activity."

#### DEC-003 — An accepted decision is immutable

Core · published · **partial**

**Requirement.** Accepting freezes the decision's content together with the revisions it cites.

**Acceptance.**
1. Later edits to a cited page add a warning that the citation is no longer current and never rewrite the accepted rationale; changing an accepted decision is done by superseding it, which links both decisions in both directions.
2. Accepting freezes content and cited revisions; later edits warn and changes supersede.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Accepting freezes the decision's content together with the revisions it cites."<br>No validated CI-run proof for this acceptance point: "Later edits to a cited page add a warning that the citation is no longer current and never rewrite the accepted rationale; changing an accepted decision is done by superseding it, which links both decisions in both directions."

#### DEC-004 — Decision log

Core · published · **partial**

**Requirement.** Decisions are listed and filtered by state, container, owner, decided date, review date and whether their citations are current, and each result opens the exact accepted revision.

**Acceptance.**
1. Decisions are listed and filtered by state, container, owner, decided date, review date and whether their citations are current, and each result opens the exact accepted revision.
2. Decision log filters by state, container, owner, dates and citation currency.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Decisions are listed and filtered by state, container, owner, decided date, review date and whether their citations are current, and each result opens the exact accepted revision."

#### DEC-005 — Review dates

Core · published · **partial**

**Requirement.** A review date that passes labels the decision overdue and notifies its owner (`NOTIF-001`) until a member records a completed review — a note, an actor, a time and the next review date — or supersedes the decision.

**Acceptance.**
1. An overdue decision stays Accepted.
2. An overdue review notifies the owner until a completed review or supersession.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "A review date that passes labels the decision overdue and notifies its owner (`NOTIF-001`) until a member records a completed review — a note, an actor, a time and the next review date — or supersedes the decision."<br>No validated CI-run proof for this acceptance point: "An overdue decision stays Accepted."

#### DEC-006 — A proposed decision is editable

Core · published · **partial**

**Requirement.** While a decision is Proposed, a member with edit access on its page can change its question, options, outcome, rationale, owner, decided date, review date and citations.

**Acceptance.**
1. Each change writes a revision (`REV-001`) keeping the previous content with its actor and time, resubmitting an unchanged proposal writes no revision, and the history is readable under `REV-002`.
2. Accepting the decision ends this, and `DEC-003` governs from then on.
3. Proposed decisions are editable with revisions; unchanged resubmits write none.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "While a decision is Proposed, a member with edit access on its page can change its question, options, outcome, rationale, owner, decided date, review date and citations."<br>No validated CI-run proof for this acceptance point: "Each change writes a revision (`REV-001`) keeping the previous content with its actor and time, resubmitting an unchanged proposal writes no revision, and the history is readable under `REV-002`."<br>No validated CI-run proof for this acceptance point: "Accepting the decision ends this, and `DEC-003` governs from then on."

### Full flagship and sustained inquiry

#### SUG-001 — Anchored suggestions

Core · published · **partial**

**Requirement.** Members with comment or edit access can propose a typed change as a separate record anchored to an exact page/block revision, inspect its diff and discuss it. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. A suggestion changes neither working page/block content nor published content before explicit acceptance under `SUG-002`.
2. Preserve author, time, original text and exact revision; inaccessible anchors disclose no content.
3. Direct granted maintenance remains a separate attributable revision path under `AI-003`/`AI-005`, not suggestion acceptance or a forced review queue.
4. Suggestions anchored to exact revisions change no content before acceptance.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Members with comment or edit access can propose a typed change as a separate record anchored to an exact page/block revision, inspect its diff and discuss it."<br>No validated CI-run proof for this acceptance point: "A suggestion changes neither working page/block content nor published content before explicit acceptance under `SUG-002`."<br>No validated CI-run proof for this acceptance point: "Preserve author, time, original text and exact revision; inaccessible anchors disclose no content."<br>No validated CI-run proof for this acceptance point: "Direct granted maintenance remains a separate attributable revision path under `AI-003`/`AI-005`, not suggestion acceptance or a forced review queue."

#### SUG-002 — Resolve explicitly

Core · published · **partial**

**Requirement.** An authorized editor accepts selected suggestions atomically with a new revision/activity/receipt or rejects them with attribution.

**Acceptance.**
1. Recheck current access and revision; conflicting or lost anchors require explicit rebase/review, never silent application.
2. Suggestion history survives reload and export.
3. Accepting selected suggestions is atomic with a revision; conflicting anchors require rebase.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "An authorized editor accepts selected suggestions atomically with a new revision/activity/receipt or rejects them with attribution."<br>No validated CI-run proof for this acceptance point: "Recheck current access and revision; conflicting or lost anchors require explicit rebase/review, never silent application."<br>No validated CI-run proof for this acceptance point: "Suggestion history survives reload and export."

#### SOURCE-001 — Connector contract

Core · published · **partial** · Rules D-1

**Requirement.** Each connected source declares provider/tenant identity, owner, represented principals, scopes, supported effects, ACL mapping or named service identity, discovery coverage, cursor, last success/error, freshness and lag, deletion/revocation and retention guarantees.

**Acceptance.**
1. Unsupported guarantees are visibly unavailable.
2. Multiple real document, collaboration/evidence and operational connector families are required.
3. Each connector declares identity, scopes, ACL mapping, coverage, freshness and guarantees; unsupported guarantees show unavailable.

**Evidence.** `tests/flagship/release-clauses/federation/connector-disclosure.test.ts`
**Gap.** flagship opt-in only (FEATURE_DISABLED in core-wiki)

#### SOURCE-002 — Exact passages

Core · published · **partial** · Rules D-1

**Requirement.** Retain immutable source-native IDs, revision/hash, observed and source times, permitted originals or restorable references, extraction version and stable passage anchors.

**Acceptance.**
1. Citations open that exact revision or a content-free tombstone, never silently newest content.
2. Citations open the exact source revision or a tombstone, never newer content.

**Evidence.** `tests/flagship/release-clauses/federation/exact-passages.test.ts`
**Gap.** flagship opt-in only (FEATURE_DISABLED in core-wiki)

#### SOURCE-003 — Scoped claims and authority

Core · published · **partial** · Rules D-1

**Requirement.** Claims retain proposition, exact passages, kind, account/product/plan/audience/jurisdiction scope, effective/expiry interval, owner, verification, conflict and unknown state.

**Acceptance.**
1. Record named approving person or delegated office and applicable authority separately.
2. Recency, popularity, model confidence and conversational evidence cannot create policy authority.
3. Claims keep passages, scope, interval, owner, verification and authority separately.

**Evidence.** `tests/qualification/authority/decision-authority.test.ts`
**Gap.** flagship opt-in only (FEATURE_DISABLED in core-wiki)

#### SOURCE-004 — Live observations

Core · published · **partial** · Rules D-1

**Requirement.** Operational state is a typed response from its owning system with tenant/account identity, observation time and freshness.

**Acceptance.**
1. Documents cannot substitute for live entitlement or activation.
2. Reconcile contradictions by scope, authority and effective dates; preserve unknown prices, expiry and unsupported facts.
3. Live observations come from the owning system with identity and freshness.

**Evidence.** `tests/qualification/authority/native-boundaries.test.ts`
**Gap.** flagship opt-in only (FEATURE_DISABLED in core-wiki)

#### SOURCE-005 — Revocation and deletion

Core · published · **partial** · Rules D-1

**Requirement.** Source changes trace dependent claims, decisions, answers, skills and runs.

**Acceptance.**
1. Revoke access immediately at every use boundary, invalidate derived content and indexes, remove deleted material from exports and retain only permitted tombstones.
2. Uncertain source ACLs fail closed.
3. Partial indexing and lag remain visible.
4. Revocation and deletion invalidate derived content immediately and fail closed on uncertain ACLs.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Source changes trace dependent claims, decisions, answers, skills and runs."<br>No validated CI-run proof for this acceptance point: "Revoke access immediately at every use boundary, invalidate derived content and indexes, remove deleted material from exports and retain only permitted tombstones."<br>No validated CI-run proof for this acceptance point: "Uncertain source ACLs fail closed."<br>No validated CI-run proof for this acceptance point: "Partial indexing and lag remain visible."

#### SOURCE-006 — Credential lifecycle

Core · published · **partial** · Rules D-1

**Requirement.** Credentials name issuer/owner, represented identity, scope/destinations, expiry and revocation.

**Acceptance.**
1. Disconnect blocks new dispatch, suspends queued/paused work, stops active work at a safe boundary and cancels unsent effects.
2. Dispatched uncertainty remains unresolved until authorized read-back.
3. Reconnect verifies identity, scopes, ACLs/deletions/revisions and each run/audience; old authority is never inherited automatically.
4. Disconnect stops dispatch at safe boundaries and reconnect re-verifies identity, scopes and ACLs.

**Evidence.** `tests/qualification/authority/disconnect.test.ts` — "SOURCE-006 — OAuth redirects preserve authorization codes and disconnect withdraws executable authority without reactivation"
**Gap.** flagship opt-in only (FEATURE_DISABLED in core-wiki)

#### SKILL-001 — Versioned procedure

Core · published · **partial**

**Requirement.** Skills retain owner, immutable version, instructions, preconditions, context/source scope, allowed semantic tools and exact effects/targets, budgets, expected outputs/checks and escalation conditions.

**Acceptance.**
1. Runs pin exact versions; export SKILL.md and attachments as labeled snapshots, not live synchronization.
2. Skills keep owner, immutable versions, scopes, budgets and checks; runs pin exact versions.

**Evidence.** `tests/qualification/authority/skill-disclosure.test.ts` — "SKILL-001 — method disclosure and portable snapshots retain exact source, audience and attachment boundaries"
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### SKILL-002 — Evaluation and activation

Core · published · **partial**

**Requirement.** Draft → evaluated → active → superseded/retired lifecycle retains domain outcome and forbidden-effect evaluations, contradictions, stale inputs, outages, permission boundaries and prior accepted cases.

**Acceptance.**
1. Failed evaluation cannot activate.
2. A person may activate an evaluated version; an agent’s activation carries standard for an internal procedure and live when it changes a running service, as decided by company policy.
3. Activation cannot widen the caller’s own authority or change policy.
4. Failed evaluation cannot activate; activation never widens scope.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### SKILL-003 — Version transitions

Core · published · **partial**

**Requirement.** Superseded/retired versions cannot start runs.

**Acceptance.**
1. A version transition identifies queued and paused pinned runs and active work at boundaries; the company policy for the affected calls decides cancellation, continuation of the exact version or a linked successor.
2. Recheck all current sources/grants; stop and revocation override continuation.
3. Preserve immutable history and receipts, reconcile ambiguity and never silently substitute versions.
4. Notify subscribed external agents of changes.
5. Superseded versions start no runs; the company policy for affected classes decides what happens to pinned work, and the held-policy journey suspends it.

**Evidence.** `tests/qualification/authority/skill-disclosure.test.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### EFFECT-001 — Durable effects

Core · published · **partial**

**Requirement.** Before external dispatch persist intent, exact semantic operation, principal/account/target, grant, source revisions and idempotency key.

**Acceptance.**
1. Distinguish prepared, dispatched, uncertain, confirmed, failed and canceled.
2. Reconcile lost responses by provider key or read-back; no blind repeat while uncertain and no success without receipt or verified state transition.
3. External effects persist intent and idempotency before dispatch and never claim success without a receipt.

**Evidence.** `tests/qualification/release-restore-authority/restored-effects.test.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### EFFECT-002 — Consent and product custody

Core · published · **partial** · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008

**Requirement.** Inquiry and paid activation retain separate product custody: an inquiry itself causes no account or charge effect. Customer conversations remain with HappyToHelp and CRM or outreach with Orbit.

**Acceptance.**
1. A paid SSO activation binds the current price, interval, discount scope and expiry, the verified purchase or entitlement and the exact activation target.
2. Activation calls carry accounts and money, adding commitment for accepted commercial terms and gated when the outside provider keeps account consent or checkout for a person; the company policy decides each class.
3. The outcome distinguishes request creation, customer setup pending and confirmed enabled.
4. Repairing an article has its own publication scope and external class; an inquiry grant supplies neither publication nor account authority.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### EFFECT-003 — Impact and maintenance

Core · published · **partial**

**Requirement.** Prepare read-only impact rehearsal before policy acceptance, identifying affected accounts/exceptions and dependent answers, procedures, skills and open work.

**Acceptance.**
1. Preserve immutable decisions; apply only determinate granted repairs, evaluate changed skills, invalidate stale answers and coalesce outcomes.
2. Unaffected scoped exceptions stay scoped.
3. Simulation is labeled read-only/isolated and never proof of live effects.
4. Read-only impact rehearsal precedes policy acceptance; only determinate granted repairs apply.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AGENT-001 — Semantic parity

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005

**Requirement.** Slate exposes its revision-pinned evidence, inquiries, proposals, granted effects and durable run outcomes through the corresponding UI, API and MCP jobs.

**Acceptance.**
1. Through each door, read an exact citation, inspect a proposal and a granted effect, and observe run pause, resume, stop and final outcome with the same source revisions and receipt.
2. An operation that Slate does not support fails explicitly.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### AGENT-002 — Portable owner interfaces

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-DATA-005

**Requirement.** Task/inquiry/experiment views derive from durable records, skill schemas and grants and preserve the accepted editor/tree/comments/history.

**Acceptance.**
1. Interface definitions are source-controlled or exportable.
2. Owners can customize source/core/schema/UI/providers without losing data, skills, decisions, runs, interface definitions or migration history
3. Interface definitions are source-controlled or exportable and survive owner customization.

**Evidence.** `tests/flagship/release-clauses/portability/owner-views.test.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### INQ-001 — Open questions

Core · published · **partial**

**Requirement.** An outcome request prepares an inquiry with decision context, rival hypotheses, discriminating observations, unresolved dependencies and independent investigations.

**Acceptance.**
1. Preserve useful interim findings, falsified hypotheses, uncertainty, next informative step and cost across bounded stages and durable waits.
2. Members inspect/correct scope or stop work without designing schemas or coordinating agents.
3. An outcome request becomes an inquiry with hypotheses and durable interim findings.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "An outcome request prepares an inquiry with decision context, rival hypotheses, discriminating observations, unresolved dependencies and independent investigations."<br>No validated CI-run proof for this acceptance point: "Preserve useful interim findings, falsified hypotheses, uncertainty, next informative step and cost across bounded stages and durable waits."<br>No validated CI-run proof for this acceptance point: "Members inspect/correct scope or stop work without designing schemas or coordinating agents."

#### INQ-002 — Reproducible reasoning

Core · published · **partial**

**Requirement.** Retain observations, assumptions, deductions and business choices separately, with population/applicability, counterexamples, failed hypotheses, executable analysis inputs/code/tool versions and results sufficient for independent replay.

**Acceptance.**
1. No private reasoning transcript is required.
2. Checked logical propositions state bounds and checker versions; exact arithmetic/feasibility is not causal customer evidence.
3. Observations, assumptions and analyses are retained for independent replay.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Retain observations, assumptions, deductions and business choices separately, with population/applicability, counterexamples, failed hypotheses, executable analysis inputs/code/tool versions and results sufficient for independent replay."<br>No validated CI-run proof for this acceptance point: "No private reasoning transcript is required."<br>No validated CI-run proof for this acceptance point: "Checked logical propositions state bounds and checker versions; exact arithmetic/feasibility is not causal customer evidence."

#### INQ-003 — Bounded planning

Core · published · **partial**

**Requirement.** Prepare objectives, constraints, allocations, sensitivity and counterexamples from current evidence.

**Acceptance.**
1. Code checks arithmetic and invariants; retain assumptions and accepting owner.
2. A feasible allocation is not proof of benefit.
3. Methods and contextual interfaces are prepared from the request rather than assigned as setup chores.
4. Plans state objectives, constraints, sensitivity and accepting owner.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Prepare objectives, constraints, allocations, sensitivity and counterexamples from current evidence."<br>No validated CI-run proof for this acceptance point: "Code checks arithmetic and invariants; retain assumptions and accepting owner."<br>No validated CI-run proof for this acceptance point: "A feasible allocation is not proof of benefit."<br>No validated CI-run proof for this acceptance point: "Methods and contextual interfaces are prepared from the request rather than assigned as setup chores."

#### INQ-004 — Routing and ambient discovery

Core · published · **partial**

**Requirement.** Typed semantic checks assess relevant permitted events for novelty, contradiction and impact and prepare consequential questions.

**Acceptance.**
1. Owner questions and scheduled frontier sweeps bypass ranking; shadow comparisons and sampled low-score audits measure missed important events.
2. Routing follows measured fit within owner policy, never grants authority or fabricates a fallback after invalid output.
3. Ambient checks route relevant events; frontier sweeps and audits measure missed events.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Typed semantic checks assess relevant permitted events for novelty, contradiction and impact and prepare consequential questions."<br>No validated CI-run proof for this acceptance point: "Owner questions and scheduled frontier sweeps bypass ranking; shadow comparisons and sampled low-score audits measure missed important events."<br>No validated CI-run proof for this acceptance point: "Routing follows measured fit within owner policy, never grants authority or fabricates a fallback after invalid output."

#### INQ-005 — Economical sustained work

Core · published · **partial**

**Requirement.** Deduplicate overlapping work only within an authorized audience and reuse revision-pinned context only after freshness/applicability/access checks.

**Acceptance.**
1. Budget compute and interruptions, keep meaningful progress inspectable and routine checks quiet.
2. Stop branches with no useful information, exhausted budget or inaccessible evidence with reason/restart condition; independent authorized branches may continue.
3. Overlapping work deduplicates only within an audience; budgets and stop reasons are visible.

**Evidence.** `tests/qualification/authority/learned-provenance.test.ts`
**Gap.** flagship opt-in only (FEATURE_DISABLED in core-wiki)

#### TRIAL-001 — Predeclared comparison

Core · published · **partial**

**Requirement.** Before any trial effect, durably record eligibility, treatment/comparison assignment, baseline/instrumentation, forecast, expected and smallest meaningful effect, required precision, observation window, stopping conditions, guardrails, owner authority and exact effects.

**Acceptance.**
1. Prefer defensible randomization when feasible and disclose confounding otherwise.
2. Changing a plan creates a revision, never retroactive predeclaration.
3. Every trial is predeclared durably before any effect.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Before any trial effect, durably record eligibility, treatment/comparison assignment, baseline/instrumentation, forecast, expected and smallest meaningful effect, required precision, observation window, stopping conditions, guardrails, owner authority and exact effects."<br>No validated CI-run proof for this acceptance point: "Prefer defensible randomization when feasible and disclose confounding otherwise."<br>No validated CI-run proof for this acceptance point: "Changing a plan creates a revision, never retroactive predeclaration."

#### TRIAL-002 — Exposure and safety

Core · published · **partial** · Register R-18

**Requirement.** Only owning systems perform granted changes; retain attempted versus confirmed effects, receipts, actual exposure, missing observations and instrumentation changes.

**Acceptance.**
1. Guardrail breaches stop future effects and initiate only separately authorized supported recovery.
2. A seeded lifecycle journey exercises the declared window and stop conditions with recorded exposure; prospective outcome claims use the dated measurements in R-18.
3. Only owning systems perform granted trial effects; guardrail breaches stop future effects.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Only owning systems perform granted changes; retain attempted versus confirmed effects, receipts, actual exposure, missing observations and instrumentation changes."<br>No validated CI-run proof for this acceptance point: "Guardrail breaches stop future effects and initiate only separately authorized supported recovery."<br>No validated CI-run proof for this acceptance point: "Prospective windows must actually elapse; fixtures or simulated time are not prospective outcome evidence."

#### TRIAL-003 — Outcome classification

Core · published · **partial** · Register R-18

**Requirement.** At the declared window classify benefit, null, adverse or inconclusive against the predeclared comparison and guardrails, with uncertainty, applicability, selection bias and measurement quality.

**Acceptance.**
1. Null counts against a mechanism only with enough precision to rule out the meaningful effect; incomplete exposure or changed instrumentation may be inconclusive.
2. Never substitute model agreement for empirical evidence.
3. Outcomes are classified against the predeclared comparison at the declared window.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "At the declared window classify benefit, null, adverse or inconclusive against the predeclared comparison and guardrails, with uncertainty, applicability, selection bias and measurement quality."<br>No validated CI-run proof for this acceptance point: "Null counts against a mechanism only with enough precision to rule out the meaningful effect; incomplete exposure or changed instrumentation may be inconclusive."<br>No validated CI-run proof for this acceptance point: "Never substitute model agreement for empirical evidence."

#### TRIAL-004 — Reusable learning

Core · published · **partial**

**Requirement.** Every outcome revises explanations and methods while retaining original forecast, decision and failed hypotheses.

**Acceptance.**
1. Learned procedures, prompts, tests and code are versioned and evaluated before activation; a person’s activation uses owner authority, while an agent’s activation carries standard or live and follows company policy.
2. No automatic model-weight tuning or cross-deployment sharing.
3. Verify repeated-work savings without invalid assumption reuse.
4. Outcomes revise methods while keeping original forecasts; an agent’s activation carries standard or live according to the service affected, as decided by company policy.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Every outcome revises explanations and methods while retaining original forecast, decision and failed hypotheses."<br>No validated CI-run proof for this acceptance point: "Learned procedures, prompts, tests and code are versioned and evaluated before activation; a person’s activation uses owner authority, while an agent’s activation carries standard or live and follows company policy."<br>No validated CI-run proof for this acceptance point: "No automatic model-weight tuning or cross-deployment sharing."<br>No validated CI-run proof for this acceptance point: "Verify repeated-work savings without invalid assumption reuse."

#### FLAG-001 — Complete product gate

Core · published · **partial**

**Requirement.** All inherited clauses with only recorded explicit amendments, every shared Base obligation, every value of the eight policies, all six USER-JOURNEYS.md journeys, full flagship and complete customer-activation inquiry → experiment → outcome → learning loop are required.

**Acceptance.**
1. No minimum subset, parser/component suite or self-report substitutes for full product acceptance.
2. The core-wiki launch amendment authorizes a separately labeled core-wiki release with the default-disabled surfaces and retained obligations specified in the core-wiki launch amendment.
3. This changes the launch gate only; it does not satisfy or waive full flagship acceptance.
4. The core-wiki release exception and complete flagship gate remain distinct under RL-4 and RL-5; their execution mechanics are in [verification guidance](docs/verify.md).

**Evidence.** `tests/flagship/release-clauses/portability/profile-retention.test.ts`
**Gap.** release gate; full flagship and provider evidence pending

#### FLAG-002 — Independent evidence

Core · published · **partial** · Register R-9, R-10, R-19

**Requirement.** Verify clean install, real browser/Worker journeys, customized owner copy, old-data migrations, restart/failure/revocation, complete export/restore, accessibility and load.

**Acceptance.**
1. Test genuine incumbent exports including Word through the seed’s public doors, with recorded providers or official-schema fakes at the network edge; real account receipts are recorded separately in R-19.
2. Separate requirements, local implementation evidence, provider evidence and release/deployment evidence; no claim advances without independent semantic verification.
3. Independent clean install, real browser and Worker journeys, migrations, restore, accessibility and load evidence.

**Evidence.** `tests/flagship/release-clauses/portability/staged-recovery.test.ts`
**Gap.** release gate; full flagship and provider evidence pending

#### FLAG-003 — Value and held-out evaluation

Core · published · **partial** · Register R-18

**Requirement.** Compare identical accessible sources/tools against expert/current-tools and capable generic-agent baselines and owner-customized Slate.

**Acceptance.**
1. Freeze held-out cases separately from development and prevent future outcomes, later summaries/labels/indexes leaking past decision cutoff.
2. Measure discoveries, falsification, missed-event recall, reproducibility, forecasts/interventions and every attempt’s cost/time/attention, setup, interruptions, failures and repair.
3. Repeated quality-preserving useful outcomes, including null/adverse/inconclusive cases, are required; privacy/authority failures cannot trade for productivity.
4. Held-out comparison against expert and generic-agent baselines with all-attempt costs.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "Compare identical accessible sources/tools against expert/current-tools and capable generic-agent baselines and owner-customized Slate."<br>No validated CI-run proof for this acceptance point: "Freeze held-out cases separately from development and prevent future outcomes, later summaries/labels/indexes leaking past decision cutoff."<br>No validated CI-run proof for this acceptance point: "Measure discoveries, falsification, missed-event recall, reproducibility, forecasts/interventions and every attempt’s cost/time/attention, setup, interruptions, failures and repair."<br>No validated CI-run proof for this acceptance point: "Repeated quality-preserving useful outcomes, including null/adverse/inconclusive cases, are required; privacy/authority failures cannot trade for productivity."

#### FLAG-004 — Complete portable knowledge

Core · published · **partial**

**Requirement.** PORT-001/002/005/006 extend to source revisions and passages, claims/authority, skill versions/evaluations/grants, run stages/effect receipts, inquiries/analyses/trials/outcomes/learning and interface definitions with exact lineage.

**Acceptance.**
1. Retain credential metadata but exclude secrets/sessions and require fresh activation/authorization after restore.
2. External state is reported, not recreated by assertion; exact public publishing and imported-actor restrictions remain.
3. Export and restore carry full flagship lineage with secrets excluded and fresh authorization required.

**Evidence.** `tests/qualification/authority/recovery.test.ts`
**Gap.** release gate; full flagship and provider evidence pending

### Writing together

#### COLLAB-001 — Live co-editing by default

Core · target · **partial**

**Requirement.** Two or more members with `edit` access can type in the same page, and in the same block, at the same time. Their characters merge without conflict: there is no 409 and no last-write-wins for concurrent text, and `SAVE-003` conflicts remain only for structural edits that cannot merge, such as editing a block another member deleted, which offers restore. Every accepted operation is durable before it is acknowledged. A member's access is rechecked on every operation. Narrowing or revoking access closes that member's socket within 5 seconds, keeps their unsent text locally as an unsaved draft (`SAVE-004`), and never applies it. Reconnecting replays unacknowledged operations exactly once. Saved means committed (`SAVE-001`).

**Acceptance.**
1. a two-browser journey at 1440 and 390 in which two members type into one paragraph at the same time and both see the same final text within 1 second.
2. It also covers a dropped connection that reconnects with no lost or duplicated characters, and a grant revoked mid-typing that closes the editor within 5 seconds, keeps the draft unsaved and lists no revision for it.
3. A Workers journey sends interleaved operations to the collaboration route and reads back one revision history.

**Evidence.** `src/core/features/collaboration/durable-object.ts`
**Gap.** Missing a complete public-door journey for live co-editing by default; the cited material shows only part of the capability.

#### COLLAB-002 — Presence, cursors and following

Core · target · **partial**

**Requirement.** A page shows who is viewing and who is editing, with an avatar, a name and a color. Each editor's cursor and selection appear live with their name. Clicking a collaborator follows their viewport, and members idle for more than 5 minutes are shown as idle. Presence reveals only members who can already read the page, and it never appears on the anonymous read view (`WEB-003`).

**Acceptance.**
1. a browser journey with three members in which one sees two named cursors move within 500ms of typing and follows a collaborator to another heading.
2. The anonymous published view of the same page shows no presence.

**Evidence.** `src/core/features/collaboration/service.ts`
**Gap.** Missing a complete public-door journey for presence, cursors and following; the cited material shows only part of the capability.

#### COLLAB-003 — Offline edits that merge

Core · target · **partial**

**Requirement.** Edits made while a client is offline, whether a browser with a cached page (`SAVE-004`) or an offline page in a native app (`MOBILE-003`), merge on reconnect through the same operation path as `COLLAB-001`. They are attributed to their author with their original time. A conflict that cannot merge, such as editing a block another member deleted, is shown with both versions and a restore action, and is never resolved silently.

**Acceptance.**
1. a browser journey takes one client offline, edits three blocks while a second client edits one of them and deletes another, then reconnects.
2. The merged page keeps both edits to the shared block, offers the deleted block for restore, and shows four attributed operations in history.

**Evidence.** `src/core/features/editor/ui/SaveStatus.tsx`
**Gap.** No validated CI-run proof for this acceptance point: "a browser journey takes one client offline, edits three blocks while a second client edits one of them and deletes another, then reconnects."<br>No validated CI-run proof for this acceptance point: "The merged page keeps both edits to the shared block, offers the deleted block for restore, and shows four attributed operations in history."

#### COLLAB-004 — Long pages and heavy tables stay fast

Core · target · **missing**

**Requirement.** A page with 2,000 blocks or a 50 × 500 table opens in under 1.5 seconds at p95 on the reference laptop profile (Chrome with Lighthouse's desktop throttling) and in under 3 seconds on the reference phone profile (Chrome with Lighthouse's mobile throttling: 4× CPU slowdown, 1.6 Mbps and 150ms round trips). With 20 co-editors, typing echoes locally in under 50ms and reaches the others in under 500ms. Table insert, delete, resize and sort complete in under 200ms. The limits are declared in `seed.json → limits`.

**Acceptance.**
1. a scripted load journey against a deployed Worker records keystroke echo and remote-arrival latency with 20 co-editors at the declared limits, and a browser journey under each reference profile records p95 open time for the 2,000-block page and the 50 × 500 table.
2. The runs' raw timings are kept with the release evidence.

**Evidence.** —
**Gap.** not implemented

#### COLLAB-005 — Attributed history from co-editing

Core · target · **partial**

**Requirement.** Co-edited operations become revisions (`REV-001`) that are grouped by time window and list every contributing author. Compare (`REV-004`) colors each change by its author, and restore (`REV-003`) works on any grouped revision.

**Acceptance.**
1. after a two-author session, history lists one revision naming both authors, compare attributes each changed block to its author, and restoring the previous revision brings back the earlier text for both authors.

**Evidence.** `src/core/features/versions/service.ts`
**Gap.** Missing a complete public-door journey for attributed history from co-editing; the cited material shows only part of the capability.

#### PAGE-015 — Page lock

Core · target · **done**

**Requirement.** A member with `edit` access can lock a page against accidental edits. Locking is separate from permissions: it changes no grant. A locked page shows a "Locked by name" banner and opens read-only for everyone, and an `edit` member unlocks it in one action. Both acts are recorded in activity. API calls, automations, imports and AI runs respect the lock and refuse with page locked. Comments stay open. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a browser journey in which one member locks a page, a second editor sees it read-only with the banner while comments still post, an API update and an automation action on that page refuse with page locked, and unlocking restores editing.
2. Activity shows both acts.

**Evidence.** `tests/qualification/ui-convergence/page-lock-journey.mjs` — "pageLockBrowserJourney"; `tests/profile/page-lock-journey.ts` — "pageLockJourney"
**Gap.** None.

#### BLOCK-011 — Synced blocks

Core · target · **partial**

**Requirement.** A block can be made synced: its content is defined once and rendered live in many pages, as with Notion synced blocks and Confluence excerpt-include. Editing any copy edits all of them, and each copy names its source page. A reader sees a copy only if they can read the source, and otherwise sees `LINK-004`'s access-needed state. Deleting the source turns each copy into a static block that keeps its last content.

**Acceptance.**
1. a browser journey that syncs a block into two pages, edits one copy and sees the change in the other within 5 seconds.
2. A member without access to the source sees the access-needed state, and deleting the source leaves static copies.

**Evidence.** `tests/e2e/editor/tables.test.ts` — "BLOCK-014 — tables, columns and synced paragraphs preserve structured content through editing, validation, exports and access" calls `tests/e2e/editor/synced-case.ts` (two copies, source edits, stale writes, source edit permission and receipt replay, reader/public/history redaction, static export/re-import and duplication, trash, audience-safe atomic permanent deletion and retained revisions); `tests/qualification/ui-convergence/synced-journey.mjs` — "syncedJourney" in the existing review-request launch at 1440 (make synced, insert two copies, touch edit, other visible copy within five seconds, access-needed state and permanent deletion to static copies; no overflow, serious/critical accessibility finding, browser error or failed request). `tests/qualification/ui-convergence/synced-custody.mjs` — "syncedCustodyJourney", "syncedHistoryJourney" and "syncedMemberErasureJourney" in the existing invitation launch at 1440 prove deletion with unpublished changes, member erasure, source removal/unsync/restore/discard, restricted-reader and trashed-source copy restore, trash labels and live resumption, frozen reader/anonymous audiences, immutable revision-door payloads and content-free deleted-reference restore; `tests/e2e/review/verification-upgrade.test.ts` proves populated c24 synced rows survive migration 0060, and `tests/flagship/release-clauses/portability/profile-retention.test.ts` proves restricted static content and its audience survive native archive restore, refuses a complete archive outside the frozen audience and admits no newly granted reader.
**Gap.** Paragraphs only. Other block kinds and incumbent synced-block imports (Notion synced blocks; Confluence Excerpt, Excerpt Include and Include Page under IMP-010) are not implemented, and the access-needed state offers no LINK-004 access request. Adopted defaults: Copy editing requires edit access to both pages; otherwise the reason is shown. A trashed source shows no content, copies resume on restore, and nothing turns static before permanent deletion. A published copy shows source content anonymously only while the source is published to the same anonymous audience. Export, duplication and templates produce static paragraphs from what the acting reader can read, and re-import stays static.

#### BLOCK-012 — Columns and page layouts

Core · target · **partial**

**Requirement.** A page body can hold 2 to 5 side-by-side columns that blocks can be dragged into. Columns stack in order at phone width. Page export (`PORT-007`) and the Notion and Confluence imports (`IMP-002`, `IMP-003`) preserve the column layout.

**Acceptance.**
1. a browser journey creates a three-column section at 1440 and sees it stack at 390.
2. Importing a Notion export with columns and a Confluence page with a two-column layout reproduces both.

**Evidence.** `tests/e2e/editor/tables.test.ts` — "BLOCK-014 — tables, columns and synced paragraphs preserve structured content through editing, validation, exports and access" calls `tests/e2e/editor/columns-case.ts` (2–5 columns, refused nesting, HTML/Markdown round trips, Notion HTML and Confluence storage layouts, ordered Word content, copies, comments, revisions, public rendering and reader access); `tests/qualification/ui-convergence/columns-journey.mjs` — "columnsJourney" in the existing core-wiki/touch-member launch at 1440px/390px (three columns, native and touch drag into and out of columns, count changes, phone stacking, persistence, overflow and accessibility).
**Gap.** One level only: nested columns are refused. PDF and Word exports flow column content in reading order rather than preserving side-by-side layout.

#### BLOCK-013 — Equations and diagrams as code

Core · target · **missing** · Cites BASE-INPUT-002

**Requirement.** Inline and block LaTeX equations render with KaTeX, and Mermaid diagram blocks render as SVG. Both are rendered without network access, are sanitized under `BASE-INPUT-002`, are kept as source in Markdown export, and are imported from Notion equation blocks and Confluence code macros. This clause inherits `PORT-010`'s Word obligations when these blocks ship: equations export as OMML or images, and Mermaid diagrams export as images, under the same reader and media access checks.

**Acceptance.**
1. a browser journey that inserts an equation and a Mermaid flowchart, sees both render offline, exports Markdown that contains the source, and re-imports it unchanged.
2. It also exports Word under `PORT-010` and parses the document to verify the equation as OMML or an image and the Mermaid diagram as an image, with no external media relationship.

**Evidence.** —
**Gap.** not implemented

#### BLOCK-014 — Tables that work like tables

Core · target · **done**

**Requirement.** Table blocks support header rows and columns, column widths, merged cells, cell color, and sorting by a column. Rows and columns can be added and removed from the keyboard. Pasting from Excel or Google Sheets keeps rows and columns, and a table converts to a database (`DB-001`) and back without losing cells.

**Acceptance.**
1. a browser journey that pastes a 10 × 20 range copied from a spreadsheet and keeps its shape, merges cells, sorts by a column, converts the table to a database and back, and finds the cells identical.

**Evidence.** `tests/qualification/ui-convergence/tables-journey.mjs` — "tablesJourney"; `tests/e2e/editor/tables.test.ts` — "BLOCK-014 — tables, columns and synced paragraphs preserve structured content through editing, validation, exports and access"
**Gap.** None.

#### BLOCK-015 — Assigned tasks with due dates

Core · target · **done**

**Requirement.** A task item (`BLOCK-007`) can carry one assignee and a due date. Typing `@` inside a task assigns the member mentioned, and typing the documented public door or choosing from the date picker sets the due date, which renders in the reader's locale and shows as overdue once it passes. The assignee gets one inbox item when assigned (`NOTIF-001`), by email or push under their delivery settings (`NOTIF-005`, `NOTIF-006`), and one reminder on the due date (`NOTIF-004`). Reassigning notifies the new assignee once and the previous assignee not at all, and an assignee completing their own task notifies no one. Assigning a member who cannot read the page asks the assigner to share the page with them or cancel, and never notifies that member. Completion still records who and when. Tasks are read and changed through the API and MCP (`API-001`, `API-003`) under the same checks. A task item stays a block, and it still never appears in a database view. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a browser journey at 1440 and 390 types a task, assigns it with `@` and sets a due date with the documented public door.
2. The assignee gets exactly one inbox item and, after a Workers journey advances time, exactly one due-date reminder.
3. Reassigning notifies only the new assignee.
4. Assigning a member without access prompts the assigner to share and sends that member nothing.
5. The task shows as overdue after its due date.

**Evidence.** `tests/profile/profile.worker.test.ts` — "BLOCK-015 — a task assigned to a member without access prompts a share, notifies its assignee once, reassigns without notifying the previous assignee and records completion"; `tests/qualification/ui-convergence/task-assignment-journey.mjs` — "taskAssignmentJourney"
**Gap.** None.

#### BLOCK-016 — Task reports

Core · target · **done**

**Requirement.** A body can hold a task report: a live list of tasks filtered by container, ancestor page, label, assignee (including "the current reader"), creator, due-date range and state, grouped by page, assignee or due date, and ordered and limited by the author. It follows `BLOCK-010`'s rules: it re-runs when the page is opened, shows when it last ran, shows each reader only the tasks on pages that reader can read, never renders a task on a draft (`LIFE-002`), and says so when its source container is deleted. A reader with edit access to a task's page can complete the task from the report. A published page shows a task report as a sign-in notice and never runs it for anonymous readers, so a public view reveals no task, page title or count. Confluence Task Report macros import as task reports with the same filters, carried and proven by `IMP-010`.

**Acceptance.**
1. a browser journey embeds a report filtered to one container and one assignee over tasks on three pages.
2. One reader sees all three tasks.
3. A reader without access to one of the pages sees the other two, with no count, title or placeholder for the third.
4. Completing a task from the report updates its page.
5. Published, the page shows the report as a sign-in notice, and an anonymous reader's view names none of the tasks or pages and makes no API request.

**Evidence.** `tests/qualification/ui-convergence/task-report-journey.mjs` — "taskReportJourney"; `tests/profile/work-items-journey.ts` — "taskReportsJourney"
**Gap.** None.

#### BLOCK-017 — Table of contents block

Core · target · **partial**

**Requirement.** A body can hold a table of contents built from its headings, placed anywhere in the page, with a chosen range of heading levels and a flat or nested style. Like `PAGE-010`'s side outline, it follows the current body within 2 seconds of an edit, and each entry links to its heading. It survives export as a linked list in Markdown, HTML, PDF and Word (`PORT-007`, `PORT-010`), and Confluence's Table of Contents macro imports as this block (`IMP-010`). It is separate from the side outline.

**Acceptance.**
1. a browser journey inserts a table of contents limited to heading levels 1 and 2, adds a heading and sees its entry within 2 seconds, follows an entry to its heading, and exports Markdown that contains the linked list.
2. Importing a Confluence page with a Table of Contents macro produces the block.

**Evidence.** `tests/profile/body-blocks-journey.ts`
**Gap.** Genuine Confluence macro-fixture acceptance remains unproven.

#### BLOCK-018 — Status labels

Core · target · **partial**

**Requirement.** An inline status label is a short colored lozenge with text, in gray, blue, green, yellow, red or purple, inserted from the block menu or by typing the documented public door. Screen readers and search read it as text. It survives export, as text with its color name in Markdown and as a styled span in HTML, and Confluence's Status macro imports as this label with its color (`IMP-010`). It is separate from a page's status (`STAT-*`). Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a browser journey inserts a green "Done" label and a red "Blocked" label, finds the page by searching for "Blocked", and exports and re-imports the page with both labels and colors intact.
2. A Confluence page with Status macros imports with matching labels and colors.

**Evidence.** `tests/profile/body-blocks-journey.ts`
**Gap.** Confluence status color in plain-string table cells is reported as loss; genuine incumbent macro-fixture acceptance remains unproven.

#### BLOCK-019 — Diagrams.net diagrams

Core · target · **missing** · Cites BASE-INPUT-002

**Requirement.** A diagram block holds a diagrams.net (draw.io) diagram: its `.drawio` source and a rendered SVG preview. A member with edit access opens it in the diagrams.net editor (jgraph/drawio, Apache-2.0), which Slate serves from the deployment's own origin so that diagram content never reaches a third party. Saving writes a new revision of the block (`REV-001`). Readers, including the anonymous read view (`WEB-003`), see the preview sanitized under `BASE-INPUT-002`, and anyone who can read the page can download the source as a `.drawio` file. Confluence draw.io diagrams import as diagram blocks with their source and preview. Gliffy diagrams are converted to diagrams.net, with the original `.gliffy` file attached to the block (`IMP-010`). A diagram that cannot be converted keeps its preview image and its source attachment and is named in the loss report. This clause inherits `PORT-010`'s Word obligation when diagram blocks ship: the readable preview exports as an embedded image under the same reader and media access checks.

**Acceptance.**
1. a browser journey inserts a diagram, edits it in the editor while the request log shows no request leaving the deployment's origin, saves it, sees a new revision, and downloads the `.drawio` file.
2. The published page shows the SVG and loads no third-party resource.
3. Importing the `IMP-010` fixture's draw.io and Gliffy diagrams produces editable diagram blocks whose previews match their sources, with the original files attached.
4. Exporting Word under `PORT-010` embeds each readable preview as an image, with no external media relationship.

**Evidence.** —
**Gap.** not implemented

#### BLOCK-020 — Group mentions

Core · target · **partial**

**Requirement.** A mention can name a group (`WORK-009`). It renders the group's name and notifies, once each, the members of that group who can read the page, never a member who cannot. Before the comment or edit is saved, the composer shows how many people will be notified. Owners can limit mentions of groups larger than the size in `seed.json → limits` to container administrators. Confluence team mentions import as group mentions where the team is mapped through `IMP-016`'s reviewed principal mapping, and as plain text otherwise.

**Acceptance.**
1. a Workers journey mentions a four-member group on a page one of its members cannot read and finds exactly three inbox items.
2. A browser journey shows "3 people will be notified" before saving, and a member without permission who mentions a group above the size limit is refused with a reason.

**Evidence.** `tests/flagship/discovery/group-mentions.test.ts`, `tests/qualification/ui-convergence/group-mentions-journey.mjs`
**Gap.** Native mentions implemented; Confluence team import remains unproven.

#### BLOCK-021 — Attachment previews

Core · target · **missing**

**Requirement.** Every file attachment (`BLOCK-008`) of a supported preview type opens in an in-page viewer inside its file block and in a full-screen viewer. Both viewers offer page or sheet navigation, zoom, find-in-file and a download button. The supported preview types are: - PDF; - Word `.docx` and `.doc`, Excel `.xlsx`, `.xls` and `.csv`, and PowerPoint `.pptx` and `.ppt`; - OpenDocument `.odt`, `.ods` and `.odp`; - plain text, Markdown, JSON and source code; - every image, video and audio type `BLOCK-008` already displays. Slate renders each preview itself after upload, as a sanitized rendition stored beside the file. PDF pages render through a PDF renderer served from the deployment's own origin, and Office and OpenDocument files convert to sanitized HTML or page images. Sheets keep their tabs, and slides keep their order and speaker notes. A rendition runs no script or macro from the file and fetches no external reference (linked images, remote templates, OLE links). It is served same-origin in a sandboxed frame under a content security policy that allows no third-party request. The raw file keeps `BLOCK-008`'s download disposition with its declared type and `nosniff`; only the rendition is served inline, with exactly the page's access, or through its public link (`WEB-003`). Some files get no preview: an unsupported type, a password-protected or corrupt file, a file larger than `seed.json → limits.attachmentPreviewBytes`, or a file with more pages than `seed.json → limits.attachmentPreviewPages`. Each shows its name, type, size, a download button and the reason. A preview always shows the attachment version its block shows (`BLOCK-022`).

**Acceptance.**
1. A browser journey at 1440 and 390 attaches a PDF, a `.docx`, an `.xlsx`, a `.pptx`, a `.doc`, an `.xls`, a `.ppt` and an `.odt`.
2. It opens each in the in-page and the full-screen viewer, moves to its second page, sheet or slide, and finds a word in it.
3. Throughout, the request log shows no request leaving the deployment's origin (the `BLOCK-019` pattern). - A `.docx` with a remote image and a remote template, and a PDF with embedded JavaScript, produce no outbound request and run no script. - Downloading each raw file still returns a download disposition and `nosniff`. - A member without page access gets 404 for both the rendition and the file.
4. The anonymous view of a published page shows the preview. - A file over the size limit and a password-protected PDF show the no-preview state with its reason. - The `IMP-010` fixture's Attachments and View File macros import as file blocks that preview.

**Evidence.** —
**Gap.** No validated CI-run proof for this acceptance point: "A browser journey at 1440 and 390 attaches a PDF, a `.docx`, an `.xlsx`, a `.pptx`, a `.doc`, an `.xls`, a `.ppt` and an `.odt`."<br>No validated CI-run proof for this acceptance point: "It opens each in the in-page and the full-screen viewer, moves to its second page, sheet or slide, and finds a word in it."<br>No validated CI-run proof for this acceptance point: "Throughout, the request log shows no request leaving the deployment's origin (the `BLOCK-019` pattern)."<br>No validated CI-run proof for this acceptance point: "A `.docx` with a remote image and a remote template, and a PDF with embedded JavaScript, produce no outbound request and run no script."<br>No validated CI-run proof for this acceptance point: "Downloading each raw file still returns a download disposition and `nosniff`."<br>No validated CI-run proof for this acceptance point: "A member without page access gets 404 for both the rendition and the file."<br>No validated CI-run proof for this acceptance point: "The anonymous view of a published page shows the preview."<br>No validated CI-run proof for this acceptance point: "A file over the size limit and a password-protected PDF show the no-preview state with its reason."<br>No validated CI-run proof for this acceptance point: "The `IMP-010` fixture's Attachments and View File macros import as file blocks that preview."

#### BLOCK-022 — Attachment versions

Core · target · **missing** · Cites BASE-DATA-003

**Requirement.** Uploading a file to a page that already has an attachment of the same name creates the next version of that attachment, not a second file. This holds for a drop, the file picker, `API-001` and every import. A "Replace file" action on a file block does the same under any file name. - **Each version** keeps its uploader, time, size, content hash and an optional note. - **The attachment's history** lists every version. Each version previews (`BLOCK-021`) and downloads. Restoring a version makes it the new latest version and deletes none. - **File blocks and links** show the latest version unless they are pinned to one. A page revision (`REV-001`) opened from history shows the attachment version that was current at that revision. - **Versions follow the page.** They inherit its access, move with it, count towards `seed.json → limits.attachmentStorageBytesPerDeployment`, are included in exports with their history (`PORT-001`), and are erased with the attachment under `BASE-DATA-003`. - **Deleting one version** needs edit access, is recorded in activity and leaves the other versions.

**Acceptance.**
1. A Workers journey uploads `policy.pdf` to a page and then a different `policy.pdf` to the same page.
2. It finds one attachment with versions 1 and 2, each downloadable with its own bytes and hash, uploader and time, and the file block shows version 2. - Restoring version 1 creates version 3 with version 1's bytes.
3. The page revision from before the second upload shows version 1. - A browser journey at 1440 and 390 does the same through the file block's history. - A member without page access gets no version. - Exporting and re-importing the workspace keeps all three versions in order. - The `IMP-007` fixture's attachment with two versions imports with both.

**Evidence.** —
**Gap.** not implemented

### Organizing and finding

#### CONT-010 — Space blog and announcements

Core · target · **partial**

**Requirement.** A container has a blog: dated posts with an author, a cover and comments that appear in a feed in the container and on followers' home pages (`NAV-001`). Following a container notifies its followers of new posts (`NOTIF-001`). Posts are pages and keep every page clause. Confluence blogs import as posts (`IMP-003`), not as folders.

**Acceptance.**
1. a browser journey in which one member publishes a post, a follower gets the notification and sees the post on Home, and importing a Confluence space with blog posts creates posts that keep their dates and authors.

**Evidence.** `tests/qualification/ui-convergence/blog-journey.mjs`
**Gap.** Native posts, permission-aware feeds, follower notices and Home are proven at 1440/390; Cloud blog import is proven only on a derived export, Server/DC XML blog posts remain unmapped, and email delivery waits on NOTIF-005.

#### CONT-011 — Space home and company hub

Core · target · **done**

**Requirement.** Each container has an editable home page that its index opens first. Workspace owners curate a company hub: one page that every member sees from Home, made of chosen links, a news feed of announcement posts and verified key pages.

**Acceptance.**
1. a browser journey in which an owner builds a hub, a new member's first Home shows it, and the hub's links show each reader only pages that reader can read.

**Evidence.** `tests/qualification/ui-convergence/hub-journey.mjs` — "hubJourney"
**Gap.** None.

#### CONT-012 — Watch a container

Core · target · **done**

**Requirement.** A member can watch a whole container. For each page in it the member can read, a watched container delivers page creation, edits, moves in or out, archiving or trashing, and comments and replies, as one inbox item each (`NOTIF-002`) or as one line each in a digest under `NOTIF-005`. Edits are coalesced into one item per page, per author, per editing session (`COLLAB-005`'s window). A page the member cannot read, and every draft (`LIFE-002`), produces nothing. A member who watches both a page and its container gets one item, not two. Blog posts (`CONT-010`) arrive the same way. Home shows a Following section with the same events for the member's watched pages and containers; it is personal, not a workspace-wide feed (`NAV-001`). A container's administrators can see its watchers.

**Acceptance.**
1. a Workers journey has a member watch a container.
2. Another member then creates a page, edits it in two sessions, comments on it, and creates a restricted page the watcher cannot read.
3. The watcher gets exactly four items (the creation, two edit sessions and the comment) and nothing for the restricted page, and a comment on a page they also watch directly arrives once.
4. A variant with a daily digest preference finds the same four events as digest lines, and a browser journey sees them in Home's Following section.

**Evidence.** `tests/flagship/discovery/following.test.ts` — "CONT-012 — a watched container delivers creation, two edit sessions and a comment once each, nothing for restricted or draft pages, one item when the page is also watched, and rechecks moves, lifecycle and access"
**Gap.** None.

#### PAGE-016 — Autowatch on create and edit

Core · target · **done**

**Requirement.** Creating a page, or saving an edit to it, watches it for that member, as commenting already does (`PAGE-009`), until they unwatch it. Unwatching stops autowatch for that page, so a later edit by the same member does not watch it again. A member can turn autowatch off for themselves, and `NOTIF-006` sets the workspace default. An implicit watch delivers the same events as an explicit one.

**Acceptance.**
1. a Workers journey has one member create a page and a second member edit another page, then a third member comments on both, and the creator and the editor each get exactly one notification.
2. After the editor unwatches their page and edits it again, a further comment notifies them of nothing.
3. A member with autowatch off creates a page and is not watching it.

**Evidence.** `tests/flagship/discovery/following.test.ts` — "PAGE-016 — authoring watches respect durable unwatch, personal overrides and workspace defaults"
**Gap.** None.

#### WORK-016 — People directory and expertise

Core · target · **partial** · Cites BASE-ACCESS-001, BASE-ACCESS-002, BASE-ROLE-001

**Requirement.** Each member has a profile with their name, title, team, manager, time zone and the pages they own, verify and frequently edit. Expertise tags are derived from that work, and the member can edit or hide them. The directory is searchable, guests see only the people on pages shared with them, and expertise is used to route reviews and questions (`STAT-006`, `KEEP-003`).

**Acceptance.**
1. a browser journey that finds the expert for a topic from the directory, sees the pages they own and verify, hides a derived tag, and confirms a guest cannot list members beyond their shared pages.

**Evidence.** `tests/e2e/review/review-access.test.ts` — "Needs review and the people directory expose only readable work, with live access, expertise choices and explicit review routing" calls `tests/e2e/review/people-case.ts` (search, per-viewer owned/verified/frequently edited pages, hidden tags and review suggestions, guest scope, self/owner field authority and member erasure); `tests/e2e/review/verification-upgrade.test.ts` — "Existing verifications and member profiles upgrade in place without losing populated work or lapse notices" proves the populated prior-schema upgrade; `tests/flagship/release-clauses/portability/profile-retention.test.ts` — "FLAG-001 — core profile gates preserve pages, portable history and disabled restored execution" retains profile fields and hidden tags across a native archive restore; `tests/qualification/ui-convergence/people-journey.mjs` — "peopleJourney" in the existing review-request launch at 1440 (find an expert, owned/verified pages, hide a derived tag, another member sees neither hidden expertise nor private work, native guest acceptance and page-scoped people).
**Gap.** Question routing, this clause's own obligation, waits on KEEP-003 (missing). Adopted defaults: members edit only their own title, time zone and expertise; team and manager are workspace-owner-only in the current two-role model. Expertise derives only from readable page labels on owned, currently verified or repeatedly edited work; no performance assessment. Frequently edited lists for read-only viewers and guest editor lists use published work. Guests use shared-page people lists and cannot browse the directory; hidden choices are visible and restorable only to their member.

#### SHARE-009 — Share with a message

Core · target · **partial** · Cites BASE-ROLE-001

**Requirement.** The share panel can send a page to members, groups or email addresses with an optional plain-text message no longer than the limit in `seed.json → limits`. A recipient who can already read the page gets one inbox item, and an email under their delivery settings (`NOTIF-005`, `NOTIF-006`), carrying the sender, the page title, the message and a link. A recipient without access is offered to the sender as a grant to add (`SHARE-001`, or a guest invitation under `SHARE-006`) and receives nothing until it is added. The message is never the page body, and it is kept in the sender's activity.

**Acceptance.**
1. a browser journey shares a page with a message to one member who can read it and one who cannot.
2. The first gets one inbox item and one email with the message.
3. The second is offered to the sender as a grant and receives nothing until it is added, then gets one item.

**Evidence.** `tests/qualification/backend/emitted.mjs`
**Gap.** Missing a complete public-door journey for share with a message; the cited material shows only part of the capability.

#### TMPL-007 — Starter templates

Core · target · **done**

**Requirement.** Slate ships starter templates that work from the first sign-in: meeting notes (attendees, agenda and assigned tasks under `BLOCK-015`), retrospective, decision (`DEC-*`), how-to, troubleshooting, product requirements (with a task report and issue embeds), project plan, runbook (`KEEP-006`), onboarding page, team home (`CONT-011`) and policy page (with an owner and a review date). Each is a shipped template under `TMPL-004`: it can be duplicated into an editable copy and is never edited itself. Each is categorized in the gallery (`TMPL-001`) and previews under `TMPL-002`.

**Acceptance.**
1. a browser journey finds each named starter template in the gallery by category, previews it, creates a page from meeting notes and assigns a task in it, and duplicates the retrospective into an editable copy while the shipped template stays unchanged.

**Evidence.** `tests/qualification/ui-convergence/starter-templates-journey.mjs` — "starterTemplatesJourney"
**Gap.** None.

#### NAV-007 — My tasks

Core · target · **done**

**Requirement.** Every member has a My tasks view, reachable from Home and the sidebar. It lists the tasks assigned to them and, in a second tab, the tasks they created, across every page they can read. It filters by open, completed and overdue, by container and by due-date range, sorts by due date (undated tasks last), page or container, and paginates stably while tasks change. Completing a task in the list completes it on its page under the page's edit check (`BLOCK-007`). A task leaves the list when its page becomes unreadable to the member, is a draft they cannot read (`LIFE-002`) or is in the trash. Guests see only tasks on pages shared with them.

**Acceptance.**
1. a browser journey assigns one member three tasks on two pages with different due dates.
2. Their My tasks view, filtered to open and sorted by due date, lists exactly those three in that order.
3. Completing one from the list marks it done on its page, and revoking the member's access to one page removes its task from the list on the next load.

**Evidence.** `tests/qualification/ui-convergence/my-tasks-journey.mjs` — "myTasksJourney"
**Gap.** None.

#### SEARCH-010 — Labels and advanced search

Core · target · **partial**

**Requirement.** Search and container views filter by label. Queries accept the operators `title:`, `label:`, `in:` (container), `by:` (contributor), `owner:`, `status:`, `verified:`, `before:`, `after:`, `type:` and quoted phrases, combined with `AND`, `OR` and `-`. A member can save a search, and a saved search can feed a content query (`BLOCK-010`). Operators never widen access (`SEARCH-005`).

**Acceptance.**
1. a Workers journey over seeded pages checks each operator and each combination against expected result IDs for two members with different grants.
2. A browser journey saves a search and embeds it in a page.

**Evidence.** `tests/e2e/search/discovery-journey.ts`
**Gap.** Missing a browser journey saving a search and embedding it in a page; the cited discoveryJourney checks operator and saved-query HTTP results only.

#### SEARCH-011 — Verified-first ranking and trust badges

Core · target · **done**

**Requirement.** Search results, link cards, content queries and answers show each page's verification state (verified with its owner and expiry, lapsed, or unverified) and its last-updated time. Among equally relevant results, ranking puts current verified pages ahead of unverified ones and lapsed or archived pages last, and collapses near-duplicates into one result with a "similar pages" control. Anonymous published views of link cards and content queries carry no verification owner, expiry or lapse state; they show titles only. Answers carry this trust under `ANSWER-002`, which proves it. Two pages are near-duplicates when the Jaccard similarity of their current revisions' 5-word shingles, estimated by MinHash, is at least `seed.json → limits.nearDuplicateSimilarity` (0.8 by default); the same definition drives `KEEP-004`. A member can sort by relevance, last updated or most viewed.

**Acceptance.**
1. a Workers journey over a seeded corpus of a verified, a lapsed and an unverified page with equal text matches asserts their order and badges.
2. A seeded pair at a measured similarity of 0.85 collapses into one result and a pair at 0.7 does not; lowering the limit to 0.65 collapses the second pair too.
3. A browser journey sees the badges and the collapsed near-duplicates, and an anonymous reader of the published pages and of a published content query over them sees their titles with no verification owner, expiry or lapse state.

**Evidence.** `tests/qualification/ui-convergence/trust-ranking-journey.mjs` — "trustRankingJourney"; `tests/e2e/search/discovery-journey.ts` — "discoveryJourney"
**Gap.** None.

#### SEARCH-012 — Connected results in search

Core · target · **partial** · Register R-1

**Requirement.** When connectors are attached (`CONNECT-001`), one search covers Slate content and connected items, which are labeled with their source and opened in their source. Each connected result is shown only if the asking member's mapped identity can read it in the source now (`CONNECT-002`). Connected results never change Slate result ranking for members without that source.

**Acceptance.**
1. a Workers journey with a provider fake at the network edge returns a Drive file to a member mapped to its reader and hides it from an unmapped member, with identical Slate results for both.

**Evidence.** `src/core/features/source-memory/service.ts`
**Gap.** Missing a complete public-door journey for connected results in search; the cited material shows only part of the capability.

#### SEARCH-013 — Search inside attached files

Core · target · **missing**

**Requirement.** Slate extracts the text of every attachment of a type `BLOCK-021` previews and indexes it with the page. That covers PDF text layers, Office and OpenDocument text, slide text and speaker notes, sheet cell values, plain text, Markdown and code. Extraction reads the latest version (`BLOCK-022`), up to `seed.json → limits.attachmentTextBytes` per file. When AI is on (`AI-001`), image-only PDFs and images are read by the owner's configured provider and indexed the same way. - **Results.** Global search (`SEARCH-001`) matches attachment text within its 500ms bound. A match is returned as the file, naming its page, with a snippet from the file and the match highlighted. Opening it opens the viewer at the matching page, sheet or slide. Search can be filtered to attachments, and by file type (`SEARCH-010`). - **Access.** `SEARCH-005` applies unchanged: a member without access to the page gets no result, snippet, facet or total from its files. - **Freshness.** A new version is re-indexed through the page's dirty generation (`PORT-004`), and text from an older version stops matching. - **Limits.** A file whose text exceeds the limit shows "partially indexed". A file with no extractable text shows "no searchable text" while AI is off. - **Answers.** Cited answers (`ANSWER-001`) may cite attachment text. The citation opens the viewer at the cited version and page.

**Acceptance.**
1. A Workers journey attaches a PDF and a `.docx` whose bodies each contain a phrase found nowhere else, plus an `.xlsx` and a `.pptx` with their own phrases.
2. Searching each phrase returns that file and its page with a snippet from the file.
3. A browser journey opens the viewer at the matching page. - A member without access to the page gets no result, snippet, facet or total for any of the phrases. - Uploading version 2 without the phrase makes the phrase stop matching once indexing settles. - A file larger than the text limit shows "partially indexed". - With AI on and a provider fake at the network edge, a scanned PDF's phrase becomes searchable. - An import of the `IMP-007` fixture has its attachment text searchable before the import is Completed (`PORT-004`).

**Evidence.** —
**Gap.** not implemented

#### SEARCH-014 — Old Confluence URLs find their Slate record

Core · target · **missing**

**Requirement.** Wherever a member can paste a URL, an old Confluence URL that `IMP-013` recognizes resolves to its imported record: - **Search.** Pasting the URL into global search (`SEARCH-001`) returns the record as the first result. A record the member cannot read is returned as `LINK-004`'s access-needed result, with no title, snippet or author, and an unmapped URL returns one "Not migrated" result naming the source space key. - **Link field.** Pasting the URL into the editor's link field links to the record's permanent URL and shows its current title (`LINK-003`). - **Page body.** Pasting the URL into a page body inserts a link to the record, not a link card to the old site. One undo restores the URL as pasted. - **API and MCP.** The public REST resolver and MCP link-resolution job (`API-001`, `API-003`) return the record's ID and URL to a token or client acting as a member who can read it, the access-needed result otherwise, and `not_migrated` for an unmapped URL. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. over the `IMP-013` fixture's tiny link, page-ID URL, the documented public door URL and blog URL, a Workers journey searches each one and gets its record first, and calls the resolve endpoint with tokens for a reader and a non-reader: the reader gets the record, the non-reader gets the access-needed result with no title.
2. A browser journey at 1440 and 390 pastes the tiny link into the link field and sees the record's current title, pastes the page-ID URL into a paragraph and gets a link to the record, undoes once and gets the URL as pasted, and pastes an unmapped URL into search and sees "Not migrated" with its space key.

**Evidence.** —
**Gap.** not implemented

### Keeping knowledge true

#### STAT-006 — Review requests and expert queues

Core · target · **done**

**Requirement.** A page owner or editor can request review from a named member or group, with a due date and a note. The reviewer gets an inbox item (`NOTIF-002`) and a queue of pages awaiting their review, and can verify (`STAT-003`), request changes as a comment, or reassign. An overdue review reminds the reviewer once and then the container owner. Owners can re-verify in bulk from the queue, opening each exact revision (`STAT-003` requires a person to open the revision for their own attestation; an agent’s separate verification carries commitment under company policy).

**Acceptance.**
1. a browser journey in which one member requests review, the reviewer sees the queue item, opens the revision and verifies it, and an overdue request reminds the reviewer and then the container owner exactly once each.

**Evidence.** `tests/qualification/ui-convergence/review-request-journey.mjs` — "reviewRequestJourney"
**Gap.** None.

#### STAT-007 — Verification rules

Core · target · **partial**

**Requirement.** Container owners configure nightly rules that flag or unverify, never verify. Examples: unverify a page when a page or source it cites changes, flag pages with no owner, and flag verified pages unviewed for 180 days. Each run records what it changed and why in activity, notifies affected owners once in a coalesced notice, and can be previewed before it is turned on. A timer never renews a person’s verification; an agent’s separate verification carries commitment and is decided by the company policy (`STAT-004`). The rule selections, flags, nightly receipts and preview behavior are specified in [verification rules](docs/verification-rules.md). Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a Workers journey runs a rule over seeded pages and asserts exactly the expected unverifications, flags, activity entries and one coalesced notice per owner.
2. An attempted rule action of "verify" is rejected.
3. `SOURCE-003` and `SOURCE-004` each extend this journey with a cited source that changes.

**Evidence.** `tests/e2e/review/verification-rules.test.ts`, `tests/qualification/ui-convergence/review-request-journey.mjs`
**Gap.** Missing the cited-source-change journey for SOURCE-003 and SOURCE-004; the cited Workers and browser journeys cover page citations, flags, nightly receipts and notices, with no connected-source change.

#### CARD-001 — Knowledge cards and collections

Core · target · **partial**

**Requirement.** A card is a short page kind with a soft length limit (`seed.json → limits`, 500 words by default: past it the editor warns and suggests a page, and nothing is truncated), a question-style title, an owner, verification required by default, and placement in a collection (a container with card-friendly views). Cards render compactly in search, answers, chat (`CHAT-002`) and the browser extension (`CARD-002`). Guru cards import as cards (`IMP-008`).

**Acceptance.**
1. a browser journey creates a card and finds it as a compact result with its verification badge, and a 600-word card shows the length warning and saves intact.
2. A Guru import creates cards in collections that keep their owners and their verification intervals as imported metadata.

**Evidence.** `src/core/features/containers/service.ts`
**Gap.** Missing a complete public-door journey for knowledge cards and collections; the cited material shows only part of the capability.

#### CARD-002 — Browser extension

Core · target · **missing**

**Requirement.** A Chrome and Edge extension signs in as the member and searches and asks Slate from any tab. On sites the owner allowlists, such as Salesforce, Zendesk, HappyToHelp, Orbit and GitHub, it suggests cards relevant to the open record. It reads page text only after the member opens the extension on that tab, sends only the query and the record title, and shows only what the member can read. After a Confluence cutover, a workspace owner lists the old Confluence hostnames (`IMP-013`). The extension then redirects the member's navigation to a Confluence path on those hosts (the documented public door, and the documented public door, the documented public door, the documented public door, the documented public door and the documented public door on a Server or Data Center hostname) to Slate's resolver, using a browser redirect rule. It holds no map, reads nothing from the old page and leaves every other path on the host, such as Jira's the documented public door on the same `atlassian.net` site, untouched. A member can switch the redirect off. IT can force-install the extension, with the old hostnames preset, on managed Chrome and Edge browsers through enterprise policy. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. an automated Chromium journey loads the packed extension, signs in, opens an allowlisted fixture page, sees a relevant verified card, and confirms through a request log that no page text left the tab before the member opened the extension.
2. With `ourcompany.atlassian.net` listed as an old hostname and served by a fixture host, navigating to the `IMP-013` fixture's tiny link and page-ID URL lands on their Slate records, the documented public door on the same host is not redirected, and with the member's switch off the tiny link is not redirected.

**Evidence.** —
**Gap.** not implemented

#### CARD-003 — Required reading and announcements

Core · target · **missing**

**Requirement.** An owner can send a page or card to a group as required reading. Each member gets an inbox item and a reminder after a set number of days, and their acknowledgment is recorded. The sender sees who has acknowledged. Slate records no reading time and no scroll depth, and acknowledgments are visible only to the sender and workspace owners.

**Acceptance.**
1. a browser journey sends a page to a group, two members acknowledge, one is reminded once, and the sender's report lists exactly those states with no reading-time data.

**Evidence.** —
**Gap.** not implemented

### Structured knowledge

#### DB-013 — Database forms

Core · target · **missing**

**Requirement.** A database can publish a form whose questions map to its fields, with required fields, help text and simple conditional questions. A form is open to members, to named guests or, if the container allows public links (`CONT-007`), to an anonymous link with rate limits and a spam check (a honeypot field, a per-address rate limit, and Cloudflare Turnstile when the owner configures it). Each submission creates a record and can trigger automations (`AUTO-001`). Standalone survey and quiz products belong to [Pencil](https://github.com/just-every/run-pencil).

**Acceptance.**
1. a browser journey publishes a form with a conditional question, submits it as a guest and anonymously, sees two records with mapped values, and sees an automation fire on each submission.
2. The conditional question appears only when its condition is met, and a submission that fills the honeypot or exceeds the rate limit creates no record.
3. Forbidding public links makes the anonymous form stop resolving at once.

**Evidence.** —
**Gap.** not implemented

#### DB-014 — Dashboards

Core · target · **partial**

**Requirement.** A page can hold a dashboard: several charts (`DB-008`) and views (`DB-011`) arranged in a grid, with dashboard-wide filters such as a date range or a person that apply to every tile. Each tile computes over the reader's authorized records only (`DB-002`).

**Acceptance.**
1. a browser journey builds a dashboard of three charts and a view, applies a date filter that changes every tile, and confirms a member with fewer grants sees lower counts and no restricted values.

**Evidence.** `src/core/features/databases/ui/workspace/DatabaseChart.tsx`
**Gap.** No validated CI-run proof for this acceptance point: "a browser journey builds a dashboard of three charts and a view, applies a date filter that changes every tile, and confirms a member with fewer grants sees lower counts and no restricted values."

#### DB-015 — Record templates and recurring records

Core · target · **partial**

**Requirement.** A database has record templates (default fields and a body), and a template can repeat on a schedule (daily, weekly on given days, monthly or yearly), creating a record at the set time in the time zone of the member who last saved it. A schedule runs as the template's last saver (a re-save hands it to that saver, and the Templates tab shows who it runs as), exactly once per occurrence, even after restarts, and pauses with a visible reason if that saver loses access.

**Acceptance.**
1. a Workers journey advances a scheduled trigger across two occurrences and a restart and finds exactly two records.
2. Revoking the last saver's access pauses the schedule with its reason shown.
3. A browser journey at 1440 and 390 shows the Templates tab saying the schedule runs as the member who last saved it, and a second member's re-save changing that name for both.

**Evidence.** `tests/e2e/databases/record-templates.test.ts`
**Gap.** Missing a browser journey through the Templates tab showing the last saver before and after another member re-saves; the cited HTTP journey covers recurrence, revocation and returned last-saver names only.

#### DB-016 — AI autofill fields

Core · target · **missing**

**Requirement.** A field can be an AI field (summary, extraction, classification or translation) computed from the record's own content. It re-runs when its inputs change, cites the record revision it read, is labeled AI-generated, counts against AI budgets (`AI-012`), and never reads records the field's owner cannot read. A member can override a value, and an override is kept until it is cleared.

**Acceptance.**
1. a Workers journey with a provider fake at the network edge fills a classification field for 20 records, re-runs only the 3 records that changed, keeps a manual override, and records usage against the budget.

**Evidence.** —
**Gap.** not implemented

### Notifications and follow-up

#### NOTIF-004 — Reminders

Core · target · **done**

**Requirement.** A date mention (`BLOCK-005`) can carry a reminder at the date or at a chosen offset. A member can set a reminder on any page or task item (`BLOCK-007`), and a task with a due date reminds its assignee on that date (`BLOCK-015`). Reminders arrive in the inbox, and by email or push where the member opted in (`NOTIF-005`), at the member's local time, exactly once, and are rechecked against access at delivery.

**Acceptance.**
1. a Workers journey sets reminders in two time zones, advances time, and finds exactly one inbox item each at the right local time.
2. A reminder on a page whose access was revoked is not delivered.

**Evidence.** `tests/profile/work-items-journey.ts` — "remindersJourney"
**Gap.** None.

#### NOTIF-005 — Email, push and digest delivery

Core · target · **missing**

**Requirement.** Each member chooses, per event kind, between in-app only, immediate email, a daily or weekly digest, push on their devices (`MOBILE-004`), and a chat direct message (`CHAT-004`), or keeps the workspace default for that kind (`NOTIF-006`). The inbox item is created whatever the choice. Email goes through `mail.sender.v1` from the configured sender and carries the event, the actor, the page title and a link, never a page body. Recipient access is rechecked at send, and an unsubscribe link changes that member's preference without sign-in. Reminders and due tasks (`NOTIF-004`, `BLOCK-015`) sent by email or in a digest keep `NOTIF-004`'s rules: each arrives at the member's local time, exactly once however many sends race or retry, and only while the member can still read its page. Task assignments (`BLOCK-015`) by email keep its rules: one per assignment to an assignee who can read the page, none to a previous assignee on reassignment, and none when an assignee completes their own task. Digests coalesce watched page and container changes (`CONT-012`, under its rules: one line per creation, editing session, move, archive or trash, and comment, nothing for a page the member cannot read or a draft, and one line for an event also covered by a page watch), mentions, task assignments and due tasks, review requests and lapsed verifications. A watched change carries a change summary: the counts of blocks added, changed and removed and of comments added since the member's last notice. When a workspace owner turns on "section names in notifications", the summary also names the headings the changed blocks sit under, for example "3 blocks changed in Rollout plan". It never carries block or comment text.

**Acceptance.**
1. a Workers journey with a mail provider fake at the network edge opts a member into a daily digest, generates eight events including one on a page the member later loses access to, and receives exactly one digest with seven items and no body text.
2. The unsubscribe link changes the preference.
3. An edit that changes 3 blocks under the heading "Rollout plan" appears as "3 blocks changed" with the owner switch off and "3 blocks changed in Rollout plan" with it on, and no text from those blocks appears in either email.
4. A reminder set for 09:00 in the member's time zone with immediate email produces exactly one email at that local time after two concurrent sends, and a reminder on a page the member lost access to produces none.
5. Assigning a task to a member opted into immediate email sends them exactly one email; reassigning it sends the new assignee one and the previous assignee none.
6. A member who watches a container with a daily digest finds another member's page creation, two edit sessions and a comment as exactly four digest lines, and nothing for a restricted page in it.

**Evidence.** —
**Gap.** not implemented

#### NOTIF-006 — Workspace notification defaults

Core · target · **missing**

**Requirement.** A workspace owner sets the default delivery for each event kind: mentions, comments and replies on watched or authored pages, task assignments and due tasks, reminders (`NOTIF-004`, under its local-time, exactly-once and access-at-delivery rules), review requests, access grants, shares with a message, watched changes, lapsed verifications and required reading. Each default is one of in-app only, immediate email, a daily or weekly digest, push, or a chat direct message (`CHAT-004`), and the owner also sets the default for autowatch (`PAGE-016`). A member who has not chosen for an event kind receives it exactly as the default says, and a change to the default reaches them from the next event. A member's own choice, including an unsubscribe, survives later changes to the default and is shown as theirs. A new workspace starts with Confluence's defaults: mentions, replies, task assignments, review requests and access grants by immediate email, watched changes as a daily digest, and autowatch on. A workspace upgraded from a version without this setting keeps in-app delivery only until an owner sets a default, and its owners are asked once. Every email keeps `NOTIF-005`'s rules: a title and a link only, access rechecked at send, and a one-click unsubscribe that works without signing in.

**Acceptance.**
1. a Workers journey with a mail provider fake at the network edge sets a default of immediate email for mentions and a daily digest for watched changes, invites a member who sets nothing, and finds one immediate email for a mention and one digest with the watched changes.
2. A second member who unsubscribed from mention email before the default changed gets no mention email.
3. Changing the default to in-app only stops the first member's mail from the next event.
4. A new workspace's first mention produces an immediate email with no owner action, a member who set nothing for reminders receives a due reminder once, at their local time, by the default's delivery, a new workspace's first task assignment emails its assignee once and a reassignment emails only the new assignee, and no email contains a page body.

**Evidence.** —
**Gap.** not implemented

#### AUTO-006 — Outbound automation actions

Core · target · **partial**

**Requirement.** Rule actions (`AUTO-001`) can also: - post to a Slack, Microsoft Teams or Nook channel; - call a signed webhook (`API-002`); - send an email from a member's own connected Gmail or Outlook mailbox under that member's OAuth grant, never from Slate's sender (`MAIL-001`); - create a Vector or Jira issue, with a backlink to the page (`EMBED-005`). Each action acts as the rule's actor (`AUTO-002`), sends only titles, links and fields the actor can read, uses an operation key so retries never duplicate, and records its receipt in the run log (`AUTO-003`). Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a Workers journey with provider fakes at the network edge fires one rule four times and finds one message, one webhook, one email and one issue per firing.
2. A retried firing produces no duplicate, and every receipt appears in the run log.

**Evidence.** `src/core/features/automation/actions.ts`
**Gap.** Missing a complete public-door journey for outbound automation actions; the cited material shows only part of the capability.

#### AUTO-007 — Triggers from connected tools

Core · target · **missing**

**Requirement.** Rules can trigger on events from connected tools: a GitHub or GitLab pull request merged or released, a Vector or Jira issue changing state, a Drive file changing, or an inbound signed webhook. They can then flag a page, request review, create a record or start a `KEEP-001` check. Event payloads are untrusted content (`AI-007`).

**Acceptance.**
1. a Workers journey posts a signed GitHub-shaped webhook and sees the matching rule run once and request review on the linked page.
2. An unsigned or replayed delivery is rejected and logged.

**Evidence.** —
**Gap.** not implemented

#### AUTO-008 — Accountable follow-through

Core · target · **partial**

**Requirement.** Every background action is a durable job with an accountable owner, a due condition, visible progress, a visible failure and an explicit stop or resolution state. This covers rules, schedules, reminders, review escalations, connector syncs, verification rules and agent work. A failed or stuck job appears on the owner's Home without a search. Re-running a job never duplicates a message, record or issue, and stopping a job cancels its unsent work.

**Acceptance.**
1. a Workers journey kills a job mid-run and finds it resumed once with no duplicate effect.
2. A forced failure appears on the owner's Home, and stopping a queued job cancels its pending sends.

**Evidence.** `src/core/features/automation/jobs.ts`
**Gap.** No validated CI-run proof for this acceptance point: "a Workers journey kills a job mid-run and finds it resumed once with no duplicate effect."<br>No validated CI-run proof for this acceptance point: "A forced failure appears on the owner's Home, and stopping a queued job cancels its pending sends."

### Moving in and out

#### IMP-006 — Notion import with comments and live databases

Core · target · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2 · Register R-2

**Requirement.** Slate imports Notion's HTML export, including page and block comments, which become threads anchored to the matching blocks with their authors and times. It also imports through the Notion API, keeping databases with their relations, rollups, formulas, views and filters, with page-level sharing mapped through reviewed principal mappings (`IMP-016`'s rules). An API import can re-sync changed pages until cutover, and the loss report names every unsupported block, formula function and permission.

**Acceptance.**
1. imports of a real Notion HTML export with comments and of a real Notion workspace over the API with a provider-recorded fixture.
2. Threads land on the right blocks, rollups recompute to Notion's values or are marked not-recomputed, and a re-sync updates only changed pages.

**Evidence.** `src/core/features/imports/service.ts`
**Gap.** Missing a complete public-door journey for notion import with comments and live databases; the cited material shows only part of the capability.

#### IMP-007 — Confluence Cloud live migration

Core · target · **missing** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2 · Register R-3

**Requirement.** Through the Confluence Cloud REST API (OAuth), Slate imports one or more spaces using `IMP-016`'s reviewed principal mapping. It carries: - pages with every version, each with its mapped author and time; - blog posts as posts with their original dates and authors (`CONT-010`); - footer comments with their replies, and inline comments anchored to the same text, each with its author, time and open or resolved state; - attachments with every version (`BLOCK-022`), with their text searchable (`SEARCH-013`); - labels (`PAGE-001`, `SEARCH-010`); - page restrictions, space permissions (`IMP-011`) and personal spaces (`IMP-012`). Macros, diagrams and tasks with their assignees and due dates map as `IMP-010` names. It can re-sync deltas until cutover. A delta adds exactly what changed since the last pass, keyed by source ID and version, and never duplicates a page, version, comment or attachment. Its redirect map, from every old Confluence URL to its Slate record, is kept in Slate and served by Slate itself (`IMP-013`), so a buyer whose site lives on `atlassian.net`, where only Confluence Premium offers a custom domain, needs no host of its own. Links into spaces imported in later passes are back-filled (`IMP-014`). The cutover report lists what changed since the first pass, every link in Slate that still points at the old site (`IMP-014`), the old URLs requested since cutover that map to nothing (`IMP-013`), and the changes made by the Jira re-pointing step (`EMBED-006`). Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. the recorded Confluence Cloud API fixture holds: - a page with 3 versions by 2 authors; - one open and one resolved inline comment anchored to text; - a footer comment with a reply; - an attachment with 2 versions; - two labels; - a blog post; - a personal space.
2. After import, a Workers journey asserts block by block that: - the page's history lists 3 revisions with their mapped authors and times; - both inline threads sit on the same text with their authors and resolved states, and the footer comment keeps its reply; - the attachment has both versions; - both labels are searchable and filterable; - the blog post is a post with its original date and author; - the personal space lands as `IMP-012` requires.
3. A delta that adds one comment and one page version adds exactly those two and duplicates nothing.
4. Every old page and blog URL in the fixture, in each `IMP-013` form, resolves through Slate's own resolver route to its imported record with no host other than the deployment, and the cutover report lists the fixture's links into a space that was not imported.
5. The same fixture's macros, diagrams, tasks and space permissions arrive as `IMP-010` and `IMP-011` require.

**Evidence.** —
**Gap.** not implemented

#### IMP-008 — Guru import

Core · target · **missing** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** Slate imports a Guru export or reads the Guru API, turning collections into containers, folders into tree pages and cards into cards (`CARD-001`), with their owners, verifiers and verification intervals. Guru verification arrives as imported metadata that reads "Verified in Guru by name on date". It never counts as Slate verification until a member verifies the exact revision (`STAT-003`).

**Acceptance.**
1. an import of a real Guru export fixture creates the expected collections, cards and owners, every imported card shows the Guru verification line and Slate status "unverified", and verifying one card produces a normal `STAT-003` record.

**Evidence.** —
**Gap.** not implemented

#### IMP-009 — Folder imports from Google Drive and SharePoint

Core · target · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2 · Register R-4

**Requirement.** A member can import a Google Drive folder or a SharePoint/OneDrive folder of Google Docs, Word and PDF files as a page tree, keeping folder hierarchy, titles, headings, tables, images and links between imported documents. Each source document keeps a link back to the original, and the report names every file it did not import.

**Acceptance.**
1. a Workers journey with recorded provider fixtures imports a nested folder of 12 documents into a tree with resolved cross-links.
2. A workspace owner enables a provider; each full member supplies a delegated credential whose provider account matches their verified Slate email.
3. Credentials are encrypted, omitted from responses and exports, and destroyed on disconnect or member erasure.
4. Preview binds the exact source tree and destination revision before atomic publication.
5. Every new folder and document page is restricted to the importing member, including beneath a shared destination; source sharing grants are never copied.
6. An unreadable folder is not enumerated.
7. A file whose structure cannot be preserved is wholly omitted and named in the report; supported tagged PDFs preserve headings, tables, images and document links.

**Evidence.** `tests/e2e/imports/drive-sharepoint-import.test.ts` — "IMP-009 — Member folder imports preserve a nested twelve-document tree, resolving links and actor-only access with a per-file omission report" (Verify Slate: workers); `tests/qualification/ui-convergence/folder-journey.mjs` — "folderJourney", loaded by the existing readable-export journey (Verify Slate: ui-content-desktop shards, 1440)
**Gap.** Carried partial pending a fresh-judge claim on the existing recorded-provider and browser journeys. Real Drive/SharePoint accounts and consent are R-4 field proof and do not gate DONE.

#### IMP-010 — Confluence macros, tasks and diagrams map to Slate blocks

Core · target · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** The file import (`IMP-003`) and the API migration (`IMP-007`) map each Confluence macro to a named Slate equivalent, which is live wherever the Slate equivalent is live: A Task Report macro becomes a task report block (`BLOCK-016`) with the macro's space, ancestor page, label, assignee, creator, due-date range and state filters, its grouping, order and limit, and it then shows each reader only the tasks they can read; this mapping is proven here, by the genuine export below, not by `BLOCK-016`'s acceptance. The loss report lists only the unsupported rows and macros Slate does not recognize. A mapped macro whose target lies outside the import, such as an excerpt from a space not imported or a Jira site not connected, imports as its mapped block in its access-needed or "Connect to view" state and is listed as unresolved, never dropped.

| Confluence | Slate |
| --- | --- |
| Jira Issues (single issue or JQL table), Jira Smart Links | Live issue card or query table (`EMBED-001`) with a backlink on each issue (`EMBED-005`) |
| Jira Chart (pie, two-dimensional and created-versus-resolved charts over JQL) | Live Jira query embed shown as the same chart type over the same JQL (`EMBED-001`) |
| Excerpt, Excerpt Include, Include Page | Synced block from the source page (`BLOCK-011`) |
| Children Display, Content by Label, Page Tree, Recently Updated | Content query with the same scope, labels, depth and order (`BLOCK-010`) |
| Table of Contents | Table-of-contents block (`BLOCK-017`) |
| Page Properties, Page Properties Report | Pages that carry a Page Properties macro with the same label become records of one database for that label, keeping their bodies and tree positions (`DB-010`), with typed fields; the report becomes an embedded view with its columns and sort (`DB-011`) |
| Task list, Task Report | Tasks with their assignee (through the reviewed principal mapping), due date and completion (`BLOCK-015`); task report with the same filters (`BLOCK-016`) |
| Status | Status label with its color (`BLOCK-018`) |
| Info, Note, Warning, Tip, Panel | Callout with the matching tone (`BLOCK-006`) |
| Expand | Expandable section (`BLOCK-006`) |
| Code, Noformat | Code block with its language (`BLOCK-006`) |
| Attachments, View File | A file block for each attachment, previewing in place for every `BLOCK-021` preview type, with every attachment version kept (`BLOCK-022`) and its text searchable (`SEARCH-013`) |
| Section and Column, page layouts | Columns (`BLOCK-012`) |
| Anchor | A heading anchor that links resolve to |
| User mention, team mention, Date | Person or group mention through the reviewed mapping (`BLOCK-005`, `BLOCK-020`); date mention |
| Widget Connector and Smart Link embeds (YouTube, Loom, Figma, Google Docs and others) | Allowlisted embed (`EMBED-003`), otherwise a link card (`BLOCK-009`) |
| draw.io, Gliffy | Diagram block with its source (`BLOCK-019`) |
| LaTeX and Mermaid apps | Equation or Mermaid block (`BLOCK-013`) |
| Whiteboards | Named in the loss report with a link to the original, plus its exported image as a file block when the export or API supplies one |
| Confluence databases | Named in the loss report with a link to the original; the database's own CSV export imports as a database under `IMP-005` |
| Team Calendars (Confluence Premium) | Each calendar whose ICS feed or export the buyer supplies imports as a database with a date field and a calendar view (`DB-004`); a calendar not supplied is named in the loss report with a link to the original |
| Roadmap Planner, Chart (over a body table), Livesearch, gadgets and Marketplace macros not named above | Unsupported: the macro's body text is kept where it has one, and the loss report names the macro, the page and the count |

**Acceptance.**
1. a real Confluence Cloud space, captured both as a file export produced by Confluence (`IMP-003`) and as a recorded API fixture (`IMP-007`), contains at least one of every mapped macro, a draw.io and a Gliffy diagram, a whiteboard and a Roadmap Planner.
2. After each import a Workers journey checks every macro block by block against the fixture's expected map: the Jira macros render as live embeds under recorded Jira fixtures, the Jira Chart as a chart of the same type, the View File macros as file blocks that preview (`BLOCK-021`), the excerpt as a synced block, the children display as a content query, the table of contents as its block, Page Properties as records with a view, tasks with their assignee, due date and state, the Task Report as a task report with the same filters, grouping and order, and the panels, expand, code and status labels as their blocks.
3. Both diagrams render as diagram blocks with their sources.
4. The loss report lists exactly the whiteboard and the Roadmap Planner.

**Evidence.** `src/core/features/imports/confluence/storage.ts`
**Gap.** Missing a complete public-door journey for confluence macros, tasks and diagrams map to slate blocks; the cited material shows only part of the capability.

#### IMP-011 — Confluence space permissions become container grants

Core · target · **missing** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** Both Confluence imports carry each space's permissions, not only its page restrictions. Where the source supplies them (the Confluence Cloud REST API's space permissions and space role assignments under `IMP-007`, and the `SpacePermission` objects in a Server or Data Center `entities.xml` under `IMP-003`), the Preview (`IMP-001`) lists every principal (user, group, team, all licensed users and anonymous) with its source role and the proposed Slate grant: - view only becomes `view`, view and comment becomes `comment`, add or edit pages (with or without delete) becomes `edit`, and space admin becomes `full` and a container administrator (`CONT-009`); - a group or team maps only through a reviewed source-ID mapping to a Slate group, and a user only to an existing active member, under `IMP-016`'s rules; all licensed users, or the default users group, maps to the container's general grant at that level, scoped to the container (`SHARE-005`); - anonymous access is reported and never published (`PORT-005`, `WEB-001`); - finer permissions with no Slate level (export, delete own, set restrictions) collapse to the nearest level that does not widen access, and each collapse is named. After Apply, the container's grants match the reviewed mapping, page restrictions still narrow access inside it as `IMP-003` requires, and a member covered by no mapped grant cannot open any imported page. A Confluence Cloud CSV export carries no space permissions, so it imports with the container closed to everyone except the importing member and the workspace owners until the reviewed grants are set, and the report says so.

**Acceptance.**
1. an `IMP-007` recorded fixture space grants view to group A and edit to group B, makes one user space admin, and has anonymous access on; an `entities.xml` fixture repeats the same permissions.
2. After the reviewed mapping, the container's grants are group A `view`, group B `edit`, and the user `full` and container administrator.
3. The anonymous access appears in the report and no page is published.
4. A member in neither group cannot open any page, a member of group A can read but not edit, and a page restriction inside the space still narrows access.

**Evidence.** —
**Gap.** not implemented

#### IMP-012 — Confluence personal spaces become personal containers

Core · target · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** Both Confluence imports recognize a personal space: `spacetype=personal` in a Cloud CSV export, the personal space type in `entities.xml`, and the API's `personal` space type (`IMP-007`). The outcome depends on the space's owner and on who else could read it: - **Owner mapped, space private to them.** When the owner maps through the reviewed principal mapping to an existing active member, the space's pages land in that member's personal container (`CONT-005`) with their tree, and only that member can open them afterwards. - **Space shared with others.** A personal container allows no grants (`CONT-005`), so a personal space that granted access to anyone other than its owner imports as a `private` container owned by the mapped member. It carries the mapped grants (`IMP-011`), and the report says why. - **Owner unmapped.** The space imports as a `private` container that only the importing member and the workspace owners can open, and it is flagged for reassignment to a member. No page from a personal space ever carries a general grant (`SHARE-004`).

**Acceptance.**
1. an `IMP-007` recorded fixture and an `IMP-003` CSV export each hold three personal spaces: one private to a mapped owner, one shared with a group, and one whose owner is unmapped.
2. After the reviewed mapping: - the first space's pages are in the mapped member's personal container, which no other member, the importing member included, can open; - the second is a `private` container with the group's grant and a report line; - the third is a `private` container that only the importing member and the owners can open, flagged for reassignment.
3. No imported page carries a general grant.

**Evidence.** `src/core/features/imports/confluence/space.ts`
**Gap.** Missing a complete public-door journey for confluence personal spaces become personal containers; the cited material shows only part of the capability.

#### IMP-013 — Old Confluence links resolve in Slate

Core · target · **partial** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** Every Confluence import, by file (`IMP-003`) or by API (`IMP-007`), keeps a link map in Slate from each imported space, page, blog post, attachment and comment to its Slate record. The map is keyed by source site and source ID, and keeps every title a page or post has had as an alias. Slate recognizes these old URL forms, on an `atlassian.net/wiki` site and on a Server or Data Center base URL: - tiny links (the documented public door, the documented public door), decoded with Confluence's tiny-link encoding of the page ID; - page-ID URLs (the documented public door, its editor forms, and `viewpage.action?pageId=123`); - title URLs (the documented public door), matched against the page's current and earlier titles; - blog URLs (the documented public door and the documented public door); - space home URLs (the documented public door, the documented public door) and attachment downloads (the documented public door); - `focusedCommentId` parameters and heading fragments, which carry through to the comment thread and the heading anchor. Slate serves the map itself, so the buyer needs no host of its own: - **Resolver route.** the documented resolver is an authenticated Slate route. A signed-out visitor signs in first and then continues, and learns nothing about the map before sign-in. A mapped URL redirects to the record's permanent URL (`LINK-001`). A member without access gets `LINK-004`'s access-needed state there and learns nothing more, and a deleted record resolves to its tombstone (`LINK-002`). An unmapped URL shows a "Not migrated" page with an "Ask an owner" action. It names the source space key when the URL or the import records carry it, and never a title. - **Old hostname.** An owner who controls the old hostname, such as a Server or Data Center site or a Confluence Premium custom domain, can add it as a legacy hostname and point it at the deployment. Every old path on it then redirects to the resolver on Slate's own origin, keeping the fragment. - **Chat.** An owner can add the old Confluence hostname to the Slack, Teams and Nook apps' unfurl domains. A newly posted old URL then unfurls as its Slate record under `CHAT-002`'s access rule, with an "Open in Slate" action. - **Browser.** Members with the browser extension are sent from the old site to Slate (`CARD-002`). - **Map export.** An owner can download the map as CSV (old URL, Slate URL) to serve from any proxy they run. Later passes add to the map (`IMP-014`). Complete export and restore carry it (`PORT-001`, `PORT-002`), and only an Undo removes entries, for the records it removes. Every unmapped URL that reaches the resolver after cutover is counted in the cutover report (`IMP-007`) by source URL, with no member identity. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. the `IMP-007` fixture and an `IMP-003` CSV export of the same space each import a page, a renamed page, a blog post, an attachment and an inline comment.
2. A Workers journey then requests the documented resolver with: - the page's tiny link, its page-ID URL and its `viewpage.action` URL; - the renamed page's old the documented public door title URL; - the blog URL and the attachment download URL; - the comment's `focusedCommentId` URL.
3. Each redirects to its imported record.
4. A member without access to the page follows the redirect and gets the access-needed state with no title.
5. A signed-out request reaches sign-in and reveals nothing else.
6. A URL from a space that was not imported shows "Not migrated" with its space key.
7. A request to a configured legacy hostname for the tiny link redirects to the resolver on the main origin and sets no cookie.
8. With a chat provider fake at the network edge, a posted page-ID URL unfurls as the Slate page for a reader and as "Restricted Slate page" for a non-reader. The downloaded CSV lists every mapped URL, and after export and restore into an empty deployment the tiny link still resolves. Exceeding the lookup limit returns 429.

**Evidence.** `src/core/platform/db/knowledge-operations-schema.ts`
**Gap.** Missing a complete public-door journey for old confluence links resolve in slate; the cited material shows only part of the capability.

#### IMP-014 — Links between spaces imported in separate passes

Core · target · **missing** · Cites BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003 · Rules D-2

**Requirement.** A link in an imported body whose target lies outside that import is kept as a pending link. The target can be a Confluence page, blog post or attachment, named by a Confluence URL in any `IMP-013` form or by a storage-format reference with its space key and title or content ID. A pending link renders as the original URL with a "not yet migrated" marker, and Slate records its page, block and target. When a later pass imports the target, by file (`IMP-003`) or by API (`IMP-007`) and in either order: - each pending link becomes a link to the imported record, in one revision per page attributed to that import run, and only the link target changes; - a native edit made since the earlier pass is kept, and a pending link whose block was deleted leaves the list with no change; - an `IMP-010` block whose target lay outside the earlier import, such as an excerpt from a space not yet imported, becomes live; - a link rewritten once never changes again, so re-running a pass or a delta changes nothing; - Undo of the later pass (`IMP-001`) restores the original URLs and keeps native edits. The cutover report (`IMP-007`) lists, by page, every link in Slate content that still points at an old Confluence hostname, pending links and plain URLs in text alike, grouped by target space with counts. It shows titles only of pages its viewer can read, counts the rest, and downloads as CSV.

**Acceptance.**
1. the fixture holds two spaces.
2. In space A, page A1 links to space B's page B1 by a page-ID URL, a tiny link and a storage-format page reference, and includes an excerpt from B's page B2.
3. A Workers journey imports A from its CSV file export.
4. A1's three links render as pending, the excerpt shows its access-needed state, and the cutover report lists A1 with three links to space B.
5. A member then edits another paragraph of A1.
6. Importing B by API turns all three links into links to B1's record and the excerpt into a live synced block.
7. The native edit is intact, and A1's history shows exactly one import revision.
8. A delta pass of B changes nothing, and the cutover report lists no link to space B. Undo of B's import restores the three original URLs and keeps the native edit. A member without access to A1 sees neither its title nor its links in the report.

**Evidence.** —
**Gap.** not implemented

#### PORT-008 — Exports carry comments

Core · target · **done** · Cites BASE-DATA-001

**Requirement.** Workspace, container and page exports in HTML include page and inline comment threads with their authors, times and resolved state, anchored to their blocks. Markdown exports carry the same threads in a sidecar JSON file, and re-importing a Slate export restores the threads.

**Acceptance.**
1. a round trip of export to HTML and Markdown and re-import into a fresh deployment restores every thread on the same block with the same authors and resolved states.

**Evidence.** `tests/qualification/ui-convergence/export-comments-journey.mjs` — "exportCommentsJourney"
**Gap.** None.

#### PORT-009 — Scheduled backups to the buyer's storage

Core · target · **partial** · Cites BASE-BACKUP-001, BASE-DATA-001 · Register R-13

**Requirement.** An owner can schedule a nightly or weekly complete export (`PORT-001`) to the buyer's own S3-compatible bucket or Cloudflare R2, with a retention count, failure notices to owners, and a restore drill that restores the latest backup into an empty deployment (`PORT-002`). [Chest](https://github.com/just-every/run-chest) inherits this destination contract when it publishes an intake. Failure notices are in-app; email notices inherit `NOTIF-005`. Only an owner with a fresh sign-in proof configures or removes a destination. The same proof gates credential replacement, which keeps the schedule and run history. Credentials are encrypted with connector credentials key, returned by no API and excluded from archives; removal destroys them. Nightly and weekly schedules use UTC. A durable destination/period receipt admits one run even under concurrent invocation or restart; an interrupted run is recorded as a failure rather than uploaded twice. A complete ZIP is streamed in bounded parts, then uploaded and checked by size and SHA-256 readback before retention removes any exact key written by this feature. An incomplete export scope produces a recorded failure and no partial external object. A failed run sends each active owner one in-app notice; a later success clears the current failure while preserving history. Restore requires an empty separate deployment and renewed credentials. The source action validates the latest archive and supplies a report and instructions; it does not claim that the separate restore has already completed. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a scheduled run writes a backup to a test bucket, a forced failure notifies owners, and the restore drill restores into an empty deployment where links resolve to the same records.
2. Chest inherits the same destination contract when an intake exists; email failure notices inherit `NOTIF-005`.

**Evidence.** `tests/flagship/federation/federation.test.ts` — "PORT-009 — Scheduled backup writes to the destination, applies retention, notifies owners on failure and restores into an empty deployment" (Verify Slate: workers); `tests/qualification/ui-convergence/backups-journey.mjs` — "backupsJourney", loaded by "readable exports retain discussions through HTML and Markdown re-import" (Verify Slate: ui-content-desktop shards, 1440)
**Gap.** Carried partial pending a fresh-judge claim on the cited S3/R2 fixture and browser restore journeys. The real bucket receipt is R-13 field proof and does not gate DONE; email notices remain NOTIF-005’s obligation.

#### PORT-010 — Word export of a page

Core · target · **done** · Cites BASE-DATA-001

**Requirement.** A member can export one page, or a page with its descendants, as one Word `.docx` file. It carries headings, bulleted, numbered and toggle lists, tasks with their checked state, assignee and due date, tables with horizontal and vertical merged cells, code, callouts, images with their alt text, equations, diagrams as images and links: links to other exported pages resolve inside the document, and other links point to their Slate URLs. A table of contents (`BLOCK-017`) exports as a linked list. Comments can be included as Word comments, retaining authors, times, replies and resolved state under `PORT-008`'s authorization rules. The file carries only what the exporting member can read: an unreadable descendant contributes no content, title, count or placeholder. Access is rechecked before the export is returned. Re-importing under `IMP-005` reproduces headings, tables including merged cells, and images with their alt text. Every string is XML-escaped. The document contains no macros and no external relationships except hyperlinks to Slate URLs; image bytes come only from files the exporting member can read. The equation and diagram blocks inherit these Word obligations in their own clauses and acceptance: `BLOCK-013` carries equations as OMML or images and Mermaid diagrams as images; `BLOCK-019` carries diagrams.net previews as images. Their Word representations are governed by those clauses; no unsupported representation is fabricated. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a default-profile Workers journey exports a seeded page containing every implemented block kind listed above as `.docx`, parses the document, comments and relationships, and checks formatting, merged cells, task metadata, image alt text, linked contents, internal page anchors and optional comments.
2. It verifies escaped XML, no macros and no external relationships except hyperlinks to Slate URLs, then re-imports under `IMP-005` with the same headings, merged tables and images with alt text.
3. A member without access to one child exports the parent with descendants, and the file names nothing from that child; inaccessible media is never embedded and a concurrent access change prevents a stale export.
4. `BLOCK-013` and `BLOCK-019` add their inherited equation and diagram checks when those blocks ship.
5. A browser journey at 1440 and 390 selects Word, includes or excludes comments, downloads the file and verifies the comments choice.

**Evidence.** `tests/qualification/ui-convergence/export-comments-journey.mjs` — "exportCommentsJourney"; `tests/e2e/imports/word-export.test.ts` — "PORT-010 — PORT-010 Word export carries every block kind, omits a child the member cannot read and re-imports with the same headings, merged tables and image alt"
**Gap.** None.

### Integrations

#### EMBED-001 — Live issue embeds from Vector and Jira

Core · target · **missing** · Register R-5

**Requirement.** Pasting a [Vector](https://github.com/just-every/run-vector) or Jira issue URL, or a Vector or JQL query, renders a live card or table showing status, assignee, priority and sprint, refreshed on open and every 5 minutes. A query embed can also display as a pie chart by one field, a two-dimensional table of counts by two fields, or a created-versus-resolved chart over a period. Each reader sees issue details only through their own linked account. A reader without a linked account sees "Connect to view", never the details Slate fetched for someone else. Selecting text offers "Create issue", which files the issue under the member's account and links it in both directions: the page shows the issue, and the issue carries a backlink to the page (`EMBED-005`).

**Acceptance.**
1. a browser journey with recorded Jira and Vector API fixtures renders a card, a query table and the same query as a pie chart and a two-dimensional chart whose counts match the fixture, refreshes a changed status, creates an issue from selected text with a backlink, and shows "Connect to view" to an unlinked member.

**Evidence.** —
**Gap.** not implemented

#### EMBED-002 — GitHub and GitLab embeds

Core · target · **missing**

**Requirement.** Pull request, issue, commit and release links render live cards with their state and checks. A file-range permalink renders the code pinned to its commit, with a notice when the default branch has changed those lines since. Reader access follows `EMBED-001`'s per-member rule.

**Acceptance.**
1. a browser journey with recorded GitHub and GitLab fixtures renders a PR card, a pinned code range with a "changed since" notice after the fixture's branch moves, and the unlinked-member state.

**Evidence.** `src/core/features/connectors/github.ts`
**Gap.** not implemented

#### EMBED-003 — Design, video and document embeds

Core · target · **partial** · Cites BASE-PUBLIC-001

**Requirement.** Allowlisted embeds render inline through oEmbed or provider iframes: Figma, Miro, Lucid, Loom, YouTube, Vimeo, Google Docs, Sheets and Slides, and Microsoft 365 files. Each sets a sandbox and a content security policy per provider, loads nothing before the reader interacts on a published page (`BASE-PUBLIC-001`), and falls back to a link card (`BLOCK-009`) when the provider refuses.

**Acceptance.**
1. a browser journey embeds one item per provider using recorded fixtures, checks the sandbox and CSP attributes, and confirms that a published page loads no third-party request before a click.

**Evidence.** `tests/e2e/editor/provider-embeds.test.ts` — existing EMBED-003 registration via embedRefusalsJourney (`tests/e2e/editor/embed-refusals-journey.ts`) proves paired allowed/refused origins, zero visitor provider reads, expired-verdict rejection and member refresh, private/loopback/link-local literals and redirect-hop rejection, observation values free of member identity and credentials, and closed-target refusal of decimal, hex and IPv4-mapped literals, userinfo, non-443 ports and non-https schemes, plus stopped non-allowlisted redirects and arbitrary-host published link cards with zero probes, Verify Slate: workers (1/6); `tests/e2e/review/verification-upgrade.test.ts` — populated prior-schema upgrade, Verify Slate: workers; `tests/qualification/ui-convergence/provider-embeds-journey.mjs` via embedTimeoutJourney, Verify Slate: ui-content-desktop shards (1440)
**Gap.** Unrecognized HTTP-200 error documents; provider-specific authenticated/consent refusals; live provider acceptance NOT RUN; arbitrary-host embeds are not probed.

#### EMBED-004 — Live file cards from Drive, SharePoint and Chest

Core · target · **partial** · Register R-4

**Requirement.** A file picker inserts Google Drive, SharePoint/OneDrive or [Chest](https://github.com/just-every/run-chest) files by reference. Each card shows the file's current title, owner, last modified time and type, and whether the reader can open it. Slate never copies the file unless the member chooses "attach a copy" (`BLOCK-008`). Drive and SharePoint references use the inserting member's own provider connection. Metadata is resolved afresh with each reader's own provider authority: when it cannot open the file, the card exposes no title, owner, type or time, only the provider, request-access action and provider link; an unconnected reader also sees the existing connect path. This conservative default grants no provider permission. Unmapped or ambiguous provider identity and ACL refresh failure disclose no metadata (`CONNECT-002`). Deleted files show unavailable without retained metadata. Disconnect destroys the member token and retains page references. A reference stores and exports only provider, file ID and stable link; existing page revisions, archive/restore and erasure carry it without file bytes, tokens or cached metadata. Public pages and readable exports show the provider link without fetching metadata. [Chest](https://github.com/just-every/run-chest), the RunEditRun file-storage product, remains a named source gap while it publishes no metadata door.

**Acceptance.**
1. a browser journey with recorded provider fixtures inserts one file from each source, sees a renamed file's new title after refresh, and sees "request access" for a reader without access.

**Evidence.** `tests/e2e/editor/provider-embeds.test.ts` — EMBED-003 registration with [EMBED-004], fileCardsHttpJourney (`tests/e2e/editor/file-cards-journey.ts`); `tests/qualification/ui-convergence/provider-embeds-journey.mjs` — fileCardsJourney (`tests/qualification/ui-convergence/file-cards-journey.mjs`) at 1440 (`evidence/file-cards/`), Verify Slate: workers, ui-content-desktop shards
**Gap.** Chest file cards remain unimplemented until its metadata door exists. Drive/SharePoint real account receipts are R-4 field proof; the recorded per-reader card journeys remain local evidence. The unconnected-reader outcome follows RL-2.

#### EMBED-005 — Backlinks on Jira and Vector issues

Core · target · **missing** · Register R-6

**Requirement.** When a page embeds, mentions or links a Jira or Vector issue (`EMBED-001`), or a member or a rule creates an issue from it (`EMBED-001`, `AUTO-006`), Slate writes exactly one link to the page on the issue, so the issue lists the Slate pages that reference it. In Jira Cloud this is a remote issue link with a stable global ID for each page and issue, written under the acting member's linked account. In [Vector](https://github.com/just-every/run-vector) it is Vector's own page link. Embedding the same issue again on the same page writes nothing new. Renaming the page updates the link's title. Removing the page's last reference to the issue, or trashing or erasing the page, removes the link, and restoring the page writes it again. A page in a `private` or `personal` container, a draft (`LIFE-002`), or a page under a Confidential classification (`ADMIN-006`) gets a link titled "Slate page" with no page title, and opening any backlink still requires Slate access. A failed write is retried under its operation key and shown on the embed, never dropped silently. Links that people add to the page from the Jira or Vector side are listed on the page (`EMBED-007`), and the links Jira already holds to Confluence pages that Slate migrated are re-pointed at cutover (`EMBED-006`).

**Acceptance.**
1. a Workers journey against recorded Jira Cloud and Vector API fixtures embeds one issue, mentions a second and creates a third from selected text, and finds exactly one remote link to the page URL on each issue.
2. Embedding the first issue again writes no second link, renaming the page updates the link titles, removing the embed deletes its link, and a draft's link carries the neutral title.

**Evidence.** —
**Gap.** not implemented

#### EMBED-006 — Jira links to migrated Confluence pages are re-pointed at cutover

Core · target · **missing**

**Requirement.** An optional cutover step re-points the Jira issue links that point at Confluence pages Slate has migrated (`IMP-007`, `IMP-003`). A workspace owner runs it under their own linked Jira Cloud account. It finds the links in two ways: - Jira's `issuesWithRemoteLinksByGlobalId` query for the application-link global ID of every migrated page, which finds the links Confluence wrote when a page embedded an issue; - a scan of the remote links on issues in the Jira projects the owner selects, matching each web link's URL against the `IMP-013` map in any of its forms. A preview lists every proposed change by issue: the old link, the Slate link to be written and the action for the old link. Issues the account cannot edit and links to pages that were not migrated are listed separately and left alone. On apply: - each issue gets exactly one Slate backlink to the migrated page, with `EMBED-005`'s semantics: a stable global ID, the neutral title "Slate page" for a page in a `private` or `personal` container, a draft or a Confidential page, and no second link where an `EMBED-005` backlink already exists; - the old Confluence link is removed, or relabeled "Confluence (retired): title", as the owner chose for the run. A relabeled link keeps its URL, so the resolver and the extension still route it; - each change is recorded in the run log with its issue, old link, new link and action, and appears in the cutover report; - re-running the step changes nothing, and reverting a run restores each old link and removes each Slate link it wrote. [Vector](https://github.com/just-every/run-vector) issues that carry Confluence links, for example from a Jira import into Vector, are re-pointed the same way through Vector's API.

**Acceptance.**
1. a Workers journey runs against a recorded Jira Cloud fixture: - issue J1 has an application-linked remote link to migrated page P1; - J2 has a web link to P1's tiny link; - J3 has a web link to the page-ID URL of P2, in a `private` container; - J4 links to a page that was not migrated; - J5 is in a project the owner's account cannot edit.
2. The preview lists changes for J1, J2 and J3, lists J4 as not migrated and J5 as skipped.
3. Applying in relabel mode leaves J1, J2 and J3 each with exactly one Slate remote link carrying the stable global ID, beside the relabeled Confluence link, and J3's Slate link is titled "Slate page".
4. J4 and J5 are unchanged, and the run log has three entries.
5. Re-running writes nothing.
6. A second run on a fresh fixture in remove mode removes the Confluence links, and reverting it restores them.
7. A variant in which J1 already carries an `EMBED-005` backlink writes no second link.
8. The same journey runs against a recorded Vector fixture, and provider acceptance repeats it against a real Jira Cloud site.

**Evidence.** —
**Gap.** not implemented

#### EMBED-007 — Issues that link here

Core · target · **missing**

**Requirement.** Each page has an Issues panel, like Confluence's Jira links button, listing the Jira and Vector issues that link to the page. That includes the backlinks `EMBED-005` and `EMBED-006` wrote, and remote links people added from the Jira or Vector side to the page's Slate URL or to an old Confluence URL that `IMP-013` maps to it. Slate finds the links three ways: Jira's `issuesWithRemoteLinksByGlobalId` query for its own global IDs, a periodic scan of the remote links on issues in the connected projects within `seed.json → limits`, and Vector's page-link query. Each reader sees an issue's key, title and status only through their own linked account (`EMBED-001`). An issue their account cannot read is neither shown nor counted, and a reader with no linked account sees "Connect to view". The page header shows the panel's count, and each issue opens in its tracker.

**Acceptance.**
1. a Workers journey against recorded Jira Cloud and Vector fixtures links four issues to one page: one by a Slate backlink from an embed, one by a web link to the page's Slate URL added from the Jira side, one by a web link to the page's old Confluence URL, and one in a project that a second reader's account cannot read.
2. A browser journey shows a reader with full Jira access all four, the second reader three with no trace or count of the fourth, and an unlinked member "Connect to view".
3. A link added from the Jira side after the first scan appears after the next scan interval with no Slate edit.
4. Provider acceptance repeats this on a real Jira Cloud site.

**Evidence.** —
**Gap.** not implemented

#### EMBED-008 — Slate for Jira: smart links and project pages

Core · target · **missing**

**Requirement.** Slate ships an Atlassian Forge app that gives Jira what Confluence's own integration gave it. The buyer installs it on their Jira Cloud site from a distribution link, with no Marketplace listing. - **Smart Links.** A Slate URL pasted into a Jira issue description or comment renders as a Smart Link with the page's title, verification state and last update. Slate reads it as the viewing Jira user's linked Slate identity, linked once like `CHAT-002`'s chat identity. A page that identity cannot read renders as "Restricted Slate page", and an unlinked viewer gets a "Connect Slate" prompt. - **Project pages.** A Jira project admin links the project to one or more Slate containers. The project sidebar then shows a "Slate" page listing the pages of those containers that the viewer's linked identity can read, with search, recently updated pages and a "Create page" action that opens Slate. [Vector](https://github.com/just-every/run-vector) projects get the same through Vector's own project link: a linked container's readable pages appear in the project, and Slate URLs render with their titles.

**Acceptance.**
1. a Workers journey sends the app's recorded Forge invocations, link resolution and project-page requests, to Slate's app endpoint for a reader, a non-reader and an unlinked Jira user.
2. The reader gets the title, verification state and last update, the non-reader gets "Restricted Slate page", and the unlinked user gets the connect prompt.
3. The project page lists only each user's readable pages of the linked container.
4. A browser journey does the same through Vector's project view.
5. Provider acceptance deploys the app to a real Jira Cloud development site, pastes a Slate URL into an issue and sees the Smart Link, and opens the project's Slate page.

**Evidence.** —
**Gap.** not implemented

#### CHAT-001 — Chat notifications to Slack, Microsoft Teams and Nook

Core · target · **partial** · Rules D-1 · Register R-14

**Requirement.** Workspace and container owners connect any number of channels in Slack, Microsoft Teams or [Nook](https://github.com/just-every/run-nook), each with its own event selection: published or updated pages, new comments, blog posts, review requests and lapsed verifications in the container. `NOTIF-003`'s guarantees apply to every destination: link-only messages, access-checked links, encrypted credentials returned by no API response and destroyed on disconnect, startup refusal naming connector credentials key when any destination is connected and that key is missing, delivery and failure state, transient-only retry, and stopping on disconnect. Expired or revoked authorization marks that destination as needing attention, offers reconnect and stops sending to it while retaining the destination, its event selection and its delivery history. Every Slack destination, however it is authorized, also meets `NOTIF-007`'s Slack channel and audience rules. Every Teams and Nook destination meets the same rule in its provider's terms: a channel whose full roster Slate can read and only admitted members change (Teams private team or private channel, Nook private channel), not shared with another organization (`NOOK-031`), with no guest, external account or bot but Slate's, and every person an active Slate member by verified email who can read the linked record immediately before sending; Slate refuses it at connect, rechecks before every send and sends nothing while it fails. Slack connects as an OAuth app a workspace admin installs; Teams as an app package an Entra admin consents to with resource-specific channel permissions; Nook through `NOOK-080`. Slate honours each provider's rate limit and `Retry-After` without loss, and coalesces more than five events per destination per minute into one message. Later events on the same page within 24 hours reply in its first message's thread. Each destination chooses immediate or daily digest. When a page is deleted, moves beyond the channel's audience or its actor is erased (`WORK-007`), Slate edits every message it sent about it to "Restricted Slate page". Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a Workers journey with provider fakes at the network edge connects one channel per provider, fires each event kind and finds exactly one link-only message per destination.
2. Disconnecting one destination stops only that destination.
3. The fixture journey also proves the inherited `NOTIF-003` guarantees for every destination: its links still require access; it shows its own last delivery and last failure; only transient transport failures are retried; its credential is encrypted, absent from every API response and destroyed on disconnect; a deployment with a destination connected and connector credentials key missing refuses at startup naming it; an expired or revoked authorization marks only that destination as needing attention and stops it while keeping it, its event selection and its delivery history for reconnect; and every Slack destination is shown to meet `NOTIF-007`'s Slack channel and audience rules, including their refusal and no-send cases.
4. The fixture journey refuses a Teams and a Nook channel holding a guest, external share or other bot; coalesces 20 events; threads an update; survives a 429; sends a digest; and rewrites sent messages after deletion, narrowing and erasure.
5. Requested Nook replies refuse, uncertain sends stay held, and unresolved withdrawals remain recorded.
6. A held send shows as "Needs attention" to owners with a resolve action and is never silently dropped or re-sent (no double post). Until Nook offers client-key lookup, the owner acknowledges without resending; acknowledgment preserves uncertainty and unresolved withdrawal records. Retry is permitted only once Nook offers client-key lookup.

**Evidence.** `tests/e2e/notifications/destinations.test.ts` — "CHAT-001 — Owners connect several chat destinations, each with its own event selection, and every destination sends one link-only message, fails and disconnects on its own"; same file — "CHAT-001 — Nook channel changes are refused before custody changes while rotation and independent destinations work" (Verify Slate: workers; NOOK-080/089 thread, same-key receipt and replacement-approval HTTP assertions in `tests/e2e/notifications/nook-http-journey.ts`); `tests/qualification/ui-convergence/chat-journey.mjs` — "chatJourney" (1440/390); `tests/e2e/notifications/chat.test.ts` — "NOTIF-007 — chat admission requires fresh authority and keeps link-only delivery inside the current audience" (inherited admission and audience assertions)
**Gap.** The NOOK-080 HTTP door with NOOK-089 exists on Nook main 7dd6d142; Slate maps its documented thread field and client-key receipt lookup through the deployment's NOOK_NOTIFICATION_ORIGIN. Recorded network-edge fixtures prove replies in the page's first-message thread within 24 hours, same-key acceptance receipts without another post, and replacement-approval edits of earlier posts after deletion, audience narrowing and actor erasure under the current exact approved (app name, channel) authority. Missing, tombstoned, malformed or unavailable lookup never authorizes a resend; unresolved withdrawals remain recorded. Live Nook acceptance against a real deployment remains open: fixture-only, synthetic-slate-<n>. Slack workspace-admin OAuth installation and Teams Entra-admin app-package consent with resource-specific permissions remain open; the shipped Teams path uses a delegated token, and refuses destinations unless Graph can enumerate the complete private roster, tenant, user and installed-bot facts. Graph directory mail does not independently prove mailbox verification. Withdrawal cannot edit remote messages after disconnect, revoked authorization or connection-owner erasure destroys the credential; those receipts retain unresolved withdrawal state. Live Slack acceptance needs a private unshared channel; live Teams acceptance needs a licensed Teams user. No live-provider acceptance is claimed. Chest as a destination remains open.

#### CHAT-002 — Ask and unfurl in chat

Core · target · **missing** · Rules D-1

**Requirement.** In Slack, Teams and Nook: - a Slate page link unfurls with its title, status and verification, owner and last update, but only when the unfurling user's linked Slate identity can read the page; otherwise it shows "Restricted Slate page"; - the documented public door or a mention asks a question and gets a cited answer (`ANSWER-001`) computed for the asker alone, posted only to the asker when the channel's audience is broader than the sources' readers. A member links their chat identity to Slate once, from Slate or from the app's first prompt in chat. The same link delivers their personal notifications (`CHAT-004`). Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a Workers journey with chat provider fakes unfurls a readable and a restricted link for two linked users.
2. An in-channel question citing a restricted page is answered privately to the asker, and an unlinked user is asked to link their account first.
3. Provider acceptance repeats this in a real Slack workspace.

**Evidence.** `src/core/features/connectors/slack.ts`
**Gap.** not implemented

#### CHAT-003 — Capture chat into pages

Core · target · **missing** · Rules D-1

**Requirement.** A message shortcut in Slack, Teams or Nook creates a Slate page or card, or appends to an existing one, from a message or thread. It quotes the messages with their authors and a link back to the thread, and opens as a draft for the member to edit. When the same question recurs in a channel, Slate suggests to the member who answered that their answer become a card.

**Acceptance.**
1. a Workers journey with chat provider fakes captures a five-message thread into a new page with attributed quotes and a source link, and appends a second thread to the same page.

**Evidence.** —
**Gap.** not implemented

#### CHAT-004 — Personal notifications as chat direct messages

Core · target · **missing** · Rules D-1 · Register R-14

**Requirement.** A member who has linked their Slack, Microsoft Teams or Nook identity (`CHAT-002`) can choose "chat direct message" as the delivery for any event kind (`NOTIF-005`). A workspace owner can make it the default for any event kind (`NOTIF-006`). The Slate app then sends that member one direct message per event, for each of these kinds: - mentions, including group mentions (`BLOCK-020`); - replies, and comments on watched or authored pages; - task assignments and due tasks (`BLOCK-015`); - reminders (`NOTIF-004`), at the member's local time and once each; - shares, shares with a message (`SHARE-009`) and access grants; - review requests (`STAT-006`) and lapsed verifications; - watched page and container changes (`CONT-012`); - required reading (`CARD-003`). A daily or weekly digest can also arrive as one direct message. - **Content.** Each message carries the event kind, the actor, the page title and a link, never a page body or comment text, with "Open" and "Mark as read" actions. Marking a message read in chat clears its inbox item. - **Access.** Recipient access is rechecked at send. An event on a page the member cannot read at send produces nothing. - **Control.** The member manages these choices in Slate or from chat (the documented public door in Slack and Teams, and Nook's equivalent command). Unlinking stops direct messages from the next event. - **Fallback, never silence.** An event set to chat goes to the member's chosen fallback, immediate email unless they chose otherwise, when any of these holds: the member has no linked identity, the link is broken, or the workspace's chat app is disconnected. Slate also shows them a "Connect chat" prompt. - **Delivery.** Messages use the workspace app's encrypted credentials and `NOTIF-003`'s delivery and failure state with transient-only retry. Each member and event has an operation key, so a retry never sends twice. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a Workers journey with a chat provider fake at the network edge: - links a member's Slack identity and sets mentions and task assignments to chat; - finds that one mention and one assignment each produce exactly one direct message, carrying the actor, the page title and a link and no body; - finds that reassigning the task sends the new assignee one direct message and the previous assignee none; - finds that an event on a page the member lost access to before send produces nothing; - finds that a reminder set to chat arrives as exactly one direct message at the member's local time, and none when the member lost access to its page before it was due; - finds that "Mark as read" in the message clears the inbox item; - finds that unlinking stops direct messages from the next event; - has an owner set chat as the workspace default for mentions (`NOTIF-006`), and finds that a member who chose nothing receives a direct message; - finds that a member with no linked identity receives the mention by immediate email instead, never nothing, and sees the "Connect chat" prompt; - finds that a forced transient failure and retry deliver once.
2. The same journey runs against Teams and Nook provider fakes.
3. Provider acceptance repeats it in a real Slack workspace and a real Microsoft Teams tenant.

**Evidence.** —
**Gap.** not implemented

#### CONNECT-001 — Named connectors

Core · target · **partial**

**Requirement.** Slate connects to Google Drive, SharePoint/OneDrive, Confluence Cloud, Notion, Slack, Microsoft Teams, [Nook](https://github.com/just-every/run-nook), Jira, [Vector](https://github.com/just-every/run-vector), GitHub, GitLab, Salesforce, Zendesk, [HappyToHelp](https://github.com/just-every/run-happytohelp) and [Chest](https://github.com/just-every/run-chest), and to a member's own Gmail or Outlook mailbox when that member opts in. Each connector meets `SOURCE-001`: it declares its scopes, identity mapping, discovery coverage, an incremental sync target of 15 minutes, deletion and revocation propagation within 1 hour, and retention. Each is turned on per workspace by an owner.

**Acceptance.**
1. each connector has a Workers journey against a recorded provider fixture covering first sync, an incremental change, a deletion and a revoked user, and provider acceptance against a real authorized account for at least Drive, SharePoint, Slack, Teams, Jira and GitHub.

**Evidence.** `src/core/features/connectors/slack.ts`
**Gap.** Missing a complete public-door journey for named connectors; the cited material shows only part of the capability.

#### CONNECT-002 — Source permissions are mirrored

Core · target · **partial**

**Requirement.** Every connected item carries its source ACL, refreshed with the item. A member sees a connected item in search, answers, embeds or agent work only when their mapped source identity can read it now. An unmapped or ambiguous identity sees nothing from that source, a source ACL that fails to refresh fails closed, and a revocation in the source removes the item from that member's results within the connector's propagation target.

**Acceptance.**
1. a Workers journey with provider fakes runs a matrix of three members against items shared to a user, a group, a domain and nobody, revokes one share in the source, and asserts results before and after propagation, including that answers stop citing the revoked item.

**Evidence.** `src/core/features/connectors/authority.ts`
**Gap.** Missing a complete public-door journey for source permissions are mirrored; the cited material shows only part of the capability.

#### CONNECT-003 — Connector health

Core · target · **partial**

**Requirement.** Owners see per connector: last sync, lag, items indexed and excluded with reasons, errors, identity-mapping coverage, and the next scheduled run. An owner can pause a connector, re-sync it, or disconnect and purge it, which removes its indexed content and derived answers within 1 hour (`SOURCE-005`, `SOURCE-006`).

**Acceptance.**
1. a browser journey shows a lagging connector's health, pauses and resumes it, and purges it, after which a search finds none of its items and an answer that cited them is marked invalidated.

**Evidence.** `src/core/features/connectors/service.ts`
**Gap.** Missing a complete public-door journey for connector health; the cited material shows only part of the capability.

### Answers

#### ANSWER-001 — Cited answers in the default product

Core · target · **partial** · Rules D-1

**Requirement.** Once an owner configures a provider and turns AI on (`AI-001`), every member gets Ask: a box above search results and a side panel on any page. It answers from pages, records, comments and connected items the asker can read, with inline citations that open the exact revision (`AI-004`, `REV-005`). It keeps the conversation: a follow-up question is answered in the context of the earlier turns, each answer offers up to three suggested follow-ups, and the member's past conversations are listed privately to them, can be reopened and continued, and can be deleted. Every turn recomputes access, so a follow-up never cites a page the asker has since lost. This needs no `SLATE_PROFILE=flagship` opt-in, and every `AI-*` guarantee applies. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. in the default profile with AI on and a provider fake at the network edge, a browser journey asks a question in search and in a page panel and gets an answer whose every citation opens its exact revision.
2. A follow-up that refers to the first answer only by pronoun ("who owns it?") is answered about the same page.
3. Clicking a suggested follow-up asks it.
4. The conversation reopens from the member's history after a reload, another member cannot list or open it, and deleting it removes it.
5. After the asker loses access to a cited page, the next follow-up does not cite it.
6. With AI off, Ask is absent and search is unchanged (`SEARCH-008`).

**Evidence.** `src/core/features/ai/integration.ts`
**Gap.** No validated CI-run proof for this acceptance point: "in the default profile with AI on and a provider fake at the network edge, a browser journey asks a question in search and in a page panel and gets an answer whose every citation opens its exact revision."<br>No validated CI-run proof for this acceptance point: "A follow-up that refers to the first answer only by pronoun ("who owns it?") is answered about the same page."<br>No validated CI-run proof for this acceptance point: "Clicking a suggested follow-up asks it."<br>No validated CI-run proof for this acceptance point: "The conversation reopens from the member's history after a reload, another member cannot list or open it, and deleting it removes it."<br>No validated CI-run proof for this acceptance point: "After the asker loses access to a cited page, the next follow-up does not cite it."<br>No validated CI-run proof for this acceptance point: "With AI off, Ask is absent and search is unchanged (`SEARCH-008`)."

#### ANSWER-002 — Answers state their trust

Core · target · **partial** · Rules D-1

**Requirement.** Each answer shows, for every cited source, its verification state, owner and last update. It flags disagreement between sources, separates what the sources state from what the model inferred, and gives its uncertainty in words. When the only evidence is lapsed or conflicting, it says so and names the owner to ask, with a one-click review request (`STAT-006`). It prefers current verified sources, using `SEARCH-011`'s verification states and ordering; answer trust is proven by this clause's acceptance, not by `SEARCH-011`'s.

**Acceptance.**
1. a Workers journey with a provider fake asks over a corpus with a verified, a lapsed and a conflicting page, and asserts that the response's structured fields mark each citation's state, the conflict and the named owner, that among equally relevant sources the current verified page is cited ahead of the lapsed one (`SEARCH-011`), and that the review request is created once.

**Evidence.** `tests/flagship/intelligence/authority.test.ts`
**Gap.** Missing a complete public-door journey for answers state their trust; the cited material shows only part of the capability.

#### ANSWER-003 — Answers never leak restricted knowledge

Core · target · **partial** · Rules D-1

**Requirement.** No answer, citation, follow-up suggestion, "no answer" wording, latency pattern, cache entry, embedding neighbor or count reveals a page, record, comment or connected item the asker cannot read. Caches and embeddings are keyed to the access state they were computed under and invalidated when it changes (`AI-013`).

**Acceptance.**
1. an adversarial Workers suite asks 50 probing questions as a member without access to a seeded secret page, including paraphrases, title guesses, "does a page exist" questions and prompt injection inside readable pages.
2. It asserts no secret token, title or count appears and that "no answer" responses are identical with and without the secret page present.
3. The suite then revokes a grant and repeats.

**Evidence.** `tests/qualification/authority/skill-disclosure.test.ts`
**Gap.** Missing a complete public-door journey for answers never leak restricted knowledge; the cited material shows only part of the capability.

#### ANSWER-004 — Feedback and unanswered questions

Core · target · **missing** · Rules D-1

**Requirement.** Members rate answers as helpful or not helpful and can report a wrong answer with a note. Unanswered and low-rated questions are logged with their timestamps but without the asker's identity, unless the asker chooses to follow up. They are clustered weekly into a report for container owners showing frequency, the sources tried and suggested experts. This report feeds `KEEP-003`.

**Acceptance.**
1. a Workers journey records 30 questions with ratings, runs clustering, and asserts the report's clusters, counts and anonymity, and that a "wrong answer" report notifies the cited page's owner once.

**Evidence.** —
**Gap.** not implemented

#### ANSWER-005 — Summaries and catch-up

Core · target · **partial** · Rules D-1

**Requirement.** A member can summarize a page, a comment thread, the changes to a page since their last visit, or a container's week. Each summary cites exact revisions and can be posted to chat (`CHAT-001`) or inserted under `AI-016`.

**Acceptance.**
1. a Workers journey with a provider fake summarizes "changes since last visit" for a member and finds that the summary cites exactly the revisions after that member's last view.

**Evidence.** `src/core/features/ai/routes.ts`
**Gap.** Missing a complete public-door journey for summaries and catch-up; the cited material shows only part of the capability.

#### ANSWER-006 — Owner-chosen models and data controls

Core · target · **partial** · Rules D-1

**Requirement.** The owner picks the provider (Anthropic, OpenAI, Azure OpenAI, Amazon Bedrock, Google Vertex AI or a local model), sets a monthly budget in USD (`AI-012`), and can exclude containers or labels from AI entirely. Excluded content is never sent to a provider or embedded. Settings show what each provider retains under the owner's agreement with it.

**Acceptance.**
1. a Workers journey configures two providers with fakes at the network edge, excludes a container and asserts that no request body ever contains its content, and stops at the USD budget with a visible reason.

**Evidence.** `src/core/features/ai/integration.ts`
**Gap.** Missing a complete public-door journey for owner-chosen models and data controls; the cited material shows only part of the capability.

### Platform

#### API-001 — Public REST API

Core · target · **partial**

**Requirement.** A versioned public REST API covers pages, blocks, databases, records, comments, search, members, groups and files, described by a published OpenAPI document. It uses cursor pagination, operation keys (`SAVE-005`), declared rate limits and a stable error shape. Authentication is a personal access token or an OAuth 2.0 app with scopes (read or write, per container). Every call acts as exactly one member and passes the same checks as the UI (`SHARE-002`, `LIFE-002`, `SEARCH-005`). Tasks (`BLOCK-015`) are read and changed through it, with their assignee, due date and completion, under the same checks and notifications as the UI: assigning a member who cannot read the page is refused until it is shared, and completion records who and when. Personal-token custody follows RL-101: full members and owners only, no guest tokens, explicit container scopes bounded by current UI rights, once-issued secrets stored as hashes, a disclosed 90-day default and one-year maximum, immediate revocation, no hashes in archives and permanently inactive restored credentials. Undeclared privileged operations remain denied. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a contract suite generated from the OpenAPI document runs every operation over HTTP with a token for each of two members, asserting the schemas and that every access difference matches the UI's.
2. Expired, revoked and under-scoped tokens are refused.
3. The suite assigns, dates, reassigns and completes a task and finds the same refusals, notifications and completion record as the UI.
4. Issue a once-visible full-member token with finite container scopes; after revocation, expiry or restore it executes no request, and guest issuance is refused (RL-101).

**Evidence.** `tests/e2e/public-api/contract.test.ts` — personal API tokens run the published HTTP contract with member parity, task effects and immediate authority loss
**Gap.** OAuth applications and the missing database, record, comment, search, member, group, file and URL-resolution APIs remain unimplemented; RL-101 settles personal-token custody without narrowing complete API coverage.

#### API-002 — Webhooks

Core · target · **partial**

**Requirement.** Owners and OAuth apps subscribe to page, record, comment, status, verification and member events by container. Deliveries are HMAC-signed with a timestamp, retried with backoff for 24 hours, logged with their responses, replayable, and disabled with a notice after repeated failure. Payloads carry IDs and titles only when the subscription's acting member can read the record. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a Workers journey subscribes a test endpoint, produces events, verifies the signatures, forces failures and sees the backoff and the disable notice, replays one delivery, and confirms that a record the subscriber cannot read produces no payload.

**Evidence.** `tests/e2e/webhooks/deliveries.test.ts` — owner webhook subscriptions sign current readable events, persist backoff, replay and disable once without following refused destinations; `tests/qualification/ui-convergence/webhook-access-journey.mjs` — webhookAccessJourney (1440)
**Gap.** OAuth application subscribers and address-pinned resolved-address egress. Default ADOPTED: owner-entered public HTTPS 443, no redirects, ten-second exchanges; real receiver acceptance pending.

#### API-003 — MCP server

Core · target · **partial** · Cites BASE-AGENT-001, BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-004, BASE-AGENT-005, BASE-AGENT-007 · Register R-11

**Requirement.** Slate offers search, cited page fetch, database listing and queries, answers, comments, page creation and updates, and task changes through its MCP door. Supported clients include Claude, ChatGPT and Cursor.

**Acceptance.**
1. Two members search, fetch, query, ask and comment through MCP and observe the same wiki outcomes as in the browser.
2. Under the held company policy for standard edits, a page change is a revision-pinned suggestion and changes nothing before the person named by policy accepts it.
3. Under the all-autonomous company policy, an authorized page update and task assignment, reassignment and completion execute with the same notifications and completion record as the browser.

**Evidence.** `src/core/features/external-agent/routes.ts`
**Gap.** No validated CI-run proof for this acceptance point: "an MCP client conformance run lists the tools, calls each one as two members and asserts access parity with the UI, confirms that a write without a grant becomes a suggestion, and confirms that revoking the client ends its session at once."<br>No validated CI-run proof for this acceptance point: "With a direct-write grant, it assigns, reassigns and completes a task and finds the same notifications and completion record as the UI."

#### API-004 — App and token administration

Core · target · **partial**

**Requirement.** Owners see every personal access token, OAuth app, MCP client and webhook, with its member, scopes, creation time and last use, and can revoke any of them. Members see and revoke their own. Tokens expire after a default of 90 days. Revocation takes effect on the next request, and every grant and revocation is recorded in activity. Under RL-102 this complete owner/member administration target includes OAuth applications and MCP clients; API-001 governs personal-token execution custody. Secrets appear once, native browser administration uses fresh session proof and agent administration carries access and security under company policy, and activity retains grant and revocation history. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a browser journey creates a token and an OAuth app, sees both with last use after an API call, revokes each and gets 401 on the next request, and finds the activity entries.
2. An owner sees all credential types while a member sees only their own; creating and revoking uses fresh session proof and leaves activity (RL-102).

**Evidence.** `tests/e2e/public-api/contract.test.ts`; `tests/qualification/ui-convergence/developer-access-journey.mjs` — developerAccessJourney, existing readership journey at 1440
**Gap.** OAuth application and MCP-client administration remain unimplemented; RL-102 keeps the complete administration target partial and authorizes no carve.

#### API-005 — Zapier, Make and Crank apps

Core · target · **missing**

**Requirement.** Slate publishes an app in the Zapier app directory and one in Make's app directory, and ships a [Crank](https://github.com/just-every/run-crank) connector. Each one connects to the buyer's own deployment by URL through `API-001`'s OAuth app flow and acts as the connecting member. - **Triggers** use `API-002` webhooks (REST hooks), never polling where a webhook exists. They cover a page published or updated, a comment added, a record created or updated, a verification lapsed, a review requested and a form submitted (`DB-013`). - **Actions** create a page from a template, append to a page, create or update a record, add a comment, request review and search. - **Access.** A trigger never fires for a record the connecting member cannot read, and an action passes the same checks as the UI. - **Revocation.** Revoking the app under `API-004` stops its triggers and actions on the next request. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. The Zapier Platform CLI's validation and the app's integration tests run against a test deployment.
2. Each trigger fires once from a real event through a REST hook, and each action creates its record as the connecting member. - A page the member cannot read fires no trigger. - Revoking the app returns 401 on the next action. - Make's app validation and the Crank connector's tests run the same journey. - The published listings are recorded with the release evidence.

**Evidence.** —
**Gap.** not implemented

#### ADMIN-001 — SAML single sign-on

Core · target · **partial** · Cites BASE-SIGNIN-001 · Register R-12

**Requirement.** Slate is a SAML 2.0 service provider for Okta, Microsoft Entra ID, Google Workspace, JumpCloud and [Auth](https://github.com/just-every/run-auth). It supports both SP- and IdP-initiated sign-in, signed assertions, an email domain verified by a DNS TXT record the owner publishes (rechecked daily; a failed check stops new just-in-time creation and notifies owners) and just-in-time creation of invited or allow-listed members. When an owner enforces SSO, members sign in only through the provider, guests keep magic links, and one designated owner keeps a magic-link break-glass path. Slate's OIDC identity-provider function (WORK-015) stays available to members who have signed in through the enforced method. Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a browser journey against a SAML test IdP verifies a domain through a TXT record served by a DNS fake at the network edge, refuses just-in-time creation for an unverified domain, signs in through SP and IdP flows, rejects an unsigned assertion and one with the wrong audience, enforces SSO for a member while a guest uses a magic link, and confirms break-glass access for the designated owner.
2. Owners configure one pinned SAML issuer and certificate, verify one email domain through its TXT challenge, and explicitly enable enforcement.
3. Assertions require a verified XML signature over the exact assertion, current issuer/audience/recipient/time checks and a durable replay fence; SP flows also require the issued browser-bound request.
4. New members require a current verified domain and an unused invitation or an exact allow-listed email.
5. Failed daily domain verification stops new JIT admission and notifies owners in-app.
6. While enforcement is on, full members sign in only through the configured SAML provider (every other member sign-in route, OIDC-based included, is off); guests keep magic links; exactly the designated active owner keeps the mailbox break-glass; previously issued native proofs and sessions do not bypass enforcement; an unauthenticated person can never obtain OIDC-provider tokens by a route that skips enforcement.
7. SP AuthnRequests are unsigned; assertions must be signed. Provider trust, pending requests and sessions do not cross backup and restore.

**Evidence.** `tests/flagship/core/identity-upgrade.test.ts` — "ADMIN-001 — signed SP and IdP SAML, DNS-gated invited or allow-listed JIT, enforced member SSO and one owner mailbox escape" (Verify Slate: workers); `tests/qualification/ui-convergence/saml-journey.mjs` — "samlJourney", loaded by "SAML sign-in verifies the domain and signatures while preserving guest and designated-owner access" (Verify Slate: ui-content-desktop shards, 1440)
**Gap.** Pre-enforcement Managed preview owner sessions lack provenance distinguishing them from mailbox sessions; that prior-session case is not proven. WORK-015 currently implements sign-in through an external OIDC provider; Slate exposes no OIDC identity-provider token-issuance door, so the identity-provider-function sentence remains unproven.

#### ADMIN-002 — SCIM provisioning

Core · target · **partial** · Cites BASE-SIGNIN-001 · Register R-12

**Requirement.** A SCIM 2.0 endpoint provisions users and groups from Okta, Entra ID, JumpCloud and Auth. Create invites the member. Update changes the name, email and groups (`WORK-009`). Deactivate runs `WORK-007` removal within 60 seconds, revoking sessions, tokens and devices. The bearer token is owner-generated, rotatable and stored hashed.

**Acceptance.**
1. a SCIM compliance run (Okta's SCIM test suite shape) creates, updates, pushes groups to and deactivates users, and asserts the resulting members, groups, revoked sessions and activity entries.

**Evidence.** `tests/e2e/scim/contract.test.ts` — SCIM RFC7643/7644 HTTP sequence uses native invitations, Members, groups and revocation authority; populated upgrade, revoked restore and erasure; `tests/qualification/ui-convergence/scim-access-journey.mjs` (1440)
**Gap.** Default ADOPTED: Member role and name/email/groups only, Owner/guest/break-glass protection, hashed owner credentials; scoped admission cap applies to SCIM, while native invitation admission has no shared capacity guard.

#### ADMIN-003 — Guest management

Core · target · **done**

**Requirement.** Owners list every guest with what they can access, who invited them, when they were last active, and their expiry. They can set a default guest expiry, keep allow and deny lists of email domains, and revoke guests in bulk. A guest's access never outlives their expiry (`SHARE-008`).

**Acceptance.**
1. a browser journey lists three guests with their access, bulk-revokes two (their open sessions end under `SHARE-007`), and rejects an invite to a denied domain.

**Evidence.** `tests/qualification/ui-convergence/guest-console-journey.mjs` — "guestConsoleJourney"
**Gap.** None.

#### ADMIN-004 — Workspace analytics

Core · target · **done**

**Requirement.** Owners and container owners get reports on views and unique viewers (`PAGE-013`), stale pages (unedited and unverified for a chosen period), pages without an owner, lapsed verifications by owner, most-viewed unverified pages, searches with no results, and container growth. Reports export as CSV. They never show an individual's reading history beyond what `PAGE-013` already shows on a page.

**Acceptance.**
1. a Workers journey over a seeded workspace asserts each report's rows, the CSV export, and that a container owner sees only their own container's figures.

**Evidence.** `tests/e2e/pages/analytics.test.ts` — "ADMIN-004 — owner reports export every report as CSV and container owners see only their readable container figures"
**Gap.** None.

#### ADMIN-005 — Audit export and SIEM streaming

Core · target · **partial**

**Requirement.** Owners filter the workspace audit trail (`ACT-*`, including sign-ins, permission and sharing changes, exports, token use and admin settings) and export it as CSV or JSON. They can stream it to Splunk, Datadog or Microsoft Sentinel through a signed webhook (`API-002`), with a retention setting no shorter than one year.

**Acceptance.**
1. a Workers journey produces each audited action kind, exports it and finds every action with its actor, time and target, and streams it to a test receiver with valid signatures and no gaps after a receiver outage.

**Evidence.** `tests/qualification/core/audit-content.test.ts` — auditExportProof: audited action families, filtered CSV/JSON, neutralized formulas, retention floor, signed ordered outage recovery; `tests/qualification/ui-convergence/audit-access-journey.mjs` (1440)
**Gap.** Signed generic webhooks inherit API-002’s unresolved address pinning and adopted destination rule; real vendor receivers and vendor-specific formats are not claimed.

#### ADMIN-006 — Content governance

Core · target · **partial**

**Requirement.** Owners decide who may create containers, publish publicly, invite guests, export and use AI. A container may carry a classification label, such as Confidential, that by default forbids public links and AI for its pages, and only a workspace owner can lift those defaults. Every governance change is recorded in activity.

**Acceptance.**
1. a browser journey restricts public publishing to owners, labels a container Confidential, and confirms that a member's publish attempt, an AI request over a confidential page and an export by a non-permitted member are each refused with a reason.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** No validated CI-run proof for this acceptance point: "a browser journey restricts public publishing to owners, labels a container Confidential, and confirms that a member's publish attempt, an AI request over a confidential page and an export by a non-permitted member are each refused with a reason."

#### ADMIN-007 — Every target surface ships in the default product

Core · target · **partial**

**Requirement.** Every surface that a target or push-further clause describes is part of the default product, and an owner turns it on in workspace settings with nothing else needed. Ask, AI writing and AI fields turn on once a provider is configured and AI is on (`AI-001`, `ANSWER-006`). Suggestions and agent maintenance (`SUG-*`, `KEEP-*`) turn on with AI. Each connector turns on once it is connected (`CONNECT-001`), and chat ask and unfurl once the chat app is installed (`CHAT-002`). MCP and OAuth clients work once a member grants them (`API-003`, `API-004`), and live co-editing is on from the start (`COLLAB-001`). No target surface requires `SLATE_PROFILE=flagship`. Settings show each switch's state and who changed it when, and every change is recorded in activity. Turning a switch off refuses its surface with feature disabled from the next request and stops its scheduled jobs, and it erases nothing. A surface also stays refused until its clause's own safety acceptance has passed: `ANSWER-003` for answers, `CONNECT-002` for connected items and `COLLAB-001`'s revocation test for co-editing. `SLATE_PROFILE=flagship` remains only for the inquiry, experiment, trial and production-effect extension (`INQ-*`, `TRIAL-*`, `EFFECT-002`). Protocol and representation details are in [wiki doors](docs/wiki-doors.md).

**Acceptance.**
1. a Workers journey in the default profile, with slate profile unset, first finds every target surface (Ask, AI writing, AI fields, suggestions, MCP, each connector, chat ask and agent jobs) refusing with feature disabled.
2. It turns each owner switch on and finds its surface serving, then turns it off and finds it refusing again on the next request with its stored records intact.
3. A release check fails any target-clause journey that sets `SLATE_PROFILE=flagship`.

**Evidence.** `src/core/platform/config/launch-profile.ts`
**Gap.** Missing a complete public-door journey for every target surface ships in the default product; the cited material shows only part of the capability.

#### MOBILE-001 — Native iOS and Android apps

Core · target · **missing** · Cites BASE-ACCESSIBILITY-001 · Register R-7

**Requirement.** App Store and Google Play apps let a member sign in (magic link, OIDC or SAML), read, search, ask, edit pages and blocks, comment, use the inbox, verify, and take photos straight into pages. They support share-sheet capture into Slate, deep links that open slate URLs in the app, and an optional biometric lock. They use the same API as the web (`API-001`) and the same access rules.

**Acceptance.**
1. automated device-farm journeys on current iOS and Android sign in, edit and comment on a page, verify it, take a photo into a page through the device camera, lock and unlock the app with the platform biometric prompt, receive a mention push, and open a deep link.

**Evidence.** `tests/qualification/interface/routed.browser.mjs`
**Gap.** not implemented

#### MOBILE-002 — Desktop app

Core · target · **missing** · Cites BASE-ACCESSIBILITY-001 · Register R-8

**Requirement.** A macOS and Windows desktop app opens Slate links natively, keeps several windows open on different pages and restores them on relaunch, supports offline pages (`MOBILE-003`) and system notifications, and updates itself through signed releases.

**Acceptance.**
1. automated journeys on macOS and Windows open a deep link, open a second window on another page and edit in both, quit and relaunch to find both windows restored on their pages, edit offline and sync, and receive a system notification.
2. Native fixture builds produce the signed installers; an installed client verifies a signed update and rejects an invalid signature.

**Evidence.** —
**Gap.** not implemented

#### MOBILE-003 — Offline pages

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001

**Requirement.** A member marks pages or containers as available offline on a device. Those pages, with their media and comments, stay readable and editable without a connection and merge on reconnect (`COLLAB-003`). A revoked grant, a removed member or a remote sign-out erases the offline copies at the next connection, and an owner can require that sessions on lost devices be signed out remotely.

**Acceptance.**
1. a device journey marks a container offline, edits in airplane mode and merges on reconnect, then has its access revoked and finds the offline copy erased on the next connection.

**Evidence.** `src/core/features/editor/ui/SaveStatus.tsx`
**Gap.** No validated CI-run proof for this acceptance point: "a device journey marks a container offline, edits in airplane mode and merges on reconnect, then has its access revoked and finds the offline copy erased on the next connection."

#### MOBILE-004 — Push notifications

Core · target · **missing** · Cites BASE-ACCESSIBILITY-001

**Requirement.** Mentions, replies, review requests, task assignments and due tasks (`BLOCK-015`), reminders and lapsed verifications can be pushed to a member's devices through APNs and FCM according to `NOTIF-005` preferences. A push payload carries the event and the page title only, and access is rechecked at send. A reminder push keeps `NOTIF-004`'s rules: it arrives at the member's local time and exactly once per reminder, even when a send is retried.

**Acceptance.**
1. a Workers journey with APNs and FCM fakes at the network edge sends exactly one push per eligible event, none for a page whose access was revoked before send, and payloads with no body text.
2. Reminders set in two time zones push once each at their members' local times, and a retried send does not push a reminder twice.
3. A task assignment pushes once to its assignee, a reassignment pushes only to the new assignee, and an assignee completing their own task pushes nothing.

**Evidence.** —
**Gap.** not implemented

### Agents that maintain knowledge

#### KEEP-001 — Contradiction watch

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** The knowledge agent watches authoritative change and checks which pages it contradicts. Authoritative change means merged pull requests and releases (GitHub, GitLab), resolved issues (Vector, Jira), revised policy and decision pages (`DEC-*`), changed connected documents, and newly verified pages. The agent maps each change to the specific statements in dependent pages, cards and recent answers. Where a statement is now contradicted, it places a "possibly outdated" flag on the exact block revision, citing the change, the evidence and its confidence. Its data is page revisions the agent's declared audience may read, connector events (`CONNECT-*`) and decisions. Flags are read-only. They notify the page owner once, in a coalesced notice, and appear to editors and in answers (`ANSWER-002`). An owner dismisses a flag with a reason, which suppresses identical future flags. Flagging is the job of this clause; repairs use KEEP-002 and its standard or external class under company policy.

**Acceptance.**
1. a Workers journey with a provider fake merges a fixture pull request that renames a configuration flag.
2. Exactly the two dependent blocks are flagged, with citations to the pull request, and the unrelated page that mentions the old name only historically is not flagged.
3. Dismissing a flag suppresses its re-flag.
4. Precision and recall on a held-out set of 100 labeled change and page pairs are recorded under `FLAG-003`.

**Evidence.** `src/core/features/impact/routes.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-002 — Revision-specific fix proposals

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** For each flag, the knowledge agent drafts a suggestion (`SUG-001`) against the exact block revision. The suggestion carries a diff, the sources, the readers who will see the change, and the answers and runbooks it affects, and is routed to the page owner. Its data is the flagged page revision, the cited change and the pages that depend on it. The company policy decides standard internal edits and external edits where outsiders gain visibility. Under the held company policy for standard or external changes, the owner accepts the suggestion (`SUG-002`); under the all-autonomous policy a bounded rename commits as a revision that `REV-003` can roll back in one action. Verification never carries over: an edited verified page shows that its verified revision is not current (`STAT-003`).

**Acceptance.**
1. under the held company policy for standard or external changes, a browser journey in which the owner receives a fix suggestion, inspects the diff and sources, and accepts it, producing one revision.
2. A second case applies a granted rename across three pages and rolls one back.
3. A suggestion whose anchor changed in the meantime requires a rebase and never applies silently.

**Evidence.** `src/core/features/suggestions/routes.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-003 — Close knowledge gaps as work

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** The knowledge agent takes clusters of unanswered questions and low-rated answers (`ANSWER-004`) and repeated questions in chat (`CHAT-003`), finds the best expert (page owners, frequent editors, verifiers and `WORK-016` expertise), and sends that expert a short evidence request with the question, what was found and what is missing. From the expert's reply it drafts a card or page, records commitment-class verification as company policy decides, and re-asks the original questions to confirm they now retrieve it; under the held policy the expert verifies the draft. Its data is questions without asker identity, expertise signals and the expert's reply. The expert decides whether the draft is correct and sets its verification expiry. An agent verification carries commitment and names the agent under company policy; it never records the expert’s attestation. The draft is visible only to its eventual audience.

**Acceptance.**
1. a Workers journey with a provider fake clusters seeded unanswered questions and sends one evidence request to the right expert.
2. Under the held company policy for commitment, the expert's reply produces a draft, the expert verifies it, and re-asking the cluster's questions returns the new card as a top citation.
3. The gap report then shows the cluster closed.

**Evidence.** —
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-004 — Duplicates and conflicts

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** The knowledge agent finds near-duplicate pages, by `SEARCH-011`'s definition and its `seed.json → limits.nearDuplicateSimilarity` threshold, and statements that conflict across pages, and proposes a merge (one canonical page, with the others redirecting through `LINK-003` tombstone links) or a reconciliation for the owners to choose. Its data is page revisions within one audience; it never compares across an access boundary for a reader who lacks either side. A merge is reversible through restore, carries standard or external according to visibility, and is decided by company policy; under the held company policy for standard or external merges, both page owners accept the exact merge.

**Acceptance.**
1. a Workers journey over a seeded corpus with a pair of pages at a measured similarity of 0.9, a pair at 0.7 and one conflict proposes exactly one merge and one reconciliation, and nothing for the pair at 0.7.
2. Accepting the merge leaves the old URL resolving to the canonical page, and search collapses the pair (`SEARCH-011`).

**Evidence.** `src/core/features/claims/service.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-005 — Answers with current evidence and stated uncertainty

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007 · Rules D-1

**Requirement.** Before answering, the knowledge agent checks each candidate source's verification, lapse, open flags (`KEEP-001`) and the freshness of connected sources. It answers with what is verified, what is inferred and what is uncertain, gives the date each fact was last confirmed, and names the owner to ask when the evidence is stale. Its data is the asker's readable pages and connected items. "Ask the owner" creates a review request (`STAT-006`) when invoked; an agent’s invocation carries standard under company policy.

**Acceptance.**
1. a Workers journey asks about a fact whose only page carries an open outdated flag.
2. The answer states the flag and names the owner, and clicking "Ask the owner" creates exactly one review request.

**Evidence.** `tests/flagship/intelligence/authority.test.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-006 — Checked runbooks

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** The knowledge agent converts a procedure page into steps. On a schedule or on demand, it dry-runs them against current tool schemas and test accounts within declared resource authority (read-only calls to GitHub, Vector, Jira or connected admin APIs), and checks links, screenshots against the current UI where possible, and command syntax. It reports each broken step on the exact block. Its data is the runbook page, tool schemas and responses from test accounts. Read-only rehearsal is separate from effects on an exact isolated test resource (`EFFECT-001`, `AI-011`). The company policy decides each effect’s classes, including live for a running service. Ambiguity is reported with the affected facts; it supplies no authority or assumed approval.

**Acceptance.**
1. a Workers journey with recorded tool fixtures dry-runs a runbook whose third step references a removed API field, flags exactly that step with the schema evidence, and makes no write call.

**Evidence.** `src/core/features/skills/routes.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-007 — Onboarding paths

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007 · Rules D-1

**Requirement.** For a new member, the knowledge agent assembles a reading path for their group or role from current verified pages (`CARD-003` can make it required). It asks short comprehension questions, answers follow-ups with citations, and routes confusion ("this step no longer matches") to the page owner as a flag. Its data is verified pages readable by the new member and their questions. The member controls whether their progress is shared. Their manager sees only the progress they agree to share, and nothing is inferred about performance. Formal courses and certifications belong to [Beam](https://github.com/just-every/run-beam).

**Acceptance.**
1. a browser journey assigns a path to a new member, who answers questions and reports one confusing step.
2. That step becomes a flag for its owner, and the manager's view shows only the shared completion.

**Evidence.** —
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-008 — Stale-knowledge sweeps

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Once a week, the knowledge agent prepares each owner one digest of their lapsed verifications, open flags, ownerless pages in their containers and pages nobody has opened in 180 days. Each item comes with a prepared action: re-verify (which opens the revision), accept a fix, reassign, or archive. Its data is status, analytics (`PAGE-013`), flags and ownership. The company policy decides every action: commitment for verification, standard for reversible archive, and access when reassignment changes standing authority. Under the held company policy for commitment, standard and access, the owner performs the prepared actions.

**Acceptance.**
1. a Workers journey advances a week over a seeded workspace and delivers exactly one digest per owner with the expected items.
2. Acting on two items applies the actions and leaves no duplicate notices.

**Evidence.** `src/core/features/notifications/events.ts`
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-009 — Measured knowledge health

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007 · Rules D-1

**Requirement.** The knowledge agent maintains a workspace knowledge-health report: the share of views landing on current verified pages, the median time from flag to fix, the flag false-positive rate from dismissals, and answer accuracy on an owner-curated held-out question set re-run monthly. Its data is analytics, flags and answer runs. Owners curate the question set and its expected answers, and the report never ranks individual people.

**Acceptance.**
1. a Workers journey seeds a month of events and checks every report figure against hand-computed values.
2. A held-out re-run records its accuracy and cost under `FLAG-003`'s rules.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

#### KEEP-010 — Team-built agents

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** An authorized member builds an agent for their team without code. The agent has a name, instructions, a knowledge scope (containers, labels, cards and connected sources), the tools it may use, and when it runs: Its tools offer search and cited answers (`ANSWER-001`), drafting pages and cards, proposing edits as suggestions (`SUG-001`), filing issues (`EMBED-001`) and posting to a chat channel (`CHAT-001`). Its triggers are asked in Slate, in chat (`CHAT-002`) or over MCP (`API-003`), on a schedule, or on an automation event (`AUTO-*`). Each agent is an `AI-014` agent record. Its builder can test it against sample questions before sharing it with groups. Its data is the intersection of the agent's declared scope and what the member it runs for may read. A scheduled or event run reads as the agent's owner, and its output reaches only an audience that may read every source it used (`AI-013`). Verification carries commitment, publication external, reversible archive standard, permanent deletion destructive and access changes access. The company policy decides execution; under the held company policy for standard or external edits, edits are suggestions and pages stay drafts until the named person accepts them. Every run records its actor, scope, tools, sources and cost against the company’s chosen spend policy (`AI-010`, `AI-012`). Owners can see, pause or delete any agent, and removing an agent's owner pauses it (`WORK-007`).

**Acceptance.**
1. a Workers journey with a provider fake at the network edge builds an agent scoped to one container with the answer and propose-edit tools, and shares it with a group.
2. A group member who can read only half the container asks it a question, and the answer cites only pages that member can read.
3. Under the held company policy for standard or external edits, the agent’s proposed edit lands as a suggestion and changes nothing until the named person accepts it.
4. A page in scope that instructs the agent to publish itself or grant access produces a refusal and no change.
5. A scheduled run posts once to a channel fake, citing only sources its audience can read.
6. Pausing the agent stops its next scheduled run, and exhausting its budget stops it with a notice to its owner.
7. A browser journey at 1440 and 390 builds, tests and shares the agent.

**Evidence.** `CONTRACT.md` — requirement text only; no validated CI-run proof.
**Gap.** The cited material does not prove the complete revision, authority, audience and outcome journey for this capability under company policy; the held and all-autonomous cases remain unproven. Earlier implementation notes are retained in CHANGELOG.md.

## Agent surface

### Agent surface

#### SURFACE-001 — Wiki registry and Core coverage

Agent surface · target · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013 · Rules D-1

**Requirement.** The wiki curator’s registry describes the jobs and non-tool reasons in this Agent surface.

**Acceptance.**
1. The advertised wiki jobs and mapped Core clause IDs equal this table; browser, device, connector, import and installation reasons account for every other Core job.
2. Existing evidence reads, asks, run controls and effect operations are brought into the same registry as page, block, database, task, comment, sharing and administration actions.
3. The Base conformance journey runs on Slate’s own populated wiki fixtures and rejects any registry or UI-parity gap.

**Evidence.** None.
**Gap.** No executed Slate MCP journey yet covers this seed delta under both company policies.

#### SURFACE-002 — Wiki class computation for records and outside services

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Slate derives classes from the actual wiki target, exposure, relationship and provider state.

**Acceptance.**
1. standard: An internal reversible wiki edit, watch, draft, task or suggestion carries its item count; a move or edit is external as well when it newly exposes content outside the business.
2. external: A public page, outside share, member or guest invitation, mail retry, chat delivery, audit stream, connector write or externally visible wiki change carries recipient count and counterparty: internal, known from an admitted domain or existing company relationship, new otherwise, or public for an open publication.
3. money: Paid activation carries the verified amount, currency and counterparty of the charge or changed price.
4. commitment: An accepted decision, attestation, approval of relied-on content or commercial term carries its value and counterparty; an agent’s act remains distinct from a person’s attestation.
5. accounts: Creating a paid SSO account or outside resource carries its provider.
6. gated: A provider’s account consent (including Slack OAuth installation or Teams Entra-admin consent), hosted card entry or identity check carries provider and step when that provider requires a person; an offered agent API uses the company policy for the call’s classes.

**Evidence.** None.
**Gap.** No executed Slate MCP journey yet covers this seed delta under both company policies.

#### SURFACE-003 — Wiki class computation for business and data effects

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Slate derives classes from the actual wiki target, exposure, relationship and provider state.

**Acceptance.**
1. access: Membership, groups, guest or page grants, SAML admission allow-lists, restored grants, connector or client authority and governance changes to standing permission carry people affected and widening or narrowing; reassigning a page owner without changing authority remains standard.
2. security: SSO enforcement, AI-provider, chat or source connector credential custody and changes, token custody, signed-webhook or audit-stream signing and SIEM credentials, audit retention, backup and form anti-spam protective settings carry the affected setting.
3. destructive: Permanent erasure, connector-content purge, permanent template, saved-conversation, decision-record or saved-view deletion, irreversible field conversion or removal, backup retention deletion or deleting a retained page or attachment version carries the item count; reversible trash, archive and changes recoverable through revision restore remain standard.
4. sensitive: Reading, writing or exporting source or wiki records containing regulated ID, health, bank, card or payroll data carries record count and data kind; a confidential label alone does not invent this class.
5. live: A trial effect, operational remediation, learned-procedure activation or skill activation that changes a running service carries that service; a read-only rehearsal remains standard.

**Evidence.** None.
**Gap.** No executed Slate MCP journey yet covers this seed delta under both company policies.

#### SURFACE-004 — Revision-pinned knowledge resources

Agent surface · target · **missing** · From new · Cites BASE-AGENT-003, BASE-AGENT-005 · Rules D-1

**Requirement.** The curator works with pages, blocks, databases and records, containers, comments, exact revisions, source passages, decisions, inquiries and runs.

**Acceptance.**
1. Resource templates cover every record family listed here, including an exact page-revision link and the linked record returned after a tool changes it.
2. A cited answer opens the exact permitted source passage or a content-free tombstone after erasure.
3. Changing a source’s authority or audience invalidates its derived wiki output rather than silently substituting a newer or wider source.

**Evidence.** None.
**Gap.** No executed Slate MCP journey yet covers this seed delta under both company policies.

#### SURFACE-005 — Wiki event handoffs

Agent surface · target · **missing** · From new · Cites BASE-AGENT-010, BASE-OPS-003 · Rules D-1

**Requirement.** Wiki changes and knowledge-maintenance outcomes can start accountable cross-product follow-up.

**Acceptance.**
1. Page, task, verification, suggestion, decision, source, inquiry and run changes emit the record URI and the outcome needed for typed handoffs.
2. A Vector or Jira issue event can request review of its linked page, and a restricted page sends no disclosing handoff to an unauthorized subscriber.
3. The same wiki event is read through the event cursor, subscription and signed webhook without creating a duplicate effect.

**Evidence.** None.
**Gap.** No executed Slate MCP journey yet covers this seed delta under both company policies.

#### SURFACE-006 — One seeded week for the wiki curator

Agent surface · target · **missing** · From new · Cites BASE-AGENT-005, BASE-AGENT-007, BASE-AGENT-009, BASE-AGENT-011, BASE-AGENT-012, BASE-AGENT-013 · Rules D-1

**Requirement.** A stranger agent receives only the installation URL and completes a seeded week of wiki upkeep through MCP.

**Acceptance.**
1. Discover the curator jobs, read two exact-revision sources, answer a question, assign and complete a task, flag contradicted knowledge, repair its page, reconcile a duplicate and post the permitted update.
2. Run that week under the company’s all-autonomous policy: every authorized class runs without a person waiting or a policy refusal.
3. Run it again under the held company policy: standard changes enter review and other declared classes wait for the person that policy names; the saved exact actions execute once after those people act.
4. The week reads the final pages, citations, task state, outside update, activity and usage, then demonstrates revocation and no duplicate result after retry.
5. A changed source, a private draft and a message claiming broader authority change neither the call’s computed class nor the outcome the current company policy requires.

**Evidence.** None.
**Gap.** No executed Slate MCP journey yet covers this seed delta under both company policies.

## Later

None.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | Provider acceptance repeats this against a real authorized Google Drive. | SEARCH-012 | not run | | |
| R-2 | A provider acceptance run repeats this against a real workspace. | IMP-006 | not run | | |
| R-3 | A provider acceptance run repeats this against a real Confluence Cloud site. | IMP-007 | not run | | |
| R-4 | Real Google Drive and SharePoint folder-import and file-card acceptance. | IMP-009, EMBED-004 | not run | | |
| R-5 | Provider acceptance repeats this against a real Jira Cloud site. | EMBED-001 | not run | | |
| R-6 | Provider acceptance repeats this against a real Jira Cloud site. | EMBED-005 | not run | | |
| R-7 | App Store and Play review builds are recorded with the release evidence. | MOBILE-001 | not run | | |
| R-8 | Notarization and real distribution-signing identity receipts for desktop installers. | MOBILE-002 | not run | | |
| R-9 | Human screen-reader review of every operator and public surface. | DOCS-001, NAV-006, FLAG-002 | not run | | |
| R-10 | A dated VPAT for Slate. | FLAG-002 | not run | | |
| R-11 | Receipts from real Claude, ChatGPT, Cursor and other supported MCP clients. | API-003 | not run | | |
| R-12 | Real Okta, Microsoft Entra ID, Google Workspace, JumpCloud and Auth tenant acceptance; standards fixtures and run-auth remain acceptance duties. | WORK-015, ADMIN-001, ADMIN-002 | not run | | |
| R-13 | A real authorized R2 or S3 backup destination and complete independent restore receipt. | PORT-009 | not run | | |
| R-14 | Real licensed Slack, Teams and Nook app installation and destination acceptance. | NOTIF-003, NOTIF-007, CHAT-001, CHAT-004 | not run | | |
| R-18 | Prospective trial windows actually elapse; real outcome measurements, uncertainty and repeated-work results are published without presenting simulated time as prospective proof. | TRIAL-002, TRIAL-003, FLAG-003 | not run | | |
| R-19 | Real authorized document, evidence and operational-provider account receipts for full flagship qualification. | FLAG-002 | not run | | |
