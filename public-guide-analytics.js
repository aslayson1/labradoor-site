/* Public guide visits only. Never runs on authenticated or token-addressed routes. */
(() => {
  if (!/^\/features\/[a-z0-9-]+$/.test(location.pathname) && location.pathname !== '/about') return;
  if (!['www.labradoor.ai', 'labradoor.ai'].includes(location.hostname)) return;
  try {
    let sessionId = sessionStorage.getItem('idx_session_id');
    if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem('idx_session_id', sessionId); }
    let acquisition = sessionStorage.getItem('idx_acquisition_context');
    if (!acquisition) {
      const params = new URLSearchParams(location.search);
      let referrerHost = '';
      try { referrerHost = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch {}
      const source = params.get('utm_source') || referrerHost || 'direct';
      acquisition = JSON.stringify({ source, medium: params.get('utm_medium') || (source === 'direct' ? 'none' : 'referral'), campaign: params.get('utm_campaign') || undefined, referrerHost: referrerHost || undefined, landingPath: location.pathname });
      sessionStorage.setItem('idx_acquisition_context', acquisition);
    }
    fetch('/api/idx/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(acquisition), sessionId, eventType: 'page_view', intent: 'labradoor_product_guide', landingPath: location.pathname }), keepalive: true }).catch(() => {});
  } catch { /* Analytics never blocks public content. */ }
})();
