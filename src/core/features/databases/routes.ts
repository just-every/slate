import {z} from 'zod';
import {convertTable,restoreTable} from './table-conversion';
import {
  listDatabases,
  resolveReferences,
  referenceOptions,
} from "./discovery";
import {
  parseInput,
  viewInput,
  databaseInput,
  lockInput,
  fieldInput,
  recordCreateInput,
  recordUpdateInput,
  recordTemplateInput,
  templateDeleteInput,
  templateUseInput,
} from "./validation";
import { createFromTemplate, deleteRecordTemplate, listRecordTemplates, saveRecordTemplate } from "./record-templates";
import { Hono } from "hono";
import type { AppEnvironment } from "../../app/types";
import { featureContext } from "../../app/feature-context";
import {
  createDatabase,
  setStructureLock,
  saveField,
  createRecord,
} from "./service";
import { saveView, queryView, chart } from "./views";
import { updateRecord } from "./records";
import { requireRecordDatabase } from "./repository";
import { readDatabase, readRecord } from "./reads";
export function createDatabasesRoutes() {
  const r = new Hono<AppEnvironment>();
  r.post('/from-table',async c=>c.json(await convertTable(featureContext(c),parseInput(z.object({operationKey:z.string().min(8),pageId:z.string(),blockId:z.string(),expectedRevisionId:z.string()}).strict(),await c.req.json()))));
  r.post('/:id/to-table',async c=>c.json(await restoreTable(featureContext(c),c.req.param('id'),parseInput(z.object({operationKey:z.string().min(8),expectedRevisionId:z.string(),viewId:z.string(),expectedViewRevisionId:z.string()}).strict(),await c.req.json()))));
  r.get("/", async (c) =>
    c.json(await listDatabases(featureContext(c), c.req.query("containerId"))),
  );
  r.post("/references", async (c) =>
    c.json(await resolveReferences(featureContext(c), await c.req.json())),
  );
  r.get("/:id/references/:fieldId", async (c) =>
    c.json(
      await referenceOptions(
        featureContext(c),
        c.req.param("id"),
        c.req.param("fieldId"),
        c.req.query("query"),
      ),
    ),
  );
  r.post("/", async (c) =>
    c.json(
      await createDatabase(
        featureContext(c),
        parseInput(databaseInput, await c.req.json()),
      ),
      201,
    ),
  );
  r.get("/:id", async (c) => c.json(await readDatabase(featureContext(c), c.req.param("id"))));
  r.post("/:id/lock", async (c) =>
    c.json(
      await setStructureLock(
        featureContext(c),
        c.req.param("id"),
        parseInput(lockInput, await c.req.json()),
      ),
    ),
  );
  r.post("/:id/fields", async (c) =>
    c.json(
      await saveField(
        featureContext(c),
        c.req.param("id"),
        parseInput(fieldInput, await c.req.json()),
      ),
    ),
  );
  r.post("/:id/views", async (c) =>
    c.json(
      await saveView(
        featureContext(c),
        c.req.param("id"),
        parseInput(viewInput, await c.req.json()),
      ),
    ),
  );
  r.get("/:id/views/:viewId", async (c) =>
    c.json(
      await queryView(
        featureContext(c),
        c.req.param("id"),
        c.req.param("viewId"),
      ),
    ),
  );
  r.post("/:id/views/:viewId/query", async (c) =>
    c.json(
      await queryView(
        featureContext(c),
        c.req.param("id"),
        c.req.param("viewId"),
        await c.req.json(),
      ),
    ),
  );
  r.get("/:id/views/:viewId/chart", async (c) =>
    c.json(
      await chart(
        featureContext(c),
        c.req.param("id"),
        c.req.param("viewId"),
        c.req.query("group") ?? "",
        c.req.query("numeric"),
        c.req.query("calculation"),
      ),
    ),
  );
  r.post("/:id/records", async (c) =>
    c.json(
      await createRecord(
        featureContext(c),
        c.req.param("id"),
        parseInput(recordCreateInput, await c.req.json()),
      ),
      201,
    ),
  );
  r.get("/:id/templates", async (c) => c.json(await listRecordTemplates(featureContext(c), c.req.param("id"))));
  r.post("/:id/templates", async (c) =>
    c.json(await saveRecordTemplate(featureContext(c), c.req.param("id"), parseInput(recordTemplateInput, await c.req.json()) as import("./record-templates").RecordTemplateInput), 201),
  );
  r.post("/:id/templates/:templateId/delete", async (c) =>
    c.json(await deleteRecordTemplate(featureContext(c), c.req.param("id"), c.req.param("templateId"), parseInput(templateDeleteInput, await c.req.json()))),
  );
  r.post("/:id/templates/:templateId/records", async (c) =>
    c.json(await createFromTemplate(featureContext(c), c.req.param("id"), c.req.param("templateId"), parseInput(templateUseInput, await c.req.json())), 201),
  );
  r.get("/:id/records/:pageId", async (c) =>
    c.json(await readRecord(featureContext(c), c.req.param("id"), c.req.param("pageId"))),
  );
  r.patch("/:id/records/:pageId", async (c) => {
    await requireRecordDatabase(
      featureContext(c),
      c.req.param("id"),
      c.req.param("pageId"),
    );
    return c.json(
      await updateRecord(
        featureContext(c),
        c.req.param("pageId"),
        parseInput(recordUpdateInput, await c.req.json()),
      ),
    );
  });
  return r;
}
