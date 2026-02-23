export const POTENTIAL_DISPATCH_ROUTE_PREFIX = "potential-dispatch:";

export interface PotentialDispatchRouteIdParts {
  orchestratorId: string;
  targetNodeId: string;
}

export function buildPotentialDispatchRouteId(orchestratorId: string, targetNodeId: string): string {
  return `${POTENTIAL_DISPATCH_ROUTE_PREFIX}${orchestratorId}:${targetNodeId}`;
}

export function parsePotentialDispatchRouteId(routeId: string): PotentialDispatchRouteIdParts | null {
  if (!routeId.startsWith(POTENTIAL_DISPATCH_ROUTE_PREFIX)) {
    return null;
  }

  const payload = routeId.slice(POTENTIAL_DISPATCH_ROUTE_PREFIX.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= payload.length - 1) {
    return null;
  }

  const orchestratorId = payload.slice(0, separatorIndex).trim();
  const targetNodeId = payload.slice(separatorIndex + 1).trim();
  if (orchestratorId.length === 0 || targetNodeId.length === 0) {
    return null;
  }

  return {
    orchestratorId,
    targetNodeId
  };
}
