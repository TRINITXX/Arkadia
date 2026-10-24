/**
 * Runs `task` one call at a time. A trigger while it runs queues exactly one
 * more run, started when the current one ends: runs never overlap, so their
 * results cannot land out of order, and the last trigger is always followed by
 * a run that starts after it.
 */
export function coalescedRunner(task: () => Promise<void>): () => void {
  let running = false;
  let again = false;
  const run = () => {
    running = true;
    void task()
      .catch(() => {})
      .finally(() => {
        if (again) {
          again = false;
          run();
        } else {
          running = false;
        }
      });
  };
  return () => {
    if (running) {
      again = true;
      return;
    }
    run();
  };
}
