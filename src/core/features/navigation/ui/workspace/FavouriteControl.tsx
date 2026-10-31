import { Star } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
import { mutate, operationKey, errorMessage } from "../../../../client/transport";

/** A favourite toggle for a space. */
export function FavouriteControl({ kind, id, className }: { kind: "page" | "container"; id: string; className?: string }) {
  const { navigation:resource } = useWorkspace();
  const [error, setError] = useState<unknown>();
  const enabled = resource.data?.favourites.some((item) => item.kind === kind && item.id === id) ?? false;
  const label = enabled ? "Remove from favourites" : "Add to favourites";
  const toggle = () =>
    void mutate("/api/navigation/favourites", { operationKey: operationKey(), kind, id, enabled: !enabled }, "PUT")
      .then(() => {
        window.dispatchEvent(new Event("slate:navigation-changed"));
      })
      .catch(setError);
  return (
    <>
      <button className={className} aria-pressed={enabled} disabled={!resource.data} onClick={toggle}>
        <Star aria-hidden="true" fill={enabled ? "currentColor" : "none"} />
        {label}
      </button>
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
    </>
  );
}
