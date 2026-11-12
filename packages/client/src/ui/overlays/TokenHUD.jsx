import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../StoreContext.jsx";
import {
  CONDITIONS,
  clampHpToMax,
  nextEntryId,
  parseHpInput,
} from "../windows/character/character-data.js";
import {
  conditionIcon,
  conditionStage,
  initialConditionStage,
} from "../conditions.js";
import { showToast } from "../toast.js";
import { TOKEN_HUD_EVENT } from "./dialog-service.js";

function tokenWorld(payload) {
  const layer =
    typeof window !== "undefined" && window.pf2e ? window.pf2e.tokenLayer : null;
  const tokenId = payload && payload.tokenId ? payload.tokenId : null;
  const token = tokenId && layer && layer.tokens ? layer.tokens.get(tokenId) : null;
  if (token) {
    return { x: token.x, y: token.y };
  }
  return payload && payload.world ? payload.world : null;
}

function screenForToken(world) {
  const debug = typeof window !== "undefined" ? window.pf2e : null;
  const viewport = debug && debug.viewport ? debug.viewport : null;
  const canvas = debug && debug.app ? debug.app.canvas : null;
  const zoom = viewport && Number.isFinite(viewport.zoom) ? viewport.zoom : 1;
  const cellSize =
    debug && debug.tokenLayer && Number.isFinite(debug.tokenLayer.cellSize)
      ? debug.tokenLayer.cellSize
      : 70;
  const radius = cellSize * 0.38 * zoom;
  if (!viewport || !canvas || !world) {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2, radius };
  }
  const point = viewport.worldToScreen(world);
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + point.x,
    y: rect.top + point.y,
    radius,
  };
}

/** "Person with an aura" glyph used by the conditions button. */
function AuraPersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="7" r="3" fill="currentColor" />
      <path
        d="M12 11c-3.2 0-5.4 1.9-5.9 4.8l-.3 1.7h12.4l-.3-1.7C17.4 12.9 15.2 11 12 11Z"
        fill="currentColor"
      />
      <path
        d="M4.6 5.2C3.6 6.7 3 8.3 3 10c0 1.7.6 3.3 1.6 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M19.4 5.2c1 1.5 1.6 3.1 1.6 4.8 0 1.7-.6 3.3-1.6 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Step 5.8 token HUD. Anchored to the token in screen space and kept in sync
 * with the camera while it is open.
 */
export default function TokenHUD({ payload, onClose }) {
  const { directories, networkClient } = useStore();
  const [hpDraft, setHpDraft] = useState("");
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [screen, setScreen] = useState(() =>
    screenForToken(tokenWorld(payload)),
  );
  const hudRef = useRef(null);
  const inputRef = useRef(null);

  const actorId = payload && payload.actorId ? payload.actorId : null;
  const actor = actorId
    ? (directories?.actors?.entries || []).find((entry) => entry.id === actorId) ||
      null
    : null;
  const actorSystem = actor && actor.system ? actor.system : {};
  const hp =
    (actorSystem.derived && actorSystem.derived.hp) ||
    (actorSystem.attributes && actorSystem.attributes.hp) ||
    {};
  const currentHp = Number.isFinite(Number(hp.value)) ? Number(hp.value) : 0;
  const maxHp = Number.isFinite(Number(hp.max)) ? Number(hp.max) : 0;
  const activeConditions = Array.isArray(actorSystem.conditions)
    ? actorSystem.conditions
    : [];
  const activeValues = new Set(
    activeConditions.map((condition) => String(condition && condition.value)),
  );

  // Re-anchor the HUD every frame so panning/zooming keeps it on the token.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = screenForToken(tokenWorld(payload));
      setScreen((previous) =>
        previous &&
        Math.abs(previous.x - next.x) < 0.5 &&
        Math.abs(previous.y - next.y) < 0.5 &&
        Math.abs(previous.radius - next.radius) < 0.5
          ? previous
          : next,
      );
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [payload]);

  // Close on outside click / Escape, like Foundry's token HUD.
  useEffect(() => {
    const handlePointerDown = (event) => {
      if (hudRef.current && hudRef.current.contains(event.target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const commitHp = () => {
    const next = parseHpInput(hpDraft, currentHp);
    if (next === null) {
      onClose();
      return;
    }
    if (!actor || !networkClient) {
      showToast("Нет соединения с сервером.");
      onClose();
      return;
    }
    const bounded = clampHpToMax(next, maxHp);
    const delta = bounded - currentHp;
    // Step 5.8.1: floating combat text above the token. Positive changes are
    // green, damage is red, and the label rises/fades in the token layer.
    if (delta !== 0) {
      const layer =
        typeof window !== "undefined" && window.pf2e
          ? window.pf2e.tokenLayer
          : null;
      if (layer && typeof layer.showFloatingText === "function") {
        layer.showFloatingText(
          payload.tokenId || actor.id,
          (delta > 0 ? "+" : "") + delta,
          delta > 0 ? 0x4caf70 : 0xe05252,
        );
      }
    }
    const nextAttributes = {
      ...(actorSystem.attributes || {}),
      hp: { ...(actorSystem.attributes?.hp || {}), value: bounded },
    };
    const nextSystem = {
      ...actorSystem,
      attributes: nextAttributes,
    };
    if (actorSystem.derived && actorSystem.derived.hp) {
      nextSystem.derived = {
        ...actorSystem.derived,
        hp: { ...actorSystem.derived.hp, value: bounded, max: maxHp },
      };
    }
    networkClient
      .updateActor(actor.id, {
        system: nextSystem,
        items: Array.isArray(actor.items) ? actor.items : undefined,
      })
      .catch((error) => {
        showToast(error.message || "Не удалось изменить хиты.");
      });
    onClose();
  };

  const toggleCondition = (definition) => {
    if (!actor || !networkClient) {
      showToast("Нет соединения с сервером.");
      return;
    }
    const nextConditions = activeValues.has(definition.value)
      ? activeConditions.filter(
          (condition) => condition && condition.value !== definition.value,
        )
      : [
          ...activeConditions,
          {
            id: nextEntryId("condition"),
            value: definition.value,
            label: definition.label,
            value2: initialConditionStage(definition.value),
          },
        ];
    const nextSystem = { ...actorSystem, conditions: nextConditions };
    networkClient
      .updateActor(actor.id, {
        system: nextSystem,
        items: Array.isArray(actor.items) ? actor.items : undefined,
      })
      .catch((error) => {
        showToast(error.message || "Не удалось изменить состояния.");
      });
  };

  return (
    <div
      ref={hudRef}
      className="token-hud"
      style={{ left: screen.x + "px", top: screen.y + "px" }}
      role="dialog"
      aria-label="Панель токена"
    >
      {actor ? (
        <div
          className="token-hud__hp"
          style={{ top: screen.radius + 22 + "px" }}
        >
          <input
            ref={inputRef}
            className="token-hud__hp-input"
            type="text"
            inputMode="text"
            value={hpDraft}
            placeholder={currentHp + "/" + maxHp}
            aria-label="Хиты токена: введите 15, +10 или -10"
            onChange={(event) => setHpDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitHp();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>
      ) : null}

      <button
        type="button"
        className={
          "token-hud__conditions" + (conditionsOpen ? " is-active" : "")
        }
        style={{ left: screen.radius + 12 + "px", top: -18 + "px" }}
        title="Состояния (Conditions)"
        aria-label="Открыть состояния токена"
        aria-expanded={conditionsOpen}
        onClick={() => setConditionsOpen((current) => !current)}
      >
        <AuraPersonIcon />
      </button>

      {conditionsOpen ? (
        <div
          className="token-hud__conditions-panel"
          style={{
            left: screen.radius + 12 + "px",
            top: screen.radius * 0.3 + "px",
          }}
        >
          <div className="token-hud__conditions-grid">
            {CONDITIONS.map((condition) => {
              const active = activeValues.has(condition.value);
              const stage = active
                ? conditionStage(
                    activeConditions.find(
                      (entry) => entry && entry.value === condition.value,
                    ),
                  )
                : 0;
              return (
                <button
                  type="button"
                  key={condition.value}
                  className={
                    "token-hud__condition" + (active ? " is-active" : "")
                  }
                  title={
                    stage > 0
                      ? condition.label + " " + stage
                      : condition.label
                  }
                  aria-label={condition.label}
                  aria-pressed={active}
                  onClick={() => toggleCondition(condition)}
                >
                  <span aria-hidden="true">{conditionIcon(condition.value)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Listens for `pf2e:token-hud-open` events emitted by the canvas interaction
 * layer and renders one HUD at a time.
 */
export function TokenHUDHost() {
  const [payload, setPayload] = useState(null);
  const close = useCallback(() => setPayload(null), []);

  useEffect(() => {
    const handleOpen = (event) => {
      if (event && event.detail) {
        setPayload(event.detail);
      }
    };
    window.addEventListener(TOKEN_HUD_EVENT, handleOpen);
    return () => window.removeEventListener(TOKEN_HUD_EVENT, handleOpen);
  }, []);

  if (!payload) {
    return null;
  }

  return <TokenHUD payload={payload} onClose={close} />;
}
