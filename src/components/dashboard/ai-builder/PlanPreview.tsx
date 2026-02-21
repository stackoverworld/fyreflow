import type { RefObject } from "react";
import type { AiChatMessage, PipelinePayload } from "@/lib/types";
import { ChatBubble, PlanPreviewGeneratingIndicator } from "./plan-preview/PlanPreviewSections";
import { PlanPreviewHeader } from "./plan-preview/PlanPreviewHeader";

interface PlanPreviewProps {
  messages: AiChatMessage[];
  generating: boolean;
  readOnly: boolean;
  messagesEndRef: RefObject<HTMLDivElement>;
  onApplyDraft: (draft: PipelinePayload) => void;
  onQuickReply: (value: string) => Promise<void>;
}

export function PlanPreview({
  messages,
  generating,
  readOnly,
  messagesEndRef,
  onApplyDraft,
  onQuickReply,
}: PlanPreviewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.length === 0 && !generating ? <PlanPreviewHeader /> : null}

      {messages.map((msg) => (
        <ChatBubble
          key={msg.id}
          message={msg}
          readOnly={readOnly || generating}
          onQuickReply={onQuickReply}
          onApply={
            msg.generatedDraft
              ? () => {
                  onApplyDraft(msg.generatedDraft!);
                }
              : undefined
          }
        />
      ))}

      {generating ? <PlanPreviewGeneratingIndicator /> : null}

      <div ref={messagesEndRef} />
    </div>
  );
}
