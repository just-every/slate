import { useEffect, useRef, useState } from "react";
import type { EditorBlock, BlockSaveState } from "../features/editor/ui/types";
import { contentApi, editorBlocks, type DocumentView } from "./content";
import { ApiError, TransportError, errorMessage, operationKey } from "./transport";
import { saveBlockType } from "./saveBlockType";

import {
  draftKeys,
  readDraft,
  storeDraft,
  type PendingEdit as Pending,
} from "./draftRecovery";
import { useWorkspace } from "../app/ui/WorkspaceContext";
/** How long a structure change waits for the page read around its save. */
const STRUCTURE_READ_MS = 15_000;

export function usePageEditor(document: DocumentView, invalidateRead: () => void, pendingTitle?: () => Promise<void> | null) {
  const { member } = useWorkspace();
  const journalKey = draftKeys(member.workspaceId, member.id, document.page.id).journal;
  const restored = useRef(document.permissions.canEdit ? readDraft(journalKey) : null);
  const [blocks, setBlocks] = useState(() => {
    const saved = editorBlocks(document.blocks);
    const dirty = new Map(
      (restored.current?.blocks ?? []).map((block) => [block.id, block]),
    );
    return saved
      .map((block) => dirty.get(block.id) ?? block)
      .concat(
        [...dirty.values()].filter(
          (block) => !saved.some((item) => item.id === block.id),
        ),
      );
  });
  const [saveState, setSaveState] = useState<Record<string, BlockSaveState>>(
    Object.fromEntries(
      (restored.current?.edits ?? []).map(([id]) => [
        id,
        {
          status: "failed",
          message:
            "An unsaved edit was recovered in this tab. Retry its save or compare it with the current page.",
        } as BlockSaveState,
      ]),
    ),
  );
  // Mutable page CAS may advance without creating a content snapshot (sharing, status).
  const [revision, setRevision] = useState(document.page.revisionId);
  const revisionRef = useRef(revision);
  // A read dispatched before a committed mutation may still be in transport.
  // Retire it before publishing the receipt's newer compare-and-swap revision.
  function updateRevision(value: string, previousRevisionId?: string) {
    invalidateRead();
    revisionRef.current = value;
    setRevision(value);
    if (previousRevisionId)
      window.dispatchEvent(new CustomEvent("slate:page-text-saved", {
        detail: { pageId: document.page.id, previousRevisionId, revisionId: value },
      }));
  }
  const [workingRevisionId, setWorkingRevisionId] = useState(document.workingRevisionId);
  const [firstBlockDirty,setFirstBlockDirty]=useState(false);
  const [structureState,setStructureState]=useState<"saving"|"saved"|null>(null);
  const [structureConflict, setStructureConflict] = useState<EditorBlock[] | null>(null);
  const structureConflictBlock = useRef<string | undefined>(undefined);
  const current = useRef(blocks);
  const structureBusy=useRef(false);
  const revisions = useRef(
    new Map(document.blocks.map((block) => [block.id, block.revisionId])),
  );
  const blockTypes = useRef(new Map(document.blocks.map(block => [block.id, block.blockType])));
  // The page revision this tab's copies of every block were last read at. A save
  // receipt can adopt a newer page revision that includes other people's commits.
  const synced = useRef(document.page.revisionId);
  const pending = useRef(
    new Map<string, Pending>(restored.current?.edits ?? []),
  );
  const busy = useRef(new Set<string>());
  const saving = useRef(new Map<string, Promise<void>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const alive = useRef(true);
  const pageId = document.page.id;
  const canEdit=useRef(document.permissions.canEdit);
  canEdit.current=document.permissions.canEdit;
  useEffect(()=>{
    if (!document.permissions.canEdit) {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    }
  },[document.permissions.canEdit]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (pending.current.size || busy.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  function persistDraft() {
    try {
      storeDraft(journalKey, pending.current, current.current);
    } catch {
      for (const id of pending.current.keys())
        status(id, {
          status: "failed",
          message:
            "This browser could not preserve a recovery copy. Keep this tab open until the server confirms your save.",
        });
    }
  }
  function status(id: string, value: BlockSaveState) {
    if (alive.current) setSaveState((old) => ({ ...old, [id]: value }));
  }
  async function save(id: string, propagate = false): Promise<void> {
    const active = saving.current.get(id);
    if (active) return active;
    const task = (async () => {
      while (await performSave(id, propagate)) {
        if (!pending.current.has(id) || !alive.current || !canEdit.current) break;
      }
    })();
    saving.current.set(id, task);
    try { await task; } finally { saving.current.delete(id); }
  }
  async function performSave(id: string, propagate = false) {
    if (!alive.current || !canEdit.current || busy.current.has(id)) return;
    const edit = pending.current.get(id);
    if (!edit) return;
    busy.current.add(id);
    status(id, { status: "saving" });
    try {
      await pendingTitle?.();
      const receipt = edit.structure || blockTypes.current.get(id) !== edit.block.type
        ? await saveBlockType(pageId, edit, persistDraft)
        : await contentApi.block(
        pageId,
        edit.block,
        edit.revision,
        edit.key,
      );
      if (!receipt.value.blockRevisionId)
        throw new Error(
          "The server did not confirm the block revision. Your text remains here.",
        );
      revisions.current.set(id, receipt.value.blockRevisionId);
      blockTypes.current.set(id, edit.block.type);
      if (receipt.value.previousRevisionId === synced.current)
        synced.current = receipt.value.revisionId;
      if (alive.current) {
        updateRevision(receipt.value.revisionId, receipt.value.previousRevisionId);
        setWorkingRevisionId(receipt.value.revisionId);
      }
      const latest = current.current.find((block) => block.id === id);
      pending.current.delete(id);
      if (latest && latest !== edit.block) {
        pending.current.set(id, {
          block: latest,
          key: operationKey(),
          revision: receipt.value.blockRevisionId,
        });
      } else
        status(id, {
          status: "saved",
        });
    } catch (error) {
      status(
        id,
        error instanceof ApiError && error.status === 409
          ? {
              status: "conflict",
              conflict: {
                fromRevision: edit.revision,
                currentRevision: "changed",
                byMemberName: "Another editor",
                atLabel: "since your last save",
              },
            }
          : !navigator.onLine || error instanceof TransportError ? { status: "offline" } : { status: "failed", message: errorMessage(error) },
      );
      // SHARE-007: a refused save means access changed; re-read the page now so
      // the editor closes with its explanation and the draft stays recoverable.
      if (error instanceof ApiError && (error.status === 403 || error.status === 404))
        window.dispatchEvent(new CustomEvent("slate:page-mutated", { detail: { pageId } }));
      busy.current.delete(id);
      if (propagate) throw error;
      return false;
    }
    persistDraft();
    busy.current.delete(id);
    return true;
  }
  function change(id: string, block: EditorBlock, expectedRevision?: string) {
    if (!alive.current || !canEdit.current) return;
    setStructureState(null);
    const next = current.current.map((existing) =>
      existing.id === id ? block : existing,
    );
    current.current = next;
    setBlocks(next);
    clearTimeout(timers.current.get(id));
    // A dispatched operation keeps its original payload and key until reconciled.
    if (
      !busy.current.has(id) &&
      saveState[id]?.status !== "failed" &&
      saveState[id]?.status !== "offline" &&
      saveState[id]?.status !== "unsaved" &&
      saveState[id]?.status !== "conflict"
    )
      pending.current.set(id, {
        block,
        key: operationKey(),
        revision: expectedRevision ?? revisions.current.get(id)!,
      });
    persistDraft();
    if (
      saveState[id]?.status !== "conflict" &&
      saveState[id]?.status !== "failed" &&
      saveState[id]?.status !== "offline" &&
      saveState[id]?.status !== "unsaved"
    ) {
      status(id, { status: "idle" });
      timers.current.set(
        id,
        setTimeout(() => void save(id), 650),
      );
    }
  }
  /** Takes the server's blocks, keeping this tab's unsaved or in-flight edits. */
  function adopt(fresh: DocumentView) {
    const loaded = editorBlocks(fresh.blocks);
    const byId = new Map(current.current.map((block) => [block.id, block]));
    const next = loaded.map((block) =>
      pending.current.has(block.id) || busy.current.has(block.id)
        ? (byId.get(block.id) ?? block)
        : block,
    );
    for (const block of current.current)
      if (
        !loaded.some((item) => item.id === block.id) &&
        pending.current.has(block.id)
      ) {
        next.push(block);
        status(block.id, {
          status: "failed",
          message:
            "This block was removed elsewhere. Your unsaved content remains here; copy it before reloading.",
        });
      }
    for (const block of fresh.blocks)
      if (!pending.current.has(block.id) && !busy.current.has(block.id)) {
        revisions.current.set(block.id, block.revisionId);
        blockTypes.current.set(block.id, block.blockType);
      }
    if (JSON.stringify(next) !== JSON.stringify(current.current)) {
      current.current = next;
      setBlocks(next);
    }
    synced.current = fresh.page.revisionId;
    revisionRef.current = fresh.page.revisionId;
    setRevision(fresh.page.revisionId);
    setWorkingRevisionId(fresh.workingRevisionId);
  }
  /**
   * SAVE-003: a structure change built on stale copies of other people's blocks
   * is rebased on a fresh read. Blocks the change itself edits keep the revision
   * this tab holds, so the server refuses them if someone else committed since.
   */
  /**
   * A structure change reads the page before and after it saves. A read that
   * never answers fails the change, so the editor never waits forever with its
   * refreshes paused, and the next change rebases on a fresh read.
   */
  async function structureRead(stage: "before" | "after") {
    try {
      return await contentApi.document(pageId, AbortSignal.timeout(STRUCTURE_READ_MS));
    } catch (error) {
      if (!(error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name))) throw error;
      synced.current = "";
      throw new Error(stage === "before"
        ? "The page could not be reloaded, so your change was not saved. Try again."
        : "Your change was sent, but the page could not be reloaded to confirm it. The page shows the saved version when it next refreshes; check it before changing it again.");
    }
  }
  async function rebase(next: EditorBlock[]) {
    const fresh = await structureRead("before");
    const saved = new Map(editorBlocks(fresh.blocks).map((block) => [block.id, block]));
    const local = new Map(current.current.map((block) => [block.id, block]));
    if (saved.size !== local.size || [...local.keys()].some((id) => !saved.has(id))) {
      adopt(fresh);
      throw new Error(
        "Someone else added or removed blocks on this page. Nothing was changed; the page now shows their blocks, so try again.",
      );
    }
    const content = ({ id: _id, indent: _indent, synced: _synced, copyRevisionId: _copyRevision, ...rest }: EditorBlock) => JSON.stringify(rest);
    const known = new Map(revisions.current);
    const rebased = next.map((block) => {
      const before = local.get(block.id), theirs = saved.get(block.id);
      if (!before || !theirs || content(before) !== content(block)) return block;
      known.set(block.id, fresh.blocks.find((item) => item.id === block.id)!.revisionId);
      return { ...theirs, indent: block.indent, layoutParentId: block.layoutParentId };
    });
    return { next: rebased, revision: fresh.page.revisionId, known };
  }
  async function structure(next: EditorBlock[], expectedBlocks?: Record<string, string>) {
    if (!alive.current || !canEdit.current) throw new Error("This page is read-only with your current access.");
    if (structureConflict) throw new Error("Reload the saved blocks before changing the page structure again. Your pending choices remain below.");
    // Enter in the title moves focus immediately; its receipt advances the
    // same page revision used by the first body block's creation.
    await pendingTitle?.();
    if (!alive.current || !canEdit.current) throw new Error("This page is read-only with your current access.");
    if (structureBusy.current || busy.current.size || pending.current.size)
      throw new Error(
        "Save or resolve your current edits before changing the page structure.",
      );
    structureBusy.current=true;
    setStructureState("saving");
    try {
    let committed: Awaited<ReturnType<typeof contentApi.structure>>;
    const plan = synced.current === revisionRef.current
      ? { next, revision: revisionRef.current, known: revisions.current }
      : await rebase(next);
    try {
      committed = await contentApi.structure(pageId, plan.revision, plan.next, expectedBlocks ?? Object.fromEntries(plan.known));
    } catch (error) {
      const conflict = error instanceof ApiError && error.code === "BLOCK_CONFLICT" ? (error.details as { blockId?: string } | undefined)?.blockId : undefined;
      if (conflict)
        status(conflict, {
          status: "conflict",
          conflict: {
            fromRevision: plan.known.get(conflict) ?? "",
            currentRevision: "changed",
            byMemberName: "Another editor",
            atLabel: "since you loaded it",
          },
        });
      if (error instanceof ApiError && error.status === 409) {
        structureConflictBlock.current = conflict;
        setStructureConflict(next);
      }
      throw error;
    }
    invalidateRead();
    const fresh = await structureRead("after");
    adopt(fresh);
    setStructureState("saved");
    return committed.value.blocks;
    } catch(error) {setStructureState(null);throw error;} finally {structureBusy.current=false;}
  }
  async function resolve(id: string, keepMine: boolean) {
    if (!alive.current || !canEdit.current) throw new Error("This page is read-only with your current access.");
    const fresh = await contentApi.document(pageId);
    const saved = fresh.blocks.find((block) => block.id === id);
    if (!saved)
      throw new Error(
        "This block was removed. Copy your text before reloading the page.",
      );
    revisions.current.set(id, saved.revisionId);
    blockTypes.current.set(id, saved.blockType);
    updateRevision(fresh.page.revisionId);
    setWorkingRevisionId(fresh.workingRevisionId);
    if (keepMine) {
      const block = current.current.find((item) => item.id === id)!;
      pending.current.set(id, {
        block,
        key: operationKey(),
        revision: saved.revisionId,
      });
      await save(id, true);
    } else {
      pending.current.delete(id);
      const restored = editorBlocks(fresh.blocks).find(
        (block) => block.id === id,
      )!;
      const next = current.current.map((block) =>
        block.id === id ? restored : block,
      );
      current.current = next;
      setBlocks(next);
      status(id, { status: "idle" });
      persistDraft();
    }
    if (structureConflictBlock.current === id) {
      structureConflictBlock.current = undefined;
      setStructureConflict(null);
    }
  }
  function receive(fresh: DocumentView) {
    if(!alive.current || fresh.page.id!==pageId || structureBusy.current)return;
    adopt(fresh);
    // The server answered, so it is reachable: an unsent draft is now labelled
    // unsaved and waits for an explicit save, never sent on its own.
    setSaveState((old) => Object.values(old).some((state) => state.status === "offline")
      ? Object.fromEntries(Object.entries(old).map(([id, state]) => [id, state.status === "offline" ? { status: "unsaved" } : state]))
      : old);
  }
  return {
    receive,
    blockRevisions: () => Object.fromEntries(revisions.current),
    readBlocks: () => current.current,
    async flush() {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      for (const id of pending.current.keys()) {
        if (["failed", "offline", "conflict", "unsaved"].includes(saveState[id]?.status ?? ""))
          throw new Error("Save or resolve your current edits before adding a block.");
        await save(id, true);
      }
      if (pending.current.size || busy.current.size)
        throw new Error("Save or resolve your current edits before adding a block.");
    },
    blocks,
    saveState,
    revision,
    workingRevisionId,
    structureState,
    structureConflict,
    async reloadStructure() {
      const fresh = await contentApi.document(pageId);
      adopt(fresh);
      if (structureConflictBlock.current) status(structureConflictBlock.current, { status: "idle" });
      structureConflictBlock.current = undefined;
      setStructureConflict(null);
    },
    setFirstBlockDirty,
    hasUnsavedChanges: firstBlockDirty || structureState === "saving" || structureConflict !== null || pending.current.size > 0 || busy.current.size > 0,
    setRevision: updateRevision,
    change,
    structure,
    retry: save,
    resolve,
  };
}
