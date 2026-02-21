import { HardDrive, Move, Share2, Trash2, Zap } from "lucide-react";
import { Badge } from "@/components/optics/badge";
import { AnthropicIcon, OpenAIIcon } from "@/components/optics/icons";
import { cn } from "@/lib/cn";
import type { ProviderId } from "@/lib/types";
import { DELEGATION_CARD_HEIGHT, DELEGATION_SPINE_HEIGHT, NODE_HEIGHT, NODE_WIDTH } from "../../useNodeLayout";
import { isMultiSelectModifier } from "../../selectionState";
import type { NodesLayerProps } from "./types";

const PORT_HIT_SIZE = 22;

const PROVIDER_META: Record<ProviderId, { label: string; Icon: typeof AnthropicIcon }> = {
  claude: { label: "Anthropic", Icon: AnthropicIcon },
  openai: { label: "OpenAI", Icon: OpenAIIcon }
};

export function NodesLayer({
  nodes,
  nodeById,
  selectedNodeId,
  selectedNodeIds,
  viewport,
  readOnly,
  onSelectionChange,
  onConnectNodes,
  onDeleteNodes,
  connectingState,
  setConnectingState,
  setDragState,
  toWorldPoint,
  nodeDragDidMoveRef,
  animatedNodeSet,
  glowReadySet
}: NodesLayerProps) {
  const selectedNodeSet = new Set(selectedNodeIds);

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        transformOrigin: "0 0"
      }}
    >
      {nodes.map((node) => {
        const providerMeta = PROVIDER_META[node.providerId];
        const ProviderIcon = providerMeta?.Icon;
        const isOrchestrator = node.role === "orchestrator";

        return (<div
          key={node.id}
            className={cn(
              "group pointer-events-auto absolute select-none rounded-2xl border bg-[var(--card-surface)] p-3 shadow-lg transition-colors ring-2 ring-transparent ring-offset-0",
              glowReadySet.has(node.id) && "node-border-glow",
              animatedNodeSet.has(node.id) && "glow-active",
              readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing",
              selectedNodeSet.has(node.id)
                ? selectedNodeId === node.id
                  ? "border-ember-500 ring-ember-500/40"
                  : "border-ember-400/80 ring-ember-500/30"
                : "border-[var(--card-border)] hover:border-[var(--card-border-hover)]"
            )}
          style={{
            left: node.position.x,
            top: node.position.y,
            width: NODE_WIDTH,
            height: NODE_HEIGHT
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            event.stopPropagation();
            if (readOnly) {
              onSelectionChange({
                nodeIds: [node.id],
                primaryNodeId: node.id,
                linkId: null
              });
              return;
            }

            const target = event.target as HTMLElement;
            if (target.closest("[data-node-control='true']")) {
              return;
            }

            const worldPoint = toWorldPoint(event);
            if (!worldPoint) {
              return;
            }

            if (isMultiSelectModifier(event)) {
              const nextSelection = selectedNodeSet.has(node.id)
                ? selectedNodeIds.filter((entry) => entry !== node.id)
                : [...selectedNodeIds, node.id];

              onSelectionChange({
                nodeIds: nextSelection,
                primaryNodeId: nextSelection.length > 0 ? nextSelection[nextSelection.length - 1] : null,
                linkId: null
              });
              return;
            }

            const dragNodeIds = selectedNodeSet.has(node.id) && selectedNodeIds.length > 1 ? selectedNodeIds : [node.id];
            const initialPositions = dragNodeIds
              .map((nodeId) => {
                const currentNode = nodeById.get(nodeId);
                if (!currentNode) {
                  return null;
                }

                return {
                  nodeId,
                  position: {
                    x: currentNode.position.x,
                    y: currentNode.position.y
                  }
                };
              })
              .filter((entry): entry is { nodeId: string; position: { x: number; y: number } } => entry !== null);

            if (initialPositions.length === 0) {
              return;
            }

            nodeDragDidMoveRef.current = false;
            onSelectionChange({
              nodeIds: dragNodeIds,
              primaryNodeId: node.id,
              linkId: null,
              isDragStart: true
            });

            setDragState({
              anchorNodeId: node.id,
              offsetX: worldPoint.x - node.position.x,
              offsetY: worldPoint.y - node.position.y,
              initialPositions
            });
          }}
        >
          <button
            type="button"
            aria-label={`Connect input to ${node.name}`}
            data-node-control="true"
            className={cn(
              "absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-opacity",
              connectingState?.targetNodeId === node.id
                ? "border-ember-400 bg-ember-500/25 opacity-100"
                : connectingState
                  ? "border-ember-300/70 bg-ember-500/15 opacity-100"
                  : "border-transparent bg-transparent opacity-0"
            )}
            style={{ width: PORT_HIT_SIZE, height: PORT_HIT_SIZE }}
            onPointerUp={(event) => {
              if (readOnly) {
                return;
              }

              event.stopPropagation();
              if (connectingState && connectingState.sourceNodeId !== node.id) {
                onConnectNodes(connectingState.sourceNodeId, node.id);
              }
              onSelectionChange({
                nodeIds: [node.id],
                primaryNodeId: node.id,
                linkId: null
              });
              setConnectingState(null);
            }}
          />

          <button
            type="button"
            aria-label={`Connect output from ${node.name}`}
            data-node-control="true"
            className={cn(
              "absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 rounded-full border transition-opacity",
              connectingState?.sourceNodeId === node.id
                ? "border-ember-600/80 bg-ember-700/20 opacity-100"
                : readOnly
                  ? "border-transparent bg-transparent opacity-0"
                  : "border-ember-500/40 bg-ember-700/10 opacity-0 group-hover:opacity-100"
            )}
            style={{ width: PORT_HIT_SIZE, height: PORT_HIT_SIZE }}
            onPointerDown={(event) => {
              if (readOnly) {
                return;
              }

              if (event.button !== 0) {
                return;
              }

              event.stopPropagation();
              onSelectionChange({
                nodeIds: [node.id],
                primaryNodeId: node.id,
                linkId: null
              });

              const worldPoint = toWorldPoint(event);
              if (!worldPoint) {
                return;
              }

              setConnectingState({
                sourceNodeId: node.id,
                pointer: worldPoint,
                targetNodeId: null
              });
            }}
          />

          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="line-clamp-1 text-sm font-semibold text-ink-50">{node.name}</p>
            <div className="flex h-6 items-center gap-1">
              {onDeleteNodes ? (
                <button
                  type="button"
                  data-node-control="true"
                  aria-label={`Delete ${node.name}`}
                  aria-hidden={!selectedNodeSet.has(node.id)}
                  tabIndex={selectedNodeSet.has(node.id) ? 0 : -1}
                  className={cn(
                    "h-6 w-6 rounded-md p-1 text-ink-500 transition",
                    selectedNodeSet.has(node.id)
                      ? "opacity-100 hover:bg-red-500/15 hover:text-red-300"
                      : "pointer-events-none opacity-0"
                  )}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    if (readOnly) {
                      return;
                    }

                    event.stopPropagation();
                    onDeleteNodes([node.id]);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {!readOnly && <Move className="h-4 w-4 text-ink-500" />}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
            <Badge variant={isOrchestrator ? "running" : "neutral"}>{node.role}</Badge>
            {ProviderIcon && <ProviderIcon className="h-3.5 w-3.5" />}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <p className="line-clamp-1 min-w-0 flex-1 text-xs text-ink-500">{node.model}</p>
            {node.fastMode && (
              <Zap className="h-3 w-3 shrink-0 text-ember-400" />
            )}
            {node.use1MContext && (
              <span className="shrink-0 font-mono text-[0.5rem] font-semibold leading-none text-ember-400" title="1M context">1M</span>
            )}
            {node.enableIsolatedStorage && (
              <HardDrive className="h-3 w-3 shrink-0 text-ink-500" />
            )}
            {node.enableSharedStorage && (
              <Share2 className="h-3 w-3 shrink-0 text-ink-500" />
            )}
          </div>

          {node.enableDelegation && node.delegationCount != null && node.delegationCount > 0 && (
            <>
              {/* Gradient spine connector */}
              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{ top: NODE_HEIGHT, width: 2, height: DELEGATION_SPINE_HEIGHT }}
              >
                <div className="h-full w-full bg-gradient-to-b from-[var(--card-border)] to-ink-600/40" />
              </div>

              {/* Frosted glass sub-card */}
              <div
                className="pointer-events-auto absolute left-0 rounded-xl border border-[var(--card-border)] bg-[var(--card-surface)] px-3 py-2.5 shadow-sm"
                style={{
                  top: NODE_HEIGHT + DELEGATION_SPINE_HEIGHT,
                  width: NODE_WIDTH,
                  height: DELEGATION_CARD_HEIGHT
                }}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-ember-400/70" />
                  <span className="text-[0.625rem] font-medium text-ink-300">
                    Subagents: {node.delegationCount}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: Math.min(node.delegationCount, 6) }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full bg-[var(--badge-neutral-bg)] px-2 py-0.5 text-[0.5625rem] text-ink-400",
                        animatedNodeSet.has(node.id) && "animate-pulsebar"
                      )}
                    >
                      <span className="inline-block h-1 w-1 rounded-full bg-ember-500/50" />
                      sub-{i + 1}
                    </span>
                  ))}
                  {node.delegationCount > 6 && (
                    <span className="inline-flex items-center rounded-full bg-[var(--badge-neutral-bg)] px-2 py-0.5 text-[0.5625rem] text-ink-400">
                      +{node.delegationCount - 6} more
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>);
      })}
    </div>
  );
}
