import {
  Plugin,
  WorkspaceLeaf,
  MarkdownView,
  TFile,
  PluginSettingTab,
  Setting,
  Notice
} from "obsidian";

import type { QTTask } from "./types";
import { parseTasks, serializeTask } from "./taskParser";
import TaskView, { VIEW_TYPE_QUICK_TASK } from "./ui/TaskView";
import TaskModal from "./ui/TaskModal";

interface QuickTaskSettings {
  perFileDefaults: Record<string, string[]>; // filePath -> tags
}

const DEFAULT_SETTINGS: QuickTaskSettings = {
  perFileDefaults: {}
};

export default class QuickTaskPlugin extends Plugin {
  settings: QuickTaskSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Ribbon icon toggles right sidebar view for the plugin
    this.addRibbonIcon("check", "Quick Task (open sidebar)", async () => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_QUICK_TASK);
      if (leaves.length) {
        this.app.workspace.revealLeaf(leaves[0]);
      } else {
        const leaf = this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({ type: VIEW_TYPE_QUICK_TASK, active: true });
        this.app.workspace.revealLeaf(leaf);
      }
    });

    // Register sidebar view
    this.registerView(VIEW_TYPE_QUICK_TASK, (leaf: WorkspaceLeaf) => new TaskView(leaf, this));

    // Command: quick add via modal
    this.addCommand({
      id: "quick-task-add-modal",
      name: "Quick Task: Add task (modal)",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        const defaults = this.getDefaultTagsForFile(file);
        new TaskModal(this.app, async (payload) => {
          try {
            await this.insertTask(file, {
              checkbox: "[ ]",
              title: payload.title,
              description: payload.description,
              created: this.todayISO(),
              due: payload.due,
              tags: payload.tags,
              priority: payload.priority,
              status: payload.status
            });
            new Notice("Task added");
          } catch (e) {
            console.error("Failed to insert task:", e);
            new Notice("Failed to add task — check console");
          }
        }, defaults).open();
      }
    });

    this.addSettingTab(new QuickTaskSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_QUICK_TASK);
  }

  async loadSettings(): Promise<void> {
    // loadData() may return undefined; merge with defaults
    const loaded = (await this.loadData()) as Partial<QuickTaskSettings> | undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getDefaultTagsForFile(file?: TFile | null): string[] {
    if (!file) return [];
    return this.settings.perFileDefaults[file.path] ?? [];
  }

  async saveDefaultTagsForFile(file: TFile, tags: string[]): Promise<void> {
    this.settings.perFileDefaults[file.path] = tags;
    await this.saveSettings();
  }

  todayISO(): string {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  /* ---------- File modifications ---------- */

  async insertTask(file: TFile | null, payload: {
    checkbox?: string;
    title: string;
    description?: string;
    created?: string;
    due?: string;
    tags?: string[];
    priority?: string;
    status?: string;
  }): Promise<void> {
    if (!file) {
      new Notice("Open a file first");
      return;
    }
    const content = await this.app.vault.read(file);
    const block = serializeTask({
      checkbox: payload.checkbox,
      title: payload.title,
      description: payload.description,
      created: payload.created,
      due: payload.due,
      tags: payload.tags,
      priority: payload.priority as any,
      status: payload.status as any
    });

    // If active editor is editing this file, insert at cursor
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mv && mv.file && mv.file.path === file.path) {
      const editor = mv.editor;
      const pos = editor.getCursor();
      const txt = (pos.line === 0 && content.trim() === "") ? block + "\n" : "\n" + block + "\n";
      editor.replaceRange(txt, pos);
      // editor buffer is updated; Obsidian will manage saving the file
    } else {
      // fallback: append to end of file
      try {
        await this.app.vault.modify(file, content + "\n\n" + block + "\n");
      } catch (e) {
        console.error("vault.modify failed while appending task:", e);
        new Notice("Failed to append task to file");
      }
    }
  }

  async replaceTask(file: TFile, original: QTTask, payload: {
    checkbox?: string;
    title: string;
    description?: string;
    created?: string;
    due?: string;
    tags?: string[];
    priority?: string;
    status?: string;
  }): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const newBlock = serializeTask({
      checkbox: payload.checkbox,
      title: payload.title,
      description: payload.description,
      created: payload.created,
      due: payload.due,
      tags: payload.tags,
      priority: payload.priority as any,
      status: payload.status as any
    });

    const before = lines.slice(0, original.startLine).join("\n");
    const after = lines.slice(original.endLine + 1).join("\n");
    const newContent = [before, newBlock, after].filter(Boolean).join("\n");
    try {
      await this.app.vault.modify(file, newContent);
    } catch (e) {
      console.error("Failed to replace task:", e);
      new Notice("Failed to update task");
    }
  }

  async deleteTask(file: TFile, task: QTTask): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const before = lines.slice(0, task.startLine).join("\n");
    const after = lines.slice(task.endLine + 1).join("\n");
    const newContent = [before, after].filter(Boolean).join("\n");
    try {
      await this.app.vault.modify(file, newContent);
      new Notice("Task deleted");
    } catch (e) {
      console.error("Failed to delete task:", e);
      new Notice("Failed to delete task");
    }
  }

  async toggleDone(file: TFile, task: QTTask): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const line = lines[task.startLine];
    const toggled = line.replace(/\[([ xX\-])\]/, (m, g1) => {
      const isChecked = g1.toLowerCase() === "x";
      return isChecked ? "[ ]" : "[x]";
    });
    lines[task.startLine] = toggled;

    const now = this.todayISO();
    let found = false;
    for (let i = task.startLine + 1; i <= task.endLine; i++) {
      const lm = lines[i];
      if (/^\s{2,}status::/i.test(lm)) {
        found = true;
        if (toggled.includes("[x]")) {
          lines[i] = `  status:: done`;
        } else {
          lines.splice(i, 1);
        }
        break;
      }
    }
    if (!found && toggled.includes("[x]")) {
      lines.splice(task.startLine + 1, 0, `  status:: done`);
      lines.splice(task.startLine + 2, 0, `  completed:: ${now}`);
    }

    try {
      await this.app.vault.modify(file, lines.join("\n"));
    } catch (e) {
      console.error("Failed to toggle done:", e);
      new Notice("Failed to update task status");
    }
  }
}

/* ---------- Settings tab ---------- */

class QuickTaskSettingTab extends PluginSettingTab {
  plugin: QuickTaskPlugin;
  constructor(app: any, plugin: QuickTaskPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Quick Task Settings" });

    containerEl.createEl("div", { text: "Open a file and set per-file default tags below." });

    const file = this.app.workspace.getActiveFile();
    if (!file) {
      containerEl.createEl("div", { text: "Open a file to configure defaults for it." });
      return;
    }

    new Setting(containerEl)
      .setName(`Defaults for ${file.path}`)
      .setDesc("Space-separated tags (e.g. #project #urgent)")
      .addText(text => {
        const current = this.plugin.getDefaultTagsForFile(file).join(" ");
        text.setValue(current);
        text.onChange(async (v) => {
          const arr = v.split(/\s+/).filter(Boolean);
          await this.plugin.saveDefaultTagsForFile(file, arr);
          new Notice("Saved default tags for file");
        });
      });

    containerEl.createEl("hr");
    containerEl.createEl("h3", { text: "Saved per-file defaults" });
    const map = this.plugin.settings.perFileDefaults;
    if (!Object.keys(map).length) {
      containerEl.createEl("div", { text: "No saved defaults." });
    } else {
      for (const p of Object.keys(map)) {
        containerEl.createEl("div", { text: `${p}: ${map[p].join(" ")}` });
      }
    }
  }
}
