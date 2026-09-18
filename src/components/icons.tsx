import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number; sw?: number };
const base = (size: number, sw: number, rest: P) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...rest,
});

export const IconClock = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
export const IconCalendar = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M8 2.5v4M16 2.5v4M3 9.5h18" /></svg>;
export const IconStudents = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><circle cx="9.5" cy="8.5" r="3.6" /><path d="M3 20c0-3.5 2.9-5.6 6.5-5.6s6.5 2.1 6.5 5.6" /><path d="M17 7.4a3.1 3.1 0 0 1 0 6" /><path d="M18.4 15.2c1.9.7 3 2.2 3 4.3" /></svg>;
export const IconGrid = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><rect x="3" y="3" width="7.5" height="7.5" rx="1.8" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8" /></svg>;
export const IconList = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" /></svg>;
export const IconChart = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><path d="M3 20h18" /><path d="M6.5 20v-6M12 20v-11M17.5 20v-4" /></svg>;
export const IconGear = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7M18.6 18.6l-1.7-1.7M7.1 7.1L5.4 5.4" /></svg>;
export const IconSearch = ({ size = 15, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>;
export const IconBack = ({ size = 13, sw = 2, ...r }: P) => <svg {...base(size, sw, r)}><path d="M15 5l-7 7 7 7" /></svg>;
export const IconNext = ({ size = 15, sw = 2, ...r }: P) => <svg {...base(size, sw, r)}><path d="M9 5l7 7-7 7" /></svg>;
export const IconCheck = ({ size = 13, sw = 2.2, ...r }: P) => <svg {...base(size, sw, r)}><path d="M4.5 12.5l5 5 10-11" /></svg>;
export const IconInfo = ({ size = 15, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M12 11.5v5" /></svg>;
export const IconWarn = ({ size = 15, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5h.01" /></svg>;
export const IconPlus = ({ size = 15, sw = 2, ...r }: P) => <svg {...base(size, sw, r)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconMinus = ({ size = 15, sw = 2, ...r }: P) => <svg {...base(size, sw, r)}><path d="M5 12h14" /></svg>;
export const IconClose = ({ size = 15, sw = 2, ...r }: P) => <svg {...base(size, sw, r)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconDownload = ({ size = 15, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><path d="M12 4v11M7 10l5 5 5-5M4 19h16" /></svg>;
export const IconUndo = ({ size = 14, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>;
export const IconEdit = ({ size = 14, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-3L17 5a2 2 0 0 0-3 0L4 15.5z" /><path d="M13 7l4 4" /></svg>;
export const IconFolder = ({ size = 15, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
export const IconShield = ({ size = 15, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;
export const IconBell = ({ size = 15, sw = 1.8, ...r }: P) => <svg {...base(size, sw, r)}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
export const IconEye = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>;
export const IconEyeOff = ({ size = 16, sw = 1.7, ...r }: P) => <svg {...base(size, sw, r)}><path d="M3 3l18 18" /><path d="M10.6 5.8A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4" /><path d="M6.6 6.6A16.6 16.6 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.3-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;
