# ORBIT v2.0 — Sarman Printing Job Tracking (Production Ready)

**Fresh build — zero dummy data, zero demo accounts, zero seed jobs.**
Real database (Supabase / PostgreSQL), real email+password login, ready to host on GitHub + Cloudflare Pages.

---

## What was changed from the demo version

- ✅ Removed all **7 dummy accounts** (Boss / Admin / Sales / Design / Planner / Production / Delivery).
- ✅ Removed all **demo jobs** (JOB-0227 … JOB-0237) and every hardcoded fake client/order in every page.
- ✅ Removed the **RFID "switch user" dummy cycling** and demo-password hints on the login screen.
- ✅ Replaced the fake in-browser login with **real Supabase Auth** (email + password).
- ✅ All data (staff, jobs, notifications) now persists to **Supabase (PostgreSQL)** and syncs across every device automatically.
- ✅ First user to log in automatically becomes the **IT Administrator** with full access — exactly what you asked for.
- ✅ Every page syntax-checked; no leftover dummy references.

---

## Setup (about 15 minutes)

### Step 1 — Create a Supabase project (free tier is fine)
1. Go to https://supabase.com → **Start your project** → New project.
2. Choose a name, set a database password, pick a region close to Malaysia (e.g. Singapore).
3. Wait for the project to provision.

### Step 2 — Create the database tables
1. In Supabase Dashboard → **SQL Editor** → **New query**.
2. Open the file `supabase-schema.sql` from this package, copy ALL of it, paste, click **Run**.
3. You should see "Success". This creates 3 tables (`profiles`, `jobs`, `notifications`) + security rules.

### Step 3 — Connect the website to your database
1. Supabase Dashboard → **Project Settings → API**.
2. Copy **Project URL** and **anon public** key.
3. Open `assets/supabase-config.js` in a text editor and paste them:
   ```js
   window.ORBIT_SUPABASE_CONFIG = {
     url:     "https://YOUR-PROJECT-REF.supabase.co",   // <-- Project URL
     anonKey: "YOUR-SUPABASE-ANON-PUBLIC-KEY"            // <-- anon public key
   };
   ```
   (The anon key is safe to make public — row-level security blocks anonymous writes.)

### Step 4 — Create YOUR IT Admin login
1. Supabase Dashboard → **Authentication → Users → Add user**.
2. Enter **your email** and a **password** (this is your real IT Admin login).
3. **The first account to log in automatically becomes IT Administrator** with access to every page (including Admin panel, where you manage all staff accounts).

### Step 5 — Push to GitHub
1. Create a free account at https://github.com → **New repository** (e.g. `orbit-website`), Public or Private (Private works with Cloudflare too).
2. Upload ALL files from this folder into the repo root (drag-and-drop on the repo page, or `git push`).
   - Make sure `assets/`, all `.html` files, `supabase-schema.sql` and this README are at the repo root.

### Step 6 — Host on Cloudflare Pages (free)
1. Go to https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorize GitHub, select your `orbit-website` repository.
3. Build settings:
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`  (just a forward slash)
4. Click **Save and Deploy**. In ~1 minute you get a live `https://orbit-website.pages.dev` URL.
5. (Optional) **Custom domains** tab → add your own domain (e.g. `orbit.yourcompany.com`) — Cloudflare issues the SSL certificate automatically.

### Step 7 — Add staff accounts later (from the Admin panel)
1. Log in with your IT Admin account → open **Admin** page.
2. Click **Add Employee** → fill name, email, department, role, tick the pages they may access, save.
3. In **Supabase Dashboard → Authentication → Users → Add user**, create the login for that staff member using the **same email**. (Their first login auto-links to the profile you created; they start with restricted access until you assign pages in Admin.)

---

## How the data sync works
- Every page keeps a fast local cache (so the UI is instant) and silently syncs to Supabase in the background.
- Any change on one device (new order, stage update, delivery) appears on all other devices within 60 seconds, and immediately on the next page refresh.
- Public order tracking (`index.html`) and QR scanning (`qr-view.html`) work without login — anyone can read job status, but only logged-in staff can change anything (enforced by database security rules).

## Files
```
index.html              Public landing + order tracking (no login)
staff-login.html        Staff login (real Supabase Auth)
dashboard.html          Boss / management dashboard
admin.html              IT Admin — manage staff accounts & permissions
sales.html / new-order.html          Sales queue + create order
designer.html / submit-design.html   Design queue + submit artwork
planner.html            Planner / job sheet
production.html / log-output.html    Production floor + stage updates
delivery.html           Delivery & courier management
qr-view.html            Public QR scan + stage update (shop floor)
price-reference.html    Price list (reads price-reference.xlsx)
assets/app.js           Core logic + Supabase sync
assets/supabase-config.js  ← YOU EDIT THIS (Step 3)
assets/style.css, assets/logo.png, assets/price-reference.xlsx
supabase-schema.sql      ← run once in Supabase SQL Editor (Step 2)
README.md
```

## If login says "Supabase not configured"
You skipped Step 3 — fill in `assets/supabase-config.js`, commit, and push to GitHub. Cloudflare Pages redeploys automatically in ~30 seconds.

## Reset to completely fresh
To wipe all data and start over: Supabase Dashboard → Table Editor → delete rows from `jobs` / `notifications` / `profiles`, then clear browser localStorage for your site.
