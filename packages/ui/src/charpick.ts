/**
 * Graphical character picker (Qt's qt_plsel.cpp NetHackQtPlayerSelector).
 *
 * Role/race cards carry monster-tile portraits: the male portrait glyph is the
 * role's/race's monster number itself and the female one is NUMMONS + mnum
 * (display.h monnum_to_glyph with GLYPH_MON_MALE_OFF=0 / GLYPH_MON_FEM_OFF=
 * NUMMONS), so the regular map tilesheet renders them — no core involvement.
 * Tables come from roles.json (gen-roles.mjs parsing role.c / monsters.h).
 *
 * Validity mirrors Qt's cross-filtering: race must be in role.races, and
 * gender/alignment must be allowed by BOTH the role and the race; invalid
 * picks auto-correct to the first valid value rather than deadlocking.
 *
 * The result is fed to the core purely via options (role/race/gender/align in
 * NETHACKOPTIONS + -u for the name) before callMain — genl_player_setup sees a
 * fully-specified character and never prompts.
 */
import { BASE_URL } from "./base";
import type { TileRenderer } from "./tiles";

interface RoleData {
  name: string;
  femName: string | null;
  mnum: number;
  races: string[];
  genders: string[];
  aligns: string[];
}
interface RaceData {
  noun: string;
  adjective: string;
  mnum: number;
  genders: string[];
  aligns: string[];
}
interface RolesJson {
  nummons: number;
  roles: RoleData[];
  races: RaceData[];
}

export interface CharacterChoice {
  name: string;
  role: string;
  race: string;
  gender: "male" | "female";
  align: "lawful" | "neutral" | "chaotic";
}

const GENDERS = ["male", "female"] as const;
const ALIGNS = ["lawful", "neutral", "chaotic"] as const;

export class CharPickController {
  private data!: RolesJson;

  constructor(
    private el: HTMLElement,
    private renderer: TileRenderer,
  ) {}

  async load(): Promise<void> {
    this.data = (await fetch(`${BASE_URL}roles.json`).then((r) => r.json())) as RolesJson;
  }

  /** Show the picker. Resolves with the choice, or null if the user goes back. */
  pick(defaultName: string): Promise<CharacterChoice | null> {
    const { roles, races } = this.data;

    // Current selection (indices into the tables). Start random like Qt's
    // initial highlight-nothing state would after a Random press — a concrete
    // starting character invites tweaking rather than a wall of decisions.
    let roleIdx = Math.floor(Math.random() * roles.length);
    let raceIdx = 0;
    let gender: (typeof GENDERS)[number] = "male";
    let align: (typeof ALIGNS)[number] = "lawful";

    const validRaces = () => races.map((r) => roles[roleIdx]!.races.includes(r.noun));
    const validGenders = () =>
      GENDERS.map(
        (g) => roles[roleIdx]!.genders.includes(g) && races[raceIdx]!.genders.includes(g),
      );
    const validAligns = () =>
      ALIGNS.map((a) => roles[roleIdx]!.aligns.includes(a) && races[raceIdx]!.aligns.includes(a));

    /** Qt auto-corrects conflicting picks instead of allowing dead ends. */
    const reconcile = () => {
      const vr = validRaces();
      if (!vr[raceIdx]) raceIdx = vr.indexOf(true);
      const vg = validGenders();
      if (!vg[GENDERS.indexOf(gender)]) gender = GENDERS[vg.indexOf(true)]!;
      const va = validAligns();
      if (!va[ALIGNS.indexOf(align)]) align = ALIGNS[va.indexOf(true)]!;
    };
    reconcile();

    const randomize = () => {
      roleIdx = Math.floor(Math.random() * roles.length);
      const vr = validRaces();
      const raceChoices = vr.flatMap((ok, i) => (ok ? [i] : []));
      raceIdx = raceChoices[Math.floor(Math.random() * raceChoices.length)]!;
      const vg = validGenders();
      const genderChoices = GENDERS.filter((_, i) => vg[i]);
      gender = genderChoices[Math.floor(Math.random() * genderChoices.length)]!;
      const va = validAligns();
      const alignChoices = ALIGNS.filter((_, i) => va[i]);
      align = alignChoices[Math.floor(Math.random() * alignChoices.length)]!;
    };

    return new Promise((resolve) => {
      const finish = (choice: CharacterChoice | null) => {
        window.removeEventListener("keydown", onKey, true);
        this.el.replaceChildren();
        this.el.style.display = "none";
        resolve(choice);
      };

      const root = document.createElement("div");
      root.className = "charpick";

      const title = document.createElement("h2");
      title.textContent = "Who are you?";
      root.appendChild(title);

      const nameRow = document.createElement("div");
      nameRow.className = "charpick-name";
      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Name";
      nameLabel.htmlFor = "charpick-name-input";
      const nameInput = document.createElement("input");
      nameInput.id = "charpick-name-input";
      nameInput.type = "text";
      nameInput.maxLength = 31;
      nameInput.value = defaultName;
      nameInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") play();
      });
      nameRow.append(nameLabel, nameInput);
      root.appendChild(nameRow);

      const roleGrid = document.createElement("div");
      roleGrid.className = "charpick-roles";
      root.appendChild(roleGrid);

      const bottom = document.createElement("div");
      bottom.className = "charpick-bottom";
      const raceCol = section("Race");
      const genderCol = section("Sex");
      const alignCol = section("Alignment");
      bottom.append(raceCol.box, genderCol.box, alignCol.box);
      root.appendChild(bottom);

      const footer = document.createElement("div");
      footer.className = "charpick-footer";
      const backBtn = button("Back", () => finish(null));
      const randomBtn = button("Random", () => {
        randomize();
        render();
      });
      const playBtn = button("Play", () => play());
      playBtn.classList.add("primary");
      footer.append(backBtn, randomBtn, playBtn);
      root.appendChild(footer);

      const play = () => {
        finish({
          name: nameInput.value.trim() || defaultName,
          role: roles[roleIdx]!.name,
          race: races[raceIdx]!.noun,
          gender,
          align,
        });
      };

      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      };
      window.addEventListener("keydown", onKey, true);

      /** Portrait canvas for a monster, honoring the selected gender. */
      const portrait = (mnum: number, size: number): HTMLCanvasElement => {
        const glyph = gender === "female" ? this.data.nummons + mnum : mnum;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas.className = "charpick-portrait";
        const ctx = canvas.getContext("2d");
        if (ctx) this.renderer.blit(ctx, glyph, 0, 0, size);
        return canvas;
      };

      const card = (
        label: string,
        mnum: number | null,
        state: { selected: boolean; valid: boolean },
        onClick: () => void,
      ): HTMLButtonElement => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "charpick-card";
        if (state.selected) el.classList.add("selected");
        el.disabled = !state.valid;
        if (mnum !== null) el.appendChild(portrait(mnum, 32));
        const span = document.createElement("span");
        span.textContent = label;
        el.appendChild(span);
        el.addEventListener("click", onClick);
        return el;
      };

      const render = () => {
        const role = roles[roleIdx]!;

        roleGrid.replaceChildren(
          ...roles.map((r, i) =>
            card(
              gender === "female" && r.femName ? r.femName : r.name,
              r.mnum,
              { selected: i === roleIdx, valid: true },
              () => {
                roleIdx = i;
                reconcile();
                render();
              },
            ),
          ),
        );

        const vr = validRaces();
        raceCol.body.replaceChildren(
          ...races.map((r, i) =>
            card(r.noun, r.mnum, { selected: i === raceIdx, valid: !!vr[i] }, () => {
              raceIdx = i;
              reconcile();
              render();
            }),
          ),
        );

        const vg = validGenders();
        genderCol.body.replaceChildren(
          ...GENDERS.map((g, i) =>
            card(g, null, { selected: g === gender, valid: !!vg[i] }, () => {
              gender = g;
              reconcile();
              render();
            }),
          ),
        );

        const va = validAligns();
        alignCol.body.replaceChildren(
          ...ALIGNS.map((a, i) =>
            card(a, null, { selected: a === align, valid: !!va[i] }, () => {
              align = a;
              render();
            }),
          ),
        );

        // "Valkyrie the lawful female dwarf" one-line summary above the buttons.
        summary.textContent = `${nameInput.value.trim() || defaultName} the ${align} ${gender} ${
          races[raceIdx]!.adjective
        } ${gender === "female" && role.femName ? role.femName : role.name}`;
      };

      const summary = document.createElement("div");
      summary.className = "charpick-summary";
      root.insertBefore(summary, footer);
      nameInput.addEventListener("input", render);

      render();
      this.el.replaceChildren(root);
      this.el.style.display = "flex";
      nameInput.select();
      nameInput.focus();
    });
  }
}

function section(label: string): { box: HTMLElement; body: HTMLElement } {
  const box = document.createElement("div");
  box.className = "charpick-section";
  const h = document.createElement("div");
  h.className = "charpick-section-label";
  h.textContent = label;
  const body = document.createElement("div");
  body.className = "charpick-section-body";
  box.append(h, body);
  return { box, body };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}
