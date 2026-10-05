// The instruction list's server actions. The hydration contract performs no write,
// so any call is a contract failure rather than a silent network stand-in.
function unexpectedCall(name: string): never {
  throw new Error(`${name} is not part of the instruction hydration contract`);
}

export const getJobInstructionItems = (): never => unexpectedCall('getJobInstructionItems');
export const getProjectInstructionItems = (): never => unexpectedCall('getProjectInstructionItems');
export const createJobInstructionItem = (): never => unexpectedCall('createJobInstructionItem');
export const createProjectInstructionItem = (): never => unexpectedCall('createProjectInstructionItem');
export const updateJobInstructionItemContent = (): never => unexpectedCall('updateJobInstructionItemContent');
export const deleteJobInstructionItem = (): never => unexpectedCall('deleteJobInstructionItem');
export const toggleJobInstructionItemCompletion = (): never =>
  unexpectedCall('toggleJobInstructionItemCompletion');
export const reorderJobInstructionItems = (): never => unexpectedCall('reorderJobInstructionItems');
export const reorderProjectInstructionItems = (): never => unexpectedCall('reorderProjectInstructionItems');
export const updateInstructionItemDetails = (): never => unexpectedCall('updateInstructionItemDetails');
