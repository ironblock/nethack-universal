/**
 * Save-slot picker (Qt's qt_svsel.cpp "NetHackQtSaveWindow"): a list of
 * existing saved adventurers to resume, plus a way to start a new one.
 * Resolves with the chosen player name; caller sets ENV.USER/argv from it.
 */
export class SaveSelectController {
  constructor(private el: HTMLElement) {}

  choose(existing: string[]): Promise<string> {
    return new Promise((resolve) => {
      const finish = (name: string) => {
        this.el.replaceChildren();
        this.el.style.display = "none";
        resolve(name);
      };

      const root = document.createElement("div");
      root.className = "saveselect";

      const title = document.createElement("h2");
      title.textContent = "Choose your adventurer";
      root.appendChild(title);

      if (existing.length) {
        const list = document.createElement("div");
        list.className = "saveselect-list";
        for (const name of existing) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "saveselect-btn";
          btn.textContent = name;
          btn.addEventListener("click", () => finish(name));
          list.appendChild(btn);
        }
        root.appendChild(list);
      }

      const newRow = document.createElement("div");
      newRow.className = "saveselect-new";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "New adventurer's name";
      input.maxLength = 31;
      input.value = existing.length ? "" : "Adventurer";
      newRow.appendChild(input);
      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.textContent = existing.length ? "New game" : "Play";
      newRow.appendChild(startBtn);
      root.appendChild(newRow);

      const go = () => {
        const name = input.value.trim() || "Adventurer";
        finish(name);
      };
      startBtn.addEventListener("click", go);
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") go();
      });

      this.el.replaceChildren(root);
      this.el.style.display = "flex";
      if (!existing.length) input.focus();
    });
  }
}
