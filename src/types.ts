export type Priority = "Low" | "Medium" | "High";
export type Status = "todo" | "in-progress" | "done" | "cancelled";

export interface QTTask {
  startLine: number;
  endLine: number;
  title: string;
  description?: string;
  due?: string;
  created?: string;
  tags: string[];
  priority?: Priority;
  status?: Status;
  checkbox: string;
}
