"use client";

/** Check or uncheck every contact in the surrounding form. */
export function PickAll() {
  const set = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="contactId"]').forEach((i) => { i.checked = on; });
  };
  return (
    <span className="row">
      <button type="button" className="btn btn-sm btn-ghost" onClick={set(true)}>All</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={set(false)}>None</button>
    </span>
  );
}
