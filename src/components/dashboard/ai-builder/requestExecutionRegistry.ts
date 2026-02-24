const inFlightRequestExecutions = new Map<string, Promise<void>>();

function normalizeRequestId(requestId: string): string {
  return requestId.trim();
}

export interface FlowBuilderRequestExecution {
  joinedExisting: boolean;
  promise: Promise<void>;
}

export function executeFlowBuilderRequestOnce(
  requestId: string,
  execute: () => Promise<void>
): FlowBuilderRequestExecution {
  const normalizedRequestId = normalizeRequestId(requestId);
  if (normalizedRequestId.length === 0) {
    return {
      joinedExisting: false,
      promise: Promise.resolve(execute())
    };
  }

  const existingExecution = inFlightRequestExecutions.get(normalizedRequestId);
  if (existingExecution) {
    return {
      joinedExisting: true,
      promise: existingExecution
    };
  }

  const execution = Promise.resolve(execute())
    .finally(() => {
      if (inFlightRequestExecutions.get(normalizedRequestId) === execution) {
        inFlightRequestExecutions.delete(normalizedRequestId);
      }
    });

  inFlightRequestExecutions.set(normalizedRequestId, execution);
  return {
    joinedExisting: false,
    promise: execution
  };
}

export function clearFlowBuilderRequestExecutionsForTest(): void {
  inFlightRequestExecutions.clear();
}
