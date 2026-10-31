import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentReceipt } from "./content";
import { ApiError, mutate, operationKey } from "./transport";

/** Form values belong to the revision loaded with them, including during live refreshes. */
export function usePageRevisionSave(revision: string) {
  const expected = useRef(revision);
  const [conflict, setConflict] = useState(false);
  const advance = useCallback((from: string, to: string) => {
    // A local receipt may follow these choices, but must not bridge an unseen
    // remote revision. Live reads alone never advance a pending form's revision.
    if (expected.current === from) expected.current = to;
  }, []);
  async function save(path: string, fields: object, method = "POST") {
    try {
      const result = await mutate<ContentReceipt>(path, {
        operationKey: operationKey(), ...fields, expectedRevisionId: expected.current,
      }, method);
      expected.current = result.value.revisionId;
      setConflict(false);
      return result;
    } catch (cause) {
      setConflict(cause instanceof ApiError && cause.status === 409);
      throw cause;
    }
  }
  return { save, conflict, advance, begin(value: string) { expected.current = value; setConflict(false); } };
}

export function usePagePropertySave(pageId: string, revision: string, followOwnTextSaves = false) {
  const pending = usePageRevisionSave(revision);
  const { advance } = pending;
  useEffect(() => {
    if (!followOwnTextSaves) return;
    const saved = (event: Event) => {
      const receipt = (event as CustomEvent<{ pageId: string; previousRevisionId: string; revisionId: string }>).detail;
      if (receipt?.pageId === pageId) advance(receipt.previousRevisionId, receipt.revisionId);
    };
    window.addEventListener("slate:page-text-saved", saved);
    return () => window.removeEventListener("slate:page-text-saved", saved);
  }, [pageId, followOwnTextSaves, advance]);
  return { conflict: pending.conflict, save: (properties: object) => pending.save(`/api/pages/${pageId}`, { properties }, "PATCH") };
}
