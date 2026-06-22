/**
 * Suppress the WebView / browser default context menu (refresh, save as, print, …).
 * Custom `onContextMenu` handlers in React still run; they only replace the native menu.
 */
export function disableNativeContextMenu(): void {
  document.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
    },
    { capture: true },
  );
}
