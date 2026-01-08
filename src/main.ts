import {
  App,
  Plugin,
  WorkspaceLeaf,
  ItemView,
  MarkdownView,
  Modal,
  Setting,
  Notice,
  TFile,
  PluginSettingTab,
  SettingComponent,
  Vault,
  Workspace
} from "obsidian";

/* -----------------------------
   Types
   ----------------------------- */
type Priority = "Low" | "Medium" | "High";
type Status = "todo" | "in-progress" | "done" | "cancelled";

interface QTTask {
  rawLine: string; // the original checklist line
  startLine: number; // line index where task starts
  endLine: number; // inclusive index of last metadata line
  checkbox: string; // [ ] or [x]
  title: string;
  description?: string;
  created?: string; // YYYY-MM-DD
  due?: string; // YYYY-MM-DD
  tags: string[]; // #tag style
  priority?: Priority;
  status?: Status;
}

/* -----------------------------
   Settings
   ----------------------------- */
interface QuickTaskSettings {
  perFileDefaultTags: Record<string, string[]>; // key: path, value: tags
}

const DEFAULT_SETTINGS: QuickTaskSettings = {
  perFileDefaultTags: {}
};

/* -----------------------------
   Utilities
   ----------------------------- */
function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* -----------------------------
   Task Parser / Serializer
   ----------------------------- */

function parseTasksFromContent(content: string): QTTask[] {
  const lines = content.split("\n");
  const tasks: QTTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Identify checklist line starting with - [ ] or - [x] (also allow other checkbox chars)
    const match = /^\s*-\s*\[([ xX\-])\]\s*(.*)/.exec(line);
    if (match) {
      const checkbox = `[${match[1]}]`;
      const rest = match[2].trim();
      // Extract tags (words starting with #)
      const tagMatches = Array.from(rest.matchAll(/#([A-Za-z0-9/_-]+)/g));
      const tags = tagMatches.map(m => `#${m[1]}`);
      // Extract priority emoji shortcuts (🔺, ⏫, ⏬, etc) OR text like [P:High]
      let priority: Priority | undefined = undefined;
      if (rest.includes("🔺") || /priority[:\s]*high/i.test(rest) || /P:high/i.test(rest)) {
        priority = "High";
      } else if (rest.includes("⏫") || /priority[:\s]*medium/i.test(rest) || /P:medium/i.test(rest)) {
        priority = "Medium";
      } else if (rest.includes("⏬") || /priority[:\s]*low/i.test(rest) || /P:low/i.test(rest)) {
        priority = "Low";
      }

      // Status is inferred from checkbox and inline words
      let status: Status = checkbox.toLowerCase().includes("x") ? "done" : "todo";
      if (/in[-\s]*progress/i.test(rest)) status = "in-progress";
      if (/cancel/i.test(rest)) status = "cancelled";

      // Collect metadata lines directly under the task (indented "  - Key: Value")
      const metaLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (/^\s{2,}-\s+[A-Za-z0-9]/.test(l)) {
          metaLines.push(l.trim().replace(/^-+\s*/, ""));
        } else if (/^\s{2,}[A-Za-z].*/.test(l)) {
          // also accept just indented lines (older style)
          metaLines.push(l.trim());
        } else {
          break;
        }
      }

      const meta = parseMetaLines(metaLines);

      const task: QTTask = {
        rawLine: line,
        startLine: i,
        endLine: j - 1,
        checkbox,
        title: rest.replace(/(#\w+)|🔺|⏫|⏬/g, "").trim(),
        description: meta["Description"],
        created: meta["Created"] || meta["created"],
        due: meta["Due"] || meta["due"],
        tags,
        priority: priority,
        status
      };
      tasks.push(task);
      i = j - 1; // advance
    }
  }
  return tasks;
}

function parseMetaLines(metaLines: string[]): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const l of metaLines) {
    const kv = /^([A-Za-z]+)\s*[:]{1,2}\s*(.*)$/.exec(l);
    if (kv) {
      meta[kv[1]] = kv[2];
    } else {
      // If free text, append to Description
      meta["Description"] = (meta["Description"] ? meta["Description"] + "\n" : "") + l;
    }
  }
  return meta;
}

function serializeTaskToBlock(task: {
  checkbox?: string;
  title: string;
  description?: string;
  created?: string;
  due?: string;
  tags?: string[];
  priority?: Priority;
  status?: Status;
}): string {
  const tagsPart = (task.tags || []).join(" ");
  const priorityEmoji = task.priority === "High" ? "🔺" : task.priority === "Medium" ? "⏫" : task.priority === "Low" ? "⏬" : "";
  // Status label for inline readability (not required by Tasks plugin but helpful)
  const statusInline = task.status === "in-progress" ? "in-progress" : task.status === "cancelled" ? "cancelled" : "";
  const checkbox = task.checkbox ?? "[ ]";
  const mainLine = `- ${checkbox} ${task.title}${tagsPart ? " " + tagsPart : ""}${priorityEmoji ? " " + priorityEmoji : ""}${statusInline ? " #" + statusInline : ""}`;
  const meta: string[] = [];
  if (task.description) meta.push(`  - Description: ${task.description}`);
  if (task.created) meta.push(`  - Created: ${task.created}`);
  if (task.due) meta.push(`  - Due: ${task.due}`);
  if (task.priority) meta.push(`  - Priority: ${task.priority}`);
  if (task.status) meta.push(`  - Status: ${task.status}`);
  return [mainLine, ...meta].join("\n");
}

/* -----------------------------
   Modal (Add / Edit Task)
   ----------------------------- */

class TaskModal extends Modal {
  private onSubmit: (payload: {
    title: string;
    description: string;
    due?: string;
    tags: string[];
    priority: Priority;
    status: Status;
  }) => void;
  private initial?: QTTask;
  private defaultTags: string[];

  constructor(app: App, onSubmit: (payload: any) => void, defaultTags: string[] = [], initial?: QTTask) {
    super(app);
    this.onSubmit = onSubmit;
    this.initial = initial;
    this.defaultTags = defaultTags;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.initial ? "Edit Task" : "Add Task" });

    // Title
    const titleInput = contentEl.createEl("input", { type: "text" });
    titleInput.placeholder = "Task title (required)";
    titleInput.style.width = "100%";
    titleInput.style.marginBottom = "6px";
    titleInput.value = this.initial?.title ?? "";

    // Description
    const desc = contentEl.createEl("textarea");
    desc.placeholder = "Description (optional)";
    desc.style.width = "100%";
    desc.style.height = "80px";
    desc.value = this.initial?.description ?? "";

    // Due Date
    const dueInput = contentEl.createEl("input", { type: "date" });
    dueInput.style.marginTop = "6px";
    dueInput.value = this.initial?.due ?? "";

    // Tags
    const tagsInput = contentEl.createEl("input", { type: "text" });
    tagsInput.placeholder = "Tags (space-separated, e.g. #project #urgent)";
    tagsInput.style.width = "100%";
    tagsInput.style.marginTop = "6px";
    // default tags appended
    const initialTagsStr = (this.initial?.tags ?? []).join(" ");
    const defaultsStr = this.defaultTags.join(" ");
    tagsInput.value = [initialTagsStr, defaultsStr].filter(Boolean).join(" ");

    // Priority select
    const prioritySelect = contentEl.createEl("select");
    ["Low", "Medium", "High"].forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.innerText = p;
      prioritySelect.appendChild(opt);
    });
    prioritySelect.style.marginTop = "6px";
    prioritySelect.value = this.initial?.priority ?? "Medium";

    // Status select
    const statusSelect = contentEl.createEl("select");
    const statuses: { v: Status; label: string }[] = [
      { v: "todo", label: "To Do" },
      { v: "in-progress", label: "In Progress" },
      { v: "done", label: "Done" },
      { v: "cancelled", label: "Cancelled" }
    ];
    statuses.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.v;
      opt.innerText = s.label;
      statusSelect.appendChild(opt);
    });
    statusSelect.style.marginTop = "6px";
    statusSelect.value = this.initial?.status ?? "todo";

    // Buttons
    const btnRow = contentEl.createEl("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "8px";
    btnRow.style.marginTop = "8px";

    const saveBtn = btnRow.createEl("button", { text: "Save" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

    saveBtn.onclick = () => {
      const title = titleInput.value.trim();
      if (!title) {
        new Notice("Title required");
        return;
      }
      const description = desc.value.trim();
      const due = dueInput.value || undefined;
      const tags = tagsInput.value.split(/\s+/).filter(Boolean);
      const priority = prioritySelect.value as Priority;
      const status = statusSelect.value as Status;
      this.close();
      this.onSubmit({
        title,
        description,
        due,
        tags,
        priority,
        status
      });
    };

    cancelBtn.onclick = () => {
      this.close();
    };

    // allow Enter to submit when focus in title
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveBtn.click();
    });

    // focus title
    setTimeout(() => titleInput.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/* -----------------------------
   Sidebar View
   ----------------------------- */

const VIEW_TYPE_QUICK_TASK = "quick-task-view";

class QuickTaskView extends ItemView {
  plugin: QuickTaskPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: QuickTaskPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_QUICK_TASK;
  }

  getDisplayText() {
    return "Quick Tasks";
  }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass("quick-task-panel");
    this.render();
    // update when active file changes
    this.registerEvent(this.app.vault.on("modify", () => this.render()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
    this.registerEvent(this.app.vault.on("create", () => this.render()));
  }

  async onClose() {
    this.containerEl.empty();
  }

  async render() {
    this.containerEl.empty();

    const headerRow = this.containerEl.createEl("div");
    const addBtn = headerRow.createEl("button", { text: "➕ Add Task" });
    addBtn.onclick = () => this.openAddModal();

    const settingsBtn = headerRow.createEl("button", { text: "⚙️ File defaults" });
    settingsBtn.onclick = () => this.openFileDefaultTagSetting();

    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this.containerEl.createEl("div", { text: "Open a note to manage tasks" });
      return;
    }

    // Read file content & parse tasks
    const content = await this.app.vault.read(file);
    const tasks = parseTasksFromContent(content);

    const listWrap = this.containerEl.createEl("div");
    listWrap.addClass("quick-task-list");

    if (tasks.length === 0) {
      const empty = listWrap.createEl("div", { text: "No tasks found in this file" });
      empty.style.opacity = "0.7";
    } else {
      for (const t of tasks) {
        const card = listWrap.createEl("div");
        card.addClass("quick-task-card");

        const lineRow = card.createEl("div");
        lineRow.addClass("qt-line");

        const left = lineRow.createEl("div");
        left.style.display = "flex";
        left.style.gap = "8px";
        left.style.alignItems = "center";

        const checkbox = left.createEl("input");
        checkbox.type = "checkbox";
        checkbox.checked = t.checkbox.toLowerCase().includes("x");
        checkbox.onchange = async () => {
          await this.plugin.toggleTaskDone(file, t);
        };

        const titleEl = left.createEl("div", { text: t.title });
        titleEl.style.fontWeight = "600";

        const right = lineRow.createEl("div");
        right.addClass("qt-buttons");

        const editBtn = right.createEl("button", { text: "Edit" });
        editBtn.onclick = async () => {
          await this.openEditModal(file, t);
        };

        const delBtn = right.createEl("button", { text: "Delete" });
        delBtn.onclick = async () => {
          await this.plugin.deleteTask(file, t);
        };

        // Meta row
        const metaRow = card.createEl("div");
        metaRow.addClass("qt-meta");
        if (t.tags?.length) metaRow.createEl("div", { text: t.tags.join(" ") });
        if (t.priority) metaRow.createEl("div", { text: `Priority: ${t.priority}` });
        if (t.due) metaRow.createEl("div", { text: `Due: ${t.due}` });
        if (t.created) metaRow.createEl("div", { text: `Created: ${t.created}` });
        if (t.description) {
          const d = card.createEl("div", { text: t.description });
          d.style.whiteSpace = "pre-wrap";
        }
      }
    }

    this.containerEl.appendChild(listWrap);
  }

  private openAddModal() {
    const file = this.app.workspace.getActiveFile();
    const defaultTags = this.plugin.getDefaultTagsForFile(file);
    new TaskModal(this.app, async (payload) => {
      await this.plugin.insertTaskToFile(this.app.workspace.getActiveFile(), {
        checkbox: "[ ]",
        title: payload.title,
        description: payload.description,
        created: todayISO(),
        due: payload.due,
        tags: payload.tags,
        priority: payload.priority,
        status: payload.status
      });
      this.render();
    }, defaultTags).open();
  }

  private async openEditModal(file: TFile, task: QTTask) {
    const defaultTags = this.plugin.getDefaultTagsForFile(file);
    new TaskModal(this.app, async (payload) => {
      await this.plugin.replaceTaskInFile(file, task, {
        checkbox: task.checkbox,
        title: payload.title,
        description: payload.description,
        created: task.created ?? todayISO(),
        due: payload.due,
        tags: payload.tags,
        priority: payload.priority,
        status: payload.status
      });
      this.render();
    }, defaultTags, task).open();
  }

  private openFileDefaultTagSetting() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Open a file first");
      return;
    }
    // open plugin settings tab and focus current file entry
    const tab = this.app.setting.open? (this.app as any).setting : null;
    // Fallback: open the plugin settings modal by creating a Setting modal
    const modal = new Modal(this.app);
    modal.titleEl.setText("File default tags");
    const content = modal.contentEl;
    const current = this.plugin.getDefaultTagsForFile(file).join(" ");
    const input = content.createEl("input", { type: "text" });
    input.value = current;
    input.placeholder = "#tag1 #tag2";
    input.style.width = "100%";
    input.style.marginTop = "6px";

    const save = content.createEl("button", { text: "Save" });
    const cancel = content.createEl("button", { text: "Cancel" });
    save.onclick = async () => {
      const v = input.value.split(/\s+/).filter(Boolean);
      await this.plugin.saveDefaultTagsForFile(file, v);
      modal.close();
      this.render();
      new Notice("Saved default tags for file");
    };
    cancel.onclick = () => modal.close();
    modal.open();
  }
}

/* -----------------------------
   Plugin main
   ----------------------------- */

export default class QuickTaskPlugin extends Plugin {
  settings: QuickTaskSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("check", "Quick Task", async () => {
      // toggle right sidebar view
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_QUICK_TASK);
      if (existing.length) {
        const leaf = existing[0];
        // if visible, detach; otherwise reveal
        this.app.workspace.revealLeaf(leaf);
      } else {
        await this.app.workspace.getRightLeaf(false).setViewState({ type: VIEW_TYPE_QUICK_TASK, active: true });
        this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(VIEW_TYPE_QUICK_TASK)[0]);
      }
    });

    this.registerView(VIEW_TYPE_QUICK_TASK, (leaf) => new QuickTaskView(leaf, this));

    // Register command to open add modal quickly
    this.addCommand({
      id: "quick-task-add",
      name: "Quick Task: Add Task (modal)",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const defaultTags = this.getDefaultTagsForFile(view?.file);
        new TaskModal(this.app, async (payload) => {
          await this.insertTaskToFile(this.app.workspace.getActiveFile(), {
            checkbox: "[ ]",
            title: payload.title,
            description: payload.description,
            created: todayISO(),
            due: payload.due,
            tags: payload.tags,
            priority: payload.priority,
            status: payload.status
          });
        }, defaultTags).open();
      }
    });

    this.addSettingTab(new QuickTaskSettingTab(this.app, this));

    // Load the view if there are none: do not auto-open by default; user toggles ribbon
    // but register for file changes to refresh views as needed in the view code
    this.registerEvent(this.app.vault.on("rename", () => this.saveSettings()));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_QUICK_TASK);
  }

  /* -----------------------------
     Settings helpers
     ----------------------------- */

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getDefaultTagsForFile(file?: TFile | null): string[] {
    if (!file) return [];
    return this.settings.perFileDefaultTags[file.path] ?? [];
  }

  async saveDefaultTagsForFile(file: TFile, tags: string[]) {
    this.settings.perFileDefaultTags[file.path] = tags;
    await this.saveSettings();
  }

  /* -----------------------------
     File modifications
     ----------------------------- */

  async insertTaskToFile(file: TFile | null, payload: {
    checkbox: string;
    title: string;
    description?: string;
    created?: string;
    due?: string;
    tags?: string[];
    priority?: Priority;
    status?: Status;
  }) {
    if (!file) {
      new Notice("Open a file first");
      return;
    }
    const content = await this.app.vault.read(file);
    const block = serializeTaskToBlock({
      checkbox: payload.checkbox,
      title: payload.title,
      description: payload.description,
      created: payload.created,
      due: payload.due,
      tags: payload.tags,
      priority: payload.priority,
      status: payload.status
    });

    // Insert at cursor if active editor in this file; otherwise append
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file && activeView.file.path === file.path) {
      const editor = activeView.editor;
      const pos = editor.getCursor();
      // Insert with a newline double-spaced
      const insertText = (pos.line === 0 && content.trim() === "") ? block + "\n" : "\n" + block + "\n";
      editor.replaceRange(insertText, pos);
      // Ensure vault content updated (editor will take care)
    } else {
      // Append to end
      const newContent = content + "\n\n" + block + "\n";
      await this.app.vault.modify(file, newContent);
    }
    new Notice("Task added");
  }

  async replaceTaskInFile(file: TFile, original: QTTask, payload: {
    checkbox?: string;
    title: string;
    description?: string;
    created?: string;
    due?: string;
    tags?: string[];
    priority?: Priority;
    status?: Status;
  }) {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const newBlock = serializeTaskToBlock({
      checkbox: payload.checkbox ?? original.checkbox,
      title: payload.title,
      description: payload.description,
      created: payload.created,
      due: payload.due,
      tags: payload.tags ?? original.tags,
      priority: payload.priority ?? original.priority,
      status: payload.status ?? original.status
    });
    // Replace lines from startLine..endLine
    const before = lines.slice(0, original.startLine).join("\n");
    const after = lines.slice(original.endLine + 1).join("\n");
    const newContent = [before, newBlock, after].filter(Boolean).join("\n");
    await this.app.vault.modify(file, newContent);
    new Notice("Task updated");
  }

  async deleteTask(file: TFile, task: QTTask) {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const before = lines.slice(0, task.startLine).join("\n");
    const after = lines.slice(task.endLine + 1).join("\n");
    const newContent = [before, after].filter(Boolean).join("\n");
    await this.app.vault.modify(file, newContent);
    new Notice("Task deleted");
  }

  async toggleTaskDone(file: TFile, task: QTTask) {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    // Toggle checkbox
    const line = lines[task.startLine];
    const toggledLine = line.replace(/\[([ xX\-])\]/, (m, g1) => {
      const isChecked = g1.toLowerCase() === "x";
      return isChecked ? "[ ]" : "[x]";
    });
    lines[task.startLine] = toggledLine;
    // If marked done, add Completed or Done date metadata (if not present)
    const now = todayISO();
    let hasCompleted = false;
    for (let i = task.startLine + 1; i <= task.endLine; i++) {
      if (/^(\s*-\s*Completed:)/i.test(lines[i]) || /^(\s*-\s*Done:)/i.test(lines[i])) {
        hasCompleted = true;
        if (toggledLine.includes("[x]")) {
          // update date
          lines[i] = `  - Completed: ${now}`;
        } else {
          // remove completed line when unchecking
          lines.splice(i, 1);
        }
        break;
      }
    }
    if (!hasCompleted && toggledLine.includes("[x]")) {
      // insert Completed line after startLine
      lines.splice(task.startLine + 1, 0, `  - Completed: ${now}`);
    }
    const newContent = lines.join("\n");
    await this.app.vault.modify(file, newContent);
  }
}

/* -----------------------------
   Settings tab
   ----------------------------- */

class QuickTaskSettingTab extends PluginSettingTab {
  plugin: QuickTaskPlugin;
  constructor(app: App, plugin: QuickTaskPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Quick Task Settings" });

    containerEl.createEl("div", { text: "Per-file default tags. Open a file, then add tags for that file below." });

    // current open file
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      containerEl.createEl("div", { text: "Open a file to set defaults for it." });
      return;
    }

    new Setting(containerEl)
      .setName(`Defaults for ${file.path}`)
      .setDesc("Space-separated tags (e.g. #project #urgent). These will be suggested when adding tasks in this file.")
      .addText(text => {
        const current = this.plugin.getDefaultTagsForFile(file).join(" ");
        text.setValue(current);
        text.onChange(async (v) => {
          const arr = v.split(/\s+/).filter(Boolean);
          await this.plugin.saveDefaultTagsForFile(file, arr);
          new Notice("Saved default tags for file");
        });
      });

    // Show stored file mappings (brief)
    containerEl.createEl("hr");
    containerEl.createEl("h3", { text: "All saved file defaults" });
    const map = this.plugin.settings.perFileDefaultTags;
    if (Object.keys(map).length === 0) {
      containerEl.createEl("div", { text: "No per-file defaults saved." });
    } else {
      for (const p of Object.keys(map)) {
        containerEl.createEl("div", { text: `${p}: ${map[p].join(" ")}` });
      }
    }
  }
}

