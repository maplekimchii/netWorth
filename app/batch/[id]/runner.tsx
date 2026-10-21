"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pendingJobItems, runJobItem } from "@/app/actions";

const PARALLEL = 3;

/** Works through a running job's pending items from the browser. Closing the tab pauses; reopening resumes. */
export function Runner({ jobId, running }: { jobId: number; running: boolean }) {
  const router = useRouter();
  const [active, setActive] = useState(running);
  const stop = useRef(false);

  useEffect(() => {
    if (!active) return;
    stop.current = false;
    (async () => {
      const queue = await pendingJobItems(jobId);
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined && !stop.current; id = queue.shift()) {
          await runJobItem(id);
          router.refresh();
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      setActive(false);
      router.refresh();
    })();
    return () => { stop.current = true; };
  }, [active, jobId, router]);

  if (!running) return null;
  return active
    ? <button type="button" className="btn btn-sm" onClick={() => { stop.current = true; setActive(false); }}>Pause</button>
    : <button type="button" className="btn btn-sm btn-primary" onClick={() => setActive(true)}>Resume</button>;
}
