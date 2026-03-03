import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Re-export shared error utility with a dashboard-friendly default. */
export { getErrorDetail as getErrorMessage } from '@autonomy/shared';
