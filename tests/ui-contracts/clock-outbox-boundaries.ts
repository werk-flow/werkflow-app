// The clock's outbox code as a chunk the network can fail to deliver: the contract sets
// `contractOutboxGone` before the app starts, and the page's lazy load of the outbox rejects.
declare global {
  interface Window {
    contractOutboxGone?: boolean;
  }
}

if (window.contractOutboxGone) throw new TypeError('Failed to fetch dynamically imported module');

export * from '@/components/clock-unsent-events';
export { default } from '@/components/clock-unsent-events';
