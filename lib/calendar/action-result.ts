/** Convert a transport rejection into the same visible rollback path as a returned failure. */
export async function calendarActionResult<T extends { success: boolean }>(
  operation: () => Promise<T>,
): Promise<T | { success: false; error: 'calendar_transport_failed' }> {
  try {
    return await operation();
  } catch {
    return { success: false, error: 'calendar_transport_failed' };
  }
}
