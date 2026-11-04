// Embedded sample (SPEC §13): a furnace maintenance turnaround modelled on a real schedule (task names, durations,
// FS/SS/lag/lead structure), on the app's 7-day calendar. The project, people, contractors and tags are made up.
// Shared by "Try with sample data" and scripts/make-sample.ts.
import type { Holiday, ISODate, Project, Resource, Task } from '../engine/types';

export const SAMPLE_STATUS_DATE: ISODate = '2026-09-30';

export const sampleProject: Project = {
  name: 'PM (3Y) F-101',
  owner: 'Sunisa R.',
  projectStart: '2026-09-28',
  statusDate: SAMPLE_STATUS_DATE,
  mode: 'Track',
};

export const sampleResources: Resource[] = [
  { name: 'ACME', type: 'Contractor' },
  { name: 'Refracto', type: 'Contractor' },
  { name: 'ThermCo', type: 'Contractor' },
  { name: 'ScaffCo', type: 'Contractor' },
  { name: 'VesselCo', type: 'Contractor' },
  { name: 'ValveCo', type: 'Contractor' },
  { name: 'NDT', type: 'Team' },
  { name: 'Inst', type: 'Team' },
  { name: 'QC', type: 'Team' },
];

export const sampleHolidays: Holiday[] = [
  { date: '2026-10-13', description: 'วันนวมินทรมหาราช' },
  { date: '2026-10-23', description: 'วันปิยมหาราช' },
];

const task = (id: number, name: string, area: string, fields: Partial<Task>): Task => ({
  id,
  name,
  assigned: [],
  predecessorsText: '',
  progress: 0,
  remarks: '',
  extra: { Area: area },
  ...fields,
});

const done = (start: ISODate, finish: ISODate = start): Partial<Task> => ({
  actualStart: start,
  actualFinish: finish,
  progress: 100,
});

export const sampleTasks: Task[] = [
  task(1, 'Shutdown: unit handed over to maintenance', 'Initial work', { plannedDuration: 0, ...done('2026-09-28') }),
  task(2, 'Install blind', 'Initial work', { assigned: ['ACME'], predecessorsText: '1', plannedDuration: 1, ...done('2026-09-28') }),
  task(3, 'Open manhole', 'Initial work', { assigned: ['ACME'], predecessorsText: '2SS', plannedDuration: 1, ...done('2026-09-28') }),
  task(4, 'As-found inspection and air leak test', 'Initial work', { predecessorsText: '3SS', plannedDuration: 1, ...done('2026-09-28') }),
  task(5, 'Remove thermowell at upper manhole (TE-101, AT-102)', 'Initial work', {
    assigned: ['Inst', 'QC'],
    predecessorsText: '4SS',
    plannedDuration: 1,
    ...done('2026-09-28', '2026-09-29'),
    remarks: 'Thermowell ติดแน่น ต้องใช้เวลาถอดเพิ่ม 1 วัน',
  }),
  task(6, 'Install scaffold internal (night shift)', 'Initial work', {
    assigned: ['ScaffCo'],
    predecessorsText: '5',
    plannedDuration: 2,
    ...done('2026-09-30'),
  }),
  task(7, 'Calibrate instruments and inspection valves', 'Initial work', {
    assigned: ['Inst'],
    predecessorsText: '5',
    plannedDuration: 14,
    actualStart: '2026-09-30',
    progress: 5,
    remarks: 'Waiting for calibration kit from vendor',
  }),
  task(8, 'Remove refractory module for inspection', 'Furnace internal', { assigned: ['Refracto'], predecessorsText: '6', plannedDuration: 1 }),
  task(9, 'Inspect radiant coil per ITP (replica, PT)', 'Furnace internal', { assigned: ['NDT'], predecessorsText: '8', plannedDuration: 2 }),
  task(10, 'Remove insulation of convection coil cover box', 'Convection coil', {
    assigned: ['ThermCo'],
    predecessorsText: '1',
    plannedDuration: 2,
    ...done('2026-09-28', '2026-09-29'),
  }),
  task(11, 'Open cover box, convection coil', 'Convection coil', {
    assigned: ['ACME'],
    predecessorsText: '10',
    plannedDuration: 3,
    actualStart: '2026-09-30',
    progress: 40,
  }),
  task(12, 'UTM inspection at convection coil elbows', 'Convection coil', { assigned: ['NDT'], predecessorsText: '11', plannedDuration: 3 }),
  task(13, 'Close cover box, convection coil', 'Convection coil', { assigned: ['ACME'], predecessorsText: '12', plannedDuration: 2 }),
  task(14, 'Remove insulation of small-bore piping, crossover line', 'Crossover line', {
    assigned: ['ThermCo'],
    predecessorsText: '2',
    plannedDuration: 1,
    remarks: 'ThermCo crew moved to the convection coil first',
  }),
  task(15, 'Isolate blind, steam drum', 'Steam drum D-101', {
    assigned: ['VesselCo'],
    predecessorsText: '2FS+1',
    plannedDuration: 1,
    ...done('2026-09-30'),
  }),
  task(16, 'Air ventilation, steam drum', 'Steam drum D-101', {
    assigned: ['VesselCo'],
    predecessorsText: '15SS',
    plannedDuration: 3,
    actualStart: '2026-09-30',
    progress: 50,
  }),
  task(17, 'External visual inspection, steam drum', 'Steam drum D-101', {
    assigned: ['VesselCo'],
    predecessorsText: '16FS-1',
    plannedDuration: 1,
  }),
  task(18, 'Overhaul PSV-101/102/103', 'Steam drum D-101', {
    assigned: ['ValveCo'],
    predecessorsText: '17SS',
    plannedDuration: 5,
    actualStart: '2026-09-30',
    progress: 10,
    remarks: 'PSVs removed early, during blinding',
  }),
  task(19, 'Hydrostatic test, steam drum', 'Steam drum D-101', { assigned: ['VesselCo'], predecessorsText: '18', plannedDuration: 1 }),
  task(20, 'Inspection complete', 'Close out', { predecessorsText: '9, 13, 19', plannedDuration: 0 }),
  task(21, 'Install insulation of convection coil cover box', 'Close out', { assigned: ['ThermCo'], predecessorsText: '20', plannedDuration: 3 }),
  task(22, 'Remove scaffold internal', 'Close out', { assigned: ['ScaffCo'], predecessorsText: '20', plannedDuration: 1 }),
  task(23, 'Box up', 'Close out', { assigned: ['ACME'], predecessorsText: '21, 22', plannedDuration: 2 }),
  task(24, 'SIF proof test', 'Close out', { assigned: ['Inst'], predecessorsText: '23SS+1, 7', plannedDuration: 2 }),
  task(25, 'Handover to operations', 'Close out', { predecessorsText: '23, 24', plannedDuration: 0 }),
];

export const sampleData = {
  project: sampleProject,
  tasks: sampleTasks,
  resources: sampleResources,
  holidays: sampleHolidays,
};
