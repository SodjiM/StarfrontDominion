export const posts = [
  {
    id: 2,
    slug: 'alpha-1-1-qol-ui-core-update',
    title: 'Patch Notes – Alpha 1.1 Quality-of-Life, UI, and Core Gameplay Update',
    date: '2025-08-18',
    excerpt:
      'Camera persistence, order queueing (Shift), limited gate slots, streamlined ship roster, improved blueprints, effects UI, dev mode toggle, resource logic upgrades, and more.',
    body: `# 🚀 **Patch Notes – Alpha 1.1 Quality-of-Life, UI, and Core Gameplay Update**

A new wave of improvements just hit the galaxy. From smarter camera behavior to a major step forward in automation and strategy, this update aims to improve both casual and power-user experiences. See what’s new below:

---

## 🎮 **Gameplay Enhancements**

* **📷 Camera Persistence on Turn End**
  The camera now stays locked in place at the end of a turn, preventing jarring repositioning and improving strategic oversight.

* **⏳ Order Queueing System (Beta)**
  Holding **Shift** allows you to queue multiple orders in sequence (move, warp, mine, etc.).
  Ideal for long-term planning, AFK play, or automated turn progression.

* **🧱 Limited Gate Slots per System**
  Each solar system now has a **cap on the number of interstellar gates** it can support.

  * No duplicate links: All connections must be to *novel* systems, encouraging more strategic gate placement.

---

## 🚀 **Ship Updates**

* **🔧 Ship Roster Overhaul**
  The active ship list has been **pared down to four functional ships**:

  * **Drill Skiff** – Specialized in mining operations.
  * **Needle Gun Ship** – Designed for combat roles.
  * **Explorer** – Focused on long-range recon and utility.
  * **Courier** – Utility-focused, though still under active development.

* **📐 Improved Blueprint Logic**
  Ship blueprint creation has been streamlined for better consistency and future scaling.

* **✨ Buff/Debuff Effect UI**
  Ships now display status effects via an **Effects Chip UI** in the right-hand panel, including:

  * Effect name
  * Duration
  * Intensity
  * Source (e.g., ability, structure)

---

## 🛠️ **Dev Mode and Testing Tools**

* **🧪 Dev Mode Toggle**
  A checkbox in the **Shipbuilding Menu** enables dev mode, allowing all ships to be built **for free**.
  Great for testers and modders.

---

## 🌌 **World Generation & Resource Improvements**

* **🪨 Resource Node Logic Upgraded**
  Smarter distributions for mineral/resource nodes across solar systems to reflect system archetypes and balance progression.

* **🗺️ Sector Map Improvements**
  Now displays more meaningful information about:

  * What resource types are present
  * Sector archetype definitions and strategic relevance

---

## 👤 **UI & Visuals**

* **🎨 Player Color Integration**
  Primary and secondary player colors now affect:

  * UI elements (e.g., nameplates, panels)
  * Ship color schemes

* **💬 Chat System Upgrade**
  Chat now displays **usernames**, improving multiplayer clarity and identity.

---

## 🧪 **What to Test**

* Try **queuing up multi-turn actions** and letting auto-turn progression run.
* Use dev mode to build and test all available ships.
* Try mining with the **Drill Skiff**, combat with the **Needle Gun**, and scan with the **Explorer**.
* Inspect the **Effects UI Chip** by triggering buffs/debuffs on any ship.`
  },
  {
    id: 1,
    slug: 'alpha-launch',
    title: 'Alpha Launch — Starfront: Dominion',
    date: '2025-08-16',
    excerpt:
      'Create/join games, enable auto-turn timers, build Explorer ships, anchor Interstellar Gates, mine Asteroid Fields, and battle in turn-based combat.',
    body: `Welcome to the Alpha!\n\nWhat you can do today:\n- Create/join games in the Lobby (auto-turn timers enabled)\n- Build Explorer ships\n- Anchor Interstellar Gates\n- Mine Asteroid Fields\n- Engage in turn-based combat\n\nHow to start:\n1) Head to the Lobby and spin up a game\n2) Join and explore your starting sector\n3) Share feedback and report issues — your input shapes the roadmap!`
  }
];

export function getPostsSortedNewestFirst() {
  return [...posts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}


