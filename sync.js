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
  let client = null, ready = false;

  const loadQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch { return []; } };
  const saveQueue = q => localStorage.setItem(QKEY, JSON.stringify(q));

  window.Sync = {
    enabled,
    ready: () => ready,

    async init() {
      if (!enabled) return false;
      try {
        const mod = await import('https://esm.sh/@supabase/supabase-js@2');
        client = mod.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
        ready = true;
        return true;
      } catch (e) { console.warn('[sync] init failed — running local only:', e); ready = false; return false; }
    },

    // Returns array of {card_id, state} or null on failure.
    async pull() {
      if (!ready) return null;
      try {
        const { data, error } = await client.from(TABLE).select('card_id,state').eq('profile', cfg.profile);
        if (error) throw error;
        return data || [];
      } catch (e) { console.warn('[sync] pull failed:', e); return null; }
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
      // collapse to the latest state per card_id
      const latest = {};
      for (const item of q) latest[item.card_id] = item.state;
      const rows = Object.entries(latest).map(([card_id, state]) =>
        ({ profile: cfg.profile, card_id, state, updated_at: new Date().toISOString() }));
      try {
        const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'profile,card_id' });
        if (error) throw error;
        saveQueue([]);
      } catch (e) { console.warn('[sync] flush deferred:', e); }
    }
  };

  // opportunistic flush when connectivity returns
  window.addEventListener('online', () => { if (window.Sync && window.Sync.ready()) window.Sync.flush(); });
})();
