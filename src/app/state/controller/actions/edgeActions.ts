import type { Dispatch, SetStateAction } from "react";
import type { ProviderOAuthMessageMap, ProviderOAuthStatusMap } from "@/lib/pipelineDraft";
import type { ProviderId, ProviderOAuthStatus } from "@/lib/types";

export function handleProviderOauthStatusChangeAction(
  providerId: ProviderId,
  status: ProviderOAuthStatus | null,
  ctx: { setProviderOauthStatuses: Dispatch<SetStateAction<ProviderOAuthStatusMap>> }
): void {
  ctx.setProviderOauthStatuses((current) => ({
    ...current,
    [providerId]: status
  }));
}

export function handleProviderOauthMessageChangeAction(
  providerId: ProviderId,
  message: string,
  ctx: { setProviderOauthMessages: Dispatch<SetStateAction<ProviderOAuthMessageMap>> }
): void {
  ctx.setProviderOauthMessages((current) => ({
    ...current,
    [providerId]: message
  }));
}
