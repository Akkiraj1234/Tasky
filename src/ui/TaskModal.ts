import { App, Modal, Notice } from "obsidian";
import type { Priority, Status } from "../types";

export interface TaskModalPayload {
  title: string;
  description?: string;
  due?: string;
  tags?: string[];
  priority?: Priority;
  status?: Status;
}

export default class TaskModal extends Modal {
  private onSubmit: (p: TaskModalPayload) => void;
  private initial?: TaskModalPayload;
  private defaultTags: string[];

  constructor(app: App, onSubmit: (p: TaskModalPayload) => void, defaultTags: string[] = [], initial?: TaskModalPayload) {
    super(app);
    this.onSubmit = onSubmit;
    this.initial = initial;
    this.defaultTags = defaultTags;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.initial ? "Edit Task" : "Add Task" });

    const title = contentEl.createEl("input", { type: "text" }) as HTMLInputElement;
    title.placeholder = "Title (required)";
    title.style.width = "100%";
    title.value = this.initial?.title ?? "";

    const desc = contentEl.createEl("textarea") as HTMLTextAreaElement;
    desc.placeholder = "Description (optional)";
    desc.style.width = "100%";
    desc.style.height = "80px";
    desc.value = this.initial?.description ?? "";

    const due = contentEl.createEl("input", { type: "date" }) as HTMLInputElement;
    due.style.width = "100%";
    due.value = this.initial?.due ?? "";

    const tags = contentEl.createEl("input", { type: "text" }) as HTMLInputElement;
    tags.placeholder = "Tags (space-separated, e.g. #proj #urgent)";
    tags.style.width = "100%";
    tags.value = [(this.initial?.tags ?? []).join(" "), this.defaultTags.join(" ")].filter(Boolean).join(" ");

    const priority = contentEl.createEl("select") as HTMLSelectElement;
    ["Low", "Medium", "High"].forEach(p => {
      const o = document.createElement("option");
      o.value = p;
      o.innerText = p;
      priority.appendChild(o);
    });
    priority.value = this.initial?.priority ?? "Medium";

    const status = contentEl.createEl("select") as HTMLSelectElement;
    const statuses: { v: Status; label: string }[] = [
      { v: "todo", label: "To Do" },
      { v: "in-progress", label: "In Progress" },
      { v: "done", label: "Done" },
      { v: "cancelled", label: "Cancelled" }
    ];
    statuses.forEach(s => {
      const o = document.createElement("option");
      o.value = s.v;
      o.innerText = s.label;
      status.appendChild(o);
    });
    status.value = this.initial?.status ?? "todo";

    const btnRow = contentEl.createEl("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "8px";
    btnRow.style.marginTop = "8px";

    const save = btnRow.createEl("button", { text: "Save" });
    const cancel = btnRow.createEl("button", { text: "Cancel" });

    save.onclick = () => {
      const t = title.value.trim();
      if (!t) {
        new Notice("Title required");
        return;
      }
      this.close();
      this.onSubmit({
        title: t,
        description: desc.value.trim() || undefined,
        due: due.value || undefined,
        tags: tags.value.split(/\s+/).filter(Boolean),
        priority: priority.value as Priority,
        status: status.value as Status
      });
    };

    cancel.onclick = () => this.close();

    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save.click();
    });

    setTimeout(() => title.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}
