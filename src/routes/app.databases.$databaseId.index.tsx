import { createFileRoute } from "@tanstack/react-router";
/** The database at rest; its layout route draws it. */
export const Route = createFileRoute("/app/databases/$databaseId/")({});
