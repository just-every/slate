import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
import type { usePageEditor } from "../../../../client/usePageEditor";
import { errorMessage } from "../../../../client/transport";
import { newBlock } from "../../../editor/ui/newBlock";
import type { EditorBlock } from "../../../editor/ui/types";
import { recoverInsertion, sameBlock } from "./insertionRecovery";

/** Keep the editable mounted while its creation and the latest typing commit. */
export function usePageInsertion(pageId: string, editor: ReturnType<typeof usePageEditor>) {
  const { member } = useWorkspace();
  const key = `slate:insertion:${member.workspaceId}:${member.id}:${pageId}`;
  const legacyKey = `slate:first-block:${member.id}:${pageId}`;
  const [recovered] = useState<{blocks: EditorBlock[]; expected?: Record<string, string>} | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    const stored = sessionStorage.getItem(key), legacy = sessionStorage.getItem(legacyKey);
    try {
      const parsed = stored ? JSON.parse(stored) : legacy ? [JSON.parse(legacy)] : null;
      const recovered = Array.isArray(parsed) ? {blocks: parsed as EditorBlock[]} : parsed as {blocks: EditorBlock[]; expected?: Record<string, string>} | null;
      // A response can be interrupted after the server committed the creation.
      if (recovered && !recoverInsertion(recovered.blocks, editor.blocks, recovered.expected, editor.blockRevisions()).pending) {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(legacyKey);
        return null;
      }
      return recovered;
    }
    catch { return null; }
  });
  const [draft, setDraft] = useState<EditorBlock[] | null>(recovered?.blocks ?? null);
  const [error, setError] = useState<string | undefined>(draft ? "Unsaved inserted blocks were recovered on this device. Try saving them again." : undefined);
  const current = useRef(draft), busy = useRef(false), alive = useRef(true);
  const recovering = useRef(Boolean(recovered));
  const latestEditor = useRef(editor); latestEditor.current = editor;
  const expected = useRef<Record<string, string> | undefined>(recovered?.expected);
  const baseline = useRef(editor.readBlocks());
  const [empty] = useState(() => newBlock("text", `first-${pageId}`));
  const recovery = recovering.current && draft ? recoverInsertion(draft, editor.blocks, expected.current, editor.blockRevisions()) : null;
  useEffect(() => {
    if (recovery && !recovery.pending && !busy.current) {
      remember(null);
      recovering.current = false;
      setError(undefined);
    }
  }, [draft, editor.blocks]);
  useEffect(() => {
    alive.current = true;
    latestEditor.current.setFirstBlockDirty(Boolean(current.current));
    const prevent = (event: BeforeUnloadEvent) => {
      if (current.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", prevent);
    return () => { alive.current = false; window.removeEventListener("beforeunload", prevent); };
  }, [pageId]);
  function remember(blocks: EditorBlock[] | null) {
    current.current = blocks;
    latestEditor.current.setFirstBlockDirty(Boolean(blocks));
    if (alive.current) setDraft(blocks);
    try {
      if (blocks) sessionStorage.setItem(key, JSON.stringify({blocks, expected: expected.current}));
      else { sessionStorage.removeItem(key); sessionStorage.removeItem(legacyKey); }
    } catch {
      setError("This browser could not keep a recovery copy. Keep this tab open until your blocks are saved.");
    }
  }
  async function save() {
    if (busy.current || !current.current) return;
    busy.current = true;
    setError(undefined);
    try {
      // Enter may follow the last keystroke before its debounce or receipt.
      await latestEditor.current.flush();
      if (recovering.current) {
        const recovered = recoverInsertion(current.current!, latestEditor.current.readBlocks(), expected.current, latestEditor.current.blockRevisions());
        if (recovered.conflicts.length) throw new Error("Recovered blocks conflict with saved changes. Copy your recovered content or use the saved blocks.");
        if (!recovered.pending) { remember(null); recovering.current = false; return; }
        remember(recovered.blocks);
        // Only adopted saved content receives fresh revisions. Conflicting
        // recovered content above can never be retried against a newer version.
        expected.current = latestEditor.current.blockRevisions();
      }
      if (!error) {
        const saved = latestEditor.current.readBlocks();
        remember(current.current!.map(block => sameBlock(block, baseline.current.find(item => item.id === block.id)) ? saved.find(item => item.id === block.id) ?? block : block));
        expected.current = latestEditor.current.blockRevisions();
      }
      let sent: EditorBlock[];
      do {
        sent = current.current!;
        const committed = await latestEditor.current.structure(sent, expected.current);
        if (!alive.current) return;
        const saved = latestEditor.current.readBlocks();
        const versions = latestEditor.current.blockRevisions();
        expected.current = Object.fromEntries(committed.map(block => [block.id, block.revisionId]));
        // Keep typing made during the request, and adopt unchanged neighbours.
        remember(current.current!.map(block => {
          if (!sameBlock(block, sent.find(item => item.id === block.id))) return block;
          const fresh = saved.find(item => item.id === block.id);
          if (fresh) expected.current![block.id] = versions[block.id];
          return fresh ?? block;
        }));
        // More Enter presses can add blocks while creation is in transport.
      } while (current.current!.some((block, index) => block.id !== sent[index]?.id || block.type !== sent[index]?.type) || current.current!.length !== sent.length);
      for (const block of current.current!) {
        if (!sameBlock(block, sent.find(item => item.id === block.id)))
          latestEditor.current.change(block.id, block, expected.current?.[block.id]);
      }
      remember(null);
      recovering.current = false;
    } catch (cause) {
      recovering.current = true;
      if (alive.current) setError(errorMessage(cause));
    } finally { busy.current = false; }
  }
  function insert(blocks: EditorBlock[]) {
    if (recovery?.conflicts.length) return;
    if (!current.current) {
      expected.current = latestEditor.current.blockRevisions();
      baseline.current = latestEditor.current.readBlocks();
    }
    remember(blocks);
    if (!error) void save();
  }
  function change(id: string, block: EditorBlock) {
    if (current.current) remember(current.current.map(item => item.id === id ? block : item));
    else if (!latestEditor.current.blocks.length) insert([block]);
    else latestEditor.current.change(id, block);
  }
  return {
    blocks: recovery ? (recovery.blocks.length ? recovery.blocks : [empty]) : draft ?? (editor.blocks.length ? editor.blocks : [empty]),
    readBlocks: () => current.current ?? (latestEditor.current.readBlocks().length ? latestEditor.current.readBlocks() : [empty]),
    pending: draft !== null,
    conflicts: recovery?.conflicts ?? [],
    error,
    insert,
    change,
    retry: save,
    discard() { remember(null); recovering.current = false; setError(undefined); },
  };
}
