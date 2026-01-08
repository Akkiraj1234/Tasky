import { QTTask, Priority, Status } from "./types";

/**
 * Parses markdown content for checklist tasks and dataview-like inline fields.
 * Inline fields expected format:
 * - [ ] Title #tag1 #tag2 🔺
 *   created:: 2026-01-08
 *   due:: 2026-01-10
 *   priority:: High
 *   status:: todo
 *   description:: Some text
 */

function parseTasks(content: string): QTTask[] {
  const lines = content.split("\n");
  const tasks: QTTask[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*-\s*\[([ xX\-])\]\s*(.*)$/.exec(line);
    if (!m) continue;

    const checkbox = `[${m[1]}]`;
    const rest = m[2].trim();

    // extract tags (#word) and priority emojis if any
    const tagMatches = Array.from(rest.matchAll(/#([A-Za-z0-9\/\-_]+)/g));
    const tags = tagMatches.map(t => `#${t[1]}`);

    // remove inline tags and emojis to get title fuzzily
    const title = rest
      .replace(/#([A-Za-z0-9\/\-_]+)/g, "")
      .replace(/🔺|⏫|⏬/g, "")
      .replace(/\s+#(todo|in-progress|done|cancelled)\b/gi, "")
      .trim();

    // default status from checkbox
    let status: Status = checkbox.toLowerCase().includes("x") ? "done" : "todo";
    if (/in[-\s]*progress/i.test(rest)) status = "in-progress";
    if (/cancel/i.test(rest)) status = "cancelled";

    // collect subsequent inline field lines
    const meta: Record<string, string> = {};
    let j = i + 1;
    for (; j < lines.length; j++) {
      const ml = lines[j];
      const fieldMatch = /^\s{2,}([A-Za-z0-9_-]+)::\s*(.*)$/.exec(ml);
      if (fieldMatch) {
        meta[fieldMatch[1].toLowerCase()] = fieldMatch[2];
      } else if (/^\s{2,}-\s+[A-Za-z0-9]/.test(ml)) {
        // accept dash-lines as description fallback
        const d = ml.replace(/^\s{2,}-\s*/, "");
        meta["description"] = (meta["description"] ? meta["description"] + "\n" : "") + d;
      } else {
        break;
      }
    }

    const task: QTTask = {
      startLine: i,
      endLine: j - 1,
      checkbox,
      title,
      description: meta["description"],
      created: meta["created"],
      due: meta["due"],
      tags,
      priority: meta["priority"] as Priority | undefined,
      status,
      raw: line
    };

    tasks.push(task);
    i = j - 1;
  }

  return tasks;
}

function serializeTask(task: {
  checkbox?: string;
  title: string;
  description?: string;
  created?: string;
  due?: string;
  tags?: string[];
  priority?: Priority;
  status?: Status;
}): string {
  const checkbox = task.checkbox ?? "[ ]";
  const tagsPart = (task.tags ?? []).join(" ");
  const priorityEmoji = task.priority === "High" ? "🔺" : task.priority === "Medium" ? "⏫" : task.priority === "Low" ? "⏬" : "";
  const statusInline = task.status && task.status !== "todo" ? ` #${task.status}` : "";
  const line = `- ${checkbox} ${task.title}${tagsPart ? " " + tagsPart : ""}${priorityEmoji ? " " + priorityEmoji : ""}${statusInline}`;
  const meta: string[] = [];
  if (task.created) meta.push(`  created:: ${task.created}`);
  if (task.due) meta.push(`  due:: ${task.due}`);
  if (task.priority) meta.push(`  priority:: ${task.priority}`);
  if (task.status) meta.push(`  status:: ${task.status}`);
  if (task.description) meta.push(`  description:: ${task.description}`);

  return [line, ...meta].join("\n");
}

export { parseTasks, serializeTask, QTTask as ParsedTask };
