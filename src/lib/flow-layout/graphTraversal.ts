import {
  LayoutStep,
  ElkEdgeSectionLike,
  Position,
  normalizeElkRoute,
  routePointFromElk
} from "./normalize";
import { rolePriority } from "./constants";

export function orderedStepsForElk(steps: LayoutStep[]): LayoutStep[] {
  return [...steps].sort((left, right) => {
    const leftPriority = rolePriority[left.role] ?? 99;
    const rightPriority = rolePriority[right.role] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftX = left.position?.x ?? 0;
    const rightX = right.position?.x ?? 0;
    if (leftX !== rightX) {
      return leftX - rightX;
    }

    const leftY = left.position?.y ?? 0;
    const rightY = right.position?.y ?? 0;
    if (leftY !== rightY) {
      return leftY - rightY;
    }

    return left.id.localeCompare(right.id);
  });
}

export function routeFromElkSections(sections: ElkEdgeSectionLike[]): Position[] {
  if (sections.length === 0) {
    return [];
  }

  const points: Position[] = [];

  for (const section of orderElkSections(sections)) {
    const start = routePointFromElk(section.startPoint);
    if (start) {
      points.push(start);
    }

    for (const bend of section.bendPoints ?? []) {
      const bendPoint = routePointFromElk(bend);
      if (bendPoint) {
        points.push(bendPoint);
      }
    }

    const end = routePointFromElk(section.endPoint);
    if (end) {
      points.push(end);
    }
  }

  return normalizeElkRoute(points);
}

function orderElkSections(sections: ElkEdgeSectionLike[]): ElkEdgeSectionLike[] {
  if (sections.length <= 1) {
    return sections;
  }

  const byId = new Map<string, ElkEdgeSectionLike>();
  for (const section of sections) {
    if (!section.id) {
      return sections;
    }
    byId.set(section.id, section);
  }

  if (byId.size !== sections.length) {
    return sections;
  }

  const start =
    sections.find((section) => {
      const incoming = section.incomingSections ?? [];
      return incoming.length === 0;
    }) ?? sections[0];

  const ordered: ElkEdgeSectionLike[] = [];
  const visited = new Set<string>();
  let current: ElkEdgeSectionLike | undefined = start;

  while (current?.id && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);

    const nextId: string | undefined = (current.outgoingSections ?? []).find(
      (outgoingId: string) => byId.has(outgoingId) && !visited.has(outgoingId)
    );
    current = nextId ? byId.get(nextId) : undefined;
  }

  for (const section of sections) {
    if (!ordered.includes(section)) {
      ordered.push(section);
    }
  }

  return ordered;
}
