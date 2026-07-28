# Staff Certification & Personnel Tracker

## Included
- Administrator and user login through Supabase Authentication
- Staff record entry and editing
- Degree and race/ethnicity dropdowns
- Automatic complete/incomplete status and completion percentage
- Administrator audit log showing who created, updated, or deleted a record
- Field-by-field before/after changes
- User role management
- CSV export
- Responsive professional interface
- Row Level Security

## Setup

1. Create a new Supabase project.
2. Open **SQL Editor** and run `schema.sql`.
3. In Supabase, go to **Authentication > Users** and create user accounts.
4. Run the last UPDATE statement in `schema.sql` after changing it to your administrator email.
5. Go to **Project Settings > API**.
6. Copy the Project URL and anon/public key into `config.js`.
7. Upload `index.html`, `style.css`, `config.js`, and `app.js` to GitHub Pages or another static web host.

## Default permissions
- Users can see all staff records.
- Users can create records.
- Users can edit records they originally created.
- Administrators can create, edit, and delete all records.
- Only administrators can view the audit log and manage roles.

The SQL policies can be adjusted if users should only see their own records.

## Important
This system contains sensitive personnel information. Use a private deployment, strong passwords, HTTPS, and the district's approved data-security process.
