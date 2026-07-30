export interface Handoff {
  from: string;
  to: string;
  task: string;
  stateRevision: number;
}

export function handoff(from: string, to: string, task: string, stateRevision: number): Handoff {
  if (!from || !to || from === to) throw new Error("Handoff needs two distinct agents");
  return { from, to, task, stateRevision };
}
