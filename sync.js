/* sync.js — optional cross-device sync of SRS progress via Supabase.
   Loads the Supabase client only when configured (config.js). All calls fail
   soft: if offline or unconfigured, the app runs on localStorage alone and
   queued writes flush on the next successful connection. Last-write-wins by
   each card state's `last` timestamp. */
(function () {
  const cfg = window.TL_SYNC || {};
  const enabled = !!(cfg.url && cfg.anonKey);
  const TABLE = 'srs_progress';
  const QKEY = 'tl_sync_queue_v1';
  let client = null, ready = false, lastError = null, lastPull = null;

  const loadQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch { return []; } };
  const saveQueue = q => localStorage.setItem(QKEY, JSON.stringify(q));
  const errText = e => (e && (e.message || e.details || (typeof e === 'string' ? e : JSON.stringify(e)))) || 'unknown error';

  window.Sync = {
    enabled,
    ready: () => ready,
    getStatus() { return { configured: enabled, ready, lastError, lastPull, queue: loadQueue().length }; },

    async init() {
      if (!enabled) return false;
      try {
        const mod = await import('https://esm.sh/@supabase/supabase-js@2');
        client = mod.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
        ready = true; lastError = null;
        return true;
      } catch (e) { lastError = 'load client: ' + errText(e); console.warn('[sync] init failed:', e); ready = false; return false; }
    },

    // Returns array of {card_id, state} or null on failure.
    async pull() {
      if (!ready) return null;
      try {
        const { data, error } = await client.from(TABLE).select('card_id,state').eq('profile', cfg.profile);
        if (error) throw error;
        lastPull = (data || []).length; lastError = null;
        return data || [];
      } catch (e) { lastError = 'pull: ' + errText(e); console.warn('[sync] pull failed:', e); return null; }
    },

    // Queue a card's state and attempt to flush.
    push(cardId, state) {
      if (!enabled) return;
      const q = loadQueue();
      q.push({ card_id: cardId, state });
      saveQueue(q);
      this.flush();
    },

    // Flush queued upserts. Keeps them queued on failure for later retry.
    async flush() {
      if (!ready) return;
      let q = loadQueue();
      if (!q.length) return;
      const latest = {};
      for (const item of q) latest[item.card_id] = item.state;
      const rows = Object.entries(latest).map(([card_id, state]) =>
        ({ profile: cfg.profile, card_id, state, updated_at: new Date().toISOString() }));
      try {
        const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'profile,card_id' });
        if (error) throw error;
        saveQueue([]); lastError = null;
      } catch (e) { lastError = 'push: ' + errText(e); console.warn('[sync] flush deferred:', e); }
    }
  };

  window.addEventListener('online', () => { if (window.Sync && window.Sync.ready()) window.Sync.flush(); });
})();
