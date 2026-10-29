import {contentQueryJourney} from './content-query-journey.mjs';
import { publicationJourney } from './publication-journey.mjs';
import {unpublishedChangesJourney} from './unpublished-changes-journey.mjs';
import {pageDetailsJourney} from './page-details-journey.mjs';
import {syncedCustodyJourney,syncedHistoryJourney,syncedMemberErasureJourney} from './synced-custody.mjs';
import {peopleJourney} from './people-journey.mjs';
import {workspaceAuthorityJourney} from './workspace-authority-journey.mjs';
import {syncedJourney} from './synced-journey.mjs';
import {touchDatabaseToolsJourney} from './touch-database-tools-journey.mjs';
import {touchManagementJourney} from './touch-management-journey.mjs';
import {touchPageToolsJourney} from './touch-page-tools-journey.mjs';
import {touchOperatorJourney} from './touch-operator-journey.mjs';
import {columnsJourney} from './columns-journey.mjs';
import {beginTouchJourney} from './touch-journey.mjs';
import {touchCommentJourney,touchPublishShareJourney} from './touch-page.mjs';
import {touchDatabaseJourney} from './touch-database.mjs';
import { samlJourney } from './saml-journey.mjs';
import { folderJourney } from './folder-journey.mjs';
import {tablesJourney} from './tables-journey.mjs';
import {providerEmbedsJourney} from './provider-embeds-journey.mjs';
import { exportCommentsJourney } from './export-comments-journey.mjs';
import { backupsJourney } from './backups-journey.mjs';
import { presentationJourney } from './presentation-journey.mjs';
import { analyticsJourney } from './analytics-journey.mjs';
import { reactionsJourney } from './reactions-journey.mjs';
import { pageDisplayJourney } from './page-display-journey.mjs';
import { createInPlaceJourney } from './create-in-place-journey.mjs';
import assert from 'node:assert/strict';
import { journeyTest as test } from './journey-shard.mjs';
import { expect } from '@playwright/test';

// Consecutive steps share their parent journey's workspace and registration.
async function step(name, run) {
  try { await run(); }
  catch (cause) {
    if (cause instanceof Error) { cause.message = `Step ${name} failed: ${cause.message}`; throw cause; }
    throw new Error(`Step ${name} failed: ${String(cause)}`);
  }
}
import { accessible, setupWorkspace, withWorkspace } from './browser-support.mjs';
import { commentJourney, searchJourney, settingsJourney, shareJourney, writeJourney } from './core-journeys.mjs';
import { askDraftJourney } from './ask-journey.mjs';
import { withSecondPerson, call } from './two-people-support.mjs';
import { concurrentEditingJourney } from './two-people-editing.mjs';
import { accessChangeJourney } from './two-people-access.mjs';
import { historyJourney } from './two-people-history.mjs';
import { databaseJourney } from './database-journey.mjs';
import { reviewRequestJourney } from './review-request-journey.mjs';
import { hubJourney } from './hub-journey.mjs';
import { blogJourney } from './blog-journey.mjs';
import { followingJourney } from './following-journey.mjs';
import { treeFilterJourney } from './tree-filter-journey.mjs';
import { failedSaveJourney } from './failed-save-journey.mjs';
import { sharedNavigationJourney } from './shared-navigation-journey.mjs';
import { globalCreateJourney } from './global-create-journey.mjs';
import { templateCaptureJourney } from './template-capture-journey.mjs';
import { starterTemplatesJourney } from './starter-templates-journey.mjs';
import { taskAssignmentJourney } from './task-assignment-journey.mjs';
import { recordTemplatesJourney } from './record-templates-journey.mjs';
import { pageLockBrowserJourney } from './page-lock-journey.mjs';
import { outlineJourney } from './outline-journey.mjs';
import { groupMentionJourney } from './group-mentions-journey.mjs';
import { taskReportJourney } from './task-report-journey.mjs';
import { myTasksJourney } from './my-tasks-journey.mjs';
import { trustRankingJourney } from './trust-ranking-journey.mjs';
import { chatJourney } from './chat-journey.mjs';
import { todayOutcomesJourney } from './today-outcomes-journey.mjs';

// Retain both responsive branches: desktop sidebar visibility and horizontal
// column geometry are unique assertions, while the phone case checks stacking.
for (const width of [390, 1440]) {
  test(`real core-wiki and touch-member journeys at ${width}px`, { timeout: 300000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      const refused = await state.context.request.get(state.origin + '/api/ai/availability');
      assert.equal(refused.status(), 403);
      assert.equal((await refused.json()).code, 'FEATURE_DISABLED');
      await expect(state.page.getByRole('button', { name: 'Ask', exact: true })).toHaveCount(0);
      await state.page.getByRole('button', { name: 'More', exact: true }).click();
      await expect(state.page.getByRole('menu').getByRole('menuitem', { name: 'Ask', exact: true })).toHaveCount(0);
      await state.page.keyboard.press('Escape');
      let pageId,touch;
      try {
        await step('BLOCK-001 — a new page body takes real keystrokes, including before it finishes loading, and keeps them through committed save, failed save, explicit retry and leaving; touch member creates, inserts and drags blocks', async () => { pageId = await writeJourney(state, width); touch=await beginTouchJourney(state,width);await columnsJourney(state,width,touch); });
        assert.ok(pageId, 'Writing must complete before dependent journeys.');
        assert.ok(touch, 'Touch-member writing must complete before its dependent journeys.');
        await step('anchored comment, reset composer, reply and resolve; touch member comments and resolves', async () => {await commentJourney(state, pageId);await touchCommentJourney(touch,touch.pageId);});
        await step('invite existing member, persisted grant and canonical copied link; touch member publishes and shares', async () => {await shareJourney(state, pageId);await touchPublishShareJourney(touch,touch.pageId);});
        await step('PAGE-007 populated Details and full-member ownership preserve grants under replay and edit-only refusal', async () => {await withSecondPerson(state,width,people=>pageDetailsJourney(state,people));});
        await step('query, highlighted results and opening exact page; touch Search, Inbox, My tasks and review queues', async () => {await searchJourney(state, pageId);await touchOperatorJourney(state,touch);});
        await step('published readers, editor indication, republish and lossless discard', () => withSecondPerson(state, width, people => unpublishedChangesJourney(state, people)));
        // Finish earlier page notifications before connecting the chat journey destinations.
        await state.runScheduled();
        await chatJourney(state, width);
        if (width === 390) {
          await templateCaptureJourney(state);
          await withSecondPerson(state, width, people => step('DB-015 — template handover and revoked-saver pause on a phone', () => recordTemplatesJourney(state, people)));
          // One phone smoke visits the main screens; functional journeys use desktop
          // except where an assertion distinguishes the phone layout or touch input.
          for (const route of ['/app', `/app/pages/${pageId}`, '/app/search', '/app/inbox', '/app/tasks', '/app/review', '/app/templates', '/app/settings']) {
            const response = await state.page.goto(state.origin + route, { waitUntil: 'networkidle' });
            assert.equal(response.status(), 200, `Phone smoke: ${route}`);
            await expect(state.page.getByRole('main')).toHaveCount(1);
            await accessible(state.page, `phone smoke ${route}`);
          }
        }
      } finally {await touch?.close();}
    }, {}, { scheduled: true, slack: true });
  });
}

for (const width of [1440]) {
  test(`provider embeds load only on interaction and [EMBED-004] files respect reader access at ${width}px`, {timeout:240000}, async()=>{
    await withWorkspace({width,height:width===1440?1000:844},'core-wiki',async state=>{await setupWorkspace(state);await providerEmbedsJourney(state);}, {}, {folders:true});
  });
}

for (const width of [390]) {
  test(`space tree title filtering preserves ancestors, access and expansion at ${width}px`, { timeout: 420000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await treeFilterJourney(state);
      await state.switchIdentity('owner');
      await settingsJourney(state,width);
      await workspaceAuthorityJourney(state,width);
    });
  });
}

for (const width of [1440]) {
  test(`spreadsheet tables merge, sort and round-trip through edited database records at ${width}px`, {timeout:240000}, async ()=>{
    await withWorkspace({width,height:width===1440?1000:844},'core-wiki',async state=>{
      await setupWorkspace(state);
      await tablesJourney(state);
      // Keep the independently set up database case with database round trips.
      // Its assertions and member authority remain unchanged.
      const touch=await beginTouchJourney(state,width,{writePage:false});
      try {
        await step('remove a field with impact confirmation and export current view CSV; touch member edits all six layouts and uses charts, templates and automations', async () => {await databaseJourney(state);await touchDatabaseJourney(touch,touch.containerId);await touchDatabaseToolsJourney(state,touch);});
      } finally {await touch.close();}
    }, {}, {scheduled:true});
  });
}

for (const width of [1440]) {
  test(`shared page invitations name their space and disappear on revocation at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => sharedNavigationJourney(state, people));
      await syncedCustodyJourney(state,width);
      await syncedHistoryJourney(state,width);
      await syncedMemberErasureJourney(state,width);
    });
  });
}

for (const width of [1440]) {
  test(`SEARCH-011 — verified, unverified and lapsed pages rank in order with badges, near-duplicates collapse and published views carry no trust at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await trustRankingJourney(state);
    });
  });
}

for (const width of [1440]) {
  test(`named review request, reviewer queue, exact verify and overdue escalation at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => reviewRequestJourney(state, people));
      await syncedJourney(state,width);
      await peopleJourney(state,width);
    }, {}, { scheduled: true });
  });
}

for (const width of [1440]) {
  test(`TMPL-007 starter templates are found by category; touch spaces, templates, archive and workspace settings work at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await templateCaptureJourney(state);
      await starterTemplatesJourney(state).catch(async cause => {
        await state.page.screenshot({ path: `.artifacts/ui-convergence/starter-templates-${width}-failure.png`, fullPage: true });
        throw cause;
      });
      const touch=await beginTouchJourney(state,width);try{await touchManagementJourney(state,touch);}finally{await touch.close();}
    });
  });
}

for (const width of [1440]) {
  test(`two people edit at once, lose access mid-edit and restore history at ${width}px`, { timeout: 420000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, async people => {
        await step('different blocks, same block, title and unreachable server', () => concurrentEditingJourney(state, people));
        await step('removed, narrowed and expired access with unsaved typing', () => accessChangeJourney(state, people, width));
        await step('restore writes a new revision; citations resolve to theirs', () => historyJourney(state, people));
      });
    });
  });
}

for (const width of [1440]) {
  test(`readable exports retain discussions through HTML and Markdown re-import at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => exportCommentsJourney(state, people));
      await backupsJourney(state);
      await folderJourney(state);
    }, {}, { backups: true, folders: true });
  });
}

for (const width of [1440]) {
  test(`global create names destinations for every content kind at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await globalCreateJourney(state).catch(async cause => {
        await state.page.screenshot({ path: `.artifacts/ui-convergence/global-create-${width}-failure.png`, fullPage: true });
        console.error(cause);
        throw cause;
      });
    });
  });
}

for (const width of [1440]) {
  test(`BLOCK-016 — task reports, My tasks and typed assignments preserve reader access and completion at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, async people => {
        const retained = new Set((await state.api('/api/pages')).items.map(item => item.id));
        const retireTaskPages = async () => {
          await Promise.all([people.alice.page.goto('about:blank'), people.bob.page.goto('about:blank')]);
          for (const item of (await state.api('/api/pages')).items.filter(item => !retained.has(item.id))) {
            const document = await state.api(`/api/pages/${item.id}`);
            const response = await call(state.context, state.origin, 'POST', `/api/archive/${item.id}`, {operationKey:crypto.randomUUID(),expectedRevisionId:document.page.revisionId,action:'trash'});
            assert.equal(response.status, 200, `Retire completed task scenario page ${item.id}`);
          }
        };
        await step('BLOCK-016 — task report access, inline completion and published sign-in notice', () => taskReportJourney(state, people));
        await retireTaskPages();
        await step('NAV-007 — assigned open tasks, due dates, completion and revoked access', () => myTasksJourney(state, people));
        await retireTaskPages();
        await step('BLOCK-015 — typed assignment, due date, exactly one notification and overdue state', () => taskAssignmentJourney(state, people));
      });
    });
  });
}

for (const width of [1440]) {
  test(`page creation destinations and editor locks preserve readable content at ${width}px`, { timeout: 300000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await step('TREE-005 — create in place names root and child destinations', () => createInPlaceJourney(state));
      await state.switchIdentity('owner');
      await step('review, publish, edit and cancel a scheduled publication', () => publicationJourney(state));
      await state.switchIdentity('owner');
      await withSecondPerson(state, width, people => step('PAGE-015 — locks protect content while editors comment and unlock', () => pageLockBrowserJourney(state, people)));
    }, {}, {scheduled:true});
  });
}

for (const width of [1440]) {
  test(`DB-015 — a database's Templates tab says a schedule runs as its last saver, and a re-save hands it over at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => recordTemplatesJourney(state, people));
    }, {}, { scheduled: true });
  });
}

for (const width of [1440]) {
  test(`SAML sign-in verifies the domain and signatures while preserving guest and designated-owner access at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await samlJourney(state);
    }, {}, { scheduled: true, saml: true });
  });
}

for (const width of [1440]) {
  test(`editable space home and curated company hub for a new member at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => hubJourney(state, people));
    });
  });
}

for (const width of [1440]) {
  test(`page and space readership show people, author views and inclusive dates at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => analyticsJourney(state, people));
    }, {}, {scheduled:true,webhooks:true});
  });
}

for (const width of [1440]) {
  test(`group mentions preview readers and refuse oversized groups at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => groupMentionJourney(state, people));
    });
  });
}

for (const width of [1440]) {
  test(`CONT-012 a watched space's create, edit sessions and comment appear once each in Home's Following at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => followingJourney(state, people));
    });
  });
}

for (const width of [1440]) {
  test(`space blog post reaches a follower's inbox and Home at ${width}px`, { timeout: 240000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => blogJourney(state, people));
    });
  });
}

for (const width of [1440]) {
  test(`rejected writes retain drafts and require explicit retry at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await failedSaveJourney(state);
    });
  });
}

for (const width of [1440]) {
  test(`page and comment reactions identify people without notifications or views at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => reactionsJourney(state, people));
    });
  });
}

for (const width of [1440]) {
  test(`flagship no-provider Ask retains a page-scoped draft at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'flagship', async state => {
      await setupWorkspace(state);
      await askDraftJourney(state);
      await todayOutcomesJourney(state);
    }, {}, {scheduled:true});
  });
}

for (const width of [1440]) {
  test(`presentation paginates read-only slides; touch history, details and exports work at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await presentationJourney(state);
      const touch=await beginTouchJourney(state,width);try{await touchPageToolsJourney(touch);}finally{await touch.close();}
    });
  });
}

for (const width of [1440]) {
  test(`page display settings are shared and survive export and import at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await withSecondPerson(state, width, people => pageDisplayJourney(state, people));
    });
  });
}

for (const width of [1440]) {
  test(`page outline follows headings and navigates long pages at ${width}px`, { timeout: 420000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await outlineJourney(state);
      await settingsJourney(state,width);
      await workspaceAuthorityJourney(state,width);
    });
  });
}

// Give the complete query journey its own workspace and deadline, keeping the
// established member journey's timeout and every query assertion unchanged.
for (const width of [1440, 390]) {
  test(`BLOCK-010 — native content queries retain criteria and current-reader results at ${width}px`, { timeout: 180000 }, async () => {
    await withWorkspace({ width, height: width === 1440 ? 1000 : 844 }, 'core-wiki', async state => {
      await setupWorkspace(state);
      await contentQueryJourney(state, width);
    });
  });
}
