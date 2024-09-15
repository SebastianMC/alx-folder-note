import "./folder-icon.less";

import { dirname } from "path";
import type {
  AFItem,
  CachedMetadata,
  FileExplorerView,
  FolderItem,
} from "obsidian";
import { TAbstractFile, TFile, TFolder } from "obsidian";

import type ALxFolderNote from "../fn-main";
import type { afItemMark } from "../misc";
import { isFolder } from "../misc";
import FEHandler_Base from "./base";

export const folderIconMark = "alx-folder-icons";

const folderNoteClass = "alx-folder-note";
const folderClass = "alx-folder-with-note";
const emptyFolderClass = "alx-empty-folder";

export default class FolderMark extends FEHandler_Base {
  constructor(plugin: ALxFolderNote, fileExplorer: FileExplorerView) {
    super(plugin, fileExplorer);
    this.initFolderMark();
    if (this.plugin.settings.folderIcon) {
      this.initFolderIcon();
    }
    if (this.plugin.settings.hideCollapseIndicator) {
      this.initHideCollapseIndicator();
    }
  }
  queues = {
    mark: {
      queue: new Map<string, [revert: boolean]>(),
      action: (path: string, revert: boolean) => {
        const item = this.getAfItem(path);
        if (!item) {
          console.warn("no afitem found for path %s, escaping...", path);
          return;
        }
        if (isFolder(item)) {
          if (revert === !!item.isFolderWithNote) {
            item.el.toggleClass(folderClass, !revert);
            item.isFolderWithNote = revert ? undefined : true;
            if (this.plugin.settings.hideCollapseIndicator)
              item.el.toggleClass(
                emptyFolderClass,
                revert ? false : item.file.children.length === 1,
              );
          }
          this._updateIcon(path, revert, item);
        } else if (revert === !!item.isFolderNote) {
          item.el.toggleClass(folderNoteClass, !revert);
          item.isFolderNote = revert ? undefined : true;
        }
      },
    },
    changedFolder: {
      queue: new Set<string>(),
      action: (path: string) => {
        const note = this.fncApi.getFolderNote(path);
        if (note) {
          (this.getAfItem(path) as FolderItem)?.el.toggleClass(
            emptyFolderClass,
            note.parent.children.length === 1,
          );
        }
      },
    },
  };
  private initFolderMark() {
    const { vault, metadataCache } = this.app;
    this.markAll();
    window.setTimeout(this.markAll, 20);
    // #region folder note events setup
    [
      vault.on("folder-note:create", (note: TFile, folder: TFolder) => {
        this.setMark(note);
        this.setMark(folder);
      }),
      vault.on("folder-note:delete", (note: TFile, folder: TFolder) => {
        this.setMark(note, true);
        this.setMark(folder, true);
      }),
      vault.on("folder-note:rename", () => {
        // fe-item in dom will be reused, do nothing for now
      }),
      vault.on("folder-note:cfg-changed", () => {
        this.markAll(true);
        window.setTimeout(this.markAll, 200);
      }),
      metadataCache.on("changed", (file) => {
        let folder;
        if ((folder = this.fncApi.getFolderFromNote(file))) {
          this.setMark(folder);
        }
      }),
    ].forEach(this.plugin.registerEvent.bind(this.plugin));
  }
  // #region set class mark for folder notes and folders
  public setMark = (
    target: AFItem | TAbstractFile | string,
    revert = false,
  ) => {
    if (!target) return;
    const { queue } = this.queues.mark;
    let path: string;
    if (target instanceof TAbstractFile) {
      path = target.path;
    } else if (typeof target === "string") {
      path = target;
    } else {
      path = target.file.path;
    }
    queue.set(path, [revert]);
    this.execQueue("mark");
  };
  public markAll = (revert = false) => {
    this.iterateItems((item: AFItem) => {
      if (isFolder(item) && !revert) {
        this.markFolderNote(item.file);
      } else if (revert) {
        this.setMark(item, true);
      }
    });
  };
  markFolderNote = (af: TAbstractFile): boolean => {
    if (af instanceof TFolder && af.isRoot()) return false;
    const { getFolderNote, getFolderFromNote } = this.fncApi;

    let found: TAbstractFile | null = null;
    if (af instanceof TFile) found = getFolderFromNote(af);
    else if (af instanceof TFolder) found = getFolderNote(af);

    if (found) {
      this.setMark(found);
      this.setMark(af);
    } else {
      this.setMark(af, true);
    }
    return !!found;
  };
  // #endregion
  // #region folder icon setup
  private initFolderIcon() {
    document.body.toggleClass(folderIconMark, this.plugin.settings.folderIcon);
    const { vault } = this.app;
    const updateIcon = () => {
      for (const path of this.foldersWithIcon) {
        this.setMark(path);
      }
    };
    [
      vault.on("iconsc:initialized", updateIcon),
      vault.on("iconsc:changed", updateIcon),
    ].forEach(this.plugin.registerEvent.bind(this.plugin));
  }
  foldersWithIcon = new Set<string>();
  private _updateIcon(path: string, revert: boolean, item: afItemMark) {
    const api = this.plugin.IconSCAPI;
    if (!api) return;

    let folderNotePath: string | undefined,
      metadata: CachedMetadata | undefined;
    const revertIcon = () => {
      delete item.el.dataset.icon;
      delete item.el.dataset["icon-type"];
      this.foldersWithIcon.delete(path);
      item.el.style.removeProperty("--alx-folder-icon-txt");
      item.el.style.removeProperty("--alx-folder-icon-url");
    };
    if (revert) {
      revertIcon();
    } else if (
      (folderNotePath = this.fncApi.getFolderNotePath(path)?.path) &&
      (metadata = this.plugin.app.metadataCache.getCache(folderNotePath))
    ) {
      let iconId = metadata.frontmatter?.icon,
        icon;
      if (
        iconId &&
        typeof iconId === "string" &&
        (icon = api.getIcon(iconId, true))
      ) {
        this.foldersWithIcon.add(path);
        item.el.dataset.icon = iconId.replace(/^:|:$/g, "");
        if (!api.isEmoji(iconId)) {
          item.el.dataset.iconType = "svg";
          item.el.style.setProperty("--alx-folder-icon-url", `url("${icon}")`);
          item.el.style.setProperty("--alx-folder-icon-txt", '"  "');
        } else {
          item.el.dataset.iconType = "emoji";
          item.el.style.setProperty("--alx-folder-icon-url", '""');
          item.el.style.setProperty("--alx-folder-icon-txt", `"${icon}"`);
        }
      } else if (item.el.dataset.icon) {
        revertIcon();
      }
    }
  }
  // #endregion
  // #region set hide collapse indicator
  private initHideCollapseIndicator() {
    if (!this.plugin.settings.hideCollapseIndicator) return;
    const { vault } = this.app;
    [
      vault.on("create", (file) => this.setChangedFolder(file.parent.path)),
      vault.on("delete", (file) => {
        const parent = dirname(file.path);
        this.setChangedFolder(parent === "." ? "/" : parent);
      }),
      vault.on("rename", (file, oldPath) => {
        this.setChangedFolder(file.parent.path);
        const parent = dirname(oldPath);
        this.setChangedFolder(parent === "." ? "/" : parent);
      }),
    ].forEach(this.plugin.registerEvent.bind(this.plugin));
  }

  setChangedFolder = (folderPath: string) => {
    if (!folderPath || folderPath === "/") return;
    this.queues.changedFolder.queue.add(folderPath);
    this.execQueue("changedFolder");
  };
  // #endregion
}
