/* ============================================================
   ORBIT — Supabase configuration
   ------------------------------------------------------------
   FILL IN YOUR PROJECT DETAILS BELOW.
   Find them in: Supabase Dashboard → Project Settings → API
     - URL        : Project URL
     - anonKey    : anon public key (safe to expose; RLS protects writes)
   See README.md → Step 2 for full instructions.
   ============================================================ */
window.ORBIT_SUPABASE_CONFIG = {
  url:     "https://uocpgpmpaeavzwvgqpaf.supabase.co",   // <-- replace with your Project URL
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvY3BncG1wYWVhdnp3dmdxcGFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyOTM1NDMsImV4cCI6MjEwNTg2OTU0M30.0OO8HsYGInKlDugJSohNUn9MW76AuCP81lDKgkKxCIg"            // <-- replace with your anon public key
};

/* ---- create the Supabase client (do not edit) ---- */
(function () {
  var c = window.ORBIT_SUPABASE_CONFIG || {};
  var configured =
    c.url && c.url.indexOf("YOUR-PROJECT-REF") === -1 &&
    c.anonKey && c.anonKey.indexOf("YOUR-SUPABASE-ANON") === -1;
  window.ORBIT_SB_ENABLED = !!(configured && window.supabase);
  if (window.ORBIT_SB_ENABLED) {
    window.sbClient = window.supabase.createClient(c.url, c.anonKey);
  } else {
    console.warn(
      "[ORBIT] Supabase is not configured yet — running in LOCAL-ONLY mode. " +
      "To enable real shared data + login, edit assets/supabase-config.js with your Project URL and anon key. " +
      "See README.md."
    );
  }
})();
