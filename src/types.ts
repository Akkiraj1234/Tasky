export type Priority = "Low" | "Medium" | "High";
export type Status = "todo" | "in-progress" | "done" | "cancelled";

export interface QTTask {
  startLine: number;
  endLine: number;
  checkbox: string; // "[ ]" or "[x]"
  title: string;
  description?: string;
  created?: string; // YYYY-MM-DD
  due?: string; // YYYY-MM-DD
  tags: string[]; // ["#tag"]
  priority?: Priority;
  status?: Status;
  raw?: string;
}
