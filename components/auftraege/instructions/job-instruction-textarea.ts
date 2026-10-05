/** Fits a textarea to its content, so an instruction row grows with its text. */
export function resizeTextareaElement(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  textarea.style.height = '0px';
  textarea.style.height = `${textarea.scrollHeight}px`;
}
