import { useState } from "react";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
import { mutate, operationKey, errorMessage } from "../../../../client/transport";

/** Whether the member has favourited or is watching this page, and the two toggles. */
export function usePageFollowing(pageId: string) {
  const {navigation:resource} = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  // A database's page is favourited as its database (SL1: its More menu is the database's favourite).
  const favourite = resource.data?.favourites.some((item) => item.kind !== "container" && item.pageId === pageId) ?? false;
  const watched = resource.data?.watches.includes(pageId) ?? false;
  async function refresh() {
    setPending(true);
    try { await resource.reload(); } finally { setPending(false); }
  }
  async function toggle(kind: "watch" | "favourite", enabled: boolean) {
    setPending(true);
    setError(undefined);
    try {
      await mutate(
        `/api/navigation/${kind === "watch" ? "watches" : "favourites"}`,
        { operationKey: operationKey(), ...(kind === "watch" ? { pageId } : { id: pageId, kind: "page" }), enabled },
        "PUT",
      );
      await resource.reload();

    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  return {
    favourite,
    watched,
    disabled: pending || !resource.data,
    error: error || resource.error ? errorMessage(error || resource.error) : null,
    refresh,
    toggleFavourite: () => toggle("favourite", !favourite),
    toggleWatch: () => toggle("watch", !watched),
  };
}
