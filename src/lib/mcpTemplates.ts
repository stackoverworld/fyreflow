import type { McpTransport } from "@/lib/types";
import figmaIcon from "@/assets/mcp-templates/figma.svg";
import githubIcon from "@/assets/mcp-templates/github.svg";

export interface McpServerTemplateDraft {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
  toolAllowlist: string;
}

export interface McpServerTemplate {
  id: string;
  label: string;
  subtitle: string;
  docsUrl: string;
  iconSrc: string;
  iconClassName?: string;
  setupHint: string;
  draft: McpServerTemplateDraft;
}

export const MCP_SERVER_TEMPLATES: McpServerTemplate[] = [
  {
    id: "figma-dev-mode",
    label: "Figma Dev Mode",
    subtitle: "Extract layout/components/styles from Figma via MCP",
    docsUrl: "https://github.com/GLips/Figma-Context-MCP",
    iconSrc: figmaIcon,
    setupHint: "Replace YOUR_FIGMA_TOKEN before creating the server.",
    draft: {
      name: "Figma MCP",
      transport: "stdio",
      command: "npx",
      args: "-y figma-developer-mcp --figma-api-key=YOUR_FIGMA_TOKEN --stdio",
      url: "",
      env: "",
      headers: "",
      toolAllowlist: ""
    }
  },
  {
    id: "github-official",
    label: "GitHub",
    subtitle: "Official remote MCP endpoint for repositories/issues/PRs",
    docsUrl: "https://github.com/github/github-mcp-server",
    iconSrc: githubIcon,
    iconClassName: "brightness-0 invert",
    setupHint: "Set a GitHub PAT in headers before run.",
    draft: {
      name: "GitHub MCP",
      transport: "http",
      command: "",
      args: "",
      url: "https://api.githubcopilot.com/mcp/",
      env: "",
      headers: "Authorization: Bearer YOUR_GITHUB_PAT",
      toolAllowlist: ""
    }
  }
];
