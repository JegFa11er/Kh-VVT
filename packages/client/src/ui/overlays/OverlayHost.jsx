import CanvasTextInputHost from "./CanvasTextInput.jsx";
import DialogHost from "./DialogHost.jsx";
import { TokenHUDHost } from "./TokenHUD.jsx";

/**
 * Step 5.8: every in-game overlay that replaces a browser dialog.
 * Mounted once by `App.jsx` above the canvas and below floating windows.
 */
export default function OverlayHost() {
  return (
    <>
      <DialogHost />
      <CanvasTextInputHost />
      <TokenHUDHost />
    </>
  );
}
