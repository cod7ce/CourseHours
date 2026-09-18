import type { RouteObject } from 'react-router';
import { Today } from './Today';
import { Rollcall } from './Rollcall';
import { Schedule } from './Schedule';
import { Scheduling } from './Scheduling';
import { Students } from './Students';
import { StudentDetail } from './StudentDetail';
import { Recharge } from './Recharge';
import { Reports } from './Reports';
import { Classes } from './Classes';
import { ClassDetail } from './ClassDetail';
import { Ledger } from './Ledger';
import { Settings } from './Settings';

export const routes: RouteObject[] = [
  { index: true, element: <Today /> },
  { path: 'sessions/:id/roll-call', element: <Rollcall /> },
  { path: 'schedule', element: <Schedule /> },
  { path: 'schedule/planning', element: <Scheduling /> },
  { path: 'students', element: <Students /> },
  { path: 'students/:id', element: <StudentDetail /> },
  { path: 'students/:id/recharge', element: <Recharge /> },
  { path: 'reports', element: <Reports /> },
  { path: 'classes', element: <Classes /> },
  { path: 'classes/:id', element: <ClassDetail /> },
  { path: 'ledger', element: <Ledger /> },
  { path: 'settings/:section', element: <Settings /> },
  { path: 'settings', element: <Settings /> },
];
