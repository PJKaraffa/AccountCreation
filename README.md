# Staff Certification & Personnel Tracker

## Included
- Administrator and user login through Supabase Authentication
- Staff record entry and editing
- Multiple locations per employee using a searchable tag selector
- Normalized `locations` and `staff_locations` database tables
- Degree and race/ethnicity dropdowns
- Automatic complete/incomplete status and completion percentage
- Administrator audit log showing who created, updated, or deleted a record
- Field-by-field before/after changes
- User role management
- CSV export
- Administrator Excel/CSV roster import with preview, duplicate detection, update/skip options, validation, and import results
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


## Import feature
1. Sign in as an administrator.
2. Open the **Import** tab.
3. Download the template or select an existing `.xlsx`, `.xls`, or `.csv` file.
4. Click **Preview File**.
5. Review new records, duplicates, and warnings.
6. Select whether duplicates should be updated or skipped.
7. Click **Import Records**.

Duplicates are matched by Employee ID. When updating, blank cells in the uploaded file do not erase existing values. Every inserted or updated record is captured by the audit trigger.


## Multiple locations
Users can type a location and press Enter to add it as a tag. Existing locations appear as suggestions. During Excel/CSV import, place multiple locations in the Location column separated by semicolons, for example: `Central High School; District Office`.

Existing installations should rerun the complete updated `schema.sql`; it safely creates the new location tables and migrates existing single-location values.


## CERT/NON-CERT correction

The first field is a classification dropdown, not a certification number.
Allowed values are:

- CERT
- NON-CERT

For compatibility with existing installations, the database column is still named `cert_number`, but it stores only these two values. The previous unique index was removed because many employees can share the same classification.


## Full entries table

The Records page now shows every field for every employee in one horizontally scrollable table. The Actions column remains fixed on the left so View, Edit, and Delete are always available while scrolling.

- Administrators can edit every record.
- Regular users can edit records they created.
- Administrators can delete records.
- All edits continue to be captured in the audit log.
