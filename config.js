/* Cross-device sync config (Phase 3).
   Fill in url + anonKey to turn on Supabase sync. Leave blank for per-device only.
   The anon key is a PUBLIC key and is safe to commit — access is gated by the
   `profile` namespace below and the table's row-level-security policy. */
window.TL_SYNC = {
  url: "https://uamcbhuwaeglendrdzqy.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhbWNiaHV3YWVnbGVuZHJkenF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzk1NzksImV4cCI6MjA5OTk1NTU3OX0.Y2tqbSRhbielV_zwzPUvDJtm2Rt9slDSNX9jHfJPcDY",
  profile: "abhinav"
};
