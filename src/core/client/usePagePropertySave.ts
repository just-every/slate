import { useRef, useState } from "react";
import type { ContentReceipt } from "./content";
import { ApiError, mutate, operationKey } from "./transport";

/** Form values belong to the revision loaded with them, including during live refreshes. */
export function usePageRevisionSave(revision: string) {
  const expected = useRef(revision);
  const [conflict, setConflict] = useState(false);
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
  return { save, conflict, begin(value: string) { expected.current = value; setConflict(false); } };
}

export function usePagePropertySave(pageId: string, revision: string) {
  const pending = usePageRevisionSave(revision);
  return { conflict: pending.conflict, save: (properties: object) => pending.save(`/api/pages/${pageId}`, { properties }, "PATCH") };
}
