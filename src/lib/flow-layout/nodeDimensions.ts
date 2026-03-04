import { DEFAULT_NODE_HEIGHT } from "./constants";

export const DELEGATION_SPINE_HEIGHT = 8;
export const DELEGATION_CARD_HEIGHT_BASE = 56;
export const DELEGATION_CARD_ROW_HEIGHT = 24;
export const DELEGATION_BADGES_PER_ROW = 4;

export function delegationCardHeight(delegationCount: number): number {
  const visibleCount = Math.min(delegationCount, 6);
  const hasOverflow = delegationCount > 6;
  const totalBadges = visibleCount + (hasOverflow ? 1 : 0);
  const rows = Math.ceil(totalBadges / DELEGATION_BADGES_PER_ROW);
  if (rows <= 1) return DELEGATION_CARD_HEIGHT_BASE;
  return DELEGATION_CARD_HEIGHT_BASE + (rows - 1) * DELEGATION_CARD_ROW_HEIGHT;
}

interface DelegationAwareNode {
  enableDelegation?: boolean;
  delegationCount?: number | null;
}

export function hasDelegationCard(node: DelegationAwareNode): boolean {
  return Boolean(node.enableDelegation && (node.delegationCount ?? 0) > 0);
}

export function layoutNodeVisualHeight(node: DelegationAwareNode): number {
  return hasDelegationCard(node)
    ? DEFAULT_NODE_HEIGHT + DELEGATION_SPINE_HEIGHT + delegationCardHeight(node.delegationCount ?? 0)
    : DEFAULT_NODE_HEIGHT;
}
