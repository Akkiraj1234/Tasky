import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { parseTasks } from "../taskParser";
import type { QTTask } from "../types";
import TaskModal from "./TaskModal";
import type QuickTaskPlugin from "../main";

export const VIEW_TYPE_QUICK_TASK = "quick-task-view";

export default class TaskView extends ItemView {
  plugin: QuickTaskPlugin;
  private rendering = false;

  constructor(leaf: WorkspaceLeaf, plugin: QuickTaskPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_QUICK_TASK;
  }

  getDisplayText(): string {
    return "Quick Tasks";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("quick-task-panel");
    await this.render();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.render())
    );
    this.registerEvent(
      this.app.vault.on("modify", () => this.render())
    );
    this.registerEvent(
      this.app.vault.on("create", () => this.render())
    );
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  private getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;

    try {
      this.containerEl.empty();

      const header = this.containerEl.createEl("div");
      const addBtn = header.createEl("button", { text: "➕ Add Task" });
      addBtn.onclick = () => this.openAddModal();

      const file = this.getActiveFile();
      if (!file) {
        this.containerEl.createEl("div", {
          text: "Open a note to manage tasks",
        });
        return;
      }

      const content = await this.app.vault.read(file);
      const tasks = parseTasks(content);

      const list = this.containerEl.createEl("div");
      list.addClass("qt-list");

      if (tasks.length === 0) {
        const empty = list.createEl("div", { text: "No tasks in this file" });
        empty.style.opacity = "0.7";
        return;
      }

      for (const task of tasks) {
        this.renderTaskCard(list, file, task);
      }
    } catch (err) {
      console.error("Quick Task render failed:", err);
      new Notice("Failed to render tasks (see console)");
    } finally {
      this.rendering = false;
    }
  }

  private renderTaskCard(parent: HTMLElement, file: TFile, task: QTTask) {
    const card = parent.createEl("div", { cls: "qt-card" });

    const top = card.createEl("div");
    top.style.display = "flex";
    top.style.justifyContent = "space-between";
    top.style.alignItems = "center";

    const left = top.createEl("div");
    left.style.display = "flex";
    left.style.gap = "8px";
    left.style.alignItems = "center";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.checkbox.toLowerCase().includes("x");
    checkbox.onchange = async () => {
      await this.plugin.toggleDone(file, task);
    };
    left.appendChild(checkbox);

    left.createEl("div", {
      text: task.title,
      cls: "qt-title",
    });

    const buttons = top.createEl("div", { cls: "qt-buttons" });

    const editBtn = buttons.createEl("button", { text: "Edit" });
    editBtn.onclick = () => this.openEditModal(file, task);

    const deleteBtn = buttons.createEl("button", { text: "Delete" });
    deleteBtn.onclick = async () => {
      await this.plugin.deleteTask(file, task);
      this.render();
    };

    const meta = card.createEl("div", { cls: "qt-meta" });

    if (task.tags.length) meta.createEl("div", { text: task.tags.join(" ") });
    if (task.priority) meta.createEl("div", { text: `Priority: ${task.priority}` });
    if (task.due) meta.createEl("div", { text: `Due: ${task.due}` });
    if (task.created) meta.createEl("div", { text: `Created: ${task.created}` });

    if (task.description) {
      const desc = card.createEl("div", { text: task.description });
      desc.style.whiteSpace = "pre-wrap";
    }
  }

  private openAddModal() {
    const file = this.getActiveFile();
    const defaultTags = this.plugin.getDefaultTagsForFile(file);

    new TaskModal(
      this.app,
      async (payload) => {
        await this.plugin.insertTask(file, {
          checkbox: "[ ]",
          title: payload.title,
          description: payload.description,
          created: this.plugin.todayISO(),
          due: payload.due,
          tags: payload.tags,
          priority: payload.priority,
          status: payload.status,
        });
        this.render();
      },
      defaultTags
    ).open();
  }

  private openEditModal(file: TFile, task: QTTask) {
    const defaultTags = this.plugin.getDefaultTagsForFile(file);

    new TaskModal(
      this.app,
      async (payload) => {
        await this.plugin.replaceTask(file, task, {
          checkbox: task.checkbox,
          title: payload.title,
          description: payload.description,
          created: task.created ?? this.plugin.todayISO(),
          due: payload.due,
          tags: payload.tags,
          priority: payload.priority,
          status: payload.status,
        });
        this.render();
      },
      defaultTags,
      {
        title: task.title,
        description: task.description,
        due: task.due,
        tags: task.tags,
        priority: task.priority,
        status: task.status,
      }
    ).open();
  }
}
