/**
 * Settings tab placeholder (Step 4.5).
 *
 * The buttons are deliberately disabled until the configuration step; the
 * panel only establishes the information hierarchy and version string.
 */
export default function SettingsPanel() {
  return (
    <div className="settings-panel">
      <div className="directory-panel__header">
        <span className="directory-panel__title">
          <span aria-hidden="true">⚙️</span> Настройки
        </span>
      </div>

      <div className="settings-panel__body">
        <div className="settings-panel__version">
          <div className="settings-panel__version-title">PF2e Web Engine</div>
          <div className="settings-panel__version-row">
            <span>Система</span>
            <span>PF2e Remastered</span>
          </div>
          <div className="settings-panel__version-row">
            <span>Версия</span>
            <span>1.0.0</span>
          </div>
        </div>

        <button type="button" className="ui-button settings-panel__button" disabled>
          🎲 Настройки игры
        </button>
        <button type="button" className="ui-button settings-panel__button" disabled>
          🎮 Настройки управления
        </button>
        <button type="button" className="ui-button settings-panel__button" disabled>
          🌍 Настройка мира
        </button>

        <p className="settings-panel__hint">
          Настройки станут доступны на следующем этапе.
        </p>
      </div>
    </div>
  );
}
