import type { Container } from "./ContainerWorkspace";
const switchLabel = (value: string) => (value === "allowed" ? "Allowed" : "Forbidden");
/** CONT-001 — the attributes every container carries, read from its own record. */
export function ContainerIdentity({ container }: { container: Container }) {
  const rows: [string, string][] = [
    ["Identifier", container.id],
    ["Key", container.key ?? "None"],
    ["Icon", container.icon ?? "None"],
    ["Name", container.name],
    ["Description", container.description || "None"],
    ["Owners", container.owners.map((owner) => owner.displayName).join(", ") || "None"],
    ["Visibility", container.visibility],
    ["Guest access", switchLabel(container.guestAccess)],
    ["Public link access", switchLabel(container.publicLinkAccess)],
    ["Anonymous access", switchLabel(container.anonymousAccess)],
  ];
  return (
    <section className="space-identity" aria-label="Space identity">
      <h4>Space identity</h4>
      <dl>
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
