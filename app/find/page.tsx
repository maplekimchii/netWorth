import { requireUser } from "@/lib/session";
import { FindClient } from "./find-client";

export const metadata = { title: "Find people" };

export default async function Find() {
  await requireUser();
  return (
    <div className="page-narrow">
      <div className="page-head">
        <div><h1>Find people</h1><p className="sub">AI searches the public web for people at a company. Check each source before reaching out.</p></div>
      </div>
      <FindClient />
    </div>
  );
}
