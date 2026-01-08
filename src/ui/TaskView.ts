import { ItemView, WorkspaceLeaf, MarkdownView, Notice } from "obsidian";
import { parseTasks } from "../taskParser";
import type { QTTask } from "../types";
import TaskModal from "./TaskModal";
import type QuickTaskPlugin from "../main";

export const VIEW_TYPE_QUICK_TASK = "quick-task-view";

export default class TaskView extends ItemView {
  plugin: QuickTaskPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: QuickTaskPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_QUICK_TASK; }
  getDisplayText() { return "Quick Tasks"; }
  async onOpen() {
    this.containerEl.addClass("quick-task-panel");
    this.render();

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
    this.registerEvent(this.app.vault.on("modify", () => this.render()));
    this.registerEvent(this.app.vault.on("create", () => this.render()));
  }

  async onClose() {
    this.containerEl.empty();
  }

  private async ensureFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this.containerEl.empty();
      this.containerEl.createEl("div", { text: "Open a note to manage tasks" });
      return null;
    }
    return file;
  }

  async render() {
    this.containerEl.empty();

    const header = this.containerEl.createEl("div");
    const addBtn = header.createEl("button", { text: "➕ Add Task" });
    addBtn.onclick = () => this.openAddModal();

    const file = await this.ensureFile();
    if (!file) return;

    const content = await this.app.vault.read(file);
    const tasks = parseTasks(content);

    const list = this.containerEl.createEl("div");
    list.addClass("qt-list");

    if (tasks.length === 0) {
      const empty = list.createEl("div", { text: "No tasks in this file" });
      empty.style.opacity = "0.7";
    } else {
      for (const t of tasks) {
        const card = list.createEl("div");
        card.addClass("qt-card");

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
        checkbox.checked = t.checkbox.toLowerCase().includes("x");
        checkbox.onchange = async () => {
          await this.plugin.toggleDone(file, t);
        };
        left.appendChild(checkbox);

        const title = left.createEl("div", { text: t.title });
        title.style.fontWeight = "600";

        top.appendChild(left);

        const buttons = top.createEl("div");
        buttons.addClass("qt-buttons");

        const edit = buttons.createEl("button", { text: "Edit" });
        edit.onclick = async () => { await this.openEditModal(file, t); };

        const del = buttons.createEl("button", { text: "Delete" });
        del.onclick = async () => { await this.plugin.deleteTask(file, t); };

        const meta = card.createEl("div");
        meta.addClass("qt-meta");
        if (t.tags?.length) meta.createEl("div", { text: t.tags.join(" ") });
        if (t.priority) meta.createEl("div", { text: `Priority: ${t.priority}` });
        if (t.due) meta.createEl("div", { text: `Due: ${t.due}` });
        if (t.created) meta.createEl("div", { text: `Created: ${t.created}` });
        if (t.description) {
          const d = card.createEl("div", { text: t.description });
          d.style.whiteSpace = "pre-wrap";
        }
      }
    }

    this.containerEl.appendChild(list);
  }

  private openAddModal() {
    const file = this.app.workspace.getActiveFile();
    const defaultTags = this.plugin.getDefaultTagsForFile(file);
    new TaskModal(this.app, async (payload) => {
      await this.plugin.insertTask(file, {
        checkbox: "[ ]",
        title: payload.title,
        description: payload.description,
        created: this.plugin.todayISO(),
        due: payload.due,
        tags: payload.tags,
        priority: payload.priority,
        status: payload.status
      });
      this.render();
    }, defaultTags).open();
  }

  private async openEditModal(file: import("obsidian").TFile, task: QTTask) {
    const defaultTags = this.plugin.getDefaultTagsForFile(file);
    new TaskModal(this.app, async (payload) => {
      await this.plugin.replaceTask(file, task, {
        checkbox: task.checkbox,
        title: payload.title,
        description: payload.description,
        created: task.created ?? this.plugin.todayISO(),
        due: payload.due,
        tags: payload.tags,
        priority: payload.priority,
        status: payload.status
      });
      this.render();
    }, defaultTags, {
      title: task.title,
      description: task.description,
      due: task.due,
      tags: task.tags,
      priority: task.priority,
      status: task.status
    }).open();
  }
}
