# Studio OS Web Test

A standalone web application prototype for Studio OS. It remains fully local by default and can optionally sync Classes + Students through Supabase.

## Technology Stack
- **Markup:** HTML5
- **Styling:** CSS3
- **Scripting:** Vanilla JavaScript (ES6+)
- **No build tools required** - runs directly in browser
- **Cloud library:** Supabase JavaScript 2.117.2, pinned and optional

## Getting Started

Simply open `index.html` in a web browser, or run a local web server:

```bash
# Using Python 3
python3 -m http.server 8000

# Using Python 2
python -m SimpleHTTPServer 8000

# Then visit: http://localhost:8000
```

## Structure
- `index.html` - Main HTML template
- `styles.css` - Application styling
- `app.js` - Main application logic
- `README.md` - This file

## Why This Technology?
- **Simple:** No build step, no Node.js required
- **Fast:** Direct browser execution, instant feedback
- **Maintainable:** Clean HTML, CSS, and JavaScript
- **Extensible:** Easy to add features and components
- **Local-first:** All core behavior still works without a Supabase connection

## Optional Classes + Students sync

1. Create a dedicated Supabase project.
2. Apply `supabase/migrations/20261007000000_create_studio_classes_and_students.sql`.
3. Put the project URL and a publishable key in `supabase-config.js`. Never use a secret or service-role key in browser code.
4. Configure the deployed URL and local development URL as allowed Auth redirect URLs in Supabase.
5. Serve the directory over HTTP, sign in by email, and choose **Sync now**.

All existing saves still go to `localStorage` first. If Supabase is unavailable or not configured, the app continues to work locally. See `MIGRATION_PLAN.md` for scope and safety limits.
