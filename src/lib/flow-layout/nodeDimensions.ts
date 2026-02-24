import { DEFAULT_NODE_HEIGHT } from "./constants";

export const DELEGATION_SPINE_HEIGHT = 8;
export const DELEGATION_CARD_HEIGHT = 56;

interface DelegationAwareNode {
  enableDelegation?: boolean;
  delegationCount?: number | null;
}

export function hasDelegationCard(node: DelegationAwareNode): boolean {
  return Boolean(node.enableDelegation && (node.delegationCount ?? 0) > 0);
}

export function layoutNodeVisualHeight(node: DelegationAwareNode): number {
  return hasDelegationCard(node)
    ? DEFAULT_NODE_HEIGHT + DELEGATION_SPINE_HEIGHT + DELEGATION_CARD_HEIGHT
    : DEFAULT_NODE_HEIGHT;
}
