export type Priority = "Low" | "Medium" | "High";
export type Status = "todo" | "in-progress" | "done" | "cancelled";

export interface QTTask {
  startLine: number;
  endLine: number;
  checkbox: string;
  title: string;
  description?: string;
  created?: string;
  due?: string;
  tags: string[];
  priority?: Priority;
  status?: Status;
  raw?: string;
}
