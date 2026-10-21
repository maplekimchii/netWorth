import { FIELDS } from "@/lib/importers";
import { requireUser } from "@/lib/session";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import / Export" };

export default async function ImportPage() {
  await requireUser();
  return (
    <div className="page-narrow">
      <div className="page-head">
        <div><h1>Import / Export</h1><p className="sub">Duplicates (same name at the same company) are skipped automatically.</p></div>
      </div>
      <ImportClient fields={FIELDS} />
    </div>
  );
}
