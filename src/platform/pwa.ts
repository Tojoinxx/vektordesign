import { isTauri } from './files';

/**
 * Web-Version als App (iPad: „Zum Home-Bildschirm“): Service Worker registrieren, damit die
 * App offline startet, und bei einer neuen Version Bescheid geben.
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (isTauri() || location.protocol === 'file:') return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  if (import.meta.env.DEV) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      const offer = (w: ServiceWorker) =>
        onUpdate(() => {
          w.postMessage('skipWaiting');
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      // Beim Zurückkehren in die App nach Updates sehen
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      });
    } catch {
      /* ohne Service Worker läuft die App trotzdem, nur nicht offline */
    }
  });
}

/** Läuft die Web-App als installierte App (Home-Bildschirm)? */
export function isStandalone(): boolean {
  return (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
