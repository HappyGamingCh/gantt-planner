import { createCalendar } from '../../src/engine/calendar';
import { compute } from '../../src/engine/compute';
import type { ComputeResult, ISODate, Project, Resource, Task, TaskResult } from '../../src/engine/types';

// Reference dates (2026): Project Start Mon 2 Nov, status date Fri 13 Nov. Every day is a working day
// (weekends included) unless a test passes holidays.

export function makeTask(id: number, fields: Partial<Task> = {}): Task {
  return { id, name: `Task ${id}`, assigned: [], predecessorsText: '', progress: 0, remarks: '', extra: {}, ...fields };
}

export function makeProject(fields: Partial<Project> = {}): Project {
  return { name: 'Test', owner: '', projectStart: '2026-11-02', statusDate: '2026-11-13', mode: 'Plan', ...fields };
}

export function run(
  tasks: Task[],
  project: Partial<Project> = {},
  holidays: ISODate[] = [],
  resources: Resource[] = [],
): ComputeResult {
  return compute(makeProject(project), tasks, createCalendar(holidays), resources);
}

export function taskOf(result: ComputeResult, id: number): TaskResult {
  const task = result.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not in result`);
  return task;
}

export function issuesOf(result: ComputeResult, taskId?: number) {
  return result.issues.filter((i) => taskId === undefined || i.taskId === taskId).map((i) => i.code);
}
