import {
  Bot,
  ClipboardList,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  Pencil,
  Search,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  BashOutput: Terminal,
  Edit: Pencil,
  MultiEdit: Pencil,
  NotebookEdit: Pencil,
  Write: FilePlus2,
  Read: FileText,
  Grep: Search,
  Glob: Search,
  LS: FolderOpen,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  Agent: Bot,
  TodoWrite: ListTodo,
  TaskCreate: ListTodo,
  TaskUpdate: ListTodo,
  TaskList: ListTodo,
  TaskGet: ListTodo,
  ExitPlanMode: ClipboardList,
  EnterPlanMode: ClipboardList,
  AskUserQuestion: MessageCircleQuestion,
  Skill: Zap,
};

/** The lucide icon for a tool name; a wrench for anything unknown (MCP…). */
export function toolIcon(name: string): LucideIcon {
  return TOOL_ICONS[name] ?? Wrench;
}
