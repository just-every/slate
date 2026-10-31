import { createFileRoute } from "@tanstack/react-router";
/** A record at its one address; its database's layout route draws it with the list kept mounted. */
export const Route = createFileRoute("/app/databases/$databaseId/records/$recordId")({});
