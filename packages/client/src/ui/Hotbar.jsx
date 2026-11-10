import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "./StoreContext.jsx";
import { canAcceptDrag } from "./drag-payloads.js";
import {
  HOTBAR_SLOT_KEYS,
  executeMacro,
  hotbarStorageKey,
  isTypingTarget,
  loadHotbar,
  macroGlyph,
  readMacroFromTransfer,
  saveHotbar,
  slotFromKeyboardEvent,
} from "./hotbar-macros.js";

/**
 * Foundry-style bottom hotbar (Step 4.9).
 *
 * Ten slots mapped to the 1–9/0 keys. Each connected player owns a separate
 * mapping persisted in `localStorage` (`hotbarStorageVersion:userId`).
 * Strike/spell/skill buttons from the character sheet are dragged here; a
 * click or the matching hotkey replays the exact same chat message the sheet
 * would have sent. The bar also reacts to `combatState`: slots belonging to
 * the active combatant's actor are highlighted during their turn.
 */
export default function Hotbar() {
  const { networkClient, activeRole, myUserId, combatState } = useStore();

  const storageKey = useMemo(
    () => hotbarStorageKey(myUserId, activeRole),
    [myUserId, activeRole],
  );

  const [hotbar, setHotbar] = useState(() => loadHotbar(storageKey));
  const [notice, setNotice] = useState("");
  const [dropSlot, setDropSlot] = useState(null);
  const barRef = useRef(null);

  // Switching characters/roles swaps the whole bar.
  useEffect(() => {
    setHotbar(loadHotbar(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (notice === "") {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const commitHotbar = useCallback(
    (next) => {
      setHotbar(next);
      saveHotbar(storageKey, next);
    },
    [storageKey],
  );

  const assignSlot = useCallback(
    (slot, macro) => {
      commitHotbar({ ...hotbar, [slot]: macro });
    },
    [commitHotbar, hotbar],
  );

  const clearSlot = useCallback(
    (slot) => {
      if (!hotbar[slot]) {
        return;
      }
      const next = { ...hotbar };
      delete next[slot];
      commitHotbar(next);
    },
    [commitHotbar, hotbar],
  );

  const runMacro = useCallback(
    (macro) => {
      if (!macro) {
        return;
      }
      executeMacro(networkClient, macro).catch((error) => {
        setNotice(error && error.message ? error.message : "Не удалось выполнить макрос.");
      });
    },
    [networkClient],
  );

  // Keyboard shortcuts: 1–9 and 0. `slotFromKeyboardEvent` ignores modifiers
  // and `isTypingTarget` keeps digits usable inside sheet inputs.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      const slot = slotFromKeyboardEvent(event);
      if (!slot) {
        return;
      }
      const macro = hotbar[slot];
      if (!macro) {
        return;
      }
      event.preventDefault();
      runMacro(macro);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotbar, runMacro]);

  const encounter = combatState && combatState.encounter ? combatState.encounter : null;
  const activeCombatantId =
    (encounter && encounter.activeCombatantId) ||
    (combatState && combatState.activeCombatantId) ||
    null;
  const activeCombatant = useMemo(() => {
    const combatants =
      combatState && Array.isArray(combatState.combatants)
        ? combatState.combatants
        : [];
    return combatants.find((combatant) => combatant.id === activeCombatantId) || null;
  }, [combatState, activeCombatantId]);
  const activeActorId =
    activeCombatant && (activeCombatant.actorId || activeCombatant.id)
      ? activeCombatant.actorId || activeCombatant.id
      : null;

  const handleDragOver = (event, slot) => {
    if (!canAcceptDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (dropSlot !== slot) {
      setDropSlot(slot);
    }
  };

  const handleDragLeave = (slot) => {
    if (dropSlot === slot) {
      setDropSlot(null);
    }
  };

  const handleDrop = (event, slot) => {
    const macro = readMacroFromTransfer(event.dataTransfer);
    setDropSlot(null);
    if (!macro) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    assignSlot(slot, macro);
    setNotice("Макрос «" + macro.name + "» закреплён на слоте " + slot + ".");
  };

  /** Slot under a client-space point (used by the window-level fallback). */
  const slotAtPoint = useCallback((clientX, clientY) => {
    const bar = barRef.current;
    if (!bar) {
      return null;
    }
    const rect = bar.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const slots = bar.querySelectorAll(".hotbar__slot[data-slot]");
    for (const node of slots) {
      const slotRect = node.getBoundingClientRect();
      if (
        clientX >= slotRect.left &&
        clientX <= slotRect.right &&
        clientY >= slotRect.top &&
        clientY <= slotRect.bottom
      ) {
        return node.dataset.slot || null;
      }
    }
    return null;
  }, []);

  /**
   * Safety net for the character-sheet drag: the sheet is a body-level portal
   * and can sit above the hotbar. Once `setMacroDragData()` lifts the UI overlay
   * the slot receives the drop directly; if a browser still targets the sheet,
   * the bubbling drop event is routed here by its coordinates.
   */
  useEffect(() => {
    const handleWindowDragOver = (event) => {
      if (!canAcceptDrag(event)) {
        return;
      }
      if (slotAtPoint(event.clientX, event.clientY)) {
        event.preventDefault();
      }
    };

    const handleWindowDrop = (event) => {
      if (event.defaultPrevented) {
        return;
      }
      const slot = slotAtPoint(event.clientX, event.clientY);
      if (!slot) {
        return;
      }
      const macro = readMacroFromTransfer(event.dataTransfer);
      if (!macro) {
        return;
      }
      event.preventDefault();
      assignSlot(slot, macro);
      setNotice("Макрос «" + macro.name + "» закреплён на слоте " + slot + ".");
    };

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [assignSlot, slotAtPoint]);

  return (
    <div className="hotbar" role="toolbar" aria-label="Хотбар макросов" ref={barRef}>
      {notice ? (
        <div className="hotbar__notice" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <div className="hotbar__slots">
        {HOTBAR_SLOT_KEYS.map((slot) => {
          const macro = hotbar[slot];
          const isActiveTurn = Boolean(
            macro && activeActorId && macro.actorId === activeActorId,
          );
          const isDropTarget = dropSlot === slot;
          return (
            <button
              key={slot}
              type="button"
              data-slot={slot}
              className={
                "hotbar__slot" +
                (macro ? " hotbar__slot--filled" : "") +
                (isActiveTurn ? " hotbar__slot--active-turn" : "") +
                (isDropTarget ? " hotbar__slot--drop" : "")
              }
              title={
                macro
                  ? macro.name +
                    (isActiveTurn ? " · ход этого актёра" : "") +
                    " — ЛКМ: выполнить, ПКМ: очистить"
                  : "Слот " + slot + " — перетащите сюда атаку, заклинание или навык"
              }
              aria-label={
                macro
                  ? "Макрос " + macro.name + " на слоте " + slot
                  : "Пустой слот " + slot
              }
              onClick={() => runMacro(macro)}
              onContextMenu={(event) => {
                event.preventDefault();
                clearSlot(slot);
              }}
              onDragOver={(event) => handleDragOver(event, slot)}
              onDragLeave={() => handleDragLeave(slot)}
              onDrop={(event) => handleDrop(event, slot)}
            >
              <span className="hotbar__key" aria-hidden="true">
                {slot}
              </span>
              {macro ? (
                <span className="hotbar__content">
                  <span className="hotbar__glyph" aria-hidden="true">
                    {macroGlyph(macro.type)}
                  </span>
                  {macro.icon ? (
                    <img
                      className="hotbar__icon"
                      src={macro.icon}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <span className="hotbar__name">{macro.name}</span>
                </span>
              ) : null}
              {isActiveTurn ? (
                <span className="hotbar__turn-dot" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
